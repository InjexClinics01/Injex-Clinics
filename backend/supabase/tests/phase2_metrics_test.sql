-- =============================================================================
-- Phase 2 tests: metrics, daily entries, calculations, goals, scoring, RLS.
-- Runs in a transaction and rolls back. Run with backend/scripts/test-db.sh.
-- =============================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

begin;
\ir _helpers.sql

-- Fixtures: Supabase Auth creates users in two steps, so set roles explicitly.
insert into auth.users (email, raw_user_meta_data) values
  ('admin@test.local',  '{"full_name":"Ada Admin"}'),
  ('nurse@test.local',  '{"full_name":"Nina Nurse"}'),
  ('nurse2@test.local', '{"full_name":"Nora Nurse"}'),
  ('beauty@test.local', '{"full_name":"Bea Therapist"}');
update public.profiles set role = 'admin' where email = 'admin@test.local';
update public.profiles set employee_category = 'nurse' where email in ('nurse@test.local', 'nurse2@test.local');
update public.profiles set employee_category = 'beauty_therapist' where email = 'beauty@test.local';

-- ID lookups bypass RLS (security definer) so tests can reference rows the
-- impersonated user is not allowed to see.
create function tests.uid(p_email text) returns uuid language sql security definer as $$
  select id from public.profiles where email = p_email $$;
create function tests.metric(p_key text, p_category text default 'nurse') returns uuid language sql security definer as $$
  select id from public.metric_definitions where category = p_category and key = p_key $$;
create function tests.val(p_entry uuid, p_key text) returns numeric language sql security definer as $$
  select value from public.metric_entry_values where entry_id = p_entry and metric_id = tests.metric(p_key) $$;
grant execute on all functions in schema tests to anon, authenticated;

-- =============================================================================
-- 1. Metric definitions (category-specific forms)
-- =============================================================================
do $$ begin
  perform tests.ok((select count(*) from public.metric_definitions where category = 'nurse') = 13, 'nurse: 13 metrics seeded');
  perform tests.ok((select count(*) from public.metric_definitions where category = 'nurse' and kind = 'calculated') = 3,
                   'nurse: 3 calculated metrics (hourly revenue, revenue/ticket, units/hour)');
  perform tests.ok(not exists (select 1 from public.metric_definitions where category = 'beauty_therapist'),
                   'beauty therapist: no invented metrics seeded');

  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.count_of($q$select * from public.metric_definitions where key <> 'pct_test'$q$) = 13, 'nurse sees only nurse metrics');
  perform tests.ok(tests.error_of($q$insert into public.metric_definitions (category, key, name) values ('nurse', 'hack', 'Hack')$q$) = '42501',
                   'employee cannot create metrics');
  perform tests.ok(tests.affected($q$update public.metric_definitions set name = 'x' where key = 'revenue'$q$) = 0,
                   'employee cannot edit metrics');

  perform tests.as_user('beauty@test.local');
  perform tests.ok(tests.count_of('select * from public.metric_definitions') = 0, 'beauty therapist sees no nurse metrics');

  perform tests.as_user('admin@test.local');
  perform tests.ok(tests.error_of($q$insert into public.metric_definitions (category, key, name, kind, data_type, is_goal_eligible, is_scoring_eligible, sort_order)
                                    values ('beauty_therapist', 'services', 'Services', 'input', 'integer', true, true, 10)$q$) is null,
                   'admin can configure a beauty therapist metric');
  perform tests.ok(tests.error_of($q$update public.metric_definitions set key = 'renamed' where key = 'revenue'$q$) = '42501',
                   'metric key is immutable');
  perform tests.ok(tests.error_of($q$update public.metric_definitions set kind = 'calculated' where key = 'revenue'$q$) = '42501',
                   'metric kind is immutable');
  perform tests.ok(tests.error_of($q$update public.metric_definitions set category = 'beauty_therapist' where key = 'revenue'$q$) = '42501',
                   'metric cannot be moved to another category');
  perform tests.ok(tests.error_of(format($q$insert into public.metric_definitions (category, key, name, kind, numerator_metric_id, denominator_metric_id)
                                    values ('beauty_therapist', 'bad_ratio', 'Bad ratio', 'calculated', %L, %L)$q$,
                                    tests.metric('revenue'), tests.metric('hours_worked'))) = '23514',
                   'calculated metric cannot use another category''s metrics');
  perform tests.ok(tests.error_of($q$insert into public.metric_definitions (category, key, name, data_type, min_value, is_active)
                                    values ('nurse', 'pct_test', 'Pct test', 'percentage', -5, false)$q$) is null,
                   'admin adds a percentage metric');
  perform tests.ok((select min_value = 0 and max_value = 100 from public.metric_definitions where key = 'pct_test'),
                   'percentage metrics are bounded to 0–100');
  perform tests.as_system();

  perform tests.as_user('beauty@test.local');
  perform tests.ok(tests.count_of('select * from public.metric_definitions') = 1, 'beauty therapist sees admin-configured metric');
  perform tests.as_system();
end $$;

-- =============================================================================
-- 2. Daily entries: duplicates, dates, ownership
-- =============================================================================
do $$
declare v_today date := private.app_today();
begin
  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.error_of(format($q$insert into public.metric_entries (employee_id, entry_date) values (%L, %L)$q$,
                                  tests.uid('nurse@test.local'), v_today)) is null, 'nurse creates a draft for today');
  perform tests.ok(tests.error_of(format($q$insert into public.metric_entries (employee_id, entry_date) values (%L, %L)$q$,
                                  tests.uid('nurse@test.local'), v_today)) = '23505', 'duplicate entry for the same date rejected');
  perform tests.ok(tests.error_of(format($q$insert into public.metric_entries (employee_id, entry_date) values (%L, %L)$q$,
                                  tests.uid('nurse@test.local'), v_today + 1)) = '22023', 'future date rejected');
  perform tests.ok(tests.error_of(format($q$insert into public.metric_entries (employee_id, entry_date, status) values (%L, %L, 'approved')$q$,
                                  tests.uid('nurse@test.local'), v_today - 1)) = '42501', 'cannot create an entry as approved');
  perform tests.ok(tests.error_of(format($q$insert into public.metric_entries (employee_id, entry_date) values (%L, %L)$q$,
                                  tests.uid('nurse2@test.local'), v_today - 1)) = '42501', 'cannot create entries for someone else');
  perform tests.ok((select category = 'nurse' from public.metric_entries where employee_id = tests.uid('nurse@test.local')),
                   'entry category comes from the profile');

  perform tests.as_user('admin@test.local');
  perform tests.ok(tests.error_of(format($q$insert into public.metric_entries (employee_id, entry_date) values (%L, %L)$q$,
                                  tests.uid('admin@test.local'), v_today)) = 'P0001', 'users without a category cannot create entries');
  perform tests.as_system();
end $$;

-- =============================================================================
-- 3. Values, validation and calculations
-- =============================================================================
do $$
declare
  v_entry uuid := (select id from public.metric_entries where employee_id = tests.uid('nurse@test.local'));
  ins text := 'insert into public.metric_entry_values (entry_id, metric_id, value) values (%L, %L, %s)';
begin
  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.error_of(format(ins, v_entry, tests.metric('tickets'), '2.5')) = '22023', 'integer metric rejects decimals');
  perform tests.ok(tests.error_of(format(ins, v_entry, tests.metric('rebooking_pct'), '120')) = '22023', 'percentage above 100 rejected');
  perform tests.ok(tests.error_of(format(ins, v_entry, tests.metric('hours_worked'), '25')) = '22023', 'hours above 24 rejected');
  perform tests.ok(tests.error_of(format(ins, v_entry, tests.metric('revenue'), '-1')) = '22023', 'negative revenue rejected');
  perform tests.ok(tests.error_of(format(ins, v_entry, tests.metric('revenue'), 'null')) = '23502', 'input value cannot be empty');
  perform tests.ok(tests.error_of(format(ins, v_entry, tests.metric('hourly_revenue'), '9999')) = '42501',
                   'client cannot write a calculated metric');

  perform tests.ok(tests.error_of(format(ins, v_entry, tests.metric('hours_worked'), '8')) is null, 'nurse saves hours');
  perform tests.ok(tests.error_of(format(ins, v_entry, tests.metric('revenue'), '2000')) is null, 'nurse saves revenue');
  perform tests.ok(tests.error_of(format(ins, v_entry, tests.metric('tickets'), '5')) is null, 'nurse saves tickets');
  perform tests.ok(tests.error_of(format(ins, v_entry, tests.metric('filler_ml'), '2')) is null, 'nurse saves filler ml');
  perform tests.ok(tests.error_of(format(ins, v_entry, tests.metric('sculptra'), '1')) is null, 'nurse saves sculptra');
  perform tests.ok(tests.error_of(format(ins, v_entry, tests.metric('prp'), '1')) is null, 'nurse saves PRP');
  perform tests.ok(tests.val(v_entry, 'hourly_revenue') = 250, 'hourly revenue = 2000 / 8 = 250');
  perform tests.ok(tests.val(v_entry, 'revenue_per_ticket') = 400, 'revenue per ticket = 2000 / 5 = 400');
  perform tests.ok(tests.val(v_entry, 'units_per_hour') = 0.5, 'units per hour = (2 + 1 + 1) / 8 = 0.5');

  perform tests.ok(tests.affected(format('update public.metric_entry_values set value = 0 where entry_id = %L and metric_id = %L',
                                  v_entry, tests.metric('tickets'))) = 1, 'tickets set to 0');
  perform tests.ok(tests.val(v_entry, 'revenue_per_ticket') is null,
                   'division by zero (0 tickets) gives no value instead of an error');
  perform tests.affected(format('update public.metric_entry_values set value = 5 where entry_id = %L and metric_id = %L',
                         v_entry, tests.metric('tickets')));
  perform tests.ok(tests.affected(format('delete from public.metric_entry_values where entry_id = %L and metric_id = %L',
                                  v_entry, tests.metric('prp'))) = 1, 'PRP cleared');
  perform tests.ok(tests.val(v_entry, 'units_per_hour') = 0.375, 'clearing a treatment recalculates units per hour (3 / 8)');

  perform tests.as_user('nurse2@test.local');
  perform tests.ok(tests.count_of('select * from public.metric_entries') = 0, 'other nurse cannot see the entry');
  perform tests.ok(tests.count_of('select * from public.metric_entry_values') = 0, 'other nurse cannot see the values');
  perform tests.ok(tests.error_of(format(ins, v_entry, tests.metric('revenue'), '1')) = '42501', 'other nurse cannot add values');
  perform tests.ok(tests.affected(format('update public.metric_entry_values set value = 1 where entry_id = %L', v_entry)) = 0,
                   'other nurse cannot change values');

  perform tests.as_user('admin@test.local');
  perform tests.ok(tests.count_of('select * from public.metric_entry_values') >= 8, 'admin can read all values');
  perform tests.as_system();
end $$;

-- =============================================================================
-- 4. Submission workflow and corrections
-- =============================================================================
do $$
declare
  v_entry uuid := (select id from public.metric_entries where employee_id = tests.uid('nurse@test.local'));
  upd text := 'update public.metric_entries set status = %L where id = %L';
begin
  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.error_of(format(upd, 'pending', v_entry)) = 'P0001', 'cannot submit with required fields missing (Rebooking %)');
  perform tests.error_of(format('insert into public.metric_entry_values (entry_id, metric_id, value) values (%L, %L, 80)',
                         v_entry, tests.metric('rebooking_pct')));
  perform tests.ok(tests.error_of(format(upd, 'pending', v_entry)) is null, 'nurse submits a complete entry');
  perform tests.ok((select submitted_at is not null from public.metric_entries where id = v_entry), 'submitted_at recorded');
  perform tests.ok(tests.affected(format('update public.metric_entry_values set value = 1 where entry_id = %L and metric_id = %L',
                                  v_entry, tests.metric('revenue'))) = 0, 'pending entry values are locked');
  perform tests.ok(tests.error_of(format(upd, 'approved', v_entry)) = '42501', 'employee cannot approve own entry');
  perform tests.ok(tests.error_of(format($q$update public.metric_entries set review_note = 'ok' where id = %L$q$, v_entry)) = '42501',
                   'employee cannot write review fields');
  perform tests.ok(tests.error_of(format(upd, 'draft', v_entry)) is null, 'employee can withdraw a pending entry to draft');
  perform tests.ok(tests.error_of(format(upd, 'pending', v_entry)) is null, 'and resubmit it');

  perform tests.as_user('admin@test.local');
  perform tests.ok(tests.error_of(format(upd, 'approved', v_entry)) is null, 'admin approves');
  perform tests.ok((select reviewed_by = tests.uid('admin@test.local') and reviewed_at is not null
                    from public.metric_entries where id = v_entry), 'reviewer and review time recorded');

  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.error_of(format(upd, 'draft', v_entry)) = '42501', 'approved entry cannot be reopened by the employee');

  perform tests.as_user('admin@test.local');
  perform tests.ok(tests.error_of(format($q$update public.metric_entries set status = 'rejected', review_note = 'Revenue looks wrong' where id = %L$q$,
                                  v_entry)) is null, 'admin reopens an approved entry for correction');

  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.affected(format('update public.metric_entry_values set value = 2400 where entry_id = %L and metric_id = %L',
                                  v_entry, tests.metric('revenue'))) = 1, 'employee corrects a rejected entry');
  perform tests.ok(tests.val(v_entry, 'hourly_revenue') = 300, 'correction recalculates hourly revenue (2400 / 8)');
  perform tests.ok(tests.error_of(format(upd, 'pending', v_entry)) is null, 'corrected entry resubmitted');
  perform tests.as_system();
end $$;

-- =============================================================================
-- 5. History preserved when definitions change
-- =============================================================================
do $$
declare v_entry uuid := (select id from public.metric_entries where employee_id = tests.uid('nurse@test.local'));
begin
  update public.metric_definitions set name = 'Total Revenue', unit = '£' where key = 'revenue' and category = 'nurse';
  perform tests.ok((select metric_name = 'Revenue' and metric_unit = '$' from public.metric_entry_values
                    where entry_id = v_entry and metric_id = tests.metric('revenue')),
                   'renaming a metric keeps the original name/unit on past values');
  update public.metric_definitions set is_active = false where key = 'units_per_hour' and category = 'nurse';
  perform tests.ok(tests.val(v_entry, 'units_per_hour') is not null, 'disabling a metric keeps past values');
  perform tests.ok(tests.error_of(format('delete from public.metric_definitions where id = %L', tests.metric('revenue'))) = '23503',
                   'metrics with history cannot be deleted');
  update public.metric_definitions set name = 'Revenue', unit = '$' where key = 'revenue' and category = 'nurse';
  update public.metric_definitions set is_active = true where key = 'units_per_hour' and category = 'nurse';
end $$;

-- =============================================================================
-- 6. Goals and progress
-- =============================================================================
do $$
declare
  v_today date := private.app_today();
  v_nurse uuid := tests.uid('nurse@test.local');
  ins text := 'insert into public.goals (employee_id, metric_id, period, period_start, target_value) values (%L, %L, %L, %L, %s)';
  v_goal uuid;
begin
  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.error_of(format(ins, v_nurse, tests.metric('hourly_revenue'), 'weekly', v_today, 600)) is null,
                   'nurse creates a weekly goal');
  select id into v_goal from public.goals where employee_id = v_nurse;
  perform tests.ok((select period_start = date_trunc('week', v_today)::date and period_end = period_start + 6 from public.goals where id = v_goal),
                   'weekly goal normalised to Monday–Sunday');
  perform tests.ok(tests.error_of(format(ins, v_nurse, tests.metric('hourly_revenue'), 'weekly', v_today, 500)) = '23505',
                   'duplicate active goal for the same metric and period rejected');
  perform tests.ok(tests.error_of(format(ins, v_nurse, tests.metric('hours_worked'), 'daily', v_today, 8)) = '42501',
                   'goal on a non-eligible metric rejected');
  perform tests.ok(tests.error_of(format(ins, v_nurse, tests.metric('services', 'beauty_therapist'), 'daily', v_today, 3)) = '42501',
                   'goal on another category''s metric rejected');
  perform tests.ok(tests.error_of(format(ins, v_nurse, tests.metric('revenue'), 'monthly', (v_today - interval '2 months')::date, 1000)) = '22023',
                   'back-dated goal rejected');
  perform tests.ok(tests.error_of(format(ins, v_nurse, tests.metric('rebooking_pct'), 'daily', v_today, 150)) = '22023',
                   'percentage goal above 100 rejected');
  perform tests.ok(tests.error_of(format(ins, v_nurse, tests.metric('revenue'), 'daily', v_today, 0)) = '23514',
                   'zero target rejected');
  perform tests.ok(tests.error_of(format(ins, tests.uid('nurse2@test.local'), tests.metric('revenue'), 'daily', v_today, 100)) = '42501',
                   'cannot create goals for someone else');
  perform tests.ok(tests.error_of(format('update public.goals set target_value = 1 where id = %L', v_goal)) = '42501',
                   'goal target cannot be changed after creation');

  -- Entry is pending (submitted): 2400 revenue / 8 hours = 300 per hour → 50% of 600
  perform tests.ok((select current_value = 300 and percent_complete = 50 and remaining = 300 and entries_counted = 1
                    from public.goal_progress where goal_id = v_goal),
                   'goal progress: 300 / 600 = 50%, 300 remaining');

  perform tests.ok(tests.error_of(format(ins, v_nurse, tests.metric('rebooking_pct'), 'daily', v_today, 80)) is null,
                   'nurse creates a daily rebooking goal');
  perform tests.ok((select percent_complete = 100 from public.goal_progress where metric_id = tests.metric('rebooking_pct')),
                   'daily rebooking goal reached (80 / 80 = 100%)');

  perform tests.as_user('nurse2@test.local');
  perform tests.ok(tests.count_of('select * from public.goals') = 0 and tests.count_of('select * from public.goal_progress') = 0,
                   'other nurse cannot see goals or progress');

  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.affected(format($q$update public.goals set status = 'cancelled' where id = %L$q$, v_goal)) = 1,
                   'nurse cancels a goal');
  perform tests.ok(tests.error_of(format(ins, v_nurse, tests.metric('hourly_revenue'), 'weekly', v_today, 500)) is null,
                   'a new goal can replace a cancelled one');
  perform tests.ok(tests.error_of(format($q$update public.goals set status = 'active' where id = %L$q$, v_goal)) = '42501',
                   'cancelled goals cannot be reactivated');
  perform tests.ok((select count(*) = 1 from public.my_period_summary(v_today, v_today) where value = 2400),
                   'dashboard summary returns today''s revenue');
  perform tests.as_system();
end $$;

-- =============================================================================
-- 7. Drafts do not count toward goals
-- =============================================================================
do $$
declare v_today date := private.app_today();
begin
  perform tests.as_user('nurse2@test.local');
  perform tests.error_of(format('insert into public.metric_entries (employee_id, entry_date) values (%L, %L)', tests.uid('nurse2@test.local'), v_today));
  perform tests.error_of(format('insert into public.metric_entry_values (entry_id, metric_id, value) select id, %L, 5000 from public.metric_entries',
                         tests.metric('revenue')));
  perform tests.error_of(format('insert into public.goals (employee_id, metric_id, period, period_start, target_value) values (%L, %L, %L, %L, 1000)',
                         tests.uid('nurse2@test.local'), tests.metric('revenue'), 'daily', v_today));
  perform tests.ok((select current_value is null and percent_complete = 0 from public.goal_progress),
                   'draft entries are not counted in goal progress');
  perform tests.as_system();
end $$;

-- =============================================================================
-- 8. Scoring rules
-- =============================================================================
do $$ begin
  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.error_of(format($q$insert into public.scoring_rules (metric_id, period, threshold, points) values (%L, 'daily', 80, 100)$q$,
                                  tests.metric('rebooking_pct'))) = '42501', 'employee cannot create scoring rules');

  perform tests.as_user('admin@test.local');
  perform tests.ok(tests.error_of(format($q$insert into public.scoring_rules (metric_id, period, threshold, points) values (%L, 'daily', 80, 100)$q$,
                                  tests.metric('rebooking_pct'))) is null, 'admin creates a scoring rule');
  perform tests.ok(tests.error_of(format($q$insert into public.scoring_rules (metric_id, period, threshold, points) values (%L, 'daily', 80, 50)$q$,
                                  tests.metric('rebooking_pct'))) = '23505', 'duplicate rule (same metric, period, threshold) rejected');
  perform tests.ok(tests.error_of(format($q$insert into public.scoring_rules (metric_id, period, threshold, points) values (%L, 'daily', 8, 10)$q$,
                                  tests.metric('hours_worked'))) = '23514', 'rule on a non-scoring metric rejected');
  perform tests.ok(tests.error_of(format($q$insert into public.scoring_rules (metric_id, period, threshold, points) values (%L, 'daily', 1, 0)$q$,
                                  tests.metric('revenue'))) = '23514', 'zero points rejected');

  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.count_of('select * from public.scoring_rules') = 1, 'nurse can read scoring rules for nurse metrics');
  perform tests.as_user('beauty@test.local');
  perform tests.ok(tests.count_of('select * from public.scoring_rules') = 0, 'beauty therapist cannot read nurse scoring rules');
  perform tests.as_system();
end $$;

-- =============================================================================
-- 9. Logged-out access and deactivated users
-- =============================================================================
do $$ begin
  perform tests.as_anon();
  perform tests.ok(tests.error_of('select * from public.metric_definitions') = '42501'
               and tests.error_of('select * from public.metric_entries') = '42501'
               and tests.error_of('select * from public.metric_entry_values') = '42501'
               and tests.error_of('select * from public.goals') = '42501'
               and tests.error_of('select * from public.goal_progress') = '42501'
               and tests.error_of('select * from public.scoring_rules') = '42501'
               and tests.error_of('select * from public.my_period_summary(current_date, current_date)') = '42501',
                   'logged-out users have no access to Phase 2 data');
  perform tests.as_system();

  update public.profiles set is_active = false where email = 'nurse@test.local';
  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.count_of('select * from public.metric_definitions') = 0, 'deactivated user sees no metrics');
  perform tests.ok(tests.affected($q$update public.metric_entries set status = 'draft'$q$) = 0, 'deactivated user cannot change entries');
  perform tests.as_system();
end $$;

\echo
\echo 'All Phase 2 tests passed.'
rollback;
