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
