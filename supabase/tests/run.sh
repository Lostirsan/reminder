#!/usr/bin/env bash
# Runs the tenant-isolation test on a throwaway local Postgres database.
# Usage: npm run test:db   (needs psql/createdb; set PGHOST/PGUSER etc. if not default)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
DB="pat_test_$$"
createdb "$DB"
trap 'dropdb --if-exists "$DB"' EXIT
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/auth_stub.sql"
for f in "$DIR"/../migrations/*.sql; do
  case "$f" in *_cron.sql) continue ;; esac
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$DIR/rls_test.sql"
