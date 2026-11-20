-- =============================================================================
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
