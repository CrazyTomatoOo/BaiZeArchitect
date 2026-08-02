#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" || -z "${RESTORE_DATABASE_URL:-}" ]]; then
  printf 'DATABASE_URL and RESTORE_DATABASE_URL are required\n' >&2
  exit 2
fi

backup="${BACKUP_SMOKE_FILE:-$(mktemp -t baize-backup-smoke.XXXXXX.dump)}"
cleanup_backup=0
if [[ -z "${BACKUP_SMOKE_FILE:-}" ]]; then
  cleanup_backup=1
fi

scripts/postgres-backup.sh "$backup" >/dev/null
DATABASE_URL="$RESTORE_DATABASE_URL" scripts/postgres-restore.sh "$backup"

if [[ "$cleanup_backup" == "1" ]]; then
  rm -f "$backup"
fi
