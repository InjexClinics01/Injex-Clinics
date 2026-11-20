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
