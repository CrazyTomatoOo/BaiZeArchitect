#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf 'DATABASE_URL is required\n' >&2
  exit 2
fi

backup="${1:-}"
if [[ -z "$backup" || ! -f "$backup" ]]; then
  printf 'usage: DATABASE_URL=... scripts/postgres-restore.sh <backup.dump>\n' >&2
  exit 2
fi

pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$DATABASE_URL" "$backup" || {
  printf 'pg_restore failed; retrying plain SQL restore with psql\n' >&2
  psql "$DATABASE_URL" < "$backup"
}
