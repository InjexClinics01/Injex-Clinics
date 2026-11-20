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
