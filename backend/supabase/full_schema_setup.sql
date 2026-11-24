e-- =============================================================================
-- Phase 1 · Migration 1: core schema
-- Injex Clinics Staff Performance Platform
--
-- Creates:
--   * private schema for internal helper functions (not exposed via the API)
--   * app_role enum
--   * employee_categories (reference data, seeded here)
--   * profiles (1:1 with auth.users)
--   * audit_logs (append-only activity log)
--   * shared triggers: updated_at maintenance
--
-- Future phases will add: metric_definitions, metric_entries, goals,
-- scoring_rules, points_transactions, rewards, reward_redemptions.
-- They should reference public.profiles(id) and public.employee_categories(slug)
-- and reuse private.set_updated_at() / private.is_admin().
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- Internal schema: security-definer helpers live here so they are not exposed
-- as RPC endpoints by PostgREST (which only exposes the `public` schema).
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role' and typnamespace = 'public'::regnamespace) then
    create type public.app_role as enum ('admin', 'employee');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''  
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- employee_categories
-- `slug` is the stable machine identifier referenced by profiles and by future
-- tables (e.g. metric_definitions per category). `name` is the display label.
-- -----------------------------------------------------------------------------
create table if not exists public.employee_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique
                check (slug ~ '^[a-z][a-z0-9_]{1,49}$'),
  name        text not null unique
                check (char_length(btrim(name)) between 2 and 100),
  description text check (description is null or char_length(description) <= 500),
  created_at  timestamptz not null default now()
);

comment on table public.employee_categories is
  'Employee job categories. Each category receives its own performance form (Phase 2).';

insert into public.employee_categories (slug, name, description) values
  ('nurse',            'Nurse',            'Clinical nursing staff.'),
  ('beauty_therapist', 'Beauty Therapist', 'Beauty and aesthetics therapy staff.')
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- profiles
-- One row per auth user, created automatically by a trigger on auth.users
-- (see migration 2). Never inserted directly by clients.
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  full_name         text not null default ''
                      check (char_length(full_name) <= 120),
  email             text not null
                      check (email = lower(email) and position('@' in email) > 1),
  role              public.app_role not null default 'employee',
  employee_category text references public.employee_categories (slug)
                      on update cascade on delete restrict,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint profiles_email_key unique (email)
);

comment on table public.profiles is
  'Application profile for each auth user: role, category and active status.';
comment on column public.profiles.employee_category is
  'Slug from employee_categories. Required for employees in practice; NULL for admins or not-yet-assigned staff.';

create index if not exists profiles_role_idx              on public.profiles (role);
create index if not exists profiles_employee_category_idx on public.profiles (employee_category);
create index if not exists profiles_is_active_idx         on public.profiles (is_active);

drop trigger if exists profiles_50_set_updated_at on public.profiles;
create trigger profiles_50_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- audit_logs
-- Append-only. user_id is the ACTOR (who performed the action).
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles (id) on delete set null,
  action      text not null check (char_length(action) between 1 and 100),
  entity_type text not null check (char_length(entity_type) between 1 and 100),
  entity_id   uuid,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

comment on table public.audit_logs is
  'Append-only audit trail. user_id = actor; entity_type/entity_id = target.';

create index if not exists audit_logs_user_id_idx    on public.audit_logs (user_id);
create index if not exists audit_logs_entity_idx     on public.audit_logs (entity_type, entity_id);
create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);
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
-- =============================================================================
-- Phase 1 · Migration 3: Row Level Security & table privileges
--
-- Principles:
--   * anon (logged-out) gets NOTHING on application tables.
--   * Employees see and edit only their own profile (name only - see guard).
--   * Admins (active, role = 'admin') can read all profiles and manage them.
--   * audit_logs are readable by admins only and are append-only for everyone
--     (rows are written by SECURITY DEFINER triggers or the service role).
--   * Deactivated users lose all access except reading their own profile
--     (so the app can explain why they were signed out).
-- =============================================================================

alter table public.employee_categories enable row level security;
alter table public.profiles            enable row level security;
alter table public.audit_logs          enable row level security;

-- -----------------------------------------------------------------------------
-- Table privileges (defence in depth on top of RLS)
-- -----------------------------------------------------------------------------
revoke all on public.employee_categories from anon, authenticated;
revoke all on public.profiles            from anon, authenticated;
revoke all on public.audit_logs          from anon, authenticated;

grant select, insert, update, delete on public.employee_categories to authenticated;
grant select, update                 on public.profiles            to authenticated;
grant select                         on public.audit_logs          to authenticated;

grant all on public.employee_categories, public.profiles, public.audit_logs to service_role;

-- -----------------------------------------------------------------------------
-- employee_categories
-- -----------------------------------------------------------------------------
drop policy if exists "categories: active users can read" on public.employee_categories;
create policy "categories: active users can read"
  on public.employee_categories for select
  to authenticated
  using ((select private.is_active_user()));

drop policy if exists "categories: admins can insert" on public.employee_categories;
create policy "categories: admins can insert"
  on public.employee_categories for insert
  to authenticated
  with check ((select private.is_admin()));

drop policy if exists "categories: admins can update" on public.employee_categories;
create policy "categories: admins can update"
  on public.employee_categories for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

drop policy if exists "categories: admins can delete" on public.employee_categories;
create policy "categories: admins can delete"
  on public.employee_categories for delete
  to authenticated
  using ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- profiles
-- No INSERT / DELETE policies: rows are created by the auth trigger and users
-- are deactivated rather than deleted.
-- -----------------------------------------------------------------------------
drop policy if exists "profiles: users read own, admins read all" on public.profiles;
create policy "profiles: users read own, admins read all"
  on public.profiles for select
  to authenticated
  using (
    id = (select auth.uid())
    or (select private.is_admin())
  );

drop policy if exists "profiles: active users update own, admins update all" on public.profiles;
create policy "profiles: active users update own, admins update all"
  on public.profiles for update
  to authenticated
  using (
    (id = (select auth.uid()) and (select private.is_active_user()))
    or (select private.is_admin())
  )
  with check (
    (id = (select auth.uid()) and (select private.is_active_user()))
    or (select private.is_admin())
  );

-- -----------------------------------------------------------------------------
-- audit_logs
-- -----------------------------------------------------------------------------
drop policy if exists "audit_logs: admins can read" on public.audit_logs;
create policy "audit_logs: admins can read"
  on public.audit_logs for select
  to authenticated
  using ((select private.is_admin()));
-- =============================================================================
-- Phase 1 · Migration 4: data-integrity hardening (from code review)
--   * Category names unique regardless of case/whitespace ("Nurse" = " nurse ")
--   * No control characters in names
--   * audit_logs.details must be a JSON object
-- Idempotent: safe to re-run.
-- =============================================================================

create unique index if not exists employee_categories_name_ci_key
  on public.employee_categories (lower(btrim(name)));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_full_name_no_control_chars') then
    alter table public.profiles
      add constraint profiles_full_name_no_control_chars check (full_name !~ '[[:cntrl:]]');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'employee_categories_name_no_control_chars') then
    alter table public.employee_categories
      add constraint employee_categories_name_no_control_chars check (name !~ '[[:cntrl:]]');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'audit_logs_details_is_object') then
    alter table public.audit_logs
      add constraint audit_logs_details_is_object check (jsonb_typeof(details) = 'object');
  end if;
end $$;

comment on column public.audit_logs.entity_id is
  'ID of the affected row. Deliberately not a foreign key: it can point at any entity_type, and audit history must survive deletionof the target.';-- =============================================================================
-- Phase 2 · Migration 5: daily metrics, goals and scoring rules
--
-- Tables:   metric_definitions, metric_entries, metric_entry_values, goals, scoring_rules
-- View:     goal_progress (computed live from submitted entries, so it cannot
--           drift or be edited directly)
-- RPC:      my_period_summary(start, end) for the employee dashboard
--
-- Key rules enforced here (not only in the app):
--   * Employees only see and change their own entries and goals.
--   * One entry per employee per date; no future dates.
--   * Calculated metrics are computed by the database (never trusted from clients)
--     and stored per entry, so later formula changes do not rewrite history.
--     Metric name/unit/type are snapshotted on each value for the same reason.
--   * Entry status workflow: draft → pending → approved | rejected,
--     corrections via rejected → draft/pending. Admin review UI arrives in Phase 3.
--   * Goals: only for goal-eligible metrics of the employee's own category,
--     current or next period only, one active goal per metric/period, and the
--     target cannot be edited after creation (only cancelled).
-- Idempotent: safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'metric_kind' and typnamespace = 'public'::regnamespace) then
    create type public.metric_kind as enum ('input', 'calculated');
  end if;
  if not exists (select 1 from pg_type where typname = 'metric_data_type' and typnamespace = 'public'::regnamespace) then
    create type public.metric_data_type as enum ('integer', 'decimal', 'currency', 'percentage');
  end if;
  if not exists (select 1 from pg_type where typname = 'metric_aggregation' and typnamespace = 'public'::regnamespace) then
    create type public.metric_aggregation as enum ('sum', 'average');
  end if;
  if not exists (select 1 from pg_type where typname = 'entry_status' and typnamespace = 'public'::regnamespace) then
    create type public.entry_status as enum ('draft', 'pending', 'approved', 'rejected');
  end if;
  if not exists (select 1 from pg_type where typname = 'goal_period' and typnamespace = 'public'::regnamespace) then
    create type public.goal_period as enum ('daily', 'weekly', 'monthly');
  end if;
  if not exists (select 1 from pg_type where typname = 'goal_status' and typnamespace = 'public'::regnamespace) then
    create type public.goal_status as enum ('active', 'cancelled');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Business "today". Must match NEXT_PUBLIC_APP_TIME_ZONE in the frontend.
create or replace function private.app_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/London')::date;
$$;

create or replace function private.current_category()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select employee_category from public.profiles where id = auth.uid() and is_active;
$$;

-- True while a category slug is being renamed (the old slug no longer exists),
-- i.e. the change is the ON UPDATE CASCADE from employee_categories, not a manual move.
create or replace function private.is_category_rename(p_old_slug text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.employee_categories where slug = p_old_slug);
$$;

-- Weeks run Monday–Sunday (ISO).
create or replace function private.period_start(p_period public.goal_period, p_day date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_period
    when 'daily' then p_day
    when 'weekly' then date_trunc('week', p_day)::date
    else date_trunc('month', p_day)::date
  end;
$$;

create or replace function private.period_end(p_period public.goal_period, p_start date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case p_period
    when 'daily' then p_start
    when 'weekly' then p_start + 6
    else (p_start + interval '1 month' - interval '1 day')::date
  end;
$$;

-- -----------------------------------------------------------------------------
-- metric_definitions
-- -----------------------------------------------------------------------------
create table if not exists public.metric_definitions (
  id                      uuid primary key default gen_random_uuid(),
  category                text not null references public.employee_categories (slug) on update cascade on delete restrict,
  key                     text not null check (key ~ '^[a-z][a-z0-9_]{1,49}$'),
  name                    text not null check (char_length(btrim(name)) between 2 and 80 and name !~ '[[:cntrl:]]'),
  description             text check (description is null or char_length(description) <= 300),
  kind                    public.metric_kind not null default 'input',
  data_type               public.metric_data_type not null default 'decimal',
  unit                    text check (unit is null or char_length(unit) <= 20),
  aggregation             public.metric_aggregation not null default 'sum',
  is_required             boolean not null default false,
  min_value               numeric(14, 4),
  max_value               numeric(14, 4),
  counts_as_unit          boolean not null default false,
  numerator_metric_id     uuid references public.metric_definitions (id) on delete restrict,
  numerator_is_unit_total boolean not null default false,
  denominator_metric_id   uuid references public.metric_definitions (id) on delete restrict,
  default_target          numeric(14, 4) check (default_target is null or default_target > 0),
  is_goal_eligible        boolean not null default false,
  is_scoring_eligible     boolean not null default false,
  sort_order              integer not null default 0,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint metric_definitions_category_key_key unique (category, key),
  constraint metric_definitions_min_max check (min_value is null or max_value is null or min_value <= max_value),
  constraint metric_definitions_kind_fields check (
    (kind = 'input'
      and numerator_metric_id is null and not numerator_is_unit_total and denominator_metric_id is null)
    or
    (kind = 'calculated'
      and denominator_metric_id is not null
      and ((numerator_metric_id is not null) <> numerator_is_unit_total)
      and not is_required and not counts_as_unit)
  )
);

comment on table public.metric_definitions is
  'Configurable daily metrics per employee category. Disabled (is_active = false) instead of deleted so history is preserved.';
comment on column public.metric_definitions.counts_as_unit is
  'Input metrics whose values are added up as "treatment units" (used by calculated metrics with numerator_is_unit_total).';

create index if not exists metric_definitions_category_idx on public.metric_definitions (category, sort_order);
create index if not exists metric_definitions_numerator_idx on public.metric_definitions (numerator_metric_id);
create index if not exists metric_definitions_denominator_idx on public.metric_definitions (denominator_metric_id);

create or replace function private.validate_metric_definition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.key is distinct from old.key or new.kind is distinct from old.kind
          or (new.category is distinct from old.category and not private.is_category_rename(old.category))) then
    raise exception 'metric_definitions: category, key and kind cannot be changed' using errcode = '42501';
  end if;

  if new.data_type = 'percentage' then
    new.min_value := greatest(coalesce(new.min_value, 0), 0);
    new.max_value := least(coalesce(new.max_value, 100), 100);
  end if;

  if new.kind = 'calculated' then
    if new.denominator_metric_id = new.id or new.numerator_metric_id = new.id
       or not exists (select 1 from public.metric_definitions d
                      where d.id = new.denominator_metric_id and d.kind = 'input' and d.category = new.category)
       or (new.numerator_metric_id is not null
           and not exists (select 1 from public.metric_definitions d
                           where d.id = new.numerator_metric_id and d.kind = 'input' and d.category = new.category)) then
      raise exception 'metric_definitions: calculated metrics must use input metrics of the same category'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists metric_definitions_10_validate on public.metric_definitions;
create trigger metric_definitions_10_validate
  before insert or update on public.metric_definitions
  for each row execute function private.validate_metric_definition();

drop trigger if exists metric_definitions_50_set_updated_at on public.metric_definitions;
create trigger metric_definitions_50_set_updated_at
  before update on public.metric_definitions
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- metric_entries (one per employee per day)
-- -----------------------------------------------------------------------------
create table if not exists public.metric_entries (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.profiles (id) on delete cascade,
  entry_date   date not null,
  category     text not null references public.employee_categories (slug) on update cascade on delete restrict,
  status       public.entry_status not null default 'draft',
  submitted_at timestamptz,
  reviewed_at  timestamptz,
  reviewed_by  uuid references public.profiles (id) on delete set null,
  review_note  text check (review_note is null or char_length(review_note) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint metric_entries_employee_date_key unique (employee_id, entry_date)
);

comment on column public.metric_entries.category is
  'Employee category at the time of the entry (kept even if the employee later changes category).';

create index if not exists metric_entries_status_idx on public.metric_entries (status, entry_date);
create index if not exists metric_entries_reviewed_by_idx on public.metric_entries (reviewed_by);
create index if not exists metric_entries_category_idx on public.metric_entries (category);

-- -----------------------------------------------------------------------------
-- metric_entry_values (one per entry per metric)
-- -----------------------------------------------------------------------------
create table if not exists public.metric_entry_values (
  id               uuid primary key default gen_random_uuid(),
  entry_id         uuid not null references public.metric_entries (id) on delete cascade,
  metric_id        uuid not null references public.metric_definitions (id) on delete restrict,
  value            numeric(14, 4),
  metric_name      text not null default '',
  metric_unit      text,
  metric_data_type public.metric_data_type not null default 'decimal',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint metric_entry_values_entry_metric_key unique (entry_id, metric_id)
);

comment on column public.metric_entry_values.value is
  'NULL only for calculated metrics that cannot be computed (e.g. division by zero).';
comment on column public.metric_entry_values.metric_name is
  'Snapshot of the metric name when the value was saved (history survives renames).';

create index if not exists metric_entry_values_metric_idx on public.metric_entry_values (metric_id);

-- Missing required input metrics for an entry (NULL when complete).
create or replace function private.missing_required_metrics(p_entry_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select string_agg(d.name, ', ' order by d.sort_order)
  from public.metric_entries e
  join public.metric_definitions d
    on d.category = e.category and d.kind = 'input' and d.is_active and d.is_required
  where e.id = p_entry_id
    and not exists (
      select 1 from public.metric_entry_values v
      where v.entry_id = e.id and v.metric_id = d.id and v.value is not null
    );
$$;

-- Insert: category from the employee's profile, only draft, no future dates.
-- Update: immutable identity columns + the status workflow.
-- SECURITY INVOKER on purpose: current_user must reflect the API role.
create or replace function private.guard_metric_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_client  boolean := current_user in ('authenticated', 'anon');
  v_admin   boolean;
  v_change  text;
  v_missing text;
begin
  if tg_op = 'INSERT' then
    if v_client and new.employee_id is distinct from auth.uid() then
      raise exception 'metric_entries: you can only create your own entries' using errcode = '42501';
    end if;
    new.category := (select p.employee_category from public.profiles p where p.id = new.employee_id);
    if new.category is null then
      raise exception 'metric_entries: you have not been assigned a category yet' using errcode = 'P0001';
    end if;
    if new.entry_date > private.app_today() then
      raise exception 'metric_entries: entries cannot be made for future dates' using errcode = '22023';
    end if;
    if v_client and new.status <> 'draft' then
      raise exception 'metric_entries: new entries must start as drafts' using errcode = '42501';
    end if;
    new.submitted_at := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.review_note := null;
    return new;
  end if;

  if new.employee_id <> old.employee_id or new.entry_date <> old.entry_date or new.created_at <> old.created_at
     or (new.category <> old.category and not private.is_category_rename(old.category)) then
    raise exception 'metric_entries: employee, date and category cannot be changed' using errcode = '42501';
  end if;

  if v_client then
    v_admin := private.is_admin();

    if new.status is distinct from old.status then
      v_change := old.status || '>' || new.status;
      if old.employee_id = auth.uid() then
        -- submit, resubmit after rejection, back to draft, or withdraw a pending entry
        if v_change not in ('draft>pending', 'rejected>pending', 'rejected>draft', 'pending>draft') then
          raise exception 'metric_entries: cannot change status from % to %', old.status, new.status using errcode = '42501';
        end if;
      elsif v_admin then
        -- approve, reject, or reopen an approved entry for correction
        if v_change not in ('pending>approved', 'pending>rejected', 'approved>rejected') then
          raise exception 'metric_entries: cannot change status from % to %', old.status, new.status using errcode = '42501';
        end if;
      else
        raise exception 'metric_entries: not allowed' using errcode = '42501';
      end if;
    end if;

    if not v_admin and (new.reviewed_at is distinct from old.reviewed_at
                        or new.reviewed_by is distinct from old.reviewed_by
                        or new.review_note is distinct from old.review_note
                        or new.submitted_at is distinct from old.submitted_at) then
      raise exception 'metric_entries: review fields are managed by the system' using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'pending' then
      v_missing := private.missing_required_metrics(new.id);
      if v_missing is not null then
        raise exception 'Please complete the required fields: %', v_missing using errcode = 'P0001';
      end if;
      new.submitted_at := now();
      new.reviewed_at := null;
      new.reviewed_by := null;
    elsif new.status in ('approved', 'rejected') then
      new.reviewed_at := now();
      new.reviewed_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists metric_entries_10_guard on public.metric_entries;
create trigger metric_entries_10_guard
  before insert or update on public.metric_entries
  for each row execute function private.guard_metric_entry();

drop trigger if exists metric_entries_50_set_updated_at on public.metric_entries;
create trigger metric_entries_50_set_updated_at
  before update on public.metric_entries
  for each row execute function private.set_updated_at();

-- Validate input values and snapshot the definition.
create or replace function private.prepare_entry_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.metric_definitions;
begin
  select * into d from public.metric_definitions where id = new.metric_id;

  if d.kind = 'input' then
    if new.value is null then
      raise exception '%: a value is required', d.name using errcode = '23502';
    end if;
    if d.data_type = 'integer' and new.value <> trunc(new.value) then
      raise exception '%: must be a whole number', d.name using errcode = '22023';
    end if;
    if d.min_value is not null and new.value < d.min_value then
      raise exception '%: must be at least %', d.name, d.min_value using errcode = '22023';
    end if;
    if d.max_value is not null and new.value > d.max_value then
      raise exception '%: must be at most %', d.name, d.max_value using errcode = '22023';
    end if;
  end if;

  new.metric_name := d.name;
  new.metric_unit := d.unit;
  new.metric_data_type := d.data_type;
  return new;
end;
$$;

drop trigger if exists metric_entry_values_10_prepare on public.metric_entry_values;
create trigger metric_entry_values_10_prepare
  before insert or update on public.metric_entry_values
  for each row execute function private.prepare_entry_value();

drop trigger if exists metric_entry_values_50_set_updated_at on public.metric_entry_values;
create trigger metric_entry_values_50_set_updated_at
  before update on public.metric_entry_values
  for each row execute function private.set_updated_at();

-- Recompute all active calculated metrics of an entry. Division by zero → NULL.
create or replace function private.recalculate_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category text;
  m          public.metric_definitions;
  v_num      numeric;
  v_den      numeric;
begin
  select category into v_category from public.metric_entries where id = p_entry_id;
  if not found then
    return; -- entry is being deleted
  end if;

  for m in
    select * from public.metric_definitions
    where category = v_category and kind = 'calculated' and is_active
  loop
    if m.numerator_is_unit_total then
      select coalesce(sum(v.value), 0) into v_num
      from public.metric_entry_values v
      join public.metric_definitions d on d.id = v.metric_id
      where v.entry_id = p_entry_id and d.kind = 'input' and d.counts_as_unit;
    else
      select v.value into v_num from public.metric_entry_values v
      where v.entry_id = p_entry_id and v.metric_id = m.numerator_metric_id;
    end if;

    select v.value into v_den from public.metric_entry_values v
    where v.entry_id = p_entry_id and v.metric_id = m.denominator_metric_id;

    insert into public.metric_entry_values (entry_id, metric_id, value)
    values (p_entry_id, m.id, case when v_num is null or coalesce(v_den, 0) = 0 then null else round(v_num / v_den, 4) end)
    on conflict (entry_id, metric_id) do update set value = excluded.value;

    v_num := null;
    v_den := null;
  end loop;
end;
$$;

create or replace function private.after_entry_value_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.metric_definitions
             where id = coalesce(new.metric_id, old.metric_id) and kind = 'input') then
    perform private.recalculate_entry(coalesce(new.entry_id, old.entry_id));
  end if;
  return null;
end;
$$;

drop trigger if exists metric_entry_values_90_recalculate on public.metric_entry_values;
create trigger metric_entry_values_90_recalculate
  after insert or update or delete on public.metric_entry_values
  for each row execute function private.after_entry_value_change();

-- Can the current user write this value? (own editable entry, active input metric of the entry's category)
create or replace function private.can_edit_entry_value(p_entry_id uuid, p_metric_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user() and exists (
    select 1
    from public.metric_entries e
    join public.metric_definitions d on d.id = p_metric_id
    where e.id = p_entry_id
      and e.employee_id = auth.uid()
      and e.status in ('draft', 'rejected')
      and d.category = e.category
      and d.kind = 'input'
      and d.is_active
  );
$$;

-- -----------------------------------------------------------------------------
-- goals
-- -----------------------------------------------------------------------------
create table if not exists public.goals (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.profiles (id) on delete cascade,
  metric_id    uuid not null references public.metric_definitions (id) on delete restrict,
  period       public.goal_period not null,
  period_start date not null,
  period_end   date not null,
  target_value numeric(14, 4) not null check (target_value > 0),
  status       public.goal_status not null default 'active',
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint goals_period_range check (period_end >= period_start)
);

create unique index if not exists goals_one_active_per_metric_period
  on public.goals (employee_id, metric_id, period, period_start) where status = 'active';
create index if not exists goals_employee_idx on public.goals (employee_id, period_end);
create index if not exists goals_metric_idx on public.goals (metric_id);

create or replace function private.guard_goal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today   date := private.app_today();
  v_current date;
  d         public.metric_definitions;
begin
  if tg_op = 'INSERT' then
    v_current := private.period_start(new.period, v_today);
    new.period_start := private.period_start(new.period, coalesce(new.period_start, v_today));
    new.period_end := private.period_end(new.period, new.period_start);

    -- Current or next period only: no back-dated goals for results already achieved.
    if new.period_start not in (v_current, private.period_end(new.period, v_current) + 1) then
      raise exception 'Goals can only be set for the current or next period' using errcode = '22023';
    end if;

    select * into d from public.metric_definitions where id = new.metric_id;
    if not found or not d.is_active or not d.is_goal_eligible
       or d.category is distinct from (select employee_category from public.profiles where id = new.employee_id) then
      raise exception 'This metric is not available for your goals' using errcode = '42501';
    end if;
    if d.data_type = 'percentage' and new.target_value > 100 then
      raise exception 'Percentage targets cannot exceed 100' using errcode = '22023';
    end if;

    new.status := 'active';
    new.cancelled_at := null;
    return new;
  end if;

  -- UPDATE: a goal can only be cancelled; the target and period are fixed.
  if new.employee_id <> old.employee_id or new.metric_id <> old.metric_id or new.period <> old.period
     or new.period_start <> old.period_start or new.period_end <> old.period_end
     or new.target_value <> old.target_value or new.created_at <> old.created_at then
    raise exception 'Goals cannot be edited. Cancel it and create a new one instead.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not (old.status = 'active' and new.status = 'cancelled') then
      raise exception 'Only active goals can be cancelled' using errcode = '42501';
    end if;
    new.cancelled_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists goals_10_guard on public.goals;
create trigger goals_10_guard
  before insert or update on public.goals
  for each row execute function private.guard_goal();

drop trigger if exists goals_50_set_updated_at on public.goals;
create trigger goals_50_set_updated_at
  before update on public.goals
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- scoring_rules (points preview now; points are credited in a later phase)
-- -----------------------------------------------------------------------------
create table if not exists public.scoring_rules (
  id         uuid primary key default gen_random_uuid(),
  metric_id  uuid not null references public.metric_definitions (id) on delete restrict,
  period     public.goal_period not null,
  threshold  numeric(14, 4) not null check (threshold >= 0),
  points     integer not null check (points between 1 and 100000),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint scoring_rules_metric_period_threshold_key unique (metric_id, period, threshold)
);

comment on table public.scoring_rules is
  'Reaching `threshold` for `metric` over `period` earns `points`. Tiers: several thresholds per metric/period; the highest reached applies.';

create or replace function private.validate_scoring_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.metric_id <> old.metric_id then
    raise exception 'scoring_rules: metric cannot be changed' using errcode = '42501';
  end if;
  if new.is_active and not exists (
       select 1 from public.metric_definitions where id = new.metric_id and is_scoring_eligible and is_active) then
    raise exception 'This metric is not enabled for scoring' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists scoring_rules_10_validate on public.scoring_rules;
create trigger scoring_rules_10_validate
  before insert or update on public.scoring_rules
  for each row execute function private.validate_scoring_rule();

drop trigger if exists scoring_rules_50_set_updated_at on public.scoring_rules;
create trigger scoring_rules_50_set_updated_at
  before update on public.scoring_rules
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Aggregation: value of a metric for an employee over a date range.
-- Counts submitted entries only (pending or approved).
--   input sum/average → sum/average of daily values
--   calculated        → ratio of totals (e.g. weekly revenue / weekly hours)
-- SECURITY INVOKER: RLS limits employees to their own entries.
-- -----------------------------------------------------------------------------
create or replace function private.metric_period_value(p_employee uuid, p_metric uuid, p_start date, p_end date)
returns table (value numeric, entries_counted integer)
language plpgsql
stable
set search_path = ''
as $$
declare
  m public.metric_definitions;
begin
  select * into m from public.metric_definitions where id = p_metric;
  if not found then
    return query select null::numeric, 0;
    return;
  end if;

  if m.kind = 'input' then
    return query
      select case when m.aggregation = 'average' then round(avg(v.value), 4) else sum(v.value) end,
             count(*)::integer
      from public.metric_entries e
      join public.metric_entry_values v on v.entry_id = e.id and v.metric_id = p_metric
      where e.employee_id = p_employee and e.entry_date between p_start and p_end
        and e.status in ('pending', 'approved');
  else
    return query
      with per_entry as (
        select
          (select v.value from public.metric_entry_values v
             where v.entry_id = e.id and v.metric_id = m.denominator_metric_id) as den,
          case when m.numerator_is_unit_total then
            (select coalesce(sum(v.value), 0) from public.metric_entry_values v
               join public.metric_definitions d on d.id = v.metric_id
               where v.entry_id = e.id and d.kind = 'input' and d.counts_as_unit)
          else
            (select v.value from public.metric_entry_values v
               where v.entry_id = e.id and v.metric_id = m.numerator_metric_id)
          end as num
        from public.metric_entries e
        where e.employee_id = p_employee and e.entry_date between p_start and p_end
          and e.status in ('pending', 'approved')
      )
      select case when coalesce(sum(den), 0) = 0 then null else round(sum(num) / sum(den), 4) end,
             count(*)::integer
      from per_entry
      where num is not null and den is not null;
  end if;
end;
$$;

-- Created only if missing: a later migration extends this view with more columns,
-- and re-running this file must not try to remove them.
do $view$
begin
  if to_regclass('public.goal_progress') is not null then
    return;
  end if;
  create view public.goal_progress
  with (security_invoker = true) as
  select
  g.id as goal_id,
  g.employee_id,
  g.metric_id,
  g.period,
  g.period_start,
  g.period_end,
  g.target_value,
  g.status,
  p.value as current_value,
  p.entries_counted,
  case when p.value is null then 0 else round(p.value / g.target_value * 100, 1) end as percent_complete,
  greatest(g.target_value - coalesce(p.value, 0), 0) as remaining
  from public.goals g
  cross join lateral private.metric_period_value(g.employee_id, g.metric_id, g.period_start, g.period_end) p;
end
$view$;

comment on view public.goal_progress is
  'Live goal progress from submitted (pending/approved) entries. Read-only; respects RLS on goals and entries.';

-- Dashboard summary for the signed-in employee.
create or replace function public.my_period_summary(p_start date, p_end date)
returns table (metric_id uuid, value numeric, entries_counted integer)
language sql
stable
set search_path = ''
as $$
  select d.id, s.value, s.entries_counted
  from public.metric_definitions d
  cross join lateral private.metric_period_value(auth.uid(), d.id, p_start, p_end) s
  where d.category = private.current_category() and d.is_active
  order by d.sort_order;
$$;

-- -----------------------------------------------------------------------------
-- Privileges & RLS
-- -----------------------------------------------------------------------------
alter table public.metric_definitions  enable row level security;
alter table public.metric_entries      enable row level security;
alter table public.metric_entry_values enable row level security;
alter table public.goals               enable row level security;
alter table public.scoring_rules       enable row level security;

revoke all on public.metric_definitions, public.metric_entries, public.metric_entry_values,
              public.goals, public.scoring_rules, public.goal_progress from anon, authenticated;

grant select, insert, update         on public.metric_definitions  to authenticated;
grant select, insert, update         on public.metric_entries      to authenticated;
grant select, insert, update, delete on public.metric_entry_values to authenticated;
grant select, insert, update         on public.goals               to authenticated;
grant select, insert, update         on public.scoring_rules       to authenticated;
grant select                         on public.goal_progress       to authenticated;
grant all on public.metric_definitions, public.metric_entries, public.metric_entry_values,
             public.goals, public.scoring_rules, public.goal_progress to service_role;

revoke all on function public.my_period_summary(date, date) from public, anon;
grant execute on function public.my_period_summary(date, date) to authenticated, service_role;

revoke all on function private.app_today(), private.current_category(), private.is_category_rename(text),
  private.period_start(public.goal_period, date), private.period_end(public.goal_period, date),
  private.missing_required_metrics(uuid), private.recalculate_entry(uuid),
  private.can_edit_entry_value(uuid, uuid), private.metric_period_value(uuid, uuid, date, date),
  private.validate_metric_definition(), private.guard_metric_entry(), private.prepare_entry_value(),
  private.after_entry_value_change(), private.guard_goal(), private.validate_scoring_rule()
  from public;
grant execute on function private.app_today(), private.current_category(), private.is_category_rename(text),
  private.period_start(public.goal_period, date), private.period_end(public.goal_period, date),
  private.missing_required_metrics(uuid), private.can_edit_entry_value(uuid, uuid),
  private.metric_period_value(uuid, uuid, date, date)
  to authenticated, service_role;

-- metric_definitions: employees read their own category; admins manage everything.
drop policy if exists "metrics: read own category, admins all" on public.metric_definitions;
create policy "metrics: read own category, admins all"
  on public.metric_definitions for select to authenticated
  using (category = (select private.current_category()) or (select private.is_admin()));

drop policy if exists "metrics: admins insert" on public.metric_definitions;
create policy "metrics: admins insert"
  on public.metric_definitions for insert to authenticated
  with check ((select private.is_admin()));

drop policy if exists "metrics: admins update" on public.metric_definitions;
create policy "metrics: admins update"
  on public.metric_definitions for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- metric_entries
drop policy if exists "entries: own or admin read" on public.metric_entries;
create policy "entries: own or admin read"
  on public.metric_entries for select to authenticated
  using (employee_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists "entries: employees create own drafts" on public.metric_entries;
create policy "entries: employees create own drafts"
  on public.metric_entries for insert to authenticated
  with check (employee_id = (select auth.uid()) and status = 'draft' and (select private.is_active_user()));

drop policy if exists "entries: own or admin update" on public.metric_entries;
create policy "entries: own or admin update"
  on public.metric_entries for update to authenticated
  using ((employee_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()))
  with check ((employee_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));

-- metric_entry_values: readable with the entry; writable only while the entry is editable.
drop policy if exists "entry values: read with entry" on public.metric_entry_values;
create policy "entry values: read with entry"
  on public.metric_entry_values for select to authenticated
  using (exists (select 1 from public.metric_entries e where e.id = entry_id));

drop policy if exists "entry values: insert while editable" on public.metric_entry_values;
create policy "entry values: insert while editable"
  on public.metric_entry_values for insert to authenticated
  with check (private.can_edit_entry_value(entry_id, metric_id));

drop policy if exists "entry values: update while editable" on public.metric_entry_values;
create policy "entry values: update while editable"
  on public.metric_entry_values for update to authenticated
  using (private.can_edit_entry_value(entry_id, metric_id))
  with check (private.can_edit_entry_value(entry_id, metric_id));

drop policy if exists "entry values: delete while editable" on public.metric_entry_values;
create policy "entry values: delete while editable"
  on public.metric_entry_values for delete to authenticated
  using (private.can_edit_entry_value(entry_id, metric_id));

-- goals
drop policy if exists "goals: own or admin read" on public.goals;
create policy "goals: own or admin read"
  on public.goals for select to authenticated
  using (employee_id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists "goals: employees create own" on public.goals;
create policy "goals: employees create own"
  on public.goals for insert to authenticated
  with check (employee_id = (select auth.uid()) and (select private.is_active_user()));

drop policy if exists "goals: own or admin update" on public.goals;
create policy "goals: own or admin update"
  on public.goals for update to authenticated
  using ((employee_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()))
  with check ((employee_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));

-- scoring_rules: readable for metrics the user can see; admins manage.
drop policy if exists "scoring rules: read visible metrics" on public.scoring_rules;
create policy "scoring rules: read visible metrics"
  on public.scoring_rules for select to authenticated
  using (exists (select 1 from public.metric_definitions d where d.id = metric_id));

drop policy if exists "scoring rules: admins insert" on public.scoring_rules;
create policy "scoring rules: admins insert"
  on public.scoring_rules for insert to authenticated
  with check ((select private.is_admin()));

drop policy if exists "scoring rules: admins update" on public.scoring_rules;
create policy "scoring rules: admins update"
  on public.scoring_rules for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- -----------------------------------------------------------------------------
-- Seed: Nurse metrics (from the Nurse spreadsheet fields).
-- Beauty Therapist metrics are intentionally NOT seeded: an admin configures them.
-- Scoring rules are NOT seeded: example values in the brief are illustrative only.
-- -----------------------------------------------------------------------------
insert into public.metric_definitions
  (category, key, name, kind, data_type, unit, aggregation, is_required, min_value, max_value,
   counts_as_unit, is_goal_eligible, is_scoring_eligible, sort_order)
values
  ('nurse', 'hours_worked',   'Hours Worked',      'input', 'decimal',    'h',          'sum',     true,  0, 24,   false, false, false, 10),
  ('nurse', 'revenue',        'Revenue',           'input', 'currency',   '$',          'sum',     true,  0, null, false, true,  true,  20),
  ('nurse', 'rebooking_pct',  'Rebooking %',       'input', 'percentage', '%',          'average', true,  0, 100,  false, true,  true,  30),
  ('nurse', 'tickets',        'Number of Tickets', 'input', 'integer',    'tickets',    'sum',     true,  0, null, false, true,  true,  40),
  ('nurse', 'filler_ml',      'Filler (ml)',       'input', 'decimal',    'ml',         'sum',     false, 0, null, true,  false, false, 50),
  ('nurse', 'sculptra',       'Sculptra',          'input', 'integer',    'treatments', 'sum',     false, 0, null, true,  false, false, 60),
  ('nurse', 'profhilo',       'Profhilo',          'input', 'integer',    'treatments', 'sum',     false, 0, null, true,  false, false, 70),
  ('nurse', 'sunekos',        'Sunekos',           'input', 'integer',    'treatments', 'sum',     false, 0, null, true,  false, false, 80),
  ('nurse', 'prp',            'PRP',               'input', 'integer',    'treatments', 'sum',     false, 0, null, true,  false, false, 90),
  ('nurse', 'pdo_treatments', 'PDO Treatments',    'input', 'integer',    'treatments', 'sum',     false, 0, null, true,  false, false, 100)
on conflict (category, key) do nothing;

insert into public.metric_definitions
  (category, key, name, description, kind, data_type, unit, numerator_metric_id, numerator_is_unit_total,
   denominator_metric_id, is_goal_eligible, is_scoring_eligible, sort_order)
select 'nurse', v.key, v.name, v.description, 'calculated', v.data_type::public.metric_data_type, v.unit,
       (select id from public.metric_definitions where category = 'nurse' and key = v.numerator),
       v.numerator is null,
       (select id from public.metric_definitions where category = 'nurse' and key = v.denominator),
       true, true, v.sort_order
from (values
  ('hourly_revenue',     'Hourly Revenue',     'Revenue ÷ Hours Worked',                        'currency', '$/h',     'revenue', 'hours_worked', 110),
  ('revenue_per_ticket', 'Revenue Per Ticket', 'Revenue ÷ Number of Tickets',                   'currency', '$/ticket','revenue', 'tickets',      120),
  ('units_per_hour',     'Units Per Hour',     'Treatment units (metrics marked as units) ÷ Hours Worked', 'decimal', 'units/h', null, 'hours_worked', 130)
) as v(key, name, description, data_type, unit, numerator, denominator, sort_order)
on conflict (category, key) do nothing;
-- =============================================================================
-- Phase 3 · Migration 6: admin verification, leaderboard, reporting, audit
--
-- Verification
--   * Admin decisions: approve, request correction (status 'rejected', the
--     employee can edit and resubmit, as in Phase 2) or reject
--     (status 'rejected' + final_rejection: locked for the employee).
--     Rejecting and requesting a correction both require a reason.
--   * Admins can correct values of submitted entries; every change is audited.
--   * Only APPROVED entries count towards verified performance: leaderboard,
--     reports, charts and (in Phase 4) points.
--
-- Leaderboard / reporting
--   * private.period_values(): the single set-based aggregation of metric values
--     (also used by Phase 2's metric_period_value, so the rules live in one place).
--   * public.metric_series(): approved values per period bucket (RLS applies:
--     employees get only their own data, admins everyone's).
--   * public.submission_stats(): submissions per day by status (reports).
--   * public.leaderboard(): points from admin scoring rules for a day/week/month.
--     Employees see colleagues' names, points and goal achievement, but raw
--     figures only for themselves, plus their own category's team average
--     where at least 3 people have results (so no one's figures can be worked out).
--   * app_settings.overall_leaderboard_enabled: show the cross-category board
--     (normalised points) to employees.
--
-- Audit: entry status changes, value changes on submitted entries, and
-- metric / scoring rule / settings changes are written to audit_logs.
-- Idempotent: safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- metric_entries: final rejection flag
-- -----------------------------------------------------------------------------
alter table public.metric_entries add column if not exists final_rejection boolean not null default false;

comment on column public.metric_entries.final_rejection is
  'Status rejected + true: rejected by an admin, locked for the employee. Rejected + false: correction requested.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'metric_entries_final_rejection_status') then
    alter table public.metric_entries
      add constraint metric_entries_final_rejection_status check (not final_rejection or status = 'rejected');
  end if;
end $$;

-- Phase 2 workflow, extended with final rejection, required reasons,
-- rejected → approved for admins, and a completeness check on approval.
-- SECURITY INVOKER on purpose: current_user must reflect the API role.
create or replace function private.guard_metric_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_client  boolean := current_user in ('authenticated', 'anon');
  v_admin   boolean;
  v_change  text;
  v_missing text;
begin
  if tg_op = 'INSERT' then
    if v_client and new.employee_id is distinct from auth.uid() then
      raise exception 'metric_entries: you can only create your own entries' using errcode = '42501';
    end if;
    new.category := (select p.employee_category from public.profiles p where p.id = new.employee_id);
    if new.category is null then
      raise exception 'metric_entries: you have not been assigned a category yet' using errcode = 'P0001';
    end if;
    if new.entry_date > private.app_today() then
      raise exception 'metric_entries: entries cannot be made for future dates' using errcode = '22023';
    end if;
    if v_client and new.status <> 'draft' then
      raise exception 'metric_entries: new entries must start as drafts' using errcode = '42501';
    end if;
    new.submitted_at := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.review_note := null;
    new.final_rejection := false;
    return new;
  end if;

  if new.employee_id <> old.employee_id or new.entry_date <> old.entry_date or new.created_at <> old.created_at
     or (new.category <> old.category and not private.is_category_rename(old.category)) then
    raise exception 'metric_entries: employee, date and category cannot be changed' using errcode = '42501';
  end if;

  if v_client then
    v_admin := private.is_admin();

    if new.status is distinct from old.status then
      v_change := old.status || '>' || new.status;
      if old.employee_id = auth.uid() then
        -- submit, resubmit after a correction request, back to draft, or withdraw a pending entry
        if v_change not in ('draft>pending', 'rejected>pending', 'rejected>draft', 'pending>draft')
           or old.final_rejection then
          raise exception 'metric_entries: cannot change status from % to %', old.status, new.status using errcode = '42501';
        end if;
      elsif v_admin then
        -- approve, reject / request a correction, reopen an approved entry, or overturn a rejection
        if v_change not in ('pending>approved', 'pending>rejected', 'approved>rejected', 'rejected>approved') then
          raise exception 'metric_entries: cannot change status from % to %', old.status, new.status using errcode = '42501';
        end if;
      else
        raise exception 'metric_entries: not allowed' using errcode = '42501';
      end if;
    end if;

    if not v_admin and (new.reviewed_at is distinct from old.reviewed_at
                        or new.reviewed_by is distinct from old.reviewed_by
                        or new.review_note is distinct from old.review_note
                        or new.final_rejection is distinct from old.final_rejection
                        or new.submitted_at is distinct from old.submitted_at) then
      raise exception 'metric_entries: review fields are managed by the system' using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from old.status then
    if new.status in ('pending', 'approved') then
      v_missing := private.missing_required_metrics(new.id);
      if v_missing is not null then
        raise exception 'Please complete the required fields: %', v_missing using errcode = 'P0001';
      end if;
    end if;
    if new.status = 'pending' then
      new.submitted_at := now();
      new.reviewed_at := null;
      new.reviewed_by := null;
    elsif new.status in ('approved', 'rejected') then
      new.reviewed_at := now();
      new.reviewed_by := auth.uid();
    end if;
  elsif new.status = 'rejected'
        and (new.final_rejection is distinct from old.final_rejection or new.review_note is distinct from old.review_note) then
    -- decision changed between "rejected" and "correction requested"
    new.reviewed_at := now();
    new.reviewed_by := auth.uid();
  end if;

  if new.status <> 'rejected' then
    new.final_rejection := false;
  elsif nullif(btrim(coalesce(new.review_note, '')), '') is null then
    raise exception 'metric_entries: a reason is required to reject or request a correction' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Owner edits: drafts and correction requests only (not final rejections).
create or replace function private.can_edit_entry_value(p_entry_id uuid, p_metric_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user() and exists (
    select 1
    from public.metric_entries e
    join public.metric_definitions d on d.id = p_metric_id
    where e.id = p_entry_id
      and e.employee_id = auth.uid()
      and (e.status = 'draft' or (e.status = 'rejected' and not e.final_rejection))
      and d.category = e.category
      and d.kind = 'input'
      and d.is_active
  );
$$;

-- Admin corrections: input values of submitted entries (pending, approved, rejected).
-- Existing values of since-disabled metrics can still be corrected.
create or replace function private.can_admin_edit_entry_value(p_entry_id uuid, p_metric_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin() and exists (
    select 1
    from public.metric_entries e
    join public.metric_definitions d on d.id = p_metric_id
    where e.id = p_entry_id
      and e.status in ('pending', 'approved', 'rejected')
      and d.category = e.category
      and d.kind = 'input'
      and (d.is_active or exists (select 1 from public.metric_entry_values v
                                  where v.entry_id = e.id and v.metric_id = d.id))
  );
$$;

-- Admins may insert and update values; deleting stays owner-only (drafts).
drop policy if exists "entry values: insert while editable" on public.metric_entry_values;
create policy "entry values: insert while editable"
  on public.metric_entry_values for insert to authenticated
  with check (private.can_edit_entry_value(entry_id, metric_id) or private.can_admin_edit_entry_value(entry_id, metric_id));

drop policy if exists "entry values: update while editable" on public.metric_entry_values;
create policy "entry values: update while editable"
  on public.metric_entry_values for update to authenticated
  using (private.can_edit_entry_value(entry_id, metric_id) or private.can_admin_edit_entry_value(entry_id, metric_id))
  with check (private.can_edit_entry_value(entry_id, metric_id) or private.can_admin_edit_entry_value(entry_id, metric_id));

-- -----------------------------------------------------------------------------
-- Aggregation (one implementation for goals, leaderboard, charts and reports)
--   input sum/average → sum/average of daily values
--   calculated        → ratio of totals (e.g. weekly revenue / weekly hours)
-- p_bucket NULL: one row per employee and metric for the whole range;
-- otherwise one row per day / week / month (bucket = period start).
-- SECURITY INVOKER: RLS applies to direct callers.
-- -----------------------------------------------------------------------------
create or replace function private.period_values(
  p_start    date,
  p_end      date,
  p_statuses public.entry_status[],
  p_bucket   public.goal_period default null,
  p_employee uuid default null,
  p_category text default null,
  p_metric   uuid default null
)
returns table (bucket date, employee_id uuid, metric_id uuid, value numeric, entries_counted integer)
language sql
stable
set search_path = ''
as $$
  with entries as (
    select e.id, e.employee_id, e.category,
           case when p_bucket is null then p_start else private.period_start(p_bucket, e.entry_date) end as bucket
    from public.metric_entries e
    where e.entry_date between p_start and p_end
      and e.status = any (p_statuses)
      and (p_employee is null or e.employee_id = p_employee)
      and (p_category is null or e.category = p_category)
  ),
  ratios as (
    select en.bucket, en.employee_id, d.id as metric_id,
           (select v.value from public.metric_entry_values v
             where v.entry_id = en.id and v.metric_id = d.denominator_metric_id) as den,
           case when d.numerator_is_unit_total then
             (select coalesce(sum(v.value), 0) from public.metric_entry_values v
                join public.metric_definitions u on u.id = v.metric_id
               where v.entry_id = en.id and u.kind = 'input' and u.counts_as_unit)
           else
             (select v.value from public.metric_entry_values v
               where v.entry_id = en.id and v.metric_id = d.numerator_metric_id)
           end as num
    from entries en
    join public.metric_definitions d on d.category = en.category and d.kind = 'calculated'
    where p_metric is null or d.id = p_metric
  )
  select en.bucket, en.employee_id, d.id,
         case when d.aggregation = 'average' then round(avg(v.value), 4) else sum(v.value) end,
         count(*)::integer
  from entries en
  join public.metric_entry_values v on v.entry_id = en.id
  join public.metric_definitions d on d.id = v.metric_id and d.kind = 'input'
  where p_metric is null or d.id = p_metric
  group by en.bucket, en.employee_id, d.id, d.aggregation
  union all
  select bucket, employee_id, metric_id,
         case when coalesce(sum(den), 0) = 0 then null else round(sum(num) / sum(den), 4) end,
         count(*)::integer
  from ratios
  where num is not null and den is not null
  group by bucket, employee_id, metric_id;
$$;

-- Phase 2 signature kept (goal_progress depends on it); now uses the shared aggregation.
create or replace function private.metric_period_value(p_employee uuid, p_metric uuid, p_start date, p_end date)
returns table (value numeric, entries_counted integer)
language sql
stable
set search_path = ''
as $$
  select p.value, coalesce(p.entries_counted, 0)
  from (select 1) as one
  left join private.period_values(p_start, p_end, array['pending', 'approved']::public.entry_status[],
                                  null, p_employee, null, p_metric) p on true;
$$;

-- goal_progress: Phase 2 columns unchanged (submitted entries); verified_* count approved entries only.
create or replace view public.goal_progress
with (security_invoker = true) as
select
  g.id as goal_id,
  g.employee_id,
  g.metric_id,
  g.period,
  g.period_start,
  g.period_end,
  g.target_value,
  g.status,
  p.value as current_value,
  p.entries_counted,
  case when p.value is null then 0 else round(p.value / g.target_value * 100, 1) end as percent_complete,
  greatest(g.target_value - coalesce(p.value, 0), 0) as remaining,
  a.value as verified_value,
  case when a.value is null then 0 else round(a.value / g.target_value * 100, 1) end as verified_percent
from public.goals g
cross join lateral private.metric_period_value(g.employee_id, g.metric_id, g.period_start, g.period_end) p
left join lateral private.period_values(g.period_start, g.period_end, array['approved']::public.entry_status[],
                                        null, g.employee_id, null, g.metric_id) a on true;

comment on view public.goal_progress is
  'Live goal progress. current_value: submitted (pending/approved) entries; verified_value: approved only. Read-only; respects RLS.';

-- Approved values per bucket. RLS: employees get their own data only.
create or replace function public.metric_series(
  p_bucket   public.goal_period,
  p_start    date,
  p_end      date,
  p_employee uuid default null,
  p_category text default null
)
returns table (bucket date, employee_id uuid, metric_id uuid, value numeric, entries_counted integer)
language sql
stable
set search_path = ''
as $$
  select * from private.period_values(p_start, p_end, array['approved']::public.entry_status[],
                                      p_bucket, p_employee, p_category, null);
$$;

-- Submissions per day by status (drafts excluded). One row per day, so a year
-- stays well under the API row limit. RLS: employees get their own entries only.
create or replace function public.submission_stats(p_start date, p_end date, p_category text default null, p_employee uuid default null)
returns table (day date, submitted integer, approved integer, pending integer, rejected integer)
language sql
stable
set search_path = ''
as $$
  select e.entry_date,
         count(*)::integer,
         (count(*) filter (where e.status = 'approved'))::integer,
         (count(*) filter (where e.status = 'pending'))::integer,
         (count(*) filter (where e.status = 'rejected'))::integer
  from public.metric_entries e
  where e.entry_date between p_start and p_end
    and e.status <> 'draft'
    and (p_category is null or e.category = p_category)
    and (p_employee is null or e.employee_id = p_employee)
  group by e.entry_date
  order by e.entry_date;
$$;

-- -----------------------------------------------------------------------------
-- app_settings (single row)
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  id                          uuid primary key default gen_random_uuid(),
  singleton                   boolean not null default true unique check (singleton),
  overall_leaderboard_enabled boolean not null default false,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

comment on table public.app_settings is 'Organisation-wide settings. Exactly one row.';

insert into public.app_settings (singleton) values (true) on conflict (singleton) do nothing;

drop trigger if exists app_settings_50_set_updated_at on public.app_settings;
create trigger app_settings_50_set_updated_at
  before update on public.app_settings
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Leaderboard for one day / week / month, approved entries only.
-- points     = per scoring metric, the highest rule tier reached; summed
-- max_points = the same for every metric's top tier (used to normalise across categories)
-- Employees: own category only (or all categories if the overall board is enabled);
-- metric_values only for their own row.
-- -----------------------------------------------------------------------------
create or replace function private.leaderboard(p_period public.goal_period, p_day date, p_category text)
returns table (
  employee_id    uuid,
  full_name      text,
  category       text,
  points         integer,
  max_points     integer,
  goals_set      integer,
  goals_achieved integer,
  approved_days  integer,
  metric_values  jsonb,
  team_average   jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin boolean := private.is_admin();
  v_own   text    := private.current_category();
  v_start date    := private.period_start(p_period, p_day);
  v_end   date    := private.period_end(p_period, private.period_start(p_period, p_day));
begin
  if not v_admin then
    if v_own is null then
      return; -- inactive or unassigned
    end if;
    if p_category is null
       and not coalesce((select s.overall_leaderboard_enabled from public.app_settings s), false) then
      raise exception 'The overall leaderboard is not enabled' using errcode = '42501';
    end if;
    if p_category is not null and p_category <> v_own then
      raise exception 'You can only view your own category''s leaderboard' using errcode = '42501';
    end if;
  end if;

  return query
  with staff as (
    select p.id, p.full_name, p.employee_category as category
    from public.profiles p
    where p.role = 'employee' and p.is_active and p.employee_category is not null
      and (p_category is null or p.employee_category = p_category)
  ),
  vals as (
    -- only metrics of the employee's current category
    select v.employee_id, v.metric_id, v.value, s.category
    from private.period_values(v_start, v_end, array['approved']::public.entry_status[], null, null, p_category, null) v
    join staff s on s.id = v.employee_id
    join public.metric_definitions d on d.id = v.metric_id and d.category = s.category
  ),
  rules as (
    select r.metric_id, r.threshold, r.points, d.category
    from public.scoring_rules r
    join public.metric_definitions d on d.id = r.metric_id
    where r.is_active and r.period = p_period and d.is_active and d.is_scoring_eligible
  ),
  earned as (
    select t.employee_id, sum(t.top)::integer as points
    from (select v.employee_id, r.metric_id, max(r.points) as top
          from vals v join rules r on r.metric_id = v.metric_id and v.value >= r.threshold
          group by v.employee_id, r.metric_id) t
    group by t.employee_id
  ),
  max_pts as (
    select t.category, sum(t.top)::integer as max_points
    from (select r.category, r.metric_id, max(r.points) as top from rules r group by r.category, r.metric_id) t
    group by t.category
  ),
  goal_stats as (
    select g.employee_id,
           count(*)::integer as goals_set,
           (count(*) filter (where v.value >= g.target_value))::integer as goals_achieved
    from public.goals g
    left join vals v on v.employee_id = g.employee_id and v.metric_id = g.metric_id
    where g.status = 'active' and g.period = p_period and g.period_start = v_start
    group by g.employee_id
  ),
  days as (
    select e.employee_id, count(*)::integer as approved_days
    from public.metric_entries e
    where e.status = 'approved' and e.entry_date between v_start and v_end
    group by e.employee_id
  ),
  own_values as (
    select v.employee_id, jsonb_object_agg(v.metric_id, v.value) as metric_values
    from vals v
    group by v.employee_id
  ),
  averages as (
    select a.category,
           jsonb_object_agg(a.metric_id, a.avg_value) as team_average,
           coalesce(jsonb_object_agg(a.metric_id, a.avg_value) filter (where a.people >= 3), '{}'::jsonb) as private_average
    from (select v.category, v.metric_id, round(avg(v.value), 4) as avg_value, count(*) as people
          from vals v where v.value is not null
          group by v.category, v.metric_id) a
    group by a.category
  )
  select s.id, s.full_name, s.category,
         coalesce(e.points, 0), coalesce(m.max_points, 0),
         coalesce(gs.goals_set, 0), coalesce(gs.goals_achieved, 0), coalesce(d.approved_days, 0),
         case when v_admin or s.id = auth.uid() then ov.metric_values end,
         case when v_admin then av.team_average when s.category = v_own then av.private_average end
  from staff s
  left join earned e      on e.employee_id = s.id
  left join max_pts m     on m.category = s.category
  left join goal_stats gs on gs.employee_id = s.id
  left join days d        on d.employee_id = s.id
  left join own_values ov on ov.employee_id = s.id
  left join averages av   on av.category = s.category;
end;
$$;

create or replace function public.leaderboard(p_period public.goal_period, p_day date, p_category text default null)
returns table (
  employee_id    uuid,
  full_name      text,
  category       text,
  points         integer,
  max_points     integer,
  goals_set      integer,
  goals_achieved integer,
  approved_days  integer,
  metric_values  jsonb,
  team_average   jsonb
)
language sql
stable
set search_path = ''
as $$
  select * from private.leaderboard(p_period, p_day, p_category);
$$;

-- -----------------------------------------------------------------------------
-- Audit trail
-- -----------------------------------------------------------------------------
create or replace function private.audit_actor()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.profiles where id = auth.uid();
$$;

-- Status changes and review decisions on daily entries.
create or replace function private.audit_entry_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_action text;
begin
  if new.status = old.status and new.final_rejection = old.final_rejection
     and new.review_note is not distinct from old.review_note then
    return null;
  end if;

  v_action := case
    when new.status = 'pending'  and old.status = 'rejected' then 'entry.resubmitted'
    when new.status = 'pending'  then 'entry.submitted'
    when new.status = 'draft'    then 'entry.withdrawn'
    when new.status = 'approved' then 'entry.approved'
    when new.final_rejection     then 'entry.rejected'
    else 'entry.correction_requested'
  end;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
  values (private.audit_actor(), v_action, 'metric_entry', new.id,
          jsonb_build_object('employee_id', new.employee_id, 'entry_date', new.entry_date,
                             'from', old.status, 'to', new.status, 'note', new.review_note));
  return null;
end;
$$;

drop trigger if exists metric_entries_90_audit on public.metric_entries;
create trigger metric_entries_90_audit
  after update on public.metric_entries
  for each row execute function private.audit_entry_status();

-- Value changes on entries that have been submitted at least once
-- (admin edits and employee corrections; draft typing is not logged).
create or replace function private.audit_entry_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry  public.metric_entries;
  v_row    public.metric_entry_values := case when tg_op = 'DELETE' then old else new end;
  v_actor  uuid := private.audit_actor();
begin
  if tg_op = 'UPDATE' and new.value is not distinct from old.value then
    return null;
  end if;
  if not exists (select 1 from public.metric_definitions where id = v_row.metric_id and kind = 'input') then
    return null;
  end if;
  select * into v_entry from public.metric_entries where id = v_row.entry_id;
  if not found or v_entry.submitted_at is null then
    return null;
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
  values (v_actor, case when v_actor is distinct from v_entry.employee_id then 'entry.value_edited_by_admin'
                        else 'entry.value_corrected' end,
          'metric_entry', v_entry.id,
          jsonb_build_object('employee_id', v_entry.employee_id, 'entry_date', v_entry.entry_date,
                             'metric_id', v_row.metric_id, 'metric_name', v_row.metric_name,
                             'from', case when tg_op = 'INSERT' then null else old.value end,
                             'to', case when tg_op = 'DELETE' then null else new.value end));
  return null;
end;
$$;

drop trigger if exists metric_entry_values_95_audit on public.metric_entry_values;
create trigger metric_entry_values_95_audit
  after insert or update or delete on public.metric_entry_values
  for each row execute function private.audit_entry_value();

-- Configuration changes. TG_ARGV[0] = entity type.
create or replace function private.audit_config_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new     jsonb := to_jsonb(new) - 'created_at' - 'updated_at';
  v_old     jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key     text;
begin
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - 'created_at' - 'updated_at';
    for v_key in select jsonb_object_keys(v_new) loop
      if v_new -> v_key is distinct from v_old -> v_key then
        v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('from', v_old -> v_key, 'to', v_new -> v_key));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null;
    end if;
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
  values (private.audit_actor(),
          tg_argv[0] || case when tg_op = 'INSERT' then '.created' else '.updated' end,
          tg_argv[0], new.id,
          case when tg_op = 'INSERT' then jsonb_build_object('values', v_new - 'id')
               else jsonb_build_object('changes', v_changes) end);
  return null;
end;
$$;

drop trigger if exists metric_definitions_90_audit on public.metric_definitions;
create trigger metric_definitions_90_audit
  after insert or update on public.metric_definitions
  for each row execute function private.audit_config_change('metric_definition');

drop trigger if exists scoring_rules_90_audit on public.scoring_rules;
create trigger scoring_rules_90_audit
  after insert or update on public.scoring_rules
  for each row execute function private.audit_config_change('scoring_rule');

drop trigger if exists app_settings_90_audit on public.app_settings;
create trigger app_settings_90_audit
  after update on public.app_settings
  for each row execute function private.audit_config_change('app_settings');

-- -----------------------------------------------------------------------------
-- Indexes for review queues and reports
-- -----------------------------------------------------------------------------
create index if not exists metric_entries_date_idx on public.metric_entries (entry_date desc);

-- -----------------------------------------------------------------------------
-- Privileges & RLS
-- -----------------------------------------------------------------------------
alter table public.app_settings enable row level security;

revoke all on public.app_settings from anon, authenticated;
grant select, update on public.app_settings to authenticated;
grant all on public.app_settings to service_role;

drop policy if exists "settings: active users read" on public.app_settings;
create policy "settings: active users read"
  on public.app_settings for select to authenticated
  using ((select private.is_active_user()));

drop policy if exists "settings: admins update" on public.app_settings;
create policy "settings: admins update"
  on public.app_settings for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- goal_progress was re-created: re-apply its grants.
revoke all on public.goal_progress from anon, authenticated;
grant select on public.goal_progress to authenticated;
grant all on public.goal_progress to service_role;

revoke all on function public.metric_series(public.goal_period, date, date, uuid, text) from public, anon;
revoke all on function public.leaderboard(public.goal_period, date, text) from public, anon;
revoke all on function public.submission_stats(date, date, text, uuid) from public, anon;
grant execute on function public.submission_stats(date, date, text, uuid) to authenticated, service_role;
grant execute on function public.metric_series(public.goal_period, date, date, uuid, text) to authenticated, service_role;
grant execute on function public.leaderboard(public.goal_period, date, text) to authenticated, service_role;

revoke all on function
  private.period_values(date, date, public.entry_status[], public.goal_period, uuid, text, uuid),
  private.leaderboard(public.goal_period, date, text),
  private.can_admin_edit_entry_value(uuid, uuid),
  private.audit_actor(), private.audit_entry_status(), private.audit_entry_value(), private.audit_config_change()
  from public;
grant execute on function
  private.period_values(date, date, public.entry_status[], public.goal_period, uuid, text, uuid),
  private.leaderboard(public.goal_period, date, text),
  private.can_admin_edit_entry_value(uuid, uuid)
  to authenticated, service_role;
-- =============================================================================
-- Phase 4 · Migration 7: points engine, wallet, rewards and redemptions
--
-- Points ledger (points_transactions)
--   * Append-only. Balances are always the SUM of the ledger; nothing stores a
--     balance that could drift. Only SECURITY DEFINER functions below write to it
--     (clients have SELECT only), so employees can never change their own points.
--   * Earned from APPROVED entries only:
--       performance  admin scoring rules (daily / weekly / monthly): per metric,
--                    the highest tier the period's approved result reaches
--       goal         an achieved goal earns the tier its target reaches (as previewed
--                    in Phase 2), if the goal was set before any entry of its period
--                    was submitted (no setting goals after the results are known)
--       streak       optional: N consecutive weeks with at least M approved entries
--   * A period's points are PENDING while the period is open or has entries awaiting
--     review, and are CREDITED once when it is settled (points_settlements). A
--     unique key per award makes double crediting impossible.
--   * If an admin later changes an approved result in a settled period, the period
--     is recalculated and the difference is posted as a 'correction' transaction.
--     Changing scoring rules alone never rewrites credited history.
--
-- Rewards: catalogue managed by admins (stock NULL = unlimited).
-- Redemptions: request (points reserved) → approve (points deducted, stock
--   reduced) / reject → fulfilled; an approved request can be refunded.
--   All steps run in locked functions: no overspending, no negative balance
--   from redemptions, no duplicate pending request for the same reward.
-- Idempotent: safe to re-run.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'points_kind' and typnamespace = 'public'::regnamespace) then
    create type public.points_kind as enum ('performance', 'goal', 'streak', 'correction', 'adjustment', 'redemption', 'refund');
  end if;
  if not exists (select 1 from pg_type where typname = 'redemption_status' and typnamespace = 'public'::regnamespace) then
    create type public.redemption_status as enum ('pending', 'approved', 'rejected', 'fulfilled', 'cancelled');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Settings: when points start, and the optional consistency streak
-- -----------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists points_start_date date not null default ((now() at time zone 'Europe/London')::date),
  add column if not exists streak_enabled    boolean not null default false,
  add column if not exists streak_min_days   integer not null default 4,
  add column if not exists streak_weeks      integer not null default 4,
  add column if not exists streak_points     integer not null default 100;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'app_settings_streak_ranges') then
    alter table public.app_settings add constraint app_settings_streak_ranges check (
      streak_min_days between 1 and 7 and streak_weeks between 1 and 52 and streak_points between 1 and 100000);
  end if;
end $$;

comment on column public.app_settings.points_start_date is
  'Periods ending before this date never earn points (avoids crediting test or historic data).';

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table if not exists public.points_transactions (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.profiles (id) on delete restrict,
  kind            public.points_kind not null,
  amount          integer not null check (amount <> 0 and abs(amount) <= 1000000),
  description     text not null check (char_length(description) between 1 and 300),
  -- Earned points: which award (e.g. "perf:<metric>:weekly:2026-11-02") and period.
  award_key       text,
  period          public.goal_period,
  period_start    date,
  metric_id       uuid references public.metric_definitions (id) on delete restrict,
  goal_id         uuid references public.goals (id) on delete restrict,
  redemption_id   uuid,
  -- Prevents posting the same transaction twice (per employee).
  idempotency_key text not null,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint points_transactions_idempotency_key unique (employee_id, idempotency_key),
  constraint points_transactions_sign check (
    (kind in ('performance', 'goal', 'streak', 'refund') and amount > 0)
    or (kind = 'redemption' and amount < 0)
    or kind in ('correction', 'adjustment')),
  constraint points_transactions_award check ((award_key is null) = (kind not in ('performance', 'goal', 'streak', 'correction')))
);

comment on table public.points_transactions is
  'Append-only points ledger. Balance = SUM(amount). Written only by private.* functions; never updated or deleted.';

create index if not exists points_transactions_employee_idx on public.points_transactions (employee_id, created_at desc);
create index if not exists points_transactions_award_idx on public.points_transactions (employee_id, period, period_start);
create index if not exists points_transactions_metric_idx on public.points_transactions (metric_id);
create index if not exists points_transactions_goal_idx on public.points_transactions (goal_id);
create index if not exists points_transactions_redemption_idx on public.points_transactions (redemption_id);
create index if not exists points_transactions_created_by_idx on public.points_transactions (created_by);

create table if not exists public.points_settlements (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.profiles (id) on delete cascade,
  period       public.goal_period not null,
  period_start date not null,
  settled_at   timestamptz not null default now(),
  constraint points_settlements_once unique (employee_id, period, period_start)
);

comment on table public.points_settlements is 'Periods whose points have been credited (each exactly once).';

create table if not exists public.rewards (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 2 and 80 and name !~ '[[:cntrl:]]'),
  description text check (description is null or char_length(description) <= 500),
  points_cost integer not null check (points_cost between 1 and 1000000),
  stock       integer check (stock is null or stock >= 0),
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.rewards.stock is 'Items left. NULL = unlimited. Reduced when a redemption is approved.';
create unique index if not exists rewards_name_key on public.rewards (lower(name));

create table if not exists public.reward_redemptions (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.profiles (id) on delete restrict,
  reward_id    uuid not null references public.rewards (id) on delete restrict,
  reward_name  text not null,
  points_cost  integer not null check (points_cost > 0),
  status       public.redemption_status not null default 'pending',
  admin_note   text check (admin_note is null or char_length(admin_note) <= 500),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  decided_by   uuid references public.profiles (id) on delete set null,
  fulfilled_at timestamptz,
  fulfilled_by uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz not null default now()
);

comment on column public.reward_redemptions.points_cost is 'Price when requested (later price changes do not affect it).';

-- One open request per employee and reward.
create unique index if not exists reward_redemptions_one_pending
  on public.reward_redemptions (employee_id, reward_id) where status = 'pending';
create index if not exists reward_redemptions_status_idx on public.reward_redemptions (status, requested_at);
create index if not exists reward_redemptions_employee_idx on public.reward_redemptions (employee_id, requested_at desc);
create index if not exists reward_redemptions_reward_idx on public.reward_redemptions (reward_id);
create index if not exists reward_redemptions_decided_by_idx on public.reward_redemptions (decided_by);
create index if not exists reward_redemptions_fulfilled_by_idx on public.reward_redemptions (fulfilled_by);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'points_transactions_redemption_id_fkey') then
    alter table public.points_transactions
      add constraint points_transactions_redemption_id_fkey
      foreign key (redemption_id) references public.reward_redemptions (id) on delete restrict;
  end if;
end $$;

-- The ledger is immutable, even for the service role.
create or replace function private.ledger_is_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'points_transactions is append-only: post a correcting transaction instead' using errcode = '42501';
end;
$$;

drop trigger if exists points_transactions_10_append_only on public.points_transactions;
create trigger points_transactions_10_append_only
  before update or delete on public.points_transactions
  for each row execute function private.ledger_is_append_only();

drop trigger if exists rewards_50_set_updated_at on public.rewards;
create trigger rewards_50_set_updated_at
  before update on public.rewards
  for each row execute function private.set_updated_at();

drop trigger if exists reward_redemptions_50_set_updated_at on public.reward_redemptions;
create trigger reward_redemptions_50_set_updated_at
  before update on public.reward_redemptions
  for each row execute function private.set_updated_at();

drop trigger if exists rewards_90_audit on public.rewards;
create trigger rewards_90_audit
  after insert or update on public.rewards
  for each row execute function private.audit_config_change('reward');

-- -----------------------------------------------------------------------------
-- Balances (view over the ledger; RLS of the underlying tables applies)
-- -----------------------------------------------------------------------------
create or replace view public.points_balances
with (security_invoker = true) as
select
  p.id as employee_id,
  p.full_name,
  p.employee_category,
  p.is_active,
  coalesce(t.balance, 0)::integer as balance,
  coalesce(t.earned, 0)::integer as lifetime_earned,
  coalesce(t.redeemed, 0)::integer as redeemed,
  coalesce(h.held, 0)::integer as held,
  (coalesce(t.balance, 0) - coalesce(h.held, 0))::integer as available
from public.profiles p
left join (
  select employee_id,
         sum(amount) as balance,
         sum(amount) filter (where kind not in ('redemption', 'refund')) as earned,
         -sum(amount) filter (where kind in ('redemption', 'refund')) as redeemed
  from public.points_transactions
  group by employee_id
) t on t.employee_id = p.id
left join (
  select employee_id, sum(points_cost) as held
  from public.reward_redemptions
  where status = 'pending'
  group by employee_id
) h on h.employee_id = p.id
where p.role = 'employee';

comment on view public.points_balances is
  'balance = ledger total; held = points reserved by pending redemption requests; available = balance - held.';

-- -----------------------------------------------------------------------------
-- Points engine
-- -----------------------------------------------------------------------------
-- Serialises all point changes for one employee (crediting, redeeming, adjusting).
create or replace function private.lock_points(p_employee uuid)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('points:' || p_employee::text, 0));
$$;

-- Points a goal is worth: the highest active scoring tier its target reaches (Phase 2 preview rule).
create or replace function private.goal_tier_points(p_metric uuid, p_period public.goal_period, p_target numeric)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(r.points), 0)::integer
  from public.scoring_rules r
  join public.metric_definitions d on d.id = r.metric_id
  where r.metric_id = p_metric and r.period = p_period and r.is_active and r.threshold <= p_target
    and d.is_active and d.is_scoring_eligible;
$$;

-- Every award an employee earns for one period, from entries with the given statuses
-- (approved only when crediting; pending + approved for the "pending points" preview).
create or replace function private.period_awards(
  p_employee uuid,
  p_period   public.goal_period,
  p_start    date,
  p_statuses public.entry_status[]
)
returns table (award_key text, kind public.points_kind, points integer, metric_id uuid, goal_id uuid, description text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_end      date := private.period_end(p_period, p_start);
  v_category text := (select pr.employee_category from public.profiles pr where pr.id = p_employee);
  v_first    timestamptz;
  v_settings public.app_settings;
  v_week     date;
  v_streak   integer := 0;
begin
  -- Scoring rules: per metric, the highest tier reached.
  return query
  select distinct on (r.metric_id)
         'perf:' || r.metric_id || ':' || p_period || ':' || p_start,
         'performance'::public.points_kind,
         r.points,
         r.metric_id,
         null::uuid,
         format('%s: %s target of %s reached', d.name, p_period, trim_scale(r.threshold))
  from private.period_values(p_start, v_end, p_statuses, null, p_employee, null, null) v
  join public.scoring_rules r on r.metric_id = v.metric_id and r.period = p_period and r.is_active and v.value >= r.threshold
  join public.metric_definitions d on d.id = r.metric_id and d.is_active and d.is_scoring_eligible and d.category = v_category
  order by r.metric_id, r.points desc;

  -- Goals achieved, if set before the period's first submission.
  v_first := (select min(e.submitted_at) from public.metric_entries e
              where e.employee_id = p_employee and e.entry_date between p_start and v_end and e.submitted_at is not null);
  return query
  select 'goal:' || g.id,
         'goal'::public.points_kind,
         private.goal_tier_points(g.metric_id, g.period, g.target_value),
         g.metric_id,
         g.id,
         format('Goal achieved: %s %s target of %s', d.name, g.period, trim_scale(g.target_value))
  from public.goals g
  join public.metric_definitions d on d.id = g.metric_id
  cross join lateral private.period_values(p_start, v_end, p_statuses, null, p_employee, null, g.metric_id) v
  where g.employee_id = p_employee and g.status = 'active' and g.period = p_period and g.period_start = p_start
    and v.value >= g.target_value
    and g.created_at <= coalesce(v_first, 'infinity'::timestamptz)
    and private.goal_tier_points(g.metric_id, g.period, g.target_value) > 0;

  -- Consistency streak: consecutive weeks (ending with this one) with enough entries.
  select * into v_settings from public.app_settings;
  if p_period = 'weekly' and v_settings.streak_enabled then
    v_week := p_start;
    while v_streak < 104 and (select count(*) from public.metric_entries e
                              where e.employee_id = p_employee and e.entry_date between v_week and v_week + 6
                                and e.status = any (p_statuses)) >= v_settings.streak_min_days loop
      v_streak := v_streak + 1;
      v_week := v_week - 7;
    end loop;
    if v_streak > 0 and v_streak % v_settings.streak_weeks = 0 then
      return query select 'streak:' || p_start, 'streak'::public.points_kind, v_settings.streak_points, null::uuid, null::uuid,
                          format('%s-week consistency streak (%s+ approved days a week)', v_streak, v_settings.streak_min_days);
    end if;
  end if;
end;
$$;

-- Credit a period (or recalculate a credited one): post the difference between what
-- the approved data earns now and what has been credited, per award.
create or replace function private.settle_period(p_employee uuid, p_period public.goal_period, p_start date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  a       record;
  v_net   integer := 0;
  v_delta integer;
begin
  perform private.lock_points(p_employee);

  for a in
    with target as (
      select * from private.period_awards(p_employee, p_period, p_start, array['approved']::public.entry_status[])
    ),
    posted as (
      select t.award_key,
             sum(t.amount)::integer as credited,
             count(*)::integer as posts,
             max(t.description) filter (where t.kind <> 'correction') as description,
             max(t.metric_id::text)::uuid as metric_id,
             max(t.goal_id::text)::uuid as goal_id
      from public.points_transactions t
      where t.employee_id = p_employee and t.period = p_period and t.period_start = p_start and t.award_key is not null
      group by t.award_key
    )
    select coalesce(tg.award_key, po.award_key) as award_key,
           tg.kind,
           coalesce(tg.points, 0) as target,
           coalesce(po.credited, 0) as credited,
           coalesce(po.posts, 0) as posts,
           coalesce(tg.metric_id, po.metric_id) as metric_id,
           coalesce(tg.goal_id, po.goal_id) as goal_id,
           coalesce(tg.description, po.description) as description
    from target tg
    full join posted po on po.award_key = tg.award_key
  loop
    v_delta := a.target - a.credited;
    continue when v_delta = 0;
    insert into public.points_transactions
      (employee_id, kind, amount, description, award_key, period, period_start, metric_id, goal_id, idempotency_key)
    values (
      p_employee,
      case when a.posts = 0 then a.kind else 'correction' end,
      v_delta,
      case when a.posts = 0 then a.description
           else left('Recalculated after a review change: ' || coalesce(a.description, 'award'), 300) end,
      a.award_key, p_period, p_start, a.metric_id, a.goal_id,
      case when a.posts = 0 then 'award:' || a.award_key else 'correction:' || a.award_key || ':' || a.posts end
    );
    v_net := v_net + v_delta;
  end loop;

  insert into public.points_settlements (employee_id, period, period_start)
  values (p_employee, p_period, p_start)
  on conflict (employee_id, period, period_start) do nothing;
  return v_net;
end;
$$;

-- Settle a period once it has ended and nothing in it awaits review.
create or replace function private.settle_if_closed(p_employee uuid, p_period public.goal_period, p_start date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_end date := private.period_end(p_period, p_start);
begin
  if v_end >= private.app_today()
     or v_end < (select s.points_start_date from public.app_settings s)
     or exists (select 1 from public.metric_entries e
                where e.employee_id = p_employee and e.entry_date between p_start and v_end and e.status = 'pending') then
    return;
  end if;
  perform private.settle_period(p_employee, p_period, p_start);
end;
$$;

create or replace function private.settle_day_periods(p_employee uuid, p_day date)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.settle_if_closed(p_employee, p.period, private.period_start(p.period, p_day))
  from unnest(array['daily', 'weekly', 'monthly']::public.goal_period[]) as p(period);
$$;

-- Review decisions and admin corrections settle (or recalculate) closed periods straight away.
create or replace function private.points_after_entry_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    perform private.settle_day_periods(new.employee_id, new.entry_date);
  end if;
  return null;
end;
$$;

drop trigger if exists metric_entries_95_points on public.metric_entries;
create trigger metric_entries_95_points
  after update on public.metric_entries
  for each row execute function private.points_after_entry_change();

create or replace function private.points_after_value_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   public.metric_entry_values := case when tg_op = 'DELETE' then old else new end;
  v_entry public.metric_entries;
begin
  select * into v_entry from public.metric_entries where id = v_row.entry_id;
  if found and v_entry.status = 'approved'
     and exists (select 1 from public.metric_definitions where id = v_row.metric_id and kind = 'input') then
    perform private.settle_day_periods(v_entry.employee_id, v_entry.entry_date);
  end if;
  return null;
end;
$$;

drop trigger if exists metric_entry_values_96_points on public.metric_entry_values;
create trigger metric_entry_values_96_points
  after insert or update or delete on public.metric_entry_values
  for each row execute function private.points_after_value_change();

-- Credit every finished, unsettled period that has approved entries (periods simply
-- ending need no event, so pages call public.sync_points()).
create or replace function private.sync_employee_points(p_employee uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select distinct p.period, private.period_start(p.period, e.entry_date) as start
    from public.metric_entries e
    cross join unnest(array['daily', 'weekly', 'monthly']::public.goal_period[]) as p(period)
    where e.employee_id = p_employee
      and e.status = 'approved'
      and e.entry_date >= (select s.points_start_date from public.app_settings s) - 31
      and not exists (select 1 from public.points_settlements st
                      where st.employee_id = p_employee and st.period = p.period
                        and st.period_start = private.period_start(p.period, e.entry_date))
  loop
    perform private.settle_if_closed(p_employee, r.period, r.start);
  end loop;
end;
$$;

-- Everyone. Not callable by clients; for an optional nightly job:
--   select cron.schedule('credit-points-nightly', '15 0 * * *', 'select private.sync_all_points()');
create or replace function private.sync_all_points()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in select id from public.profiles where role = 'employee' loop
    perform private.sync_employee_points(v_id);
  end loop;
end;
$$;

-- Caller-scoped: admins sync everyone, employees themselves.
create or replace function private.sync_points()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_admin() then
    perform private.sync_all_points();
  elsif private.is_active_user() then
    perform private.sync_employee_points(auth.uid());
  end if;
end;
$$;

create or replace function public.sync_points()
returns void
language sql
set search_path = ''
as $$
  select private.sync_points();
$$;

-- Points not credited yet: open periods, and finished periods with entries awaiting
-- review (counting submitted entries as if approved). Employees: own; admins: anyone (NULL = all).
create or replace function private.pending_points(p_employee uuid)
returns table (employee_id uuid, period public.goal_period, period_start date, award_key text, kind public.points_kind,
               points integer, description text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_today date := private.app_today();
  v_from  date := greatest((select s.points_start_date from public.app_settings s), private.app_today() - 62);
begin
  if not private.is_admin() then
    if not private.is_active_user() or (p_employee is not null and p_employee <> auth.uid()) then
      return;
    end if;
    p_employee := auth.uid();
  end if;

  return query
  with periods as (
    select distinct e.employee_id, p.period, private.period_start(p.period, e.entry_date) as start
    from public.metric_entries e
    join public.profiles pr on pr.id = e.employee_id and pr.is_active and pr.role = 'employee'
    cross join unnest(array['daily', 'weekly', 'monthly']::public.goal_period[]) as p(period)
    where (p_employee is null or e.employee_id = p_employee)
      and e.status in ('pending', 'approved')
      and e.entry_date between v_from - 31 and v_today
  ),
  -- Unsettled periods only, materialised first so awards are computed for these alone.
  candidates as materialized (
    select pe.* from periods pe
    where private.period_end(pe.period, pe.start) >= v_from
      and not exists (select 1 from public.points_settlements s
                      where s.employee_id = pe.employee_id and s.period = pe.period and s.period_start = pe.start)
  )
  select c.employee_id, c.period, c.start, a.award_key, a.kind, a.points, a.description
  from candidates c
  cross join lateral private.period_awards(c.employee_id, c.period, c.start, array['pending', 'approved']::public.entry_status[]) a;
end;
$$;

create or replace function public.pending_points(p_employee uuid default null)
returns table (employee_id uuid, period public.goal_period, period_start date, award_key text, kind public.points_kind,
               points integer, description text)
language sql
stable
set search_path = ''
as $$
  select * from private.pending_points(p_employee);
$$;

-- -----------------------------------------------------------------------------
-- Admin adjustments (mandatory reason; audited)
-- -----------------------------------------------------------------------------
create or replace function private.adjust_points(p_employee uuid, p_amount integer, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason    text := btrim(coalesce(p_reason, ''));
  v_available integer;
  v_id        uuid;
begin
  if not private.is_admin() then
    raise exception 'Only administrators can adjust points' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_employee and role = 'employee') then
    raise exception 'Points can only be adjusted for employees' using errcode = '22023';
  end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 then
    raise exception 'Enter a whole number of points between -100000 and 100000 (not 0)' using errcode = '22023';
  end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 300 or v_reason ~ '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]' then
    raise exception 'A reason of 5 to 300 characters is required' using errcode = '22023';
  end if;

  perform private.lock_points(p_employee);
  if p_amount < 0 then
    select available into v_available from public.points_balances where employee_id = p_employee;
    if coalesce(v_available, 0) + p_amount < 0 then
      raise exception 'This would take the available balance below zero (available: % points)', coalesce(v_available, 0)
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.points_transactions (employee_id, kind, amount, description, idempotency_key, created_by)
  values (p_employee, 'adjustment', p_amount, v_reason, 'adjustment:' || gen_random_uuid(), auth.uid())
  returning id into v_id;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
  values (private.audit_actor(), 'points.adjusted', 'points_transaction', v_id,
          jsonb_build_object('employee_id', p_employee, 'amount', p_amount, 'reason', v_reason));
  return v_id;
end;
$$;

create or replace function public.adjust_points(p_employee uuid, p_amount integer, p_reason text)
returns uuid
language sql
set search_path = ''
as $$
  select private.adjust_points(p_employee, p_amount, p_reason);
$$;

-- -----------------------------------------------------------------------------
-- Redemptions
-- -----------------------------------------------------------------------------
create or replace function private.audit_redemption(p_action text, r public.reward_redemptions)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (user_id, action, entity_type, entity_id, details)
  values (private.audit_actor(), p_action, 'reward_redemption', r.id,
          jsonb_build_object('employee_id', r.employee_id, 'reward_name', r.reward_name,
                             'points_cost', r.points_cost, 'note', r.admin_note));
$$;

-- Employee asks for a reward: checks stock and available points, reserves the points.
create or replace function private.request_redemption(p_reward uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee  uuid := auth.uid();
  v_reward    public.rewards;
  v_available integer;
  v_row       public.reward_redemptions;
begin
  if not exists (select 1 from public.profiles where id = v_employee and role = 'employee' and is_active) then
    raise exception 'Only active employees can redeem rewards' using errcode = '42501';
  end if;

  perform private.lock_points(v_employee);
  select * into v_reward from public.rewards where id = p_reward for update;
  if not found or not v_reward.is_active then
    raise exception 'This reward is no longer available' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.reward_redemptions
             where employee_id = v_employee and reward_id = p_reward and status = 'pending') then
    raise exception 'You already have a request for this reward waiting for approval' using errcode = 'P0001';
  end if;
  if v_reward.stock is not null
     and v_reward.stock <= (select count(*) from public.reward_redemptions where reward_id = p_reward and status = 'pending') then
    raise exception 'This reward is out of stock' using errcode = 'P0001';
  end if;
  select available into v_available from public.points_balances where employee_id = v_employee;
  if coalesce(v_available, 0) < v_reward.points_cost then
    raise exception 'Not enough points: this reward needs %, you have % available', v_reward.points_cost, coalesce(v_available, 0)
      using errcode = 'P0001';
  end if;

  insert into public.reward_redemptions (employee_id, reward_id, reward_name, points_cost)
  values (v_employee, p_reward, v_reward.name, v_reward.points_cost)
  returning * into v_row;
  perform private.audit_redemption('redemption.requested', v_row);
  return v_row.id;
end;
$$;

create or replace function public.request_redemption(p_reward uuid)
returns uuid
language sql
set search_path = ''
as $$
  select private.request_redemption(p_reward);
$$;

-- Employee withdraws their own pending request.
create or replace function private.cancel_redemption(p_redemption uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.reward_redemptions;
begin
  update public.reward_redemptions
     set status = 'cancelled', decided_at = now()
   where id = p_redemption and employee_id = auth.uid() and status = 'pending' and private.is_active_user()
  returning * into v_row;
  if not found then
    raise exception 'This request can no longer be cancelled' using errcode = 'P0001';
  end if;
  perform private.audit_redemption('redemption.cancelled', v_row);
end;
$$;

create or replace function public.cancel_redemption(p_redemption uuid)
returns void
language sql
set search_path = ''
as $$
  select private.cancel_redemption(p_redemption);
$$;

-- Admin decision: approve (deduct points, reduce stock), reject (reason), fulfil, refund (reason).
create or replace function private.decide_redemption(p_redemption uuid, p_decision text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.reward_redemptions;
  v_reward  public.rewards;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_balance integer;
  v_held    integer;
begin
  if not private.is_admin() then
    raise exception 'Only administrators can decide redemptions' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject', 'fulfil', 'refund') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'Keep the note to 500 characters or fewer' using errcode = '22023';
  end if;
  if p_decision in ('reject', 'refund') and char_length(coalesce(v_note, '')) < 3 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;

  select * into v_row from public.reward_redemptions where id = p_redemption for update;
  if not found then
    raise exception 'Unknown redemption request' using errcode = 'P0001';
  end if;
  perform private.lock_points(v_row.employee_id);

  if p_decision = 'approve' then
    if v_row.status <> 'pending' then
      raise exception 'Only pending requests can be approved' using errcode = 'P0001';
    end if;
    select * into v_reward from public.rewards where id = v_row.reward_id for update;
    if v_reward.stock is not null and v_reward.stock < 1 then
      raise exception 'Out of stock: add stock or reject the request' using errcode = 'P0001';
    end if;
    select balance, held into v_balance, v_held from public.points_balances where employee_id = v_row.employee_id;
    -- held includes this request's own reservation.
    if v_balance - (v_held - v_row.points_cost) < v_row.points_cost then
      raise exception 'The employee no longer has enough points (% available)', v_balance - (v_held - v_row.points_cost)
        using errcode = 'P0001';
    end if;
    insert into public.points_transactions (employee_id, kind, amount, description, redemption_id, idempotency_key, created_by)
    values (v_row.employee_id, 'redemption', -v_row.points_cost, left('Redeemed: ' || v_row.reward_name, 300), v_row.id,
            'redemption:' || v_row.id, auth.uid());
    if v_reward.stock is not null then
      update public.rewards set stock = stock - 1 where id = v_reward.id;
    end if;
    update public.reward_redemptions
       set status = 'approved', admin_note = v_note, decided_at = now(), decided_by = auth.uid()
     where id = v_row.id returning * into v_row;
    perform private.audit_redemption('redemption.approved', v_row);

  elsif p_decision = 'reject' then
    if v_row.status <> 'pending' then
      raise exception 'Only pending requests can be rejected' using errcode = 'P0001';
    end if;
    update public.reward_redemptions
       set status = 'rejected', admin_note = v_note, decided_at = now(), decided_by = auth.uid()
     where id = v_row.id returning * into v_row;
    perform private.audit_redemption('redemption.rejected', v_row);

  elsif p_decision = 'fulfil' then
    if v_row.status <> 'approved' then
      raise exception 'Only approved requests can be marked as fulfilled' using errcode = 'P0001';
    end if;
    update public.reward_redemptions
       set status = 'fulfilled', admin_note = coalesce(v_note, admin_note), fulfilled_at = now(), fulfilled_by = auth.uid()
     where id = v_row.id returning * into v_row;
    perform private.audit_redemption('redemption.fulfilled', v_row);

  else -- refund
    if v_row.status <> 'approved' then
      raise exception 'Only approved (not yet fulfilled) requests can be refunded' using errcode = 'P0001';
    end if;
    insert into public.points_transactions (employee_id, kind, amount, description, redemption_id, idempotency_key, created_by)
    values (v_row.employee_id, 'refund', v_row.points_cost, left('Refund: ' || v_row.reward_name, 300), v_row.id,
            'refund:' || v_row.id, auth.uid());
    update public.rewards set stock = stock + 1 where id = v_row.reward_id and stock is not null;
    update public.reward_redemptions
       set status = 'cancelled', admin_note = v_note, decided_at = now(), decided_by = auth.uid()
     where id = v_row.id returning * into v_row;
    perform private.audit_redemption('redemption.refunded', v_row);
  end if;
end;
$$;

create or replace function public.decide_redemption(p_redemption uuid, p_decision text, p_note text default null)
returns void
language sql
set search_path = ''
as $$
  select private.decide_redemption(p_redemption, p_decision, p_note);
$$;

-- -----------------------------------------------------------------------------
-- Privileges & RLS
-- -----------------------------------------------------------------------------
alter table public.points_transactions enable row level security;
alter table public.points_settlements  enable row level security;
alter table public.rewards             enable row level security;
alter table public.reward_redemptions  enable row level security;

revoke all on public.points_transactions, public.points_settlements, public.rewards, public.reward_redemptions,
              public.points_balances from anon, authenticated;
-- Ledger, settlements and redemptions: read-only for clients (functions write them).
grant select on public.points_transactions, public.points_settlements, public.reward_redemptions, public.points_balances
  to authenticated;
grant select, insert, update on public.rewards to authenticated;
grant all on public.points_transactions, public.points_settlements, public.rewards, public.reward_redemptions,
             public.points_balances to service_role;

drop policy if exists "points: own or admin read" on public.points_transactions;
create policy "points: own or admin read"
  on public.points_transactions for select to authenticated
  using ((employee_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));

drop policy if exists "settlements: own or admin read" on public.points_settlements;
create policy "settlements: own or admin read"
  on public.points_settlements for select to authenticated
  using ((employee_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));

drop policy if exists "redemptions: own or admin read" on public.reward_redemptions;
create policy "redemptions: own or admin read"
  on public.reward_redemptions for select to authenticated
  using ((employee_id = (select auth.uid()) and (select private.is_active_user())) or (select private.is_admin()));

drop policy if exists "rewards: active users read active, admins all" on public.rewards;
create policy "rewards: active users read active, admins all"
  on public.rewards for select to authenticated
  using ((is_active and (select private.is_active_user())) or (select private.is_admin()));

drop policy if exists "rewards: admins insert" on public.rewards;
create policy "rewards: admins insert"
  on public.rewards for insert to authenticated
  with check ((select private.is_admin()));

drop policy if exists "rewards: admins update" on public.rewards;
create policy "rewards: admins update"
  on public.rewards for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

revoke all on function public.sync_points(), public.pending_points(uuid), public.adjust_points(uuid, integer, text),
  public.request_redemption(uuid), public.cancel_redemption(uuid), public.decide_redemption(uuid, text, text)
  from public, anon;
grant execute on function public.sync_points(), public.pending_points(uuid), public.adjust_points(uuid, integer, text),
  public.request_redemption(uuid), public.cancel_redemption(uuid), public.decide_redemption(uuid, text, text)
  to authenticated, service_role;

-- Internal helpers: not callable by clients. Entry points run as definer and check the caller themselves.
revoke all on function
  private.ledger_is_append_only(), private.lock_points(uuid), private.goal_tier_points(uuid, public.goal_period, numeric),
  private.period_awards(uuid, public.goal_period, date, public.entry_status[]),
  private.settle_period(uuid, public.goal_period, date), private.settle_if_closed(uuid, public.goal_period, date),
  private.settle_day_periods(uuid, date), private.points_after_entry_change(), private.points_after_value_change(),
  private.sync_employee_points(uuid), private.sync_all_points(), private.audit_redemption(text, public.reward_redemptions)
  from public;
revoke all on function private.sync_points(), private.pending_points(uuid), private.adjust_points(uuid, integer, text),
  private.request_redemption(uuid), private.cancel_redemption(uuid), private.decide_redemption(uuid, text, text)
  from public;
grant execute on function private.sync_points(), private.pending_points(uuid), private.adjust_points(uuid, integer, text),
  private.request_redemption(uuid), private.cancel_redemption(uuid), private.decide_redemption(uuid, text, text)
  to authenticated, service_role;
-- =============================================================================
-- Migration: Beauty Therapist performance metrics
--
-- Seeded from the Beauty Therapist performance spreadsheet ("Performance Metrics - Alana").
-- Configures input metrics (Hours, Revenue, Rebooking %, Tickets, Retail/Units)
-- and calculated ratios (Hourly Revenue, Revenue Per Ticket, Retail Per Hour).
--
-- Idempotent: safe to re-run.
-- =============================================================================

insert into public.metric_definitions
  (category, key, name, kind, data_type, unit, aggregation, is_required, min_value, max_value,
   default_target, counts_as_unit, is_goal_eligible, is_scoring_eligible, sort_order)
values
  ('beauty_therapist', 'hours_worked',   'Hours Worked',      'input', 'decimal',    'h',       'sum',     true,  0, 24,   null, false, false, false, 10),
  ('beauty_therapist', 'revenue',        'Revenue',           'input', 'currency',   '$',       'sum',     true,  0, null, null, false, true,  true,  20),
  ('beauty_therapist', 'rebooking_pct',  'Rebooking %',       'input', 'percentage', '%',       'average', true,  0, 100,  null, false, true,  true,  30),
  ('beauty_therapist', 'tickets',        'Number of Tickets', 'input', 'integer',    'tickets', 'sum',     true,  0, null, null, false, true,  true,  40),
  ('beauty_therapist', 'retail_units',   'Retail / Units',    'input', 'decimal',    'units',   'sum',     false, 0, null, null, false, true,  true,  50)
on conflict (category, key) do update set
  name = excluded.name,
  data_type = excluded.data_type,
  unit = excluded.unit,
  aggregation = excluded.aggregation,
  is_required = excluded.is_required,
  min_value = excluded.min_value,
  max_value = excluded.max_value,
  default_target = excluded.default_target,
  is_goal_eligible = excluded.is_goal_eligible,
  is_scoring_eligible = excluded.is_scoring_eligible,
  sort_order = excluded.sort_order;

insert into public.metric_definitions
  (category, key, name, description, kind, data_type, unit, numerator_metric_id, numerator_is_unit_total,
   denominator_metric_id, default_target, is_goal_eligible, is_scoring_eligible, sort_order)
select 'beauty_therapist', v.key, v.name, v.description, 'calculated', v.data_type::public.metric_data_type, v.unit,
       (select id from public.metric_definitions where category = 'beauty_therapist' and key = v.numerator),
       false,
       (select id from public.metric_definitions where category = 'beauty_therapist' and key = v.denominator),
       v.default_target,
       true, true, v.sort_order
from (values
  ('hourly_revenue',     'Hourly Revenue',     'Revenue ÷ Hours Worked',               'currency', '$/h',      'revenue',      'hours_worked', null::numeric, 60),
  ('revenue_per_ticket', 'Revenue Per Ticket', 'Revenue ÷ Number of Tickets',          'currency', '$/ticket', 'revenue',      'tickets',      80::numeric,   70),
  ('retail_per_hour',    'Retail Per Hour',    'Retail / Units Sold ÷ Hours Worked',   'decimal',  'units/h',  'retail_units', 'hours_worked', 0.5::numeric,  80)
) as v(key, name, description, data_type, unit, numerator, denominator, default_target, sort_order)
on conflict (category, key) do update set
  name = excluded.name,
  description = excluded.description,
  data_type = excluded.data_type,
  unit = excluded.unit,
  numerator_metric_id = excluded.numerator_metric_id,
  numerator_is_unit_total = excluded.numerator_is_unit_total,
  denominator_metric_id = excluded.denominator_metric_id,
  default_target = excluded.default_target,
  is_goal_eligible = excluded.is_goal_eligible,
  is_scoring_eligible = excluded.is_scoring_eligible,
  sort_order = excluded.sort_order;
-- =============================================================================
-- Migration: Employee Registration Requests & Self Sign-Up Queue
--
-- Adds the employee_registration_requests table to track self-registration
-- submissions from Nurses and Beauty Therapists awaiting administrator approval.
--
-- Idempotent: safe to re-run.
-- =============================================================================

create table if not exists public.employee_registration_requests (
  id                  uuid primary key default gen_random_uuid(),
  full_name           text not null
                        check (char_length(btrim(full_name)) between 2 and 120 and full_name !~ '[[:cntrl:]]'),
  email               text not null
                        check (email = lower(email) and position('@' in email) > 1),
  employee_category   text not null references public.employee_categories (slug)
                        on update cascade on delete restrict,
  status              text not null default 'pending'
                        check (status in ('pending', 'approved', 'rejected')),
  auth_user_id        uuid references auth.users (id) on delete set null,
  decided_by          uuid references public.profiles (id) on delete set null,
  decided_at          timestamptz,
  rejection_reason    text check (rejection_reason is null or char_length(rejection_reason) <= 500),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.employee_registration_requests is
  'Self-registration queue for prospective employees awaiting administrator approval.';
comment on column public.employee_registration_requests.auth_user_id is
  'Linked auth.users id. Kept inactive until administrator approval.';
comment on column public.employee_registration_requests.employee_category is
  'Requested role category: nurse or beauty_therapist.';

-- Only one pending request per email address at a time
create unique index if not exists registration_requests_pending_email_uniq
  on public.employee_registration_requests (email)
  where (status = 'pending');

-- Efficient filtering for the admin pending queue
create index if not exists registration_requests_status_idx
  on public.employee_registration_requests (status, created_at desc);

-- Keep updated_at current
drop trigger if exists set_registration_requests_updated_at on public.employee_registration_requests;
create trigger set_registration_requests_updated_at
  before update on public.employee_registration_requests
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.employee_registration_requests enable row level security;

-- Administrators can view all registration requests
drop policy if exists "admins_select_registration_requests" on public.employee_registration_requests;
create policy "admins_select_registration_requests"
  on public.employee_registration_requests
  for select
  to authenticated
  using (private.is_admin());

-- Administrators can update status (approve / reject)
drop policy if exists "admins_update_registration_requests" on public.employee_registration_requests;
create policy "admins_update_registration_requests"
  on public.employee_registration_requests
  for update
  to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- Revoke direct mutations from normal users; service_role manages inserts/updates safely
revoke insert, delete on public.employee_registration_requests from anon, authenticated;
grant select, update on public.employee_registration_requests to authenticated;
grant all on public.employee_registration_requests to service_role;
-- =============================================================================
-- Migration: Hall of Fame & Employee Recognition Awards
--
-- Adds the hall_of_fame_awards table for administrators to induct outstanding
-- staff (Employee of the Month / Hall of Fame) with a title, award period,
-- citation message, and optional bonus points.
--
-- Idempotent: safe to re-run.
-- =============================================================================

create table if not exists public.hall_of_fame_awards (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.profiles (id) on delete cascade,
  awarded_by          uuid not null references public.profiles (id) on delete restrict,
  title               text not null check (char_length(btrim(title)) between 2 and 100),
  award_period        text not null check (char_length(btrim(award_period)) between 2 and 50),
  citation            text not null check (char_length(btrim(citation)) between 5 and 500),
  bonus_points        integer not null default 0 check (bonus_points >= 0 and bonus_points <= 100000),
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.hall_of_fame_awards is
  'Administrator-curated recognition awards and Hall of Fame inductees.';
comment on column public.hall_of_fame_awards.employee_id is
  'The staff member inducted into the Hall of Fame.';
comment on column public.hall_of_fame_awards.awarded_by is
  'The administrator who created the award.';
comment on column public.hall_of_fame_awards.title is
  'Recognition title, e.g. "Employee of the Month" or "Hall of Fame Legend".';
comment on column public.hall_of_fame_awards.award_period is
  'The timeframe of the award, e.g. "May 2026", "Q2 2026", or "All-Time".';
comment on column public.hall_of_fame_awards.citation is
  'Commendation reason written by the administrator.';
comment on column public.hall_of_fame_awards.bonus_points is
  'Optional reward points gifted to the employee for this award.';

-- Indexes
create index if not exists hall_of_fame_awards_employee_idx
  on public.hall_of_fame_awards (employee_id);

create index if not exists hall_of_fame_awards_created_idx
  on public.hall_of_fame_awards (created_at desc);

-- Keep updated_at current
drop trigger if exists set_hall_of_fame_awards_updated_at on public.hall_of_fame_awards;
create trigger set_hall_of_fame_awards_updated_at
  before update on public.hall_of_fame_awards
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.hall_of_fame_awards enable row level security;

-- All authenticated users (staff & admins) can view active awards
drop policy if exists "hall_of_fame_select_all" on public.hall_of_fame_awards;
create policy "hall_of_fame_select_all"
  on public.hall_of_fame_awards
  for select
  to authenticated
  using (true);

-- Only administrators can insert awards
drop policy if exists "hall_of_fame_insert_admin" on public.hall_of_fame_awards;
create policy "hall_of_fame_insert_admin"
  on public.hall_of_fame_awards
  for insert
  to authenticated
  with check (private.is_admin());

-- Only administrators can update awards
drop policy if exists "hall_of_fame_update_admin" on public.hall_of_fame_awards;
create policy "hall_of_fame_update_admin"
  on public.hall_of_fame_awards
  for update
  to authenticated
  using (private.is_admin())
  with check (private.is_admin());

-- Only administrators can delete awards
drop policy if exists "hall_of_fame_delete_admin" on public.hall_of_fame_awards;
create policy "hall_of_fame_delete_admin"
  on public.hall_of_fame_awards
  for delete
  to authenticated
  using (private.is_admin());

-- Permissions
grant select, insert, update, delete on public.hall_of_fame_awards to authenticated;
grant all on public.hall_of_fame_awards to service_role;
