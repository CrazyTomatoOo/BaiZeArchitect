# Production Quickstart

This guide runs the Platform API with PostgreSQL-backed storage, automatic schema migration, and the governed runtime workflow.

## Start with Docker Compose

From `platform-api/`:

```bash
docker compose up --build
```

Compose starts PostgreSQL first, waits for `pg_isready`, then starts `platform-api` with:

```text
DATABASE_URL=${DATABASE_URL:?DATABASE_URL is required}
MIGRATIONS_DIR=/app/migrations
API_TOKEN=${API_TOKEN:-}
APPROVAL_TOKEN=${APPROVAL_TOKEN:-}
TEAM_TOKENS=${TEAM_TOKENS:?TEAM_TOKENS is required}
```

On startup, the API applies `migrations/0001_create_platform_core.sql` if the core schema is missing. The runtime image copies migrations into `/app/migrations`.

Health check:

```bash
curl -fsS http://127.0.0.1:8080/healthz
```

Production hardening surfaces:

```bash
curl -fsS http://127.0.0.1:8080/metrics
curl -i -H 'X-Request-ID: smoke-test' http://127.0.0.1:8080/healthz
```

Every response includes `X-Request-ID`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: no-referrer`. `/metrics` exposes `platform_api_requests_total` and `platform_api_uptime_seconds` for production scraping.

For formal team use, set database secrets and auditable team tokens before starting Compose:

```bash
export POSTGRES_PASSWORD='replace-with-strong-password'
export DATABASE_URL='postgres://baize:replace-with-strong-password@postgres:5432/baize_architect?sslmode=disable'
export TEAM_TOKENS='operator-name:operator-token:operator,approver-name:approver-token:approver'
docker compose up --build
```

Team token roles are `operator`, `approver`, and `admin`. Any team token can call ordinary `/api/*` routes with `Authorization: Bearer <token>`. Approval, supersede, and human-confirmation routes require an `approver` or `admin` token in `X-Approval-Token`; audit records use the authenticated team member name instead of trusting the request body.

For single-user protected deployments, set both legacy shared tokens before starting Compose:

```bash
export API_TOKEN='replace-with-api-token'
export APPROVAL_TOKEN='replace-with-approval-token'
docker compose up --build
```

When `API_TOKEN` is set and `TEAM_TOKENS` is empty, every `/api/*` request must include `Authorization: Bearer <token>`. When `APPROVAL_TOKEN` is set and `TEAM_TOKENS` is empty, decision approval, decision supersede, and human confirmation also require `X-Approval-Token: <token>`. `/healthz` and `/workbench` remain public; the workbench has token fields for protected API calls.

If Docker is unavailable, the same production path can be run directly:

```bash
cd platform-api
DATABASE_URL='postgres://localhost:5432/baize_architect?sslmode=disable' \
MIGRATIONS_DIR='./migrations' \
go run ./cmd/platform-api
```

## API workflow

If auth is enabled, define reusable headers for the examples:

```bash
AUTH_HEADER=(-H "Authorization: Bearer $API_TOKEN")
APPROVAL_HEADER=(-H "X-Approval-Token: $APPROVAL_TOKEN")
```

Create a project:

```bash
PROJECT_ID=$(curl -fsS -X POST http://127.0.0.1:8080/api/v1/projects \
  -H 'Content-Type: application/json' \
  "${AUTH_HEADER[@]}" \
  -d '{"name":"Production Demo"}' | jq -r '.id')
```

Bind a public GitHub repository. When `commitSha` is blank, the API clones or fetches the HTTPS GitHub URL into the `/evidence` cache volume and pins the current branch commit before storing the binding:

```bash
curl -fsS -X POST "http://127.0.0.1:8080/api/v1/projects/$PROJECT_ID/repositories" \
  -H 'Content-Type: application/json' \
  "${AUTH_HEADER[@]}" \
  -d '{"repositoryId":"volcano-sh/volcano","gitUrl":"https://github.com/volcano-sh/volcano.git","branch":"master"}'
```

For local smoke tests, the bundled pilot repository can still be bound directly:

```bash
curl -fsS -X POST "http://127.0.0.1:8080/api/v1/projects/$PROJECT_ID/repositories" \
  -H 'Content-Type: application/json' \
  "${AUTH_HEADER[@]}" \
  -d '{"repositoryId":"pilot-backend","branch":"main","commitSha":"3dc359fceb1f"}'
```

Create a requirement and design run:

```bash
REQUIREMENT_ID=$(curl -fsS -X POST "http://127.0.0.1:8080/api/v1/projects/$PROJECT_ID/requirements" \
  -H 'Content-Type: application/json' \
  "${AUTH_HEADER[@]}" \
  -d '{"content":"Add tenant-aware upload retention policy"}' | jq -r '.id')

RUN_ID=$(curl -fsS -X POST http://127.0.0.1:8080/api/v1/design-runs \
  -H 'Content-Type: application/json' \
  "${AUTH_HEADER[@]}" \
  -d "{\"projectId\":\"$PROJECT_ID\",\"requirementVersionId\":\"$REQUIREMENT_ID\"}" | jq -r '.id')
```

Run the coordinator:

```bash
RUNTIME=$(curl -fsS -X POST "http://127.0.0.1:8080/api/v1/design-runs/$RUN_ID/runtime-runs" \
  -H 'Content-Type: application/json' \
  "${AUTH_HEADER[@]}" \
  -d '{}')

DECISION_ID=$(printf '%s' "$RUNTIME" | jq -r '.decision.id')
```

The decision starts as `UNDER_REVIEW`. Human confirmation is blocked until explicit approval:

```bash
curl -i -X POST "http://127.0.0.1:8080/api/v1/design-runs/$RUN_ID/human-confirmation" \
  -H 'Content-Type: application/json' \
  "${AUTH_HEADER[@]}" \
  -d '{"approver":"product-owner","comment":"approved for archive"}'
```

Approve, confirm, and check SRS readiness:

```bash
curl -fsS -X POST "http://127.0.0.1:8080/api/v1/decisions/$DECISION_ID/approval" \
  -H 'Content-Type: application/json' \
  "${AUTH_HEADER[@]}" \
  "${APPROVAL_HEADER[@]}" \
  -d '{"status":"ACCEPTED","approver":"product-owner","comment":"approved for final archive"}'

curl -fsS -X POST "http://127.0.0.1:8080/api/v1/design-runs/$RUN_ID/human-confirmation" \
  -H 'Content-Type: application/json' \
  "${AUTH_HEADER[@]}" \
  "${APPROVAL_HEADER[@]}" \
  -d '{"approver":"product-owner","comment":"approved for archive"}'

curl -fsS "http://127.0.0.1:8080/api/v1/design-runs/$RUN_ID/srs-acceptance" \
  "${AUTH_HEADER[@]}"
```

The final response should have `ready: true`.

Export the completed run and inspect its audit trail:

```bash
curl -fsS "http://127.0.0.1:8080/api/v1/design-runs/$RUN_ID/audit" \
  "${AUTH_HEADER[@]}"

curl -fsS "http://127.0.0.1:8080/api/v1/design-runs/$RUN_ID/export" \
  "${AUTH_HEADER[@]}"
```

The audit response includes lifecycle events and approval records. The export response combines the completed run, generated design package manifest/traceability, and the same audit trail.

## Backup and restore

Create a PostgreSQL custom-format backup from any environment that has `pg_dump` available:

```bash
DATABASE_URL='postgres://...' scripts/postgres-backup.sh
DATABASE_URL='postgres://...' scripts/postgres-backup.sh backups/manual.dump
```

Restore a backup into the target database from any environment that has `pg_restore` and `psql` available:

```bash
DATABASE_URL='postgres://...' scripts/postgres-restore.sh backups/manual.dump
```

Run restore drills against a disposable database before relying on a backup for team operations.

## Validation commands

From `platform-api/`:

```bash
go test -race -shuffle=on -count=1 ./...
go build ./cmd/platform-api
```

From the repository root:

```bash
uv run scripts/validate_m0.py
uv run scripts/validate_m0_package.py
```

## CI and observability handoff

The repository includes `.github/workflows/platform-api-ci.yml` for the production gate: race/shuffle Go tests, build, and `docker compose config`.

Prometheus and Grafana starter assets live under `ops/`:

- `ops/prometheus.yml` scrapes `/metrics` from `platform-api:8080`.
- `ops/prometheus-alerts.yml` alerts when the API is down or traffic stalls.
- `ops/grafana-platform-api-dashboard.json` displays request count and uptime.
