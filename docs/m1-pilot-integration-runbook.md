# M1 Pilot Integration Runbook

This runbook defines how to connect a real pilot repository to the current M1 Platform API skeleton without assuming the future Agent Runtime or Code Knowledge Service exists yet.

## Scope

The pilot proves this platform path:

```text
project -> requirement version -> repository binding -> design run -> evidence validation -> artifact versions -> decisions -> findings -> design package
```

M1 remains API-first. The authoritative surface is `platform-api/api/openapi/openapi.json` and the live `GET /openapi.json` endpoint.

## Prerequisites

- Go 1.23+.
- `sqlc` available on `PATH`.
- Docker with Compose when container smoke tests are required.
- A local Git checkout for every `repositoryId` used by evidence references.

For the bundled M0 pilot data, `repositoryId` is `pilot-backend`, and the expected commit is `3dc359fceb1f`.

## Start the API

From `platform-api/`:

```bash
go run ./cmd/platform-api
```

The service listens on `:8080`. Readiness is:

```bash
curl -fsS http://127.0.0.1:8080/healthz
```

Container scaffold validation is:

```bash
docker compose config
docker compose up --build
```

If the Docker daemon is unavailable, `docker compose config` still validates the scaffold syntax and service wiring.

## Validate local assets

From the repository root:

```bash
uv run scripts/validate_m0.py
uv run scripts/validate_m0_package.py
```

From `platform-api/`:

```bash
sqlc generate
go test -race -shuffle=on -count=1 ./...
go build ./cmd/platform-api
```

## API smoke path

Create a project:

```bash
curl -fsS -X POST http://127.0.0.1:8080/api/v1/projects \
  -H 'Content-Type: application/json' \
  -d '{"name":"Pilot Project"}'
```

Import the bundled M0 cases into one design run:

```bash
curl -fsS -X POST http://127.0.0.1:8080/api/v1/imports/m0 \
  -H 'Content-Type: application/json' \
  -d '{"projectId":"project-1","caseIds":["M0-001","M0-005"]}'
```

Validate a real code evidence reference:

```bash
curl -fsS -X POST http://127.0.0.1:8080/api/v1/evidence/validations \
  -H 'Content-Type: application/json' \
  -d '{"repositoryId":"pilot-backend","commitSha":"3dc359fceb1f","filePath":"src/main/java/example/FileController.java","symbol":"FileController.upload","lineStart":10,"lineEnd":20}'
```

Generate a platform-native design package for the imported run:

```bash
curl -fsS -X POST http://127.0.0.1:8080/api/v1/design-packages \
  -H 'Content-Type: application/json' \
  -d '{"runId":"run-1"}'
```

Fetch the API contract:

```bash
curl -fsS http://127.0.0.1:8080/openapi.json
```

## Real pilot repository mapping

For M1, repository mapping is intentionally local and deterministic: an evidence `repositoryId` maps to a sibling directory under the workspace root. For example, `repositoryId:"pilot-backend"` maps to `./pilot-backend`.

Before creating evidence references for a real pilot repository:

1. Place the Git checkout under the workspace root.
2. Use a commit SHA that exists in that checkout.
3. Use repository-relative `filePath` values.
4. Select line ranges where the requested symbol leaf appears.
5. Keep `repositoryId` and `filePath` relative; path traversal is rejected by the API.

## Decision and approval governance smoke

After creating or importing a design run, create a decision, submit it for review, approve or reject it, then inspect persisted approval records:

```bash
curl -fsS http://127.0.0.1:8080/api/v1/decisions/DEC-2026-0001/approvals
```

Approval records are append-only evidence that a human governance transition happened through the API.

## Known M1 boundaries

- Without `DATABASE_URL`, the API uses in-memory stores for local development.
- With `DATABASE_URL`, the API uses PostgreSQL-backed repositories and applies the core migration at startup.
- The bundled runtime path is deterministic unless `AGENT_RUNTIME_URL` points to an external runtime adapter.
- Evidence selection uses local Java/Go repository files and embeds selected code excerpts in generated artifacts.
- Web Console is out of M1 scope.
