# BaiZe Architect 2.0 Design

## Purpose

The workbench is the operator surface for the evidence-backed design-run workflow. It drives repository evidence, runtime design, human approval, confirmation, and SRS readiness without hand-written curl commands. In 2.0 this surface is a React single-page application (SPA) served by the Go backend, backed by the same REST API the other clients consume.

## 2.0 Architecture Overview

- **Frontend**: React 18 SPA built with Vite 6, TypeScript 5, and Tailwind CSS 3. The app is a first-class client of the backend API, not a server-rendered page.
- **Routing**: TanStack Router handles client-side navigation under `/workbench`, `/login`, `/auth/callback`, and `/`.
- **State**: Zustand for auth and workbench UI state; TanStack Query for server state; React Hook Form + Zod for forms.
- **Backend**: Go/Gin REST API with PostgreSQL-backed stores when `DATABASE_URL` is set (in-memory fallback for local dev), GitHub OAuth 2.0, JWT cookie auth, and API-token/team-token fallbacks.
- **Agent runtime**: Orchestrator parses the requirement and creates a design run. Analyst, Architect, and Critic run as deterministic findings phase, followed by Reviewer (human approval), optional Translator, and final human confirmation.
- **Workbench data**: `/api/workbench/*` provides JSON endpoints plus an SSE event stream consumed by the SPA.
- **Deployment**: One Go binary serves the API and the built frontend (`frontend/dist`). No feature flag; the old server-rendered HTML workbench has been removed.

## Frontend Stack

- **React 18** with function components and hooks.
- **Vite 6** for dev server, build, and HMR. The dev server proxies `/api` to `localhost:8080`.
- **TypeScript 5** in strict mode with `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`.
- **Tailwind CSS 3.4** with design-token extensions (ink, slate, canvas, accent, success, danger, warning) and role-based colors (orchestrator, architect, critic, analyst, reviewer, translator).
- **TanStack Router v1** for code-based routing (no file-based codegen). Routes are nested under `/workbench` with a shared layout.
- **TanStack Query v5** for server-state caching, with `staleTime: 30_000`, `retry: 1`, and `refetchOnWindowFocus: false`.
- **Zustand v5** for auth and workbench UI state; the auth store is built with the vanilla API and a React hook.
- **React Hook Form 7** + **Zod v4** for form validation and submission (e.g., decision rejection reason).
- **react-i18next 15** + **i18next 24** for internationalization; default language `zh-CN` with `en` fallback.
- **react-markdown 10** + **remark-gfm 4** for rendering finding/resolution Markdown.
- **lucide-react** for icons.
- **Headless UI v2** for accessible primitives (Modal, Dialog).

## Backend API Additions

### Authentication & Authorization

- **GitHub OAuth 2.0**: `GET /api/auth/github` redirects to GitHub; `GET /api/auth/github/callback` verifies state, exchanges code, fetches the user, and sets `baize_access` and `baize_refresh` httpOnly/Secure/SameSite=Lax cookies.
- **JWT cookies**: HS256 access tokens (`<= 15 min`) and refresh tokens (`<= 7 days`). `POST /api/auth/refresh` rotates refresh tokens with single-use consumption.
- **Role-based admin**: `ADMIN_GITHUB_LOGINS` grants admin on first login. `POST /api/admin/users/:id/team` requires admin claim.
- **Fallback auth**: `API_TOKEN` (Bearer), `TEAM_TOKENS` (name:token:role), and `REQUIRE_AUTH=true` are still supported so the platform can run in protected or semi-open mode without OAuth.
- **Approval permission**: decision actions require JWT admin, team-token approver/admin, or the no-auth dev fallback that accepts an optional actor.

### Workbench JSON + SSE

- `GET /api/workbench/config` returns version, language, supported languages, current user, and role metadata.
- `GET /api/workbench/runs/:id` aggregates a run with its findings, decisions, and agent steps.
- `GET /api/workbench/runs/:id/events` opens an SSE stream emitting `run.updated`, `finding.created`, `decision.updated`, and `agent_step.created` frames, with a `: heartbeat` comment every ~15 seconds.
- `POST /api/workbench/decisions/:id/approve` transitions a decision from `PROPOSED` or `UNDER_REVIEW` to `ACCEPTED`.
- `POST /api/workbench/decisions/:id/reject` and `POST /api/workbench/decisions/:id/request-changes` transition to `REJECTED` and require a non-empty reason (returning `400 {code: "reason_required"}`).

## Data Flow

1. **Orchestrator** receives the project, requirement, and repository inputs, then creates a design run.
2. **Analyst** breaks down the requirement and clarifies terminology.
3. **Architect** generates architecture options and records a design decision.
4. **Critic** reviews the design and emits findings (risks, gaps, recommendations).
5. **Reviewer** (operator) inspects the decision and findings in the Workbench SPA and approves, rejects, or requests changes.
6. **Decision** transitions to `ACCEPTED` or `REJECTED`; the SSE stream emits `decision.updated`.
7. **Translator** runs only when `targetLanguage` is set, producing localized output.
8. **Human confirmation** locks the run, and **SRS acceptance** reports readiness.

## Deployment

- The frontend is built with `npm run build` and emitted to `frontend/dist`, which contains `index.html`, the `/assets/` JS/CSS chunks, and source maps.
- The Go server resolves the dist directory via `BAIZE_FRONTEND_DIST` (env override) or by deriving `frontend/dist` from the source file location (`runtime.Caller`). This works regardless of the working directory when the server is started.
- Static routes are registered after the API routes and auth middleware so `/api/*` and `/healthz` are never shadowed.
- `GET /workbench` and `GET /workbench/*path` serve `index.html`; the SPA router renders the correct child route.
- `GET /assets/*` serves the built JS/CSS chunks referenced by absolute paths in `index.html`.
- `GET /`, `/login`, and `/auth/callback` also return `index.html` so hard refreshes on auth and root routes work.
- `/api/healthz` remains available for health checks and returns `{"status":"ok"}`.

## Visual Direction

- Style: polished operational command center, calm, dense, and legible, with layered glass-like panels rather than flat admin cards.
- Palette: ink `#172033`, slate `#566176`, muted `#7b8496`, panel `#ffffff`, panel-soft `#f8fbff`, canvas `#edf3fb`, accent `#3157d5`, accent-strong `#2446b8`, success `#1f8a5b`, danger `#b42318`, warning `#b7791f`, code `#101827`.
- Type: system sans-serif, 16px base, tight display heading, compact labels, tabular numeric/ID text for workflow evidence.
- Layout: responsive sidebar + main content; two-column detail view on desktop; single-column on narrow screens.
- Depth: soft radial page background, subtle panel borders, and tinted shadows from the ink/accent palette.
- Dark mode: supported via Tailwind `class` strategy and CSS custom properties; the UI flips in `.dark`.

## Interaction Rules

- Every network step reports success or a stable, i18n-ready error code (`messageKey` from the backend, localized in the SPA).
- Buttons disable while a request is in flight or until the required previous state exists.
- The SPA uses the real REST API directly; no mock backend in production.
- While requests are in flight, the active button keeps its label and adds a short loading affordance.
- Status cards and badges change tone when IDs/statuses become available; SRS readiness uses text plus color so meaning is not color-only.
- The raw event log remains available for debugging, but progress and next actions should be understandable without reading JSON.

## Accepted Debt

- Wave 1 stores are PostgreSQL-backed when `DATABASE_URL` is set: eight `*_db_storage` adapters back all resources, migrations auto-apply on startup, and the PG-backed E2E (`postgres_e2e_test.go`) runs via testcontainers by default (or a CI postgres service when `DATABASE_URL` is set). The `docker compose` stack verifies the full approval→archive→SRS flow end-to-end.
- The `request-changes` decision action is recorded as `REJECTED` because the existing decision status enum has no dedicated `CHANGES_REQUESTED` value; the action is distinguished by the endpoint and the `DECISION_REQUEST_CHANGES` run event.
- Runtime SSE uses an in-memory poll diff of store snapshots rather than a persistent event log; this is acceptable while the platform runs as a single process.
- The 2.0 Vite production bundle is code-split (largest chunk ≈ 157 KB / gzip 47 KB); further lazy-loading of heavy viewers (Mermaid, markdown) can reduce the initial download.
