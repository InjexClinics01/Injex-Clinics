e-- =============================================================================
-- Phase 1 · Migration 1: core schema
-- Injex Clinics 
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
