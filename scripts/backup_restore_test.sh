#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

grep -q 'DATABASE_URL' "$ROOT/scripts/postgres-backup.sh"
grep -q 'pg_dump' "$ROOT/scripts/postgres-backup.sh"
grep -q 'DATABASE_URL' "$ROOT/scripts/postgres-restore.sh"
grep -q 'psql' "$ROOT/scripts/postgres-restore.sh"
grep -q 'postgres-backup.sh' "$ROOT/scripts/backup_restore_smoke.sh"
grep -q 'postgres-restore.sh' "$ROOT/scripts/backup_restore_smoke.sh"
grep -q 'RESTORE_DATABASE_URL' "$ROOT/scripts/backup_restore_smoke.sh"

bash -n "$ROOT/scripts/postgres-backup.sh"
bash -n "$ROOT/scripts/postgres-restore.sh"
bash -n "$ROOT/scripts/backup_restore_smoke.sh"
