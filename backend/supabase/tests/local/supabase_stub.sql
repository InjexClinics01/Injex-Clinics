-- Minimal stand-in for the Supabase platform objects the migrations depend on.
-- ONLY for running the migrations + RLS tests against a plain local Postgres.
-- Never apply this to a real Supabase project (it already has these objects).

create schema if not exists extensions;
create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

-- Same semantics as Supabase: reads the `sub` claim of the request JWT.
create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
