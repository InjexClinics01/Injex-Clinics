-- =============================================================================
-- Phase 1 · Migration 2: auth helpers, profile provisioning, guards, auditing
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Role helpers (used by RLS policies). SECURITY DEFINER so they can read
-- profiles without recursing into the profiles RLS policies.
-- -----------------------------------------------------------------------------
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
      and p.is_active
  );
$$;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active
  );
$$;

revoke all on function private.is_admin()       from public;
revoke all on function private.is_active_user() from public;
grant execute on function private.is_admin()       to authenticated, service_role;
grant execute on function private.is_active_user() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Profile provisioning: every new auth user gets a profile row.
--
-- SECURITY: role / employee_category / created_by are read ONLY from
-- raw_app_meta_data, which can be set solely with the service-role key
-- (server-side admin actions). raw_user_meta_data is user-controllable and is
-- used only for the display name. Users default to the least-privileged role.
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role       public.app_role := 'employee';
  v_category   text;
  v_created_by uuid;
  v_full_name  text;
begin
  if new.raw_app_meta_data ? 'role'
     and new.raw_app_meta_data ->> 'role' in ('admin', 'employee') then
    v_role := (new.raw_app_meta_data ->> 'role')::public.app_role;
  end if;

  select c.slug into v_category
  from public.employee_categories c
  where c.slug = new.raw_app_meta_data ->> 'employee_category';

  begin
    v_created_by := (new.raw_app_meta_data ->> 'created_by')::uuid;
  exception when invalid_text_representation then
    v_created_by := null;
  end;
  if v_created_by is not null
     and not exists (select 1 from public.profiles where id = v_created_by) then
    v_created_by := null;
  end if;

  v_full_name := left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120);

  insert into public.profiles (id, full_name, email, role, employee_category)
  values (new.id, v_full_name, lower(new.email), v_role, v_category);

  insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
  values (
    v_created_by,
    'profile.created',
    'profile',
    new.id,
    jsonb_build_object('email', lower(new.email), 'role', v_role, 'employee_category', v_category)
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Keep profiles.email in sync when the auth email changes.
create or replace function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function private.handle_user_email_change();

-- -----------------------------------------------------------------------------
-- Column guard for client (authenticated-role) updates on profiles.
-- RLS decides WHICH rows can be updated; this decides WHICH columns.
--   * Nobody can change id / email / created_at through the API.
--   * Employees may only change their own full_name.
--   * Admins may change role / category / active status of other users,
--     but not their own role or active status (prevents self-lockout).
-- Service-role / server-side updates are not restricted by this trigger.
-- SECURITY INVOKER on purpose: current_user must reflect the API role.
-- -----------------------------------------------------------------------------
create or replace function private.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.created_at is distinct from old.created_at then
    raise exception 'profiles: id, email and created_at cannot be changed'
      using errcode = '42501';
  end if;

  if not private.is_admin() then
    if new.role is distinct from old.role
       or new.employee_category is distinct from old.employee_category
       or new.is_active is distinct from old.is_active then
      raise exception 'profiles: only administrators can change role, category or status'
        using errcode = '42501';
    end if;
  elsif old.id = auth.uid() then
    if new.role is distinct from old.role or new.is_active is distinct from old.is_active then
      raise exception 'profiles: administrators cannot change their own role or status'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_10_guard_update on public.profiles;
create trigger profiles_10_guard_update
  before update on public.profiles
  for each row execute function private.guard_profile_update();

-- -----------------------------------------------------------------------------
-- Never allow the system to end up with zero active administrators
-- (applies to every caller, including the service role).
-- -----------------------------------------------------------------------------
create or replace function private.ensure_active_admin_remains()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.is_active)
     and not exists (
       select 1 from public.profiles
       where role = 'admin' and is_active and id <> old.id
     ) then
    raise exception 'profiles: at least one active administrator is required'
      using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists profiles_20_ensure_admin on public.profiles;
create trigger profiles_20_ensure_admin
  before update of role, is_active or delete on public.profiles
  for each row execute function private.ensure_active_admin_remains();

-- -----------------------------------------------------------------------------
-- Audit profile changes automatically (actor = auth.uid(), NULL for system).
-- -----------------------------------------------------------------------------
create or replace function private.audit_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  if new.full_name is distinct from old.full_name then
    v_changes := v_changes || jsonb_build_object('full_name', jsonb_build_object('from', old.full_name, 'to', new.full_name));
  end if;
  if new.role is distinct from old.role then
    v_changes := v_changes || jsonb_build_object('role', jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  if new.employee_category is distinct from old.employee_category then
    v_changes := v_changes || jsonb_build_object('employee_category', jsonb_build_object('from', old.employee_category, 'to', new.employee_category));
  end if;
  if new.is_active is distinct from old.is_active then
    v_changes := v_changes || jsonb_build_object('is_active', jsonb_build_object('from', old.is_active, 'to', new.is_active));
  end if;
  if new.email is distinct from old.email then
    v_changes := v_changes || jsonb_build_object('email', jsonb_build_object('from', old.email, 'to', new.email));
  end if;

  if v_changes <> '{}'::jsonb then
    insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
    values (
      (select id from public.profiles where id = auth.uid()),
      'profile.updated',
      'profile',
      new.id,
      jsonb_build_object('changes', v_changes)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_90_audit_update on public.profiles;
create trigger profiles_90_audit_update
  after update on public.profiles
  for each row execute function private.audit_profile_update();

-- Trigger functions are never called directly.
revoke all on function private.handle_new_user()             from public;
revoke all on function private.handle_user_email_change()    from public;
revoke all on function private.guard_profile_update()        from public;
revoke all on function private.ensure_active_admin_remains() from public;
revoke all on function private.audit_profile_update()        from public;
revoke all on function private.set_updated_at()              from public;
