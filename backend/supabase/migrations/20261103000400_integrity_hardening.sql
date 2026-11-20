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
  'ID of the affected row. Deliberately not a foreign key: it can point at any entity_type, and audit history must survive deletionof the target.';