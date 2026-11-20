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
