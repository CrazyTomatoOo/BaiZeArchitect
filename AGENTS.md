# Repository Guidelines

- After user start, the Engine directly instantiates a **fixed template pipeline** (plan-template-v1: analysis → scenario → usecase → function → design, each stage tailed by a Critic review Task; the design Task emits design/architecture/data/api four artifacts) — no Orchestrator model call
- Roles run in isolated Attempt Sessions, handing off only via versioned Context Manifests, Artifact revisions, Decisions, Findings and evidence
- Stage tail reviewers gate on closed Findings + human approves each artifact revision (double gate); rejection triggers engine-generated rework plans; approval revocable with audit trail
- Approved revisions can be promoted into a workspace asset library (item-level, kind+title dedupe, provenance); FTS5 trigram search over assets + approved artifacts feeds planning-phase and producer-attempt feedback injection (critic exempt)
- The Engine exclusively owns state transitions, plan adoption, task scheduling, side-effect publication, quality judgment and archiving

**Nine Fixed Roles (model layer):**
- **analysis-analyst / scenario-analyst / usecase-analyst / function-analyst**: analysis-family artifacts
- **design-architect / architecture-architect / data-architect / api-architect**: architecture-family artifacts (model per role)
- **critic**: writes Findings against a frozen Review Bundle; receives no historical-asset injection

The Orchestrator role was retired when the Engine took over plan generation; the Reviewer role was removed, not renamed.
- After user start, the Workflow Engine creates a Planning Task
- A zero-tool Orchestrator proposes a complete finite immutable Task DAG (PlanProposal)
- The Engine validates/adopts it as a PlanRevision, then executes Analyst → Architect → Critic tasks sequentially
- Roles run in isolated Attempt Sessions, handing off only via versioned Context Manifests, Artifact revisions, Decisions, Findings and evidence
- The Engine exclusively owns state transitions, plan adoption, task scheduling, side-effect publication, quality judgment and archiving

**Four Fixed Roles:**
- **Orchestrator**: zero-tool planning, proposes PlanProposal
- **Analyst**: scenario/usecase/function artifacts
- **Architect**: design/architecture/data/API artifacts
- **Critic**: writes Findings against a frozen Review Bundle

The Reviewer role was removed, not renamed.

## Architecture & Data Flow

### High-Level Structure

Single Node process hosting:
- **Workflow Governance Kernel** (SQLite via better-sqlite3): 3830-line deterministic state machine with 19 command types, idempotent command receipts, append-only versioned events, sha256 content-addressed immutable snapshot documents
- **HTTP Transport** (node:http, no framework): Bearer→cookie session bootstrap, atomic requirement creation, unified idempotent `/api/workflows/:id/commands/:commandId`, receipts/incidents, dual SSE streams, detail reads, asset CRUD/export/import, SPA fallback
- **Pi Model Driver**: isolated per-call pi-coding-agent sessions (GLM-5.2 via DashScope)
- **Lit SPA**: served by the backend, no router, per-component reactive state + CustomEvents

### Key Modules

**Backend (`agent-runtime/`):**
- `main.ts` — sole production entry: assembles WorkflowStore + fixtures, PiModelDriver, OperatorServer; startup reconcile + outbox drain before listen
- `workflow/operator-server.ts` — 847-line HTTP transport (node:http)
- `workflow/headless-runtime.ts` — ~425-line domain API with 19 command types
- `persistence/workflow-store.ts` — 198KB/3830-line SQLite governance kernel with prepared statements, transactions, immutability triggers, digest checks, event append, outbox jobs, claims, staged-effect publication
- `persistence/migrations/` — 13 numbered forward SQL migrations (0001-workflow-governance .. 0013-actor-kind)
- `workflow/plan-types.ts` — ArtifactKind/TaskKind, TaskProposal DAG with input bindings, ARTIFACT_OWNERSHIP map, PLAN_TASK_LIMITS (≤12 tasks, depth ≤6, ≤3 attempts/task)
- `workflow/plan-validator.ts` — deterministic static PlanProposal validation (DFS cycle detection, DAG/depth budgets, ownership + output-binding rules)
- `workflow/model-driver.ts` + `pi-model-driver.ts` — ModelDriver interface + PiModelExecutor adapter
- `workflow/contracts/` — boot-loaded versioned JSON policy catalog (persistence-model-v1, plan-proposal schema, model-config-v1, readiness/recovery/concurrency/cutover policies, workflow-api-v1, event catalog) compiled with typebox

**Frontend (`web/src/`):**
- `baize-workflow.ts` — main Lit 3 SPA component (all surfaces live here)
- Typed fetch client with dual EventSource SSE streams ('after' cursor replay)
- CustomEvents for component communication (`baize-open-requirement`, `baize-goto`)
- Token-only styling per DESIGN.md (OKLCH Graphite-Indigo dark theme)
- No router; single-page component

### Data Flow

1. User creates Requirement → atomic Workflow creation (state: `pending`)
2. User starts Workflow → Planning Task created
3. Orchestrator (zero-tool) proposes PlanProposal (finite Task DAG)
4. Engine validates PlanProposal → adopts as PlanRevision
5. Engine executes tasks sequentially: Analyst → Architect → Critic
6. Each role runs in isolated Attempt Session
7. Handoff via versioned Context Manifests, Artifact revisions, Decisions, Findings
8. Engine owns all state transitions, plan adoption, task scheduling, side-effect publication
9. Human gates block progression at approval points
10. Outbox jobs + startup reconciliation ensure durability

## Key Directories

- `agent-runtime/` — Node 22 backend: workflow engine, HTTP server, SQLite persistence, model driver
- `web/` — Lit 3 SPA frontend: Vite 8 build, TypeScript, served by backend
- `agent-runtime/workflow/` — domain logic: operator-server, headless-runtime, plan-types, plan-validator, model-driver, contracts
- `agent-runtime/persistence/` — SQLite kernel: workflow-store, migrations
- `web/src/` — Lit components: baize-workflow.ts (main), tokens.css (design tokens)
- `web/e2e/` — Playwright E2E tests with route-level mocking
- `docs/` — development plans, runbooks, ADRs, glossary
- `schemas/` — 4 agent-output domain JSON Schemas (draft 2020-12)
- `agent-runtime/contracts/` — versioned workflow-governance JSON schemas (distinct from `schemas/`)
- `.wayfinder/` — design artifacts, tickets, research (active development tracking)
- `CONTEXT.md` — governing domain language (~70 glossary terms)
- `CONTEXT-MAP.md` — context map: governance (CONTEXT.md) + Store (agent-runtime/persistence/CONTEXT.md)
- `DESIGN.md` — locked web design system (must read before emitting page code)
- `fixtures/test-repo/` — seed Go repo baked into Docker image
- `scripts/` — container smoke test (smoke-gateway.mjs)
- `lws/` — gitignored vendored upstream sigs.k8s.io/lws (Kubernetes LeaderWorkerSet; Go 1.26, used only as architecture-evidence analysis target)

## Development Commands

### Backend (agent-runtime/)

```bash
cd agent-runtime
npm install
npm run test              # node --import tsx --test *.test.ts testing/*.test.ts
npm run test:contracts    # contract subset (workflow-contracts, workflow-schema, model-driver, etc.)
npm run typecheck         # tsc --noEmit
npm run build             # tsc → dist
npm run start             # tsx main.ts (sole prod entry)
```

### Frontend (web/)

```bash
cd web
npm install
npm run dev               # vite (port 5173, proxies /api → 127.0.0.1:18789)
npm run build             # vite build → dist
npm run typecheck         # tsc --noEmit
npm run test              # vitest run src
npm run test:e2e          # playwright test (3 viewports: desktop/tablet/narrow)
npm run benchmark:canvas  # playwright bench config (STALE: target file does not exist)
```

### Docker

```bash
docker compose up -d demo    # seeded demo gateway on :18789, token demo-token
docker compose run --rm test # container smoke test (network none, tmpfs-only)
```

### Environment Variables

- `BAIZE_DB_PATH` — SQLite database path
- `BAIZE_SESSION_DIR` — session directory
- `BAIZE_PORT` — HTTP port (default 18789)
- `BAIZE_HOST` — HTTP host
- `BAIZE_OPERATORS` — token=actorRef:cap,cap format
- `BAIZE_MODEL_CONFIG_PATH` — ModelConfig v1 JSON path (schema: `model-config-v1.schema.json`); API keys live in per-provider env vars, never in the file

## Code Conventions & Common Patterns

### TypeScript

- **Strict mode** in both packages
- **ESM modules** (`"type": "module"` in package.json)
- **`.ts` extensions in imports** — source imports use `.ts` extensions; tsc rewrites them for emitted JS via `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` (TS ≥5.7)
- **Target ES2022**, module ESNext, moduleResolution bundler
- **No linting/formatting tools** — no eslint/prettier/biome/editorconfig; only typecheck/test/build in CI

### Backend Patterns

- **No framework** — raw node:http with manual routing
- **Synchronous SQLite** — better-sqlite3 with prepared statements, transactions, immutability triggers
- **Idempotent commands** — `/api/workflows/:id/commands/:commandId` with 19 command outcome types (accepted/capability_denied/version_conflict/state_conflict/business_rule_rejected/idempotency_conflict)
- **Append-only events** — all state changes recorded as versioned events
- **Outbox pattern** — jobs + startup reconciliation for durability
- **Content-addressed snapshots** — sha256 digest checks, immutable snapshot_document table
- **Bearer→cookie session bootstrap** — token auth with session cookies
- **Dual SSE streams** — workflow + run event streams with 'after' cursor replay
- **Versioned contracts** — boot-loaded JSON policy catalog compiled with typebox
- **Deterministic validation** — PlanProposal validation with DFS cycle detection, DAG/depth budgets

### Frontend Patterns

- **Lit 3 components** — web components with reactive state
- **No router** — single-page component, CustomEvents for navigation (`baize-open-requirement`, `baize-goto`)
- **Token-only styling** — OKLCH Graphite-Indigo dark theme per DESIGN.md
- **Typed fetch client** — manual HTTP client (no axios/fetch wrapper library)
- **EventSource SSE** — dual streams with cursor-based replay
- **Route-level mocking in E2E** — page.route + fulfillJson for API mocking
- **MockEventSource helper** — controllable SSE for E2E tests (emit/fail/reopen)

### Naming Conventions

- **Files**: kebab-case (`operator-server.ts`, `plan-validator.ts`, `baize-workflow.ts`)
- **Components**: PascalCase Lit classes (`BaizeWorkflow`)
- **Custom events**: `baize-` prefix (`baize-open-requirement`, `baize-goto`)
- **Migrations**: numbered prefix (`0001-workflow-governance`, `0013-actor-kind`)
- **Test files**: `*.test.ts` suffix
- **E2E specs**: `*.spec.ts` suffix
- **Domain terms**: see CONTEXT.md / CONTEXT-MAP.md glossaries

### Error Handling

- **Command outcome types** — 19 explicit outcomes (accepted, capability_denied, version_conflict, state_conflict, business_rule_rejected, idempotency_conflict, etc.)
- **Deterministic validation** — PlanProposal validation returns rule-violation list
- **Idempotency** — duplicate commandId returns idempotency_conflict, not error
- **Immutability triggers** — SQLite triggers prevent snapshot_document mutation
- **Digest checks** — sha256 content addressing ensures integrity

### Async Patterns

- **Synchronous SQLite** — better-sqlite3 is synchronous; no async DB calls
- **SSE streams** — async EventSource for real-time updates
- **Outbox jobs** — async background processing with startup reconciliation
- **Model driver** — async per-call pi-coding-agent sessions

## Important Files

### Entry Points

- `agent-runtime/main.ts` — sole production entry (backend)
- `web/index.html` — SPA entry (frontend)
- `web/src/baize-workflow.ts` — main Lit component (all surfaces)

### Configuration

- `agent-runtime/package.json` — backend deps: better-sqlite3, typebox, @earendil-works/pi-ai, @evomap/evolver
- `web/package.json` — frontend deps: lit, @antv/g6, elkjs, marked, mermaid, vite
- `agent-runtime/tsconfig.json` — TS strict, ES2022, allowImportingTsExtensions
- `web/tsconfig.json` — TS strict, ES2022, no outDir (Vite emits)
- `web/vite.config.ts` — dev server port 5173, proxies /api → 127.0.0.1:18789
- `compose.yaml` — Docker Compose: `test` (smoke) and `demo` (seeded gateway) services
- `agent-runtime/Dockerfile` — single-stage node:22-slim, embeds web SPA dist, rebuilds better-sqlite3, installs gitnexus globally

### Key Modules

- `agent-runtime/workflow/operator-server.ts` — HTTP transport (847 lines)
- `agent-runtime/workflow/headless-runtime.ts` — domain API (~425 lines)
- `agent-runtime/persistence/workflow-store.ts` — SQLite governance kernel (198KB/3830 lines)
- `agent-runtime/workflow/plan-validator.ts` — deterministic PlanProposal validation
- `agent-runtime/workflow/model-driver.ts` — ModelDriver interface
- `agent-runtime/workflow/pi-model-driver.ts` — PiModelExecutor adapter

### Documentation

- `CONTEXT.md` — governance-context domain language (~70 glossary terms: Requirement, Workflow, Plan Revision, Task, Attempt, Run, Context Manifest, Review Bundle, Staged Effect, Approval Packet, Command Receipt, Outbox Job, Workflow Incident)
- `CONTEXT-MAP.md` — context map (governance + Store); Store subdomain glossary at `agent-runtime/persistence/CONTEXT.md`
- `DESIGN.md` — locked web design system (atmospheric dark AI workbench, Graphite Indigo, OKLCH tokens, ≥4.5:1 contrast, Space Grotesk + system fonts, 4pt spacing, motion 150/250ms, no scroll reveal, optimistic update + undo)
- `README.md` — bilingual overview, demo commands, HTTP contract table, directory structure
- `docs/GLOSSARY.md` — domain glossary
- `docs/adr/` — Architecture Decision Records (ADR-001 platform-api-go [retired], ADR-002 versioned-c4-projection-snapshots, ADR-003 gate-canvas-on-yfiles-evaluation, ADR-004 free-c4-canvas-stack)

## Runtime/Tooling Preferences

### Runtime

- **Node 22** — required (Dockerfile `node:22-slim`, CI `setup-node 22`)
- **NOT Bun** — uses Node's built-in `node:test` runner and native `fetch`
- **Go 1.26** — required only by vendored `lws/` (not part of project CI)

### Package Manager

- **npm** — exclusively (package-lock.json in both packages)
- No pnpm/yarn/bun/volta/corepack

### Tooling

- **TypeScript** — strict mode, ES2022 target
- **Vite 8** — frontend build tool
- **tsx** — TypeScript execution for Node
- **better-sqlite3** — synchronous SQLite (native, rebuilt in Docker)
- **typebox** — JSON schema validation for contracts
- **Lit 3** — web components framework
- **Playwright 1.62** — E2E testing (3 viewports: desktop 1440x900, tablet 1024x768, narrow 390x844)
- **Vitest 4** — frontend unit testing
- **node:test** — backend unit/integration testing (Node built-in)
- **gitnexus 1.6.6** — repo indexing (installed globally in Docker)

### No Linting/Formatting

- No eslint, prettier, biome, or editorconfig
- CI only verifies via typecheck/test/build
- Code style enforced by convention, not tooling

## Testing & QA

### Test Frameworks

**Backend (agent-runtime/):**
- **node:test** — Node built-in test runner with `node:assert/strict`
- **tsx loading** — `node --import tsx --test`
- **~28 `*.test.ts` files** in agent-runtime root + `testing/` subdirectory
- **Real SQLite DBs** — temp dirs, fully deterministic injected fixtures
- **No external test framework** — pure Node test runner

**Frontend (web/):**
- **Vitest 4** — unit tests (`vitest run src`, single file `web/src/baize-workflow.test.ts`)
- **Playwright 1.62** — E2E tests (`web/e2e/*.spec.ts`)
- **Route-level mocking** — page.route + fulfillJson for API mocking
- **MockEventSource helper** — controllable SSE for E2E (emit/fail/reopen)
- **3 viewport projects** — desktop (1440x900), tablet (1024x768), narrow (390x844)

### Running Tests

```bash
# Backend
cd agent-runtime
npm run test              # all unit+integration tests
npm run test:contracts    # contract tests only (workflow-contracts, workflow-schema, model-driver, etc.)

# Frontend
cd web
npm run test              # Vitest unit tests
npm run test:e2e          # Playwright E2E (3 viewports)
```

### Test Tiers

1. **Unit + Integration** (agent-runtime) — node:test with real SQLite DBs in temp dirs, deterministic fixtures
2. **Contract Tests** (agent-runtime) — dedicated `test:contracts` script asserting versioned JSON contract catalogs (12 assets, byte-identical to .wayfinder sources)
3. **Web Unit** (web) — Vitest with pure-function assertions + `?raw` source-text 'negative' checks
4. **E2E** (web) — Playwright with route-level mocking, 3 viewport projects
5. **Container Smoke** — `scripts/smoke-gateway.mjs` via `docker compose run --rm test` (network none, tmpfs-only, boots production main.ts end-to-end)

### Test Patterns

- **Deterministic fixtures** — injected fixtures for reproducibility
- **Real SQLite** — temp dirs, not mocks
- **Route mocking** — page.route + fulfillJson in E2E
- **Controllable SSE** — MockEventSource with emit/fail/reopen controls
- **Negative scans** — tests proving old surfaces unreachable
- **Contract byte-identity** — contract tests assert JSON catalogs match .wayfinder sources

### Coverage

- **No coverage tooling** — no nyc/c8/istanbul configured
- **No numeric coverage thresholds**
- Quality gates: contract tests + negative-scan + CI + compose-smoke

### CI Pipeline

`.github/workflows/runtime-ci.yml` with 3 jobs:

1. **agent-runtime** — tests + typecheck + contracts
2. **web** — typecheck + vitest + build + three-viewport Playwright e2e
3. **compose** — docker build + container smoke test with `network_mode: none`

### Stale Scaffolding

- `web/playwright.benchmark.config.ts` + `npm run benchmark:canvas` target `architecture-canvas.benchmark.ts`, which does NOT exist — the script would fail with 'no tests found'

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues on CrazyTomatoOo/BaiZeArchitect, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: root `CONTEXT-MAP.md` links the governance context (`CONTEXT.md`) and the Store context (`agent-runtime/persistence/CONTEXT.md`); ADRs in `docs/adr/`. See `docs/agents/domain.md`.
