-- =============================================================================
-- Phase 4 tests: points engine, ledger, wallet, rewards, redemptions, security.
-- Includes the full workflow through the real roles: employee entry → submit →
-- admin approval → points credited → reward request → admin approval → fulfilment.
-- Runs in a transaction and rolls back. Run with backend/scripts/test-db.sh.
-- =============================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

begin;
\ir _helpers.sql

insert into auth.users (email, raw_user_meta_data) values
  ('admin@test.local',  '{"full_name":"Ada Admin"}'),
  ('nurse@test.local',  '{"full_name":"Nina Nurse"}'),
  ('nurse2@test.local', '{"full_name":"Nora Nurse"}');
update public.profiles set role = 'admin' where email = 'admin@test.local';
update public.profiles set employee_category = 'nurse' where email like 'nurse%';

create function tests.uid(p_email text) returns uuid language sql security definer as $$
  select id from public.profiles where email = p_email $$;
create function tests.metric(p_key text) returns uuid language sql security definer as $$
  select id from public.metric_definitions where category = 'nurse' and key = p_key $$;
create function tests.balance(p_email text) returns integer language sql security definer as $$
  select coalesce(sum(amount), 0)::integer from public.points_transactions where employee_id = tests.uid(p_email) $$;
create function tests.txns(p_email text, p_kind text default null) returns bigint language sql security definer as $$
  select count(*) from public.points_transactions where employee_id = tests.uid(p_email) and (p_kind is null or kind::text = p_kind) $$;
create function tests.base() returns date language sql as $$
  select private.period_start('weekly', private.app_today()) - 14 $$;
create function tests.entry(p_email text, p_date date) returns uuid language sql security definer as $$
  select id from public.metric_entries where employee_id = tests.uid(p_email) and entry_date = p_date $$;
create function tests.reward(p_name text) returns uuid language sql security definer as $$
  select id from public.rewards where name = p_name $$;
create function tests.redemption(p_email text, p_reward text) returns uuid language sql security definer as $$
  -- now() is constant inside the test transaction, so prefer the open request rather than "latest".
  select id from public.reward_redemptions where employee_id = tests.uid(p_email) and reward_name = p_reward
  order by (status = 'pending') desc, (status = 'approved') desc, requested_at desc limit 1 $$;

-- The employee fills in and submits a day through the API role (as the app does).
create function tests.submit_day(p_email text, p_date date, p_hours numeric, p_revenue numeric, p_rebooking numeric, p_tickets numeric)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform tests.as_user(p_email);
  insert into public.metric_entries (employee_id, entry_date) values (tests.uid(p_email), p_date) returning id into v_id;
  insert into public.metric_entry_values (entry_id, metric_id, value) values
    (v_id, tests.metric('hours_worked'), p_hours), (v_id, tests.metric('revenue'), p_revenue),
    (v_id, tests.metric('rebooking_pct'), p_rebooking), (v_id, tests.metric('tickets'), p_tickets);
  update public.metric_entries set status = 'pending' where id = v_id;
  perform tests.as_system();
  return v_id;
end $$;

create function tests.review(p_entry uuid, p_status text, p_note text default null) returns void language plpgsql as $$
begin
  perform tests.as_user('admin@test.local');
  update public.metric_entries set status = p_status::public.entry_status, review_note = p_note where id = p_entry;
  perform tests.as_system();
end $$;
grant execute on all functions in schema tests to anon, authenticated;

-- Points count from two weeks before the test week; scoring rules set by the admin.
update public.app_settings set points_start_date = tests.base() - 7;
do $$ begin
  perform tests.as_user('admin@test.local');
  insert into public.scoring_rules (metric_id, period, threshold, points) values
    (tests.metric('revenue'), 'daily', 1000, 10),
    (tests.metric('revenue'), 'weekly', 3000, 100),
    (tests.metric('rebooking_pct'), 'weekly', 80, 50);
  perform tests.as_system();
end $$;

-- =============================================================================
-- 1. Automatic points from approved performance (closed periods)
-- =============================================================================
do $$
declare
  b    date := tests.base();
  v_e1 uuid;
  v_e2 uuid;
begin
  v_e1 := tests.submit_day('nurse@test.local', b, 8, 2000, 85, 5);

  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.balance('nurse@test.local') = 0, 'nothing is credited while the entry awaits review');
  perform tests.ok((select sum(points) from public.pending_points() where period = 'daily' and period_start = b) = 10,
                   'pending points: daily revenue 2000 ≥ 1000 → 10 pts (not yet credited)');
  perform tests.ok((select sum(points) from public.pending_points() where period = 'weekly' and period_start = b) = 50,
                   'pending points: weekly rebooking 85% ≥ 80% → 50 pts');

  perform tests.review(v_e1, 'approved');
  perform tests.ok(tests.balance('nurse@test.local') = 60, 'approval credits the finished day (10) and week (50) automatically');
  perform tests.ok(tests.txns('nurse@test.local', 'performance') = 2, 'one ledger transaction per award');
  perform tests.ok((select description from public.points_transactions
                    where employee_id = tests.uid('nurse@test.local') and period = 'weekly') = 'Rebooking %: weekly target of 80 reached',
                   'transactions explain what was earned');
  perform tests.as_user('nurse@test.local');
  perform tests.ok(not exists (select 1 from public.pending_points() where period_start = b and period in ('daily', 'weekly')),
                   'credited periods no longer show as pending');

  perform tests.as_system();
  perform private.settle_period(tests.uid('nurse@test.local'), 'weekly', b);
  perform private.settle_period(tests.uid('nurse@test.local'), 'daily', b);
  perform tests.as_user('admin@test.local');
  perform public.sync_points();
  perform tests.ok(tests.balance('nurse@test.local') = 60 and tests.txns('nurse@test.local') = 2,
                   'settling or syncing again never credits twice');
  perform tests.as_system();
  perform tests.ok(tests.error_of(format($q$insert into public.points_transactions (employee_id, kind, amount, description, award_key, period, period_start, idempotency_key)
                                    values (%L, 'performance', 10, 'dup', 'x', 'daily', %L, %L)$q$,
                                    tests.uid('nurse@test.local'), b, 'award:perf:' || tests.metric('revenue') || ':daily:' || b)) = '23505',
                   'the database itself rejects a duplicate award (unique idempotency key)');

  -- Second day in the same (already settled) week: the week is recalculated.
  v_e2 := tests.submit_day('nurse@test.local', b + 1, 7, 1500, 90, 3);
  perform tests.ok(tests.balance('nurse@test.local') = 60, 'a new pending entry changes nothing yet');
  perform tests.review(v_e2, 'approved');
  perform tests.ok(tests.balance('nurse@test.local') = 170,
                   'approving another day credits it (10) and the week''s new revenue tier (3500 ≥ 3000 → 100)');

  -- Admin reopens the day for correction: its points are withdrawn as corrections.
  perform tests.review(v_e2, 'rejected', 'Check the ticket count');
  perform tests.ok(tests.balance('nurse@test.local') = 60, 'reopening an approved day withdraws its points (−10, −100)');
  perform tests.ok(tests.txns('nurse@test.local', 'correction') = 2, 'withdrawals are visible correction transactions');

  perform tests.as_user('nurse@test.local');
  update public.metric_entry_values set value = 4 where entry_id = v_e2 and metric_id = tests.metric('tickets');
  update public.metric_entries set status = 'pending' where id = v_e2;
  perform tests.review(v_e2, 'approved');
  perform tests.ok(tests.balance('nurse@test.local') = 170, 'corrected and re-approved: points credited again');

  -- Admin edits a value of an approved entry in a settled period.
  perform tests.as_user('admin@test.local');
  update public.metric_entry_values set value = 500 where entry_id = v_e2 and metric_id = tests.metric('revenue');
  perform tests.as_system();
  perform tests.ok(tests.balance('nurse@test.local') = 60,
                   'admin edit recalculates: day 500 < 1000 (−10), week 2500 < 3000 (−100)');
  perform tests.as_user('admin@test.local');
  update public.metric_entry_values set value = 1500 where entry_id = v_e2 and metric_id = tests.metric('revenue');
  perform tests.as_system();
  perform tests.ok(tests.balance('nurse@test.local') = 170, 'and back when the edit is reversed');
end $$;

-- Changing scoring rules never rewrites credited history.
do $$ begin
  perform tests.as_user('admin@test.local');
  update public.scoring_rules set points = 999 where period = 'weekly' and threshold = 3000;
  perform public.sync_points();
  perform tests.ok(tests.balance('nurse@test.local') = 170, 'rule changes do not alter credited points');
  update public.scoring_rules set points = 100 where period = 'weekly' and threshold = 3000;
  perform tests.as_system();
end $$;

-- Periods before the points start date never earn points.
do $$
declare v_old uuid;
begin
  v_old := tests.submit_day('nurse2@test.local', tests.base() - 10, 8, 5000, 95, 5);
  perform tests.review(v_old, 'approved');
  perform tests.ok(tests.balance('nurse2@test.local') = 0, 'periods ending before the points start date earn nothing');
end $$;

-- =============================================================================
-- 2. Goals (current period: credited when settled; the preview shows them as pending)
-- =============================================================================
do $$
declare
  t   date := private.app_today();
  v_e uuid;
  v_before integer;
begin
  perform tests.as_user('nurse@test.local');
  insert into public.goals (employee_id, metric_id, period, period_start, target_value)
  values (tests.uid('nurse@test.local'), tests.metric('revenue'), 'daily', t, 1000);
  perform tests.as_system();

  v_e := tests.submit_day('nurse@test.local', t, 8, 1200, 70, 4);
  perform tests.as_user('nurse@test.local');
  insert into public.goals (employee_id, metric_id, period, period_start, target_value)
  values (tests.uid('nurse@test.local'), tests.metric('revenue'), 'weekly', t, 1000);
  perform tests.ok((select count(*) from public.pending_points() where kind = 'goal' and period = 'daily') = 1,
                   'an achieved goal shows as pending points before approval and period end');

  perform tests.review(v_e, 'approved');
  perform tests.ok(not exists (select 1 from public.points_transactions where employee_id = tests.uid('nurse@test.local')
                               and period_start = t and period = 'daily'),
                   'today is still open: nothing credited yet');

  v_before := tests.balance('nurse@test.local');
  perform private.settle_period(tests.uid('nurse@test.local'), 'daily', t);
  perform tests.ok(tests.balance('nurse@test.local') = v_before + 20, 'settled day: revenue rule 10 + goal 10 (tier its 1000 target reaches)');
  perform tests.ok(tests.txns('nurse@test.local', 'goal') = 1, 'goal award recorded once');
  perform private.settle_period(tests.uid('nurse@test.local'), 'daily', t);
  perform tests.ok(tests.txns('nurse@test.local', 'goal') = 1, 'goal points cannot be credited twice');

  perform tests.ok(not exists (select 1 from private.period_awards(tests.uid('nurse@test.local'), 'weekly',
                                 private.period_start('weekly', t), array['approved']::public.entry_status[]) where kind = 'goal'),
                   'a goal set after the period''s results were submitted earns nothing (no gaming)');
end $$;

-- =============================================================================
-- 3. Consistency streak (if enabled)
-- =============================================================================
do $$
declare
  b   date := tests.base();
  v_e uuid;
begin
  perform tests.as_user('admin@test.local');
  update public.app_settings set streak_enabled = true, streak_min_days = 1, streak_weeks = 2, streak_points = 25;
  perform tests.as_system();
  v_e := tests.submit_day('nurse@test.local', b + 7, 8, 800, 60, 2);
  perform tests.review(v_e, 'approved');
  perform tests.ok(exists (select 1 from public.points_transactions where employee_id = tests.uid('nurse@test.local')
                           and kind = 'streak' and amount = 25 and period_start = b + 7),
                   'two consecutive qualifying weeks → 25-point streak bonus');
  perform tests.ok(tests.error_of('update public.app_settings set streak_weeks = 0') = '23514', 'streak settings are range-checked');
end $$;

-- =============================================================================
-- 4. Admin adjustments
-- =============================================================================
do $$ begin
  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.error_of(format($q$select public.adjust_points(%L, 1000, 'Give myself points')$q$, tests.uid('nurse@test.local'))) = '42501',
                   'employees cannot adjust points');
  perform tests.ok(tests.error_of(format($q$insert into public.points_transactions (employee_id, kind, amount, description, idempotency_key)
                                    values (%L, 'adjustment', 1000, 'hack', 'x')$q$, tests.uid('nurse@test.local'))) = '42501',
                   'employees cannot write to the ledger');

  perform tests.as_user('admin@test.local');
  perform tests.ok(tests.error_of(format($q$select public.adjust_points(%L, 100, '  ')$q$, tests.uid('nurse2@test.local'))) = '22023',
                   'an adjustment needs a reason');
  perform tests.ok(tests.error_of(format($q$select public.adjust_points(%L, 0, 'Nothing at all')$q$, tests.uid('nurse2@test.local'))) = '22023',
                   'a zero adjustment is refused');
  perform tests.ok(tests.error_of(format($q$select public.adjust_points(%L, 100, 'Admin bonus')$q$, tests.uid('admin@test.local'))) = '22023',
                   'admins cannot give themselves points');
  perform tests.ok(tests.error_of(format($q$select public.adjust_points(%L, 120, 'Welcome bonus for launch')$q$, tests.uid('nurse2@test.local'))) is null
               and tests.balance('nurse2@test.local') = 120, 'admin adds points with a reason');
  perform tests.ok(exists (select 1 from public.audit_logs where action = 'points.adjusted' and user_id = tests.uid('admin@test.local')
                           and (details ->> 'amount')::int = 120 and details ->> 'reason' = 'Welcome bonus for launch'),
                   'adjustment recorded in the audit log with the reason');
  perform tests.ok(tests.error_of(format($q$select public.adjust_points(%L, -500, 'Remove too much')$q$, tests.uid('nurse2@test.local'))) = 'P0001',
                   'an adjustment cannot take the balance below zero');
  perform tests.as_system();
  perform tests.ok(tests.error_of('update public.points_transactions set amount = 9999') = '42501'
               and tests.error_of('delete from public.points_transactions') = '42501',
                   'the ledger is append-only, even for the system');
end $$;

-- =============================================================================
-- 5. Rewards and redemptions (end of the workflow)
-- =============================================================================
do $$
declare v_id uuid;
begin
  perform tests.as_user('admin@test.local');
  insert into public.rewards (name, description, points_cost, stock) values
    ('Coffee voucher', 'A coffee on us', 50, 1),
    ('Spa day', 'A full spa day', 100000, null),
    ('Lunch', 'Team lunch', 20, null);
  insert into public.rewards (name, points_cost, is_active) values ('Retired reward', 10, false);
  perform tests.ok((select count(*) from public.audit_logs where action = 'reward.created') = 4, 'reward changes are audited');

  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.count_of('select * from public.rewards') = 3, 'employees see active rewards only');
  perform tests.ok(tests.affected($q$update public.rewards set points_cost = 1$q$) = 0, 'employees cannot change rewards');
  perform tests.ok(tests.error_of(format($q$insert into public.reward_redemptions (employee_id, reward_id, reward_name, points_cost, status)
                                    values (%L, %L, 'x', 1, 'approved')$q$, tests.uid('nurse@test.local'), tests.reward('Lunch'))) = '42501',
                   'employees cannot write redemptions directly');
  perform tests.ok(tests.error_of(format('select public.request_redemption(%L)', tests.reward('Spa day'))) = 'P0001',
                   'insufficient points: request refused');
  perform tests.ok(tests.error_of(format('select public.request_redemption(%L)', tests.reward('Retired reward'))) = 'P0001',
                   'inactive rewards cannot be requested');

  perform tests.ok(tests.error_of(format('select public.request_redemption(%L)', tests.reward('Coffee voucher'))) is null,
                   'employee requests a reward');
  perform tests.ok((select held = 50 and available = balance - 50 from public.points_balances), 'the request reserves the points');
  perform tests.ok(tests.error_of(format('select public.request_redemption(%L)', tests.reward('Coffee voucher'))) = 'P0001',
                   'duplicate request for the same reward refused');

  perform tests.as_user('nurse2@test.local');
  perform tests.ok(tests.error_of(format('select public.request_redemption(%L)', tests.reward('Coffee voucher'))) = 'P0001',
                   'last item reserved by another request: out of stock');
  perform tests.ok(tests.count_of('select * from public.reward_redemptions') = 0, 'employees cannot see others'' redemptions');
  perform tests.ok(tests.count_of('select * from public.points_transactions') = 1
               and tests.count_of('select * from public.points_balances') = 1, 'employees see only their own points');
  perform tests.ok(tests.error_of(format('select public.cancel_redemption(%L)', tests.redemption('nurse@test.local', 'Coffee voucher'))) = 'P0001',
                   'employees cannot cancel others'' requests');
  perform tests.ok(tests.count_of(format('select * from public.pending_points(%L)', tests.uid('nurse@test.local'))) = 0,
                   'employees cannot see others'' pending points');

  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.error_of(format($q$select public.decide_redemption(%L, 'approve')$q$, tests.redemption('nurse@test.local', 'Coffee voucher'))) = '42501',
                   'employees cannot approve their own redemption');

  perform tests.as_user('admin@test.local');
  v_id := tests.redemption('nurse@test.local', 'Coffee voucher');
  perform tests.ok(tests.error_of(format($q$select public.decide_redemption(%L, 'reject', '')$q$, v_id)) = '22023', 'rejection needs a reason');
  perform tests.ok(tests.error_of(format($q$select public.decide_redemption(%L, 'approve', 'Enjoy!')$q$, v_id)) is null, 'admin approves');
  perform tests.ok((select status = 'approved' from public.reward_redemptions where id = v_id)
               and (select stock = 0 from public.rewards where name = 'Coffee voucher')
               and exists (select 1 from public.points_transactions where redemption_id = v_id and amount = -50 and kind = 'redemption'),
                   'approval deducts the points (ledger −50) and reduces stock');
  perform tests.ok((select held = 0 from public.points_balances where employee_id = tests.uid('nurse@test.local')), 'reservation released');
  perform tests.ok(tests.error_of(format($q$select public.decide_redemption(%L, 'approve')$q$, v_id)) = 'P0001', 'cannot approve twice');
  -- (Action and check in separate statements: Postgres may evaluate an uncorrelated subquery first.)
  perform tests.ok(tests.error_of(format($q$select public.decide_redemption(%L, 'fulfil')$q$, v_id)) is null, 'admin marks the reward as handed over');
  perform tests.ok((select status = 'fulfilled' and fulfilled_by = tests.uid('admin@test.local') from public.reward_redemptions where id = v_id),
                   'fulfilment recorded with who and when');
  perform tests.ok(tests.error_of(format($q$select public.decide_redemption(%L, 'refund', 'Too late')$q$, v_id)) = 'P0001',
                   'a fulfilled redemption cannot be refunded');
  perform tests.ok(exists (select 1 from public.audit_logs where entity_id = v_id and action = 'redemption.approved')
               and exists (select 1 from public.audit_logs where entity_id = v_id and action = 'redemption.fulfilled'),
                   'redemption decisions are audited');

  -- Refund and rejection.
  perform tests.as_user('nurse@test.local');
  perform public.request_redemption(tests.reward('Lunch'));
  perform tests.as_user('admin@test.local');
  v_id := tests.redemption('nurse@test.local', 'Lunch');
  perform public.decide_redemption(v_id, 'approve');
  perform tests.ok(tests.error_of(format($q$select public.decide_redemption(%L, 'refund', 'Restaurant closed')$q$, v_id)) is null,
                   'admin refunds an approved redemption');
  perform tests.ok(exists (select 1 from public.points_transactions where redemption_id = v_id and kind = 'refund' and amount = 20),
                   'refund returns the points');
  perform tests.as_user('nurse@test.local');
  perform public.request_redemption(tests.reward('Lunch'));
  perform tests.as_user('admin@test.local');
  perform tests.ok(tests.error_of(format($q$select public.decide_redemption(%L, 'reject', 'Not this month')$q$,
                                  tests.redemption('nurse@test.local', 'Lunch'))) is null, 'admin rejects with a reason');
  perform tests.as_user('nurse@test.local');
  perform tests.ok(exists (select 1 from public.reward_redemptions
                           where reward_name = 'Lunch' and status = 'rejected' and admin_note = 'Not this month'),
                   'employee sees the status and reason');
  perform public.request_redemption(tests.reward('Lunch'));
  perform tests.ok(tests.error_of(format('select public.cancel_redemption(%L)', tests.redemption('nurse@test.local', 'Lunch'))) is null,
                   'employee cancels a pending request');
  perform tests.ok((select held = 0 from public.points_balances), 'cancelling releases the reserved points');

  -- Final balance = earned − redeemed (170 + 20 goal day + 25 streak − 50 coffee).
  perform tests.ok((select balance = 165 and lifetime_earned = 215 and redeemed = 50 and available = 165 from public.points_balances),
                   'wallet: balance 165 = 215 earned − 50 redeemed');
  perform tests.as_system();
end $$;

-- Approving cannot overdraw: points removed after a request was made are re-checked.
do $$
declare v_id uuid;
begin
  perform tests.as_user('admin@test.local');
  insert into public.rewards (name, points_cost) values ('Cinema tickets', 100);
  perform tests.as_user('nurse2@test.local');
  perform public.request_redemption(tests.reward('Cinema tickets'));
  perform tests.ok((select available = 20 from public.points_balances), 'nurse2: 120 − 100 reserved = 20 available');
  perform tests.as_user('admin@test.local');
  perform tests.ok(tests.error_of(format($q$select public.adjust_points(%L, -50, 'Correction of bonus')$q$, tests.uid('nurse2@test.local'))) = 'P0001',
                   'reserved points cannot be adjusted away');
  perform tests.as_system();
  insert into public.points_transactions (employee_id, kind, amount, description, award_key, period, period_start, idempotency_key)
  values (tests.uid('nurse2@test.local'), 'correction', -50, 'Simulated withdrawal', 'test', 'daily', tests.base(), 'test-withdrawal');
  perform tests.as_user('admin@test.local');
  v_id := tests.redemption('nurse2@test.local', 'Cinema tickets');
  perform tests.ok(tests.error_of(format($q$select public.decide_redemption(%L, 'approve')$q$, v_id)) = 'P0001',
                   'approval re-checks the balance (never goes negative through redemption)');
  perform tests.as_system();
end $$;

-- The nightly job (system, no user) credits finished periods for everyone.
do $$
declare v_e uuid;
begin
  -- Approve while points are "not started" so the approval itself credits nothing.
  update public.app_settings set points_start_date = private.app_today() + 1;
  v_e := tests.submit_day('nurse2@test.local', tests.base() + 2, 8, 1200, 70, 3);
  update public.metric_entries set status = 'approved' where id = v_e;
  perform tests.ok(not exists (select 1 from public.points_transactions where employee_id = tests.uid('nurse2@test.local')
                               and period_start = tests.base() + 2), 'nothing credited before the points start date');
  update public.app_settings set points_start_date = tests.base() - 7;
  perform private.sync_all_points();
  perform tests.ok(exists (select 1 from public.points_transactions where employee_id = tests.uid('nurse2@test.local')
                           and period = 'daily' and period_start = tests.base() + 2 and amount = 10),
                   'system sync credits finished periods (nightly job)');
  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.error_of('select private.sync_all_points()') = '42501', 'clients cannot call internal points functions');
  perform tests.ok(tests.error_of(format($q$select private.settle_period(%L, 'daily', %L)$q$, tests.uid('nurse@test.local'), tests.base())) = '42501',
                   'clients cannot settle periods directly');
  perform tests.as_system();
end $$;

-- =============================================================================
-- 6. Access for logged-out and deactivated users
-- =============================================================================
do $$ begin
  perform tests.as_anon();
  perform tests.ok(tests.error_of('select * from public.points_transactions') = '42501'
               and tests.error_of('select * from public.points_balances') = '42501'
               and tests.error_of('select * from public.rewards') = '42501'
               and tests.error_of('select * from public.reward_redemptions') = '42501'
               and tests.error_of('select public.sync_points()') = '42501'
               and tests.error_of('select * from public.pending_points()') = '42501',
                   'logged-out users have no access to points or rewards');
  perform tests.as_system();
  update public.profiles set is_active = false where email = 'nurse2@test.local';
  perform tests.as_user('nurse2@test.local');
  perform tests.ok(tests.error_of(format('select public.request_redemption(%L)', tests.reward('Lunch'))) = '42501',
                   'deactivated users cannot redeem');
  perform tests.ok(tests.count_of('select * from public.points_transactions') = 0, 'deactivated users see no points');
  perform tests.as_system();
  perform tests.ok(tests.error_of(format('delete from auth.users where id = %L', tests.uid('nurse@test.local'))) = '23503',
                   'a user with points history cannot be deleted (deactivate instead)');
end $$;

\echo
\echo 'All Phase 4 tests passed.'
rollback;
