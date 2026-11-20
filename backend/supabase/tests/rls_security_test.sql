-- =============================================================================
-- RLS & security tests for Phase 1.
-- Runs inside a single transaction and rolls back, so it is safe to run
-- against a local/dev database (NEVER production).
--   Local Postgres : backend/scripts/test-db.sh
--   Supabase (dev) : psql "$SUPABASE_DB_URL" -f backend/supabase/tests/rls_security_test.sql
-- Each assertion prints "ok - <name>"; the first failure aborts the run.
-- =============================================================================
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;  -- show "ok - ..." lines

begin;

\ir _helpers.sql

-- -----------------------------------------------------------------------------
-- Fixtures (as system / service role)
-- -----------------------------------------------------------------------------
insert into auth.users (email, raw_app_meta_data, raw_user_meta_data) values
  ('admin@test.local',  '{"role":"admin"}',                                     '{"full_name":"Ada Admin"}'),
  ('nurse@test.local',  '{"role":"employee","employee_category":"nurse"}',      '{"full_name":"Nina Nurse"}'),
  ('beauty@test.local', '{"role":"employee","employee_category":"beauty_therapist"}', '{"full_name":"Bea Therapist"}'),
  -- attacker tries to self-assign admin via user-controlled metadata:
  ('sneaky@test.local', '{"employee_category":"not_a_category"}',               '{"full_name":"Sam Sneaky","role":"admin"}'),
  ('Mixed.Case@Test.Local', '{}', '{}');

-- =============================================================================
-- 1. Provisioning & categories
-- =============================================================================
do $$ begin
  perform tests.ok((select count(*) from public.employee_categories where slug in ('nurse','beauty_therapist')) = 2,
                   'seed categories nurse + beauty_therapist exist');
  perform tests.ok((select count(*) from public.profiles) = 5, 'a profile is created for every auth user');
  perform tests.ok((select role = 'admin' from public.profiles where email = 'admin@test.local'), 'admin role from app_metadata');
  perform tests.ok((select role = 'employee' and employee_category = 'nurse' from public.profiles where email = 'nurse@test.local'),
                   'nurse assigned employee + nurse category');
  perform tests.ok((select role = 'employee' and employee_category = 'beauty_therapist' from public.profiles where email = 'beauty@test.local'),
                   'beauty therapist assigned employee + beauty_therapist category');
  perform tests.ok((select role = 'employee' from public.profiles where email = 'sneaky@test.local'),
                   'role in user_metadata is ignored (no self-escalation)');
  perform tests.ok((select employee_category is null from public.profiles where email = 'sneaky@test.local'),
                   'unknown category is rejected (NULL)');
  perform tests.ok((select full_name = 'Nina Nurse' from public.profiles where email = 'nurse@test.local'), 'full_name copied from metadata');
  perform tests.ok(exists (select 1 from public.profiles where email = 'mixed.case@test.local'), 'email stored lower-case');
  perform tests.ok((select count(*) from public.audit_logs where action = 'profile.created') = 5, 'profile.created audited');
  perform tests.ok(tests.error_of($q$update public.profiles set employee_category = 'plumber' where email = 'nurse@test.local'$q$) = '23503',
                   'FK rejects non-existent category');
end $$;

-- Real Supabase Auth behaviour: the user row is INSERTED with only provider
-- metadata, and custom app_metadata is saved by a separate UPDATE. The profile
-- therefore starts as a plain employee; the app (create-admin.mjs and the
-- createEmployee action) must set role/category explicitly afterwards.
do $$
declare v_id uuid;
begin
  insert into auth.users (email, raw_app_meta_data, raw_user_meta_data)
  values ('gotrue@test.local', '{"provider":"email","providers":["email"]}', '{"full_name":"Two Step"}')
  returning id into v_id;
  update auth.users set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}' where id = v_id;
  perform tests.ok((select role = 'employee' from public.profiles where id = v_id),
                   'two-step Auth insert: profile defaults to least privilege (employee)');
  update public.profiles set role = 'admin' where id = v_id;   -- what the app does with the secret key
  perform tests.ok((select role = 'admin' from public.profiles where id = v_id),
                   'explicit service-role update promotes the profile');
  delete from auth.users where id = v_id;
end $$;

-- =============================================================================
-- 2. Anonymous users
-- =============================================================================
do $$ begin
  perform tests.as_anon();
  perform tests.ok(tests.error_of('select * from public.profiles') = '42501', 'anon cannot read profiles');
  perform tests.ok(tests.error_of('select * from public.employee_categories') = '42501', 'anon cannot read categories');
  perform tests.ok(tests.error_of('select * from public.audit_logs') = '42501', 'anon cannot read audit_logs');
  perform tests.ok(tests.error_of($q$update public.profiles set full_name = 'x'$q$) = '42501', 'anon cannot update profiles');
  perform tests.as_system();
end $$;

-- =============================================================================
-- 3. Employee isolation
-- =============================================================================
do $$
declare v_beauty uuid := (select id from public.profiles where email = 'beauty@test.local');
begin
  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.count_of('select * from public.profiles') = 1, 'employee sees exactly one profile (own)');
  perform tests.ok(tests.count_of(format('select * from public.profiles where id = %L', v_beauty)) = 0,
                   'employee cannot read another employee''s profile');
  perform tests.ok(tests.count_of('select * from public.employee_categories') = 2, 'active employee can read categories');
  perform tests.ok(tests.count_of('select * from public.audit_logs') = 0, 'employee cannot read audit logs');

  perform tests.ok(tests.affected($q$update public.profiles set full_name = 'Nina N.' where email = 'nurse@test.local'$q$) = 1,
                   'employee can update own full_name');
  perform tests.ok(tests.error_of($q$update public.profiles set role = 'admin' where email = 'nurse@test.local'$q$) = '42501',
                   'employee cannot promote self to admin');
  perform tests.ok(tests.error_of($q$update public.profiles set employee_category = 'beauty_therapist' where email = 'nurse@test.local'$q$) = '42501',
                   'employee cannot change own category');
  perform tests.ok(tests.error_of($q$update public.profiles set is_active = false where email = 'nurse@test.local'$q$) = '42501',
                   'employee cannot change own active status');
  perform tests.ok(tests.error_of($q$update public.profiles set email = 'x@y.z' where email = 'nurse@test.local'$q$) = '42501',
                   'employee cannot change own email via profiles');
  perform tests.ok(tests.affected(format($q$update public.profiles set full_name = 'hacked' where id = %L$q$, v_beauty)) = 0,
                   'employee cannot update another employee');
  perform tests.ok(tests.error_of($q$insert into public.profiles (id, email) values (gen_random_uuid(), 'a@b.c')$q$) = '42501',
                   'employee cannot insert profiles');
  perform tests.ok(tests.error_of('delete from public.profiles') = '42501', 'employee cannot delete profiles');
  perform tests.ok(tests.error_of($q$insert into public.audit_logs (action, entity_type) values ('fake', 'x')$q$) = '42501',
                   'employee cannot write audit logs');
  perform tests.ok(tests.error_of($q$insert into public.employee_categories (slug, name) values ('hacker', 'Hacker')$q$) = '42501',
                   'employee cannot create categories');
  perform tests.ok(tests.affected($q$delete from public.employee_categories where slug = 'nurse'$q$) = 0,
                   'employee cannot delete categories');
  perform tests.ok(tests.error_of('select private.is_admin()') is null and not private.is_admin(),
                   'is_admin() is false for employee');
  perform tests.as_system();
end $$;

-- =============================================================================
-- 4. Administrator capabilities
-- =============================================================================
do $$
declare v_admin uuid := (select id from public.profiles where email = 'admin@test.local');
        v_beauty uuid := (select id from public.profiles where email = 'beauty@test.local');
begin
  perform tests.as_user('admin@test.local');
  perform tests.ok(private.is_admin(), 'is_admin() is true for admin');
  perform tests.ok(tests.count_of('select * from public.profiles') = 5, 'admin reads all profiles');
  perform tests.ok(tests.count_of('select * from public.audit_logs') >= 5, 'admin reads audit logs');

  perform tests.ok(tests.affected(format($q$update public.profiles set employee_category = 'nurse' where id = %L$q$, v_beauty)) = 1,
                   'admin can reassign an employee category');
  perform tests.ok(tests.affected($q$update public.profiles set employee_category = 'nurse' where email = 'sneaky@test.local'$q$) = 1,
                   'admin can assign a category to an unassigned employee');
  perform tests.ok(tests.affected($q$update public.profiles set role = 'admin' where email = 'sneaky@test.local'$q$) = 1,
                   'admin can promote another user');
  perform tests.ok(tests.affected($q$update public.profiles set role = 'employee' where email = 'sneaky@test.local'$q$) = 1,
                   'admin can demote another user');
  perform tests.ok(tests.error_of(format($q$update public.profiles set role = 'employee' where id = %L$q$, v_admin)) = '42501',
                   'admin cannot change own role');
  perform tests.ok(tests.error_of(format($q$update public.profiles set is_active = false where id = %L$q$, v_admin)) = '42501',
                   'admin cannot deactivate self');
  perform tests.ok(tests.affected(format($q$update public.profiles set full_name = 'Ada A.' where id = %L$q$, v_admin)) = 1,
                   'admin can rename self');
  perform tests.ok(tests.error_of($q$update public.audit_logs set action = 'tampered'$q$) = '42501', 'audit logs cannot be updated');
  perform tests.ok(tests.error_of('delete from public.audit_logs') = '42501', 'audit logs cannot be deleted');
  perform tests.ok(tests.affected($q$update public.employee_categories set description = 'Registered nurses' where slug = 'nurse'$q$) = 1,
                   'admin can edit categories');
  perform tests.as_system();

  perform tests.ok(exists (
      select 1 from public.audit_logs
      where action = 'profile.updated' and entity_id = v_beauty and user_id = v_admin
        and details -> 'changes' -> 'employee_category' ->> 'to' = 'nurse'),
    'category change audited with admin as actor');

  -- restore
  update public.profiles set employee_category = 'beauty_therapist' where id = v_beauty;
end $$;

-- =============================================================================
-- 5. Deactivation
-- =============================================================================
do $$ begin
  perform tests.as_user('admin@test.local');
  perform tests.ok(tests.affected($q$update public.profiles set is_active = false where email = 'nurse@test.local'$q$) = 1,
                   'admin can deactivate an employee');

  perform tests.as_user('nurse@test.local');
  perform tests.ok(tests.count_of('select * from public.profiles') = 1, 'deactivated user can still read own profile (to see status)');
  perform tests.ok(tests.affected($q$update public.profiles set full_name = 'still here' where email = 'nurse@test.local'$q$) = 0,
                   'deactivated user cannot update own profile');
  perform tests.ok(tests.count_of('select * from public.employee_categories') = 0, 'deactivated user cannot read categories');

  -- Deactivated admin loses admin powers.
  perform tests.as_system();
  update public.profiles set role = 'admin' where email = 'sneaky@test.local';
  update public.profiles set is_active = false where email = 'sneaky@test.local';
  perform tests.as_user('sneaky@test.local');
  perform tests.ok(not private.is_admin(), 'deactivated admin is not treated as admin');
  perform tests.ok(tests.count_of('select * from public.profiles') = 1, 'deactivated admin sees only own profile');
  perform tests.as_system();
end $$;

-- =============================================================================
-- 6. System invariants
-- =============================================================================
do $$ begin
  perform tests.as_system();
  perform tests.ok(tests.error_of($q$update public.profiles set is_active = false where email = 'admin@test.local'$q$) = 'P0001',
                   'cannot deactivate the last active admin (even as service role)');
  perform tests.ok(tests.error_of($q$update public.profiles set role = 'employee' where email = 'admin@test.local'$q$) = 'P0001',
                   'cannot demote the last active admin');
  perform tests.ok(tests.error_of($q$delete from auth.users where email = 'admin@test.local'$q$) = 'P0001',
                   'cannot delete the last active admin');

  update auth.users set email = 'nina.new@test.local' where email = 'nurse@test.local';
  perform tests.ok(exists (select 1 from public.profiles where email = 'nina.new@test.local'), 'auth email change syncs to profile');

  perform tests.ok((select updated_at > created_at or updated_at = now() from public.profiles where email = 'nina.new@test.local'),
                   'updated_at maintained');

  delete from auth.users where email = 'beauty@test.local';
  perform tests.ok(not exists (select 1 from public.profiles where email = 'beauty@test.local'), 'deleting auth user cascades to profile');
  perform tests.ok(exists (select 1 from public.audit_logs where details ->> 'email' = 'beauty@test.local'),
                   'audit history survives user deletion');

  -- Helper functions are not exposed through the public API schema.
  perform tests.ok(not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef),
    'no SECURITY DEFINER functions in public schema');
  perform tests.ok(not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
    'RLS enabled on every public table');
end $$;

-- =============================================================================
-- 7. Schema integrity: primary keys, unique IDs, relationships between tables
-- =============================================================================
do $$
declare v_fks text;
begin
  perform tests.as_system();

  perform tests.ok(not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not exists (select 1 from pg_constraint k where k.conrelid = c.oid and k.contype = 'p')),
    'every public table has a primary key');

  perform tests.ok((
      select bool_and(format_type(a.atttypid, a.atttypmod) = 'uuid')
      from pg_constraint k
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any (k.conkey)
      where k.contype = 'p' and k.connamespace = 'public'::regnamespace),
    'all primary keys are UUIDs');

  select string_agg(fk, ', ' order by fk) into v_fks
  from (
    select format('%s(%s)->%s(%s)', k.conrelid::regclass, a.attname, k.confrelid::regclass, af.attname) as fk
  from pg_constraint k
  join pg_attribute a  on a.attrelid  = k.conrelid  and a.attnum  = k.conkey[1]
  join pg_attribute af on af.attrelid = k.confrelid and af.attnum = k.confkey[1]
  where k.contype = 'f' and k.connamespace = 'public'::regnamespace
  ) fks;
  raise notice '   foreign keys: %', v_fks;
  perform tests.ok(v_fks like '%audit_logs(user_id)->profiles(id)%'
                   and v_fks like '%profiles(employee_category)->employee_categories(slug)%'
                   and v_fks like '%profiles(id)->auth.users(id)%',
                   'foreign keys link audit_logs -> profiles -> auth.users and profiles -> employee_categories');

  perform tests.ok(tests.error_of($q$insert into public.profiles (id, email) select id, 'dup@test.local' from public.profiles limit 1$q$) = '23505',
                   'duplicate profile id rejected');
  perform tests.ok(tests.error_of($q$update public.profiles set email = 'admin@test.local' where email = 'nina.new@test.local'$q$) = '23505',
                   'duplicate profile email rejected');
  perform tests.ok(tests.error_of($q$insert into public.employee_categories (slug, name) values ('nurse', 'Another')$q$) = '23505',
                   'duplicate category slug rejected');
  perform tests.ok(tests.error_of($q$insert into public.employee_categories (slug, name) values ('nurse2', '  NURSE ')$q$) = '23505',
                   'duplicate category name rejected (case-insensitive)');
  perform tests.ok(tests.error_of($q$insert into public.employee_categories (slug, name) values ('Bad Slug', 'Bad')$q$) = '23514',
                   'invalid category slug format rejected');
  perform tests.ok(tests.error_of($q$update public.profiles set full_name = E'Nina\x01' where email = 'nina.new@test.local'$q$) = '23514',
                   'control characters in names rejected');
  perform tests.ok(tests.error_of($q$update public.profiles set email = 'Upper@Test.Local' where email = 'nina.new@test.local'$q$) = '23514',
                   'non-lower-case email rejected');
  perform tests.ok(tests.error_of($q$insert into public.audit_logs (action, entity_type, details) values ('x', 'y', '[1,2]')$q$) = '23514',
                   'audit details must be a JSON object');
  perform tests.ok(tests.error_of($q$delete from public.employee_categories where slug = 'nurse'$q$) = '23503',
                   'category in use cannot be deleted');

  update public.employee_categories set slug = 'registered_nurse' where slug = 'nurse';
  perform tests.ok(exists (select 1 from public.profiles where email = 'nina.new@test.local' and employee_category = 'registered_nurse'),
                   'renaming a category slug cascades to profiles');
end $$;

\echo
\echo 'All RLS & security tests passed.'
rollback;
