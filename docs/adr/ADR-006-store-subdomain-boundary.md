# Store is a first-class subdomain externalized from the workflow governance kernel

Status: accepted（决议来源 grilling 2026-08「store 子域外置」；实现——代码拆类——为后续单 slice ticket，本 ADR 先立边界）

The single persistence class `WorkflowStore` (`agent-runtime/persistence/workflow-store.ts`, ~3895 lines) mixes five unrelated concerns: workspace registry, the Reusable Asset library, the content-addressed `snapshot_documents` store, the workflow governance kernel, and the schema/migration chain. Three completed work waves (workspace-management, user-role-assets, audit-view-removal) all landed on the workspace/asset surfaces but added them to the same class and the same root glossary — the product-data face has no modeled or code boundary of its own, and every feature wave must thread the whole governance context to touch it. Decision: **Store（存储域）is a sibling subdomain to the governance context**, owning the product-data face; the governance kernel consumes it through a facade.

Decision details:

- **Boundary ownership.** Store owns four tables — `workspaces`, `reusable_assets`, `reusable_asset_revisions`, `snapshot_documents` — and their ~11 methods (workspace create/exists/list, cascade delete; asset create/patch/list/get/delete/export/import; snapshot insert; `BusyWorkspaceError` / `ReusableAsset*Error` ride along). Governance rows and methods stay in the governance context. WorkflowDoctor and `applyCutover` stay governance; governance read queries that JOIN `snapshot_documents` keep their joins — the boundary is method ownership, not SQL locality.
- **Workspace cascade delete stays Store-owned**, including the `BusyWorkspaceError` precondition (active Runs/Claims) checked inside the same transaction — moving the check to the runtime layer would open a TOCTOU window, since the deletion transaction cannot be wrapped from outside.
- **Code seam: three classes** `SnapshotStore` / `AssetStore` / `WorkspaceStore` in `agent-runtime/persistence/` share one Database handle; `WorkflowStore` remains a facade plus cross-domain transaction orchestrator (`createRequirement`/`bindEvidenceSnapshot`/… keep their outer `transaction()` and `workspaceExists` preconditions — AssetStore does not depend on WorkspaceStore). `headless-runtime`, `operator-server`, `main` and test constructor signatures change nothing. The migration chain (0001–0013) stays a single list — migrations interleave by concern (0013 actor-kind touches `reusable_assets`).
- **Glossary.** Workspace, Reusable Asset, Actor（业务参与者）, Snapshot Document move to `agent-runtime/persistence/CONTEXT.md`; root retains a slim Actor disambiguation note (「Actor」now uniquely means the operator identity in the governance context); root gains the **Store（存储域）** term set and `CONTEXT-MAP.md` declares both contexts and their relationship. Repository Snapshot and the cutover terms stay in the governance glossary — they describe workflow-bound facts, not store mechanics.
- **Boundary contract: types-as-contract.** The 32-asset contract catalog is unchanged — `persistence-model-v1.json` already describes the four tables with purposes matching the split ("Repository registration and snapshot ownership", "Workspace-level reusable … outside Requirement governance", immutable `snapshot_documents`; dedup by `unique(kind, digest)`).

Considered Options:

- **Data/process externalization** (separate DB or service) — contradicts the single-process SQLite invariant in the auto-orchestration map (PostgreSQL/Redis/multi-process explicitly out of scope), rejected.
- **Docs-only separation** without a code split — insufficient for the god-class motivation, rejected.
- **One `Store` class** instead of three — blurs the three owned faces into one file and defers the re-split, rejected.
- **Split the migration chain** by subdomain — migrations interleave and depend on each other, rejected.

Consequences:

- `WorkflowStore` shrinks to the governance kernel plus facade; the product-data faces become independently unit-testable and sha256-digest safe (snapshot dedup unchanged).
- `deleteWorkspace` performs a documented one-way read of governance tables (busy precondition) inside its own transaction and destroys governance rows — the only Store → governance dependency.
- Root `CONTEXT.md` now describes only the governance context; future store surfaces (headless asset API, doctor queries) get a stable boundary.
- Informal "store" wording in older docs refers to the generic persistence layer, distinct from the Store subdomain concept — covered by the new term's _Avoid_ list.