-- Shared assertion and impersonation helpers for the SQL test files.
-- Included with \ir inside each test's transaction (rolled back afterwards).

create schema tests;
grant usage on schema tests to anon, authenticated;

create function tests.ok(cond boolean, name text) returns void
language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FAIL - %', name;
  end if;
  raise notice 'ok - %', name;
end $$;

-- Impersonate an API user (like a request carrying their JWT).
create function tests.as_user(p_email text) returns void
language plpgsql as $$
declare v_id uuid;
begin
  execute 'reset role';
  select id into v_id from auth.users where email = p_email;
  if v_id is null then raise exception 'unknown test user %', p_email; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function tests.as_anon() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
end $$;

create function tests.as_system() returns void
language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Returns the SQLSTATE raised by the statement, or NULL if it succeeded.
create function tests.error_of(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;

create function tests.count_of(p_sql text) returns bigint
language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from (%s) s', p_sql) into n;
  return n;
end $$;

-- Rows affected by an UPDATE/DELETE.
create function tests.affected(p_sql text) returns bigint
language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on all functions in schema tests to anon, authenticated;
