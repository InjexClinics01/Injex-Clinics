#!/usr/bin/env bash
# Applies all migrations to a throwaway LOCAL Postgres database and runs the
# RLS/security test suite. Supabase platform objects (auth schema, API roles)
# are stubbed. The da 
tabase and any roles this script created are removed on exit.
#
# Usage: backend/scripts/test-db.sh
# Env:   PGHOST (default localhost), PGUSER (default postgres), PGPORT, PGPASSWORD
set -euo pipefail

cd "$(dirname "$0")/.."
export PGHOST="${PGHOST:-localhost}" PGUSER="${PGUSER:-postgres}"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
DB="staff_dashboard_phase1_test_$$"
CREATED_ROLES=()

psql_admin() { psql -X -v ON_ERROR_STOP=1 -d postgres -Atq "$@"; }

cleanup() {
  psql_admin -c "drop database if exists \"$DB\" with (force)" >/dev/null 2>&1 || true
  for r in "${CREATED_ROLES[@]:-}"; do
    [ -n "$r" ] && psql_admin -c "drop role if exists $r" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

for r in anon authenticated service_role; do
  if [ -z "$(psql_admin -c "select 1 from pg_roles where rolname = '$r'")" ]; then
    psql_admin -c "create role $r nologin" >/dev/null
    CREATED_ROLES+=("$r")
  fi
done
psql_admin -c "alter role service_role bypassrls" >/dev/null

psql_admin -c "create database \"$DB\"" >/dev/null
echo "→ Created temporary database $DB"

psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/local/supabase_stub.sql >/dev/null

for f in supabase/migrations/*.sql; do
  echo "→ Applying $(basename "$f")"
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null
done

echo "→ Re-applying migrations (idempotency check)"
for f in supabase/migrations/*.sql; do
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f" >/dev/null 2>&1 \
    || { echo "  ✗ $(basename "$f") is not re-runnable"; exit 1; }
done

for t in supabase/tests/*_test.sql; do
  echo "→ Running $(basename "$t")"
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f "$t" 2>&1 \
    | sed -e 's/^psql:[^ ]* NOTICE:  /  /' -e 's/^NOTICE:  /  /'
done
