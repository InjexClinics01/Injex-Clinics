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
