# Governance kernel read/write axis split of WorkflowStore

Status: accepted（决议来源 2026-08-30 architecture review grilling）

ADR-006 externalized the Store subdomain (WorkspaceStore / AssetStore / SnapshotStore) but left `WorkflowStore` as a 4336-line class mixing the governance state machine, the projection read model, the cross-domain transaction orchestration, and the migration chain. `HeadlessWorkflowRuntime` exposed this shallowness directly: ~50 of its ~60 methods were pure pass-through (`return store.xxx()`), proving the deletion test — removing the pass-through concentrates no complexity, because the interface was as wide as the implementation.

Decision: **split WorkflowStore along the read/write axis into two deep modules behind a thin orchestrator facade.**

- **Governance Kernel** — all write methods (`executeCommand`, `createRequirement` write path, `beginPlanning`/`adoptPlan`/`failPlanningAttempt`/`supersedePlanningAttempt`, `beginAttempt`/`publishAttemptResult`/`failAttempt`, `acceptFindingRisk`, `buildApprovalPacket`, `appendRunEvent`, `drainOutbox`/`processOutbox`/`reconcile`). Holds all `database.transaction()` boundaries. Single interface — the 19-command `executeCommand` entry point and the attempt lifecycle share `appendEvent` (private) and transaction locality; splitting them would force `appendEvent` across modules and break transaction atomicity.
- **Projection Read Model** — all read-only methods. Exposes three narrow interfaces by consumer: `WorkflowProjectionReader` (projection + detail + list queries, for OperatorServer read routes), `EventStreamReader` (event replay + watermark + subscribe, for SSE streams), `PlanningContextReader` (search + feedback + evidence, for headless-runtime orchestration). Internal implementation is one class sharing one Database handle; three interfaces give each consumer only the surface it needs.
- **WorkflowStore remains as thin orchestrator** — holds `applyMigrations` (constructor, single migration chain per ADR-006), `createRequirement` (cross-domain transaction: workspace precondition + baseline snapshot + governance rows), `applyCutover` (cross-domain: legacy DB read + snapshot insert + workspace/asset/governance writes). HeadlessWorkflowRuntime exposes `kernel` / `readModel` / `assets` getters; orchestration methods (`executeTask`, `planWorkflow`, `completePlanning`) stay on the facade and delegate to kernel + readModel.

Considered Options:

- **Functional domain axis** (Workflow/Task/Attempt/Artifact/Finding/Approval classes) — rejected. `executeCommand` is a single 19-type entry point touching multiple domains in one transaction; splitting produces 6+ small classes with cross-domain coordination, increasing interface count without increasing depth.
- **Read/write + Store/governance axis** — rejected as redundant. ADR-006 already split the Store subdomain; splitting governance from Store again duplicates that boundary.
- **Eliminate HeadlessWorkflowRuntime pass-through, OperatorServer holds 3 refs directly** — rejected. Orchestration logic (`executeTask` begin→drive→complete→publish chain, `planWorkflow` loop) would scatter into the HTTP layer, losing locality.
- **Per-consumer interface for Governance Kernel** (CommandExecutor / AttemptLifecycle / OutboxGovernor) — rejected. `executeCommand` internally calls `drainOutbox`; `beginAttempt`→`publishAttemptResult` share `appendEvent`; splitting forces cross-module calls inside transactions.

Consequences:

- `HeadlessWorkflowRuntime` loses ~50 pass-through methods; OperatorServer read routes call `readModel.getTaskDetail()` directly, command routes call `kernel.executeCommand()`, SSE routes call `eventStreamReader.getWorkflowEvents()` + `subscribeWorkflowEvents()`.
- Read model changes (new projection, new detail view) no longer touch the governance kernel — locality restored.
- Three read interfaces must stay in sync with the single read-model implementation; adding a read method requires deciding which interface it belongs on.
- `createRequirement` and `applyCutover` remain on WorkflowStore orchestrator — they are the only cross-domain transaction methods, and ADR-006's "WorkflowStore remains facade + cross-domain transaction orchestrator" contract is preserved.
- Migration chain stays a single list on WorkflowStore per ADR-006; `getMigrationAttestation` (read-only) moves to Projection Read Model.
- No contract catalog changes — `persistence-model-v1.json` describes tables, not classes; the split is internal.
