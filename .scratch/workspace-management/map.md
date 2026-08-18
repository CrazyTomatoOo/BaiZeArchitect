# Chart workspace lifecycle management and selection

Label: wayfinder:map

## Destination

A locked decision set that clears the way to implementing workspace lifecycle management (list / create / rename / archive) and Web workspace selection/switching, with the mounted surface (`baize-workflow`'s workflow detail) following the selected workspace. Mounting the currently-unmounted `baize-requirements` list and `baize-review-center` views — and the shell/router to host them — is a separate future effort (see Out of scope).

## Notes

- Domain: BaiZeArchitect's operator-server (HTTP) + workflow-store (SQLite) + Lit/Vite web shell. Workspaces already exist as a table (`workspaces`: id, repo_path unique, name, created_at) and `requirements` / `reusable_assets` / `design_packages` already carry `workspace_id on delete restrict`. The gap is lifecycle management + entry points, not the association itself.
- This effort plans the decisions only; it does not implement. Resolution hands off to a later `/implement` session.
- Consult `grilling` and `domain-modeling` while resolving tickets.
- The web shell is `baize-workflow` (Lit, the root element in `index.html`); it is the ONLY mounted component in production. `baize-requirements` and `baize-review-center` are defined but unmounted (their tags appear nowhere in `web/src` or the HTML); `baize-workflow` dispatches a `baize-goto` event expecting an external shell that does not exist. All three currently hardcode `this.workspaceId = 1`; only `baize-workflow`'s matters for production.
- Operator auth is single-process, server-side in-memory sessions (`sessions: Map<sessionId, OperatorIdentity>`), cookie `baize_operator`, operators pre-configured via bootstrap tokens. All operators see all workspaces; selected-workspace state is a browser preference, not a server-side concern.
- `repo_path` is `not null unique` in `workspaces`; established as purely a uniqueness key + human label (no git/file operations) — kept required and unvalidated, see [Decide repo_path policy](issues/02-decide-repo-path-creation-policy.md).

## Decisions so far

- [Decide workspace retirement semantics](issues/01-decide-workspace-archive-semantics.md) — Soft archive: migration 0014 adds `archived_at`; reversible (`archiveWorkspace` + `restoreWorkspace`); archived workspaces read-visible (writes rejected, not 404).
- [Decide repo_path policy at workspace creation](issues/02-decide-repo-path-creation-policy.md) — repo_path stays required + user-supplied (no nullable migration, no generator); no real-path/git validation (accept any non-empty unique string); field is purely a uniqueness key + label.
- [Decide the selected-workspace state carrier in the web shell](issues/03-decide-selected-workspace-state-carrier.md) — Shell-prop: `baize-workflow` `connectedCallback` reads `localStorage` (default first-active); no new module. Corrected a prior map error: only `baize-workflow` is mounted; `baize-requirements`/`baize-review-center` are unmounted orphans; no shell exists. Graduated the management-panel host question to [Decide the web host for workspace management](issues/05-decide-web-host-for-workspace-management.md).
- [Decide the fate of the existing demo workspace 1](issues/04-decide-demo-workspace-1-fate.md) — Keep as-is: seeder unchanged, no migration; demo 1 is a normal workspace (default first-active in demo deployments, manually archivable via 01).
- [Decide the web host for workspace management](issues/05-decide-web-host-for-workspace-management.md) — Extend `baize-workflow` (selector + management panel as internal views; no shell built); destination redrawn to drop "unmounted requirements-list/review-center follow"; building a shell/router + mounting those views ruled out of scope as a separate effort.
- [Prototype the workspace management panel interaction](issues/06-prototype-workspace-management-panel.md) — Confirmed standard CRUD view following `baize-workflow`'s existing patterns (top-bar selector + internal management view, no shell); IA sketch at `prototypes/panel-ia-sketch.md`. No bespoke visual design. Route clear → hand off to `/implement`.

## Not yet specified

- Multi-operator per-workspace visibility filtering. Currently judged unnecessary (single-process, pre-configured operators, all see all workspaces); holds as fog until something challenges it.

## Out of scope

- A higher-level `project` concept above `workspace` (ruled out at charting — "项目" = existing workspace).
- Per-operator workspace permissions/ACL (single-process, pre-configured operators).
- Migrating existing assets/requirements between workspaces.
- Workspace-scoped operator sessions.
- Building a shell/router and mounting the currently-unmounted `baize-requirements` list and `baize-review-center` views. These are unmounted orphans; making them "follow the selected workspace" is really mounting them via a shell — general app navigation infrastructure, not workspace management. Deferred to a separate effort (decided at [Decide the web host for workspace management](issues/05-decide-web-host-for-workspace-management.md)).
