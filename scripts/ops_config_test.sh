#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

grep -q 'go test -race -shuffle=on -count=1 ./...' "$ROOT/.github/workflows/platform-api-ci.yml"
grep -q 'go build ./cmd/platform-api' "$ROOT/.github/workflows/platform-api-ci.yml"
grep -q 'docker compose config' "$ROOT/.github/workflows/platform-api-ci.yml"
grep -q '/metrics' "$ROOT/ops/prometheus.yml"
grep -q 'platform_api_requests_total' "$ROOT/ops/prometheus-alerts.yml"
grep -q 'platform_api_uptime_seconds' "$ROOT/ops/grafana-platform-api-dashboard.json"
