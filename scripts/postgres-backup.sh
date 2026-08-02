#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf 'DATABASE_URL is required\n' >&2
  exit 2
fi

output="${1:-backups/baize-architect-$(date -u +%Y%m%dT%H%M%SZ).dump}"
mkdir -p "$(dirname "$output")"

pg_dump --format=custom --no-owner --no-privileges --file "$output" "$DATABASE_URL"
printf '%s\n' "$output"
