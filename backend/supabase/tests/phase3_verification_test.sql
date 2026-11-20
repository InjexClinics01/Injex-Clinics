-- =============================================================================
-- Phase 3 tests: verification workflow, admin edits, audit trail, approved-only
-- aggregation, leaderboard and permissions.
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
  ('nurse2@test.local', '{"full_name":"Nora Nurse"}'),
  ('nurse3@test.local', '{"full_name":"Nell Nurse"}'),
  ('beauty@test.local', '{"full_name":"Bea Therapist"}');
update public.profiles set role = 'admin' where email = 'admin@test.local';
update public.profiles set employee_category = 'nurse' where email like 'nurse%';
update public.profiles set employee_category = 'beauty_therapist' where email = 'beauty@test.local';

create function tests.uid(p_email text) returns uuid language sql security definer as $$
  select id from public.profiles where email = p_email $$;
create function tests.metric(p_key text, p_category text default 'nurse') returns uuid language sql security definer as $$
  select id from public.metric_definitions where category = p_category and key = p_key $$;
create function tests.val(p_entry uuid, p_key text) returns numeric language sql security definer as $$
  select value from public.metric_entry_values where entry_id = p_entry and metric_id = tests.metric(p_key) $$;
create function tests.entry(p_email text, p_date date) returns uuid language sql security definer as $$
  select id from public.metric_entries where employee_id = tests.uid(p_email) and entry_date = p_date $$;
create function tests.audits(p_entity uuid, p_action text) returns bigint language sql security definer as $$
  select count(*) from public.audit_logs where entity_id = p_entity and action = p_action $$;
-- Monday two weeks ago: a full past week, independent of today's date.
create function tests.base() returns date language sql as $$
  select private.period_start('weekly', private.app_today()) - 14 $$;

-- Creates an entry (as the system) with values and walks it to the wanted status.
create function tests.make_entry(p_email text, p_date date, p_values jsonb, p_status public.entry_status)
returns uuid language plpgsql as $$
declare
  v_id  uuid;
  v_key text;
  v_cat text := (select employee_category from public.profiles where email = p_email);
begin
  perform tests.as_system();
  insert into public.metric_entries (employee_id, entry_date) values (tests.uid(p_email), p_date) returning id into v_id;
  for v_key in select jsonb_object_keys(p_values) loop
    insert into public.metric_entry_values (entry_id, metric_id, value)
    values (v_id, tests.metric(v_key, v_cat), (p_values ->> v_key)::numeric);
  end loop;
  if p_status <> 'draft' then
    update public.metric_entries set status = 'pending' where id = v_id;
  end if;
  if p_status not in ('draft', 'pending') then
    update public.metric_entries
       set status = p_status, review_note = case when p_status = 'rejected' then 'Test reason' end
     where id = v_id;
  end if;
  return v_id;
end $$;
grant execute on all functions in schema tests to anon, authenticated;

-- =============================================================================
-- 1. Review workflow: approve, request correction, reject (final), overturn
-- =============================================================================
do $$
declare
  v_entry uuid := tests.make_entry('nurse@test.local', tests.base(),
    '{"hours_worked": 8, "revenue": 2000, "rebooking_pct": 80, "tickets": 5}', 'pending');
  upd text := 'update public.metric_entries set %s where id = %L';
begin
  perform tests.as_user('admin@test.local');
  perform tests.ok(tests.error_of(format(upd, $s$status = 'rejected', review_note = null$s$, v_entry)) = '22023',
                   'rejecting without a reason is refused');
  perform tests.ok(tests.error_of(format(upd, $s$status = 'rejected', review_note = '   '$s$, v_entry)) = '22023',
                   'a blank reason is refused');
  perform tests.ok(tests.error_of(format(upd, $s$status = 'rejected', final_rejection = true, review_note = 'Not a working day'$s$, v_entry)) is null,
                   'admin rejects with a reason');
  perform tests.ok(tests.audits(v_entry, 'entry.rejected') = 1, 'rejection is audited');

  perform tests.as_user('nurse@test.local');
  perform tests.ok((select status = 'rejected' and final_rejection and review_note = 'Not a working day'
                    from public.metric_entries where id = v_entry), 'employee sees the rejection and the reason');
  perform tests.ok(tests.affected(format('update public.metric_entry_values set value = 1 where entry_id = %L and metric_id = %L',
                                  v_entry, tests.metric('revenue'))) = 0, 'rejected entry values are locked for the employee');
  perform tests.ok(tests.error_of(format(upd, $s$status = 'pending'$s$, v_entry)) = '42501', 'rejected entry cannot be resubmitted');
  perform tests.ok(tests.error_of(format(upd, $s$status = 'draft'$s$, v_entry)) = '42501', 'rejected entry cannot be reopened by the employee');

  perform tests.as_user('admin@test.local');
  perform tests.ok(tests.error_of(format(upd, $s$final_rejection = false, review_note = 'Please fix the ticket count'$s$, v_entry)) is null,
                   'admin turns the rejection into a correction request');
  perform tests.ok(tests.audits(v_entry, 'entry.correction_requested') = 1, 'correction request is audited');

  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.error_of(format(upd, $s$final_rejection = true$s$, v_entry)) = '42501',
                   'employee cannot change the review decision');
  perform tests.ok(tests.affected(format('update public.metric_entry_values set value = 6 where entry_id = %L and metric_id = %L',
                                  v_entry, tests.metric('tickets'))) = 1, 'employee corrects the requested value');
  perform tests.ok(tests.audits(v_entry, 'entry.value_corrected') = 1, 'employee correction is audited');
  perform tests.ok(tests.error_of(format(upd, $s$status = 'pending'$s$, v_entry)) is null, 'employee resubmits');
  perform tests.ok(tests.audits(v_entry, 'entry.resubmitted') = 1, 'resubmission is audited');

  perform tests.as_user('admin@test.local');
  perform tests.ok(tests.error_of(format(upd, $s$status = 'approved', review_note = null$s$, v_entry)) is null, 'admin approves');
  perform tests.ok((select reviewed_by = tests.uid('admin@test.local') and not final_rejection
                    from public.metric_entries where id = v_entry), 'approval recorded with the reviewer');
  perform tests.ok(tests.audits(v_entry, 'entry.approved') = 1, 'approval is audited');

  perform tests.ok(tests.error_of(format(upd, $s$status = 'rejected', final_rejection = true, review_note = 'Duplicate'$s$, v_entry)) is null
               and tests.error_of(format(upd, $s$status = 'approved', review_note = null$s$, v_entry)) is null,
                   'admin can overturn a rejection (rejected → approved)');
  perform tests.ok((select not final_rejection from public.metric_entries where id = v_entry), 'approval clears the final rejection flag');
  perform tests.as_system();
end $$;

-- Approving needs a complete entry (the employee may have cleared a value during a correction).
do $$
declare
  v_entry uuid := tests.make_entry('nurse2@test.local', tests.base(),
    '{"hours_worked": 6, "revenue": 900, "rebooking_pct": 70, "tickets": 3}', 'pending');
begin
  perform tests.as_user('admin@test.local');
  perform tests.ok(tests.error_of(format($q$update public.metric_entries set status = 'rejected', review_note = 'Check revenue' where id = %L$q$, v_entry)) is null,
                   'admin requests a correction');
  perform tests.as_user('nurse2@test.local');
  perform tests.ok(tests.affected(format('delete from public.metric_entry_values where entry_id = %L and metric_id = %L',
                                  v_entry, tests.metric('rebooking_pct'))) = 1, 'employee clears a required value while correcting');
  perform tests.as_user('admin@test.local');
  perform tests.ok(tests.error_of(format($q$update public.metric_entries set status = 'approved' where id = %L$q$, v_entry)) = 'P0001',
                   'an incomplete entry cannot be approved');
  perform tests.as_system();
  insert into public.metric_entry_values (entry_id, metric_id, value) values (v_entry, tests.metric('rebooking_pct'), 70);
end $$;

-- =============================================================================
-- 2. Admin edits with audit trail
-- =============================================================================
do $$
declare
  v_entry uuid := tests.entry('nurse@test.local', tests.base());
  v_draft uuid := tests.make_entry('nurse@test.local', tests.base() + 1, '{"hours_worked": 4}', 'draft');
  v_log   public.audit_logs;
begin
  perform tests.as_user('admin@test.local');
  perform tests.ok(tests.affected(format('update public.metric_entry_values set value = 2400 where entry_id = %L and metric_id = %L',
                                  v_entry, tests.metric('revenue'))) = 1, 'admin edits a value of an approved entry');
  perform tests.ok(tests.val(v_entry, 'hourly_revenue') = 300, 'admin edit recalculates hourly revenue (2400 / 8)');
  select * into v_log from public.audit_logs where entity_id = v_entry and action = 'entry.value_edited_by_admin';
  perform tests.ok(v_log.user_id = tests.uid('admin@test.local')
               and (v_log.details ->> 'from')::numeric = 2000 and (v_log.details ->> 'to')::numeric = 2400
               and v_log.details ->> 'metric_name' = 'Revenue'
               and (v_log.details ->> 'employee_id')::uuid = tests.uid('nurse@test.local'),
                   'admin edit audited with who, what, old and new value');
  perform tests.ok(tests.affected(format('update public.metric_entry_values set value = 1 where entry_id = %L and metric_id = %L',
                                  v_entry, tests.metric('hourly_revenue'))) = 0, 'admin cannot overwrite a calculated value');
  perform tests.ok(tests.affected(format('delete from public.metric_entry_values where entry_id = %L and metric_id = %L',
                                  v_entry, tests.metric('revenue'))) = 0, 'admin cannot delete values');
  perform tests.ok(tests.affected(format('update public.metric_entry_values set value = 5 where entry_id = %L', v_draft)) = 0,
                   'admin cannot edit an unsubmitted draft');
  perform tests.ok(tests.audits(v_draft, 'entry.value_corrected') = 0, 'typing in a draft is not audited');

  perform tests.as_user('nurse2@test.local');
  perform tests.ok(tests.affected(format('update public.metric_entry_values set value = 1 where entry_id = %L', v_entry)) = 0,
                   'another employee cannot edit the entry');
  perform tests.ok(tests.count_of('select * from public.audit_logs') = 0, 'employees cannot read the audit trail');
  perform tests.ok(tests.error_of($q$insert into public.audit_logs (action, entity_type) values ('fake', 'x')$q$) = '42501',
                   'employees cannot write to the audit trail');
  perform tests.as_system();
end $$;

-- =============================================================================
-- 3. Configuration audit
-- =============================================================================
do $$
declare v_log public.audit_logs;
begin
  perform tests.as_user('admin@test.local');
  update public.metric_definitions set name = 'Total Revenue' where id = tests.metric('revenue');
  select * into v_log from public.audit_logs where entity_id = tests.metric('revenue') and action = 'metric_definition.updated';
  perform tests.ok(v_log.details -> 'changes' -> 'name' ->> 'from' = 'Revenue'
               and v_log.details -> 'changes' -> 'name' ->> 'to' = 'Total Revenue'
               and v_log.user_id = tests.uid('admin@test.local'), 'metric change audited with old and new value');
  update public.metric_definitions set name = 'Revenue' where id = tests.metric('revenue');

  insert into public.scoring_rules (metric_id, period, threshold, points)
  values (tests.metric('revenue'), 'weekly', 1000, 50), (tests.metric('revenue'), 'weekly', 2000, 100),
         (tests.metric('rebooking_pct'), 'weekly', 80, 100);
  perform tests.ok((select count(*) from public.audit_logs where action = 'scoring_rule.created') = 3, 'scoring rule creation audited');
  update public.scoring_rules set points = 60 where threshold = 1000;
  perform tests.ok(exists (select 1 from public.audit_logs where action = 'scoring_rule.updated'
                           and details -> 'changes' -> 'points' ->> 'to' = '60'), 'scoring rule change audited');
  update public.scoring_rules set points = 50 where threshold = 1000;

  perform tests.ok(tests.affected('update public.app_settings set overall_leaderboard_enabled = overall_leaderboard_enabled') = 1,
                   'admin saves settings');
  perform tests.ok(not exists (select 1 from public.audit_logs where action = 'app_settings.updated'),
                   'saving settings without a change is not audited');
  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.affected('update public.app_settings set overall_leaderboard_enabled = true') = 0,
                   'employees cannot change settings');
  perform tests.ok(tests.count_of('select * from public.app_settings') = 1, 'employees can read settings');
  perform tests.as_system();
end $$;

-- =============================================================================
-- 4. Approved-only aggregation (charts and reports)
-- =============================================================================
do $$
declare
  b date := tests.base();
begin
  -- Nina, week 1: base (approved, edited to 2400 / 8h / 6 tickets), base+1 draft, base+2 approved, base+3 pending.
  perform tests.make_entry('nurse@test.local', b + 2, '{"hours_worked": 4, "revenue": 600, "rebooking_pct": 90, "tickets": 2}', 'approved');
  perform tests.make_entry('nurse@test.local', b + 3, '{"hours_worked": 8, "revenue": 9000, "rebooking_pct": 50, "tickets": 9}', 'pending');
  -- Nina, week 2.
  perform tests.make_entry('nurse@test.local', b + 7, '{"hours_worked": 5, "revenue": 500, "rebooking_pct": 60, "tickets": 1}', 'approved');

  perform tests.as_user('nurse@test.local');
  perform tests.ok((select value from public.metric_series('weekly', b, b + 13) where bucket = b and metric_id = tests.metric('revenue')) = 3000,
                   'weekly revenue counts approved entries only (2400 + 600, pending 9000 excluded)');
  perform tests.ok((select value from public.metric_series('weekly', b, b + 13) where bucket = b and metric_id = tests.metric('hourly_revenue')) = 250,
                   'weekly hourly revenue is a ratio of totals (3000 / 12h)');
  perform tests.ok((select value from public.metric_series('weekly', b, b + 13) where bucket = b and metric_id = tests.metric('rebooking_pct')) = 85,
                   'weekly rebooking % is the average of approved days');
  perform tests.ok((select value from public.metric_series('weekly', b, b + 13) where bucket = b and metric_id = tests.metric('revenue_per_ticket')) = 375,
                   'weekly revenue per ticket (3000 / 8 tickets)');
  perform tests.ok((select value from public.metric_series('weekly', b, b + 13) where bucket = b + 7 and metric_id = tests.metric('revenue')) = 500,
                   'second week bucketed separately');
  perform tests.ok((select value from public.metric_series('daily', b, b + 13) where bucket = b + 2 and metric_id = tests.metric('revenue')) = 600,
                   'daily bucket');
  perform tests.ok((select count(distinct bucket) from public.metric_series('daily', b, b + 13)) = 3, 'one daily bucket per approved day');
  perform tests.ok((select value from public.metric_series(null, b, b + 13) where metric_id = tests.metric('revenue')) = 3500,
                   'whole-range total (3000 + 500)');
  perform tests.ok(not exists (select 1 from public.metric_series('weekly', b, b + 13) where employee_id <> tests.uid('nurse@test.local')),
                   'employees only get their own series');

  perform tests.as_user('nurse2@test.local');
  perform tests.ok(tests.count_of(format($q$select * from public.metric_series('weekly', %L, %L, %L)$q$, b, b + 13, tests.uid('nurse@test.local'))) = 0,
                   'an employee cannot read a colleague''s series');

  perform tests.as_user('admin@test.local');
  perform tests.ok((select value from public.metric_series(null, b, b + 13, tests.uid('nurse@test.local')) where metric_id = tests.metric('revenue')) = 3500,
                   'admin reads any employee''s series');
  perform tests.ok((select count(distinct employee_id) from public.metric_series(null, b, b + 13, null, 'nurse')) = 1,
                   'category filter (Nora''s week-1 entry is not approved)');
  perform tests.ok((select submitted = 2 and approved = 1 and rejected = 1 and pending = 0
                    from public.submission_stats(b, b + 13) where day = b),
                   'submission stats per day: drafts excluded, statuses counted');
  perform tests.ok((select sum(submitted) from public.submission_stats(b, b + 13, null, tests.uid('nurse@test.local'))) = 4,
                   'submission stats filtered by employee (b, b+2, b+3, b+7; draft excluded)');
  perform tests.as_user('nurse2@test.local');
  perform tests.ok((select sum(submitted) from public.submission_stats(b, b + 13)) = 1, 'employees only count their own submissions');
  perform tests.as_system();
end $$;

-- =============================================================================
-- 5. Leaderboard (current week, approved only, points from scoring rules)
-- =============================================================================
do $$
declare
  t      date := private.app_today();
  v_bea  uuid;
  v_beam uuid;
  lb     text := 'select * from public.leaderboard(%L, %L, %L)';
begin
  perform tests.make_entry('nurse@test.local',  t, '{"hours_worked": 8, "revenue": 2000, "rebooking_pct": 85, "tickets": 5}', 'approved');
  perform tests.make_entry('nurse2@test.local', t, '{"hours_worked": 8, "revenue": 1500, "rebooking_pct": 70, "tickets": 3}', 'approved');
  perform tests.make_entry('nurse3@test.local', t, '{"hours_worked": 8, "revenue": 9000, "rebooking_pct": 99, "tickets": 9}', 'approved');
  update public.profiles set is_active = false where email = 'nurse3@test.local';

  insert into public.metric_definitions (category, key, name, kind, data_type, is_required, is_goal_eligible, is_scoring_eligible)
  values ('beauty_therapist', 'services', 'Services', 'input', 'integer', true, true, true) returning id into v_beam;
  insert into public.scoring_rules (metric_id, period, threshold, points) values (v_beam, 'weekly', 10, 100);
  v_bea := tests.make_entry('beauty@test.local', t, '{"services": 12}', 'pending');

  -- Goals (current week): Nina reaches hers, Nora does not.
  insert into public.goals (employee_id, metric_id, period, period_start, target_value) values
    (tests.uid('nurse@test.local'),  tests.metric('revenue'), 'weekly', t, 1800),
    (tests.uid('nurse2@test.local'), tests.metric('revenue'), 'weekly', t, 3000),
    (tests.uid('beauty@test.local'), v_beam, 'weekly', t, 12);

  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.count_of(format(lb, 'weekly', t, 'nurse')) = 2, 'nurse board: active nurses only (inactive excluded)');
  perform tests.ok((select points = 200 and max_points = 200 and goals_set = 1 and goals_achieved = 1 and approved_days >= 1
                    from public.leaderboard('weekly', t, 'nurse') where full_name = 'Nina Nurse'),
                   'Nina: revenue 2000 → 100 pts (top tier), rebooking 85% → 100 pts, goal achieved');
  perform tests.ok((select points = 50 and goals_set = 1 and goals_achieved = 0
                    from public.leaderboard('weekly', t, 'nurse') where full_name = 'Nora Nurse'),
                   'Nora: revenue 1500 → 50 pts, rebooking 70% → 0, goal not achieved');
  perform tests.ok((select metric_values is not null from public.leaderboard('weekly', t, 'nurse') where full_name = 'Nina Nurse')
               and (select metric_values is null from public.leaderboard('weekly', t, 'nurse') where full_name = 'Nora Nurse'),
                   'employees see their own figures only');
  perform tests.ok((select team_average = '{}'::jsonb from public.leaderboard('weekly', t, 'nurse') where full_name = 'Nora Nurse'),
                   'team average hidden from employees when fewer than 3 people have results (privacy)');
  perform tests.ok(tests.error_of(format(lb, 'weekly', t, 'beauty_therapist')) = '42501', 'employees cannot view another category''s board');
  perform tests.ok(tests.error_of(format(lb, 'weekly', t, null)) = '42501', 'overall board is off for employees by default');
  perform tests.ok((select sum(points) from public.leaderboard('daily', t, 'nurse')) = 0, 'daily board has no points without daily rules');

  perform tests.as_user('beauty@test.local');
  perform tests.ok((select points = 0 and goals_achieved = 0 from public.leaderboard('weekly', t, 'beauty_therapist')),
                   'pending entries earn no points and achieve no goals');
  perform tests.ok((select current_value = 12 and verified_value is null and verified_percent = 0 from public.goal_progress),
                   'goal progress shows submitted vs verified values');

  perform tests.as_user('admin@test.local');
  update public.metric_entries set status = 'approved' where id = v_bea;
  perform tests.ok((select points = 100 and max_points = 100 and goals_achieved = 1
                    from public.leaderboard('weekly', t, 'beauty_therapist')), 'approval counts towards the board');
  perform tests.ok(tests.count_of(format(lb, 'weekly', t, null)) = 3, 'admin sees the overall board');
  perform tests.ok((select bool_and(metric_values is not null) from public.leaderboard('weekly', t, 'nurse')), 'admin sees everyone''s figures');
  perform tests.ok((select (team_average ->> tests.metric('revenue')::text)::numeric = 1750
                    from public.leaderboard('weekly', t, 'nurse') limit 1), 'admin sees the team average (2000 + 1500) / 2');
  update public.app_settings set overall_leaderboard_enabled = true;
  perform tests.ok(exists (select 1 from public.audit_logs where action = 'app_settings.updated'), 'settings change audited');

  perform tests.as_user('nurse2@test.local');
  perform tests.ok(tests.count_of(format(lb, 'weekly', t, null)) = 3, 'employees see the overall board once enabled');
  perform tests.ok((select metric_values is null and team_average is null from public.leaderboard('weekly', t, null) where full_name = 'Bea Therapist'),
                   'overall board hides other employees'' figures and other categories'' averages');

  perform tests.as_user('nurse3@test.local');
  perform tests.ok(tests.count_of(format(lb, 'weekly', t, 'nurse')) = 0, 'deactivated users get no leaderboard');

  perform tests.as_system();
  update public.profiles set is_active = true where email = 'nurse3@test.local';
  perform tests.as_user('nurse@test.local');
  perform tests.ok((select round((team_average ->> tests.metric('revenue')::text)::numeric, 2) = 4166.67
                    from public.leaderboard('weekly', t, 'nurse') where full_name = 'Nina Nurse'),
                   'team average shown once 3 people have results ((2000 + 1500 + 9000) / 3)');

  perform tests.as_anon();
  perform tests.ok(tests.error_of(format(lb, 'weekly', t, 'nurse')) = '42501'
               and tests.error_of(format($q$select * from public.metric_series('weekly', %L, %L)$q$, t, t)) = '42501'
               and tests.error_of('select * from public.app_settings') = '42501'
               and tests.error_of(format($q$select * from public.submission_stats(%L, %L)$q$, t, t)) = '42501',
                   'logged-out users have no access to Phase 3 data');
  perform tests.as_system();
end $$;

\echo
\echo 'All Phase 3 tests passed.'
rollback;
