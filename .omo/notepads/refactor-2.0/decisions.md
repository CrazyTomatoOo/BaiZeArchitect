# Refactor 2.0 Decisions

## 2026-07-20 — WP5 Backend: Agent Roles

- Use lowercase role names as stable machine identifiers because existing `agent_step.role` values and frontend role tokens are lowercase; retain title-case names only in product copy.
- Expose registry metadata through `List`, `Lookup`, and `Validate`, with deterministic list order and schema validation for field names, supported primitive/container types, and duplicates.
- Keep role schemas dependency-free as `Schema` plus `FieldDescriptor`; no JSON Schema library is warranted for static metadata.
- Preserve the runtime adapter external contract. Optional translation is selected at the runtime route with `targetLanguage`, and Translator is appended only after the default review step.

## 2026-07-20 — WP3 Backend: Workbench JSON API + SSE (contract consumed by T6)

New files only in `platform-api/internal/api/`: `workbench_api.go`, `workbench_api_routes.go`, `workbench_sse.go` (+ `_test.go`). `registerWorkbenchAPIRoutes(router *gin.Engine, runs designRunStorage, findings findingStorage, decisions decisionStorage, agentSteps agentStepStorage)` is defined but intentionally NOT called from `server.go` yet (wiring is a follow-up task; it is one line after the other `registerXxxRoutes` calls).

### GET /api/workbench/config → 200

```json
{
  "version": "2.0",
  "language": "zh-CN",
  "supportedLanguages": ["zh-CN", "en"],
  "currentUser": null,
  "roles": [
    { "id": "orchestrator", "label": "Orchestrator", "color": "gray",  "responsibility": "Parse requirements, assign tasks, aggregate output" },
    { "id": "architect",    "label": "Architect",    "color": "blue",  "responsibility": "Generate architecture and design options" },
    { "id": "critic",       "label": "Critic",       "color": "orange","responsibility": "Review designs, find risks" },
    { "id": "analyst",      "label": "Analyst",      "color": "purple","responsibility": "Break down requirements, clarify terminology" },
    { "id": "reviewer",     "label": "Reviewer",     "color": "green", "responsibility": "Human approval of decisions" },
    { "id": "translator",   "label": "Translator",   "color": "pink",  "responsibility": "Multi-language output and consistency checks" }
  ]
}
```

- `currentUser` is `null` until WP2 auth lands; when a team-token identity is in the gin context it is `{ "name": string, "role": string }`.
- Role ids/colors follow plan §2 (WP5 also standardized lowercase role ids).
- `language` is the default UI language (zh-CN, plan decision 5); negotiation is T8's job.

### GET /api/workbench/runs/:id → 200 | 404

Aggregates run state + findings + decisions + agent steps for the SPA detail view:

```json
{
  "run":        { "id": "run-1", "projectId": "...", "requirementVersionId": "...", "status": "CREATED" },
  "findings":   [ { "id": "finding-1", "runId": "run-1", "title": "...", "severity": "...", "category": "...", "evidenceRefs": [], "status": "OPEN", "assignee": "", "resolution": "" } ],
  "decisions":  [ { "id": "DEC-2026-0001", "runId": "run-1", "title": "...", "type": "...", "significance": "...", "options": [{"id":"...","name":"..."}], "status": "PROPOSED", "supersedesId": "" } ],
  "agentSteps": [ { "id": "agent-step-1", "runId": "run-1", "role": "analyst", "skill": "...", "version": "...", "status": "...", "summary": "..." } ]
}
```

- Element shapes are exactly the existing `designRun` / `reviewFinding` / `decisionRecord` / `agentStep` JSON shapes from the v1 API.
- Collections are always arrays (never `null`); empty run → `[]`.
- Unknown run id → `404 { "code": "design_run_not_found" }` (existing `errorResponse` shape). Storage failures → 500 with the same codes as the v1 routes (`design_run_storage_error`, `finding_storage_error`, `decision_storage_error`, `agent_step_storage_error`).

### GET /api/workbench/runs/:id/events → SSE stream

Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`.

One JSON object per `data:` frame:

```
data: {"type":"<event type>","data":{...}}


: heartbeat
```

Event types:
- `run.updated` — `data`: `designRun`. Emitted once on connect (current state), then on every run status change.
- `finding.created` — `data`: `reviewFinding`. New findings only.
- `decision.updated` — `data`: `decisionRecord`. New decisions AND status changes.
- `agent_step.created` — `data`: `agentStep`. New agent steps only.
- Keep-alive: a `: heartbeat` COMMENT line (not a data frame) every ~15s.

Implementation notes: in-memory polling every 500ms diffs store snapshots (acceptable per plan; stores are in-memory). Client disconnect is handled via `ctx.Request.Context()`. Unknown run id → `404 { "code": "design_run_not_found" }` as plain JSON (before SSE headers are sent).

## 2026-07-20 — WP2 Backend: GitHub OAuth + JWT

- New files only in `platform-api/internal/api/`: `auth_routes.go`, `auth_jwt.go`, `auth_oauth.go`, `user_store.go` (+ `_test.go` files); plus `platform-api/migrations/0002_create_auth_users.sql`.
- Storage: in-memory `userStore` following the `decisionStore` pattern. A SQL migration for `auth_user`/`auth_team`/`user_refresh_token` is included, but the DB-backed implementation is intentionally deferred because the existing migration runner only executes `0001_create_platform_core.sql`, and wiring a new store would require edits to `router_options.go` (forbidden in this Wave-1 task).
- Admin flag is set via `ADMIN_GITHUB_LOGINS` (comma-separated GitHub logins) on first login; no separate admin provisioning endpoint is needed.
- JWT: HS256, `JWT_SECRET` from env, access token ≤15 min, refresh token ≤7 days, httpOnly + Secure + SameSite=Lax cookies named `baize_access` and `baize_refresh`.
- OAuth: standard authorization-code flow; `GET /api/auth/github` sets a short-lived `baize_oauth_state` cookie and redirects to GitHub; `GET /api/auth/github/callback` verifies state, exchanges code, fetches user, creates/updates user, sets cookies, and redirects to `/`.
- Refresh rotation: `POST /api/auth/refresh` consumes the old refresh JTI from the in-memory store and issues a new pair; replayed tokens are rejected.
- JWT middleware `useJWTAuth(router *gin.Engine, jwtService *authJWTService)` is a no-op when JWT is not configured, so existing Bearer/team-token auth remains the dev fallback when `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`/`GITHUB_OAUTH_CALLBACK_URL`/`JWT_SECRET` are absent.
- Admin team assignment: `POST /api/admin/users/:id/team` requires a valid JWT with `admin` claim; responses use `admin_permission_required`, `user_not_found`, `team_not_found`.
- `registerAuthRoutes(router *gin.Engine, cfg authConfig, users userStorage, jwtService *authJWTService)` is defined but NOT called from `server.go` (wiring is the follow-up task).

## 2026-07-20 — WP4: Approval Flow API Contract

### New Workbench Decision Action Endpoints
All three routes require approval permission (JWT admin, team-token `approver`/`admin`, or no-auth dev fallback). All return the updated `decisionRecord` on success.

#### POST /api/workbench/decisions/:id/approve → 200 | 400 | 401/403 | 404 | 409 | 500
Body: `{ "reason": "optional string" }` (reason is not required for approve).
Transitions: `PROPOSED` or `UNDER_REVIEW` → `ACCEPTED`.
Run event: `DECISION_APPROVED`.

#### POST /api/workbench/decisions/:id/reject → 200 | 400 | 401/403 | 404 | 409 | 500
Body: `{ "reason": "required string" }`.
Missing/blank reason → `400 { "code": "reason_required" }`.
Transitions: `PROPOSED` or `UNDER_REVIEW` → `REJECTED`.
Run event: `DECISION_REJECTED`.

#### POST /api/workbench/decisions/:id/request-changes → 200 | 400 | 401/403 | 404 | 409 | 500
Body: `{ "reason": "required string" }`.
Missing/blank reason → `400 { "code": "reason_required" }`.
Transitions: `PROPOSED` or `UNDER_REVIEW` → `REJECTED` (the existing status enum has no dedicated `CHANGES_REQUESTED` value; the action is distinguished by the endpoint and the `DECISION_REQUEST_CHANGES` run event).
Run event: `DECISION_REQUEST_CHANGES`.

### Auth Identity Resolution
- JWT configured: uses the access-token cookie; requires `admin` claim; sets actor to `DisplayName`.
- Team-token/Bearer configured: uses existing `requireApprovalPermission` / `currentTeamMember` helpers.
- No auth configured (dev mode): accepts an optional `actor` field in the request body; otherwise defaults to `"anonymous"` so the Workbench can be exercised without configuring OAuth.

### Frontend Integration
- Mutations invalidate the `useRunDetail` query key on success so the UI refreshes.
- SSE `decision.updated` events are emitted automatically because the decision store is the source of truth for the SSE poller.
