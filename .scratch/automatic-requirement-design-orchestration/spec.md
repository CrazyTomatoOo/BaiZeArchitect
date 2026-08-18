# BaiZe 自动优先需求设计编排规格

Label: ready-for-agent
Status: Ready for ticketing

## Problem Statement

BaiZe 当前把需求设计暴露为一组由用户手工选择角色、填写自由 Prompt 并逐次启动的 Run。用户必须理解 Orchestrator、Analyst、Architect、Critic 和 Reviewer 的内部职责，自己决定调用顺序，并在每次 Run 后人工判断下一步。普通专业角色还共享 Requirement 级模型会话，角色输出没有强制 Schema，Run 完成也不会自动推进；系统无法证明一次设计是否覆盖了必需产物、证据、Decision、Finding、Critic 评审和最终人工批准。

这种体验把编排责任交给了用户和模型文本：失败、暂停、返工、多人命令竞争、服务重启及迟到模型结果都缺少统一治理语义；现有直接归档只检查没有活动 Run，不能证明设计包真正可实施。操作员需要的是“描述需求、明确开始、在真正需要判断时介入、最后批准”的自动优先流程，而不是一套手工多 Agent 控制台。

## Solution

每个 Requirement 创建时同时建立唯一的、处于 `pending` 的 Workflow。用户首次明确开始后，确定性的 Workflow Engine 创建 Planning Task，由零工具 Orchestrator 提出完整、有限、不可变的 Task DAG；Engine 校验并采用 PlanRevision，再依次执行 Analyst、Architect 和 Critic Task。所有角色都在隔离 Attempt Session 中运行，只通过版本化 Context Manifest、Artifact revision、Decision、Finding 和证据交接。

Engine 独占 Workflow 状态转换、计划采用、Task 调度、副作用发布、质量判断和归档控制。Agent 只能提出结构化计划或通过受限领域工具生成暂存事实。Artifact Policy 根据 Analyst 的 Impact Profile 派生 Required Artifact Set；Readiness Policy 用内容 Schema、来源、证据、Decision/Finding 处置、Critic coverage、一致性和 transcript 完整性进行十一项确定性检查。全部通过后，Engine 生成内容寻址的 ApprovalPacket，只有绑定当前版本与 digest 的真实人工批准才能归档。

操作体验默认显示引导式 Workflow 概览，每个治理状态只有一个主动作；计划、Task、Attempt、Run、Artifact 和治理事实在同页详情渐进展开；不提供独立审计视图，完整事件与 Command Receipt 经 Workflow Doctor 与存储层直达可查。人工可通过类型化命令暂停、继续、steer、取消 Run、重试、替换完整计划、回答门禁、修订需求和处置治理事实，但不能 force-skip、force-ready 或绕过真实批准。

新系统通过七个依赖实施切面构建，前六个切面只由测试入口装配；最后一个切面在维护窗口执行停写式 `check → apply` 历史迁移、接通唯一生产入口并硬删除旧手选角色、共享 Session、Reviewer、旧 API/UI/数据库路径。系统不保留双写、兼容适配器或长期双轨。

## User Stories

1. As a requirement author, I want creating a Requirement to atomically create its baseline, Design Session, pending Workflow, Policy Bundle, and audit event, so that design governance starts from a complete and reproducible state.
2. As a requirement author, I want to explicitly start automatic design once, so that the system never spends model resources before I consent.
3. As a requirement author, I want the Workflow to continue automatically after start, so that I do not manually choose roles or sequence Runs.
4. As a requirement author, I want to see one clear primary action for the current state, so that I do not need to understand the internal state machine.
5. As a requirement author, I want automatic work to stop only for genuine blocking gates, failures, pauses, or final approval, so that routine progress does not demand attention.
6. As a requirement author, I want human questions to identify the exact gate and subject version, so that my answer cannot be applied to a different issue accidentally.
7. As a requirement author, I want answering a Human Input gate to resolve only that gate, so that natural-language answers do not silently rewrite the Requirement or select a Decision.
8. As a requirement author, I want Requirement revisions to create immutable successors, so that plans and artifacts built from older baselines become explicitly stale.
9. As a requirement author, I want steer instructions recorded for the next safe replanning point, so that an active model Session is never invisibly rewritten.
10. As a requirement author, I want pausing to stop new dispatch while allowing an already-running exact-input Attempt to finish safely, so that useful work is not discarded unnecessarily.
11. As a requirement author, I want a separate cancel-run action when I need a hard stop, so that cancellation is explicit and auditable.
12. As a requirement author, I want resume to re-evaluate open gates and Readiness, so that the Workflow returns to the correct state instead of blindly running.
13. As a requirement author, I want failed Task recovery to offer only valid actions for that incident class, so that I cannot invoke a meaningless retry.
14. As a requirement author, I want one manual retry command to authorize exactly one extra Task Attempt, so that retry budgets remain visible and bounded.
15. As a requirement author, I want planning recovery to create a new Planning Task from the latest snapshot, so that an invalid old plan is not mutated in place.
16. As a requirement author, I want to replace a plan with a complete validated Replacement Proposal, so that manual takeover preserves DAG, role, budget, and policy invariants.
17. As a requirement author, I want diagnostic Runs to be isolated and read-only, so that troubleshooting cannot alter governed design facts.
18. As a requirement author, I want multiple open gates presented one at a time in deterministic priority order, so that I always know which decision should be handled first.
19. As a requirement author, I want stale forms to preserve my draft but disable submission, so that live events do not erase work or auto-rebase intent onto a new subject.
20. As a requirement author, I want a Command Receipt before eventual UI convergence, so that I can distinguish durable command acceptance from the resulting Workflow state.
21. As a requirement author, I want uncertain network retries to reuse the same command identity and request digest, so that duplicate clicks cannot repeat side effects.
22. As a requirement author, I want version and digest conflicts shown in the original action context, so that I can reload and make a new explicit decision.
23. As a requirement author, I want current plan progress, Task order, active Attempt and Run, artifacts, decisions, findings, and evidence available on the same page, so that I can inspect details without leaving the Requirement.
24. ~~As an auditor, I want a separate audit view for Workflow events, Run events, receipts, incidents, versions, and digests, so that operational history is traceable without cluttering the guided flow.~~（已撤回 2026-08-18：独立审计视图已删除，见 `.wayfinder/2026-08-audit-view-removal/map.md`）
25. As an approver, I want the ApprovalPacket to show exact required Artifact revisions, Decision dispositions, Finding treatment, Critic coverage, consistency results, policy versions, and provenance, so that approval is informed.
26. As an approver, I want approval bound to the current packet digest, Workflow version, and subject versions, so that approval cannot drift to changed material.
27. As an approver, I want approving the packet to approve included pending revisions and archive in one transaction, so that partial final approval is impossible.
28. As an approver, I want packet rejection to require a reason and structured targets, so that rework has an actionable and auditable basis.
29. As an approver, I want an Approval to be immutable and revocation or replacement to append new records, so that judgment history is preserved.
30. As an approver, I want major and critical Decision dispositions to require approval capability, so that consequential choices are not silently made by an Agent.
31. As an approver, I want critical Findings to require verified resolution and never allow risk acceptance, so that critical defects cannot be waived.
32. As an approver, I want major Finding risk acceptance bound to the exact Finding Thread, target revision, evidence, impact, and reason, so that accepted risk is precise.
33. As a design stakeholder, I want minor and informational Findings disclosed in the final packet, so that non-blocking risk remains visible.
34. As a design stakeholder, I want every Workflow to receive an independent Critic review, so that Analyst and Architect self-assessment cannot substitute for review.
35. As a design stakeholder, I want initial Critic review blind to historical Critic conclusions, so that the review is not anchored by earlier opinions.
36. As a design stakeholder, I want rework verification to include only targeted prior Findings and disposition evidence, so that the Critic can verify closure without unrelated history.
37. As a design stakeholder, I want the same Finding fingerprint tracked across revisions, so that rework and verification form one auditable Finding Thread.
38. As a design stakeholder, I want automatic rework limited to two cycles per Finding Thread, so that the system cannot loop indefinitely.
39. As a design stakeholder, I want Required Artifact Set derived from a structured Impact Profile, so that the design scope follows requirement impact rather than model preference.
40. As a design stakeholder, I want unknown Impact Profile dimensions to block progress, so that uncertainty is never treated as a dimension that is not required.
41. As a design stakeholder, I want requirement, analysis, and design artifacts always required, with scenario, use case, function, architecture, data, and API artifacts required by impact, so that deliverables match the change.
42. As a design stakeholder, I want each Artifact kind validated by a closed versioned content Schema, so that arbitrary model prose cannot masquerade as a governed Artifact.
43. As a design stakeholder, I want all required revisions to carry input provenance and code-related revisions to have valid TraceLinks in one Evidence Snapshot, so that claims are evidence-backed.
44. As a design stakeholder, I want all open Decisions to block Readiness, so that unresolved choices cannot reach final approval.
45. As a design stakeholder, I want consistency errors to block without waiver while warnings and information are disclosed, so that structural corruption cannot be accepted informally.
46. As a design stakeholder, I want all eleven Readiness checks recomputed from current facts, so that no Agent self-report or force-ready command controls readiness.
47. As a workflow operator, I want the Orchestrator to produce only a complete finite PlanProposal and have no tools, so that planning cannot mutate domain facts.
48. As a workflow operator, I want Plans limited to twelve Tasks, depth six, three Attempts per Task, two Planning Attempts, and five consecutive PlanRevisions without human intervention, so that model-driven expansion is bounded.
49. As a workflow operator, I want Tasks to reference explicit revisions or symbolic ancestor outputs instead of the implicit latest revision, so that every Attempt input is reproducible.
50. As a workflow operator, I want symbolic Task outputs resolved to exactly one published revision before Attempt creation, so that ambiguous dependencies fail deterministically.
51. As a workflow operator, I want one active governance Attempt per Workflow in stable topological order, so that first-release execution is simple and auditable.
52. As a workflow operator, I want one writer Task per Artifact kind in a PlanRevision, so that Artifact publication cannot race.
53. As a workflow operator, I want Analyst ownership of analysis, scenario, use case, and function artifacts and Architect ownership of design, architecture, data, and API artifacts, so that write responsibility is unambiguous.
54. As a workflow operator, I want every Attempt to use an isolated model Session and an immutable Context Manifest, so that hidden shared transcript state cannot contaminate roles.
55. As a workflow operator, I want mutating tool effects staged until Role Result, policy, CAS, and publication-token checks pass, so that failed Attempts cannot partially publish.
56. As a workflow operator, I want late results from cancelled or superseded Attempts retained only for audit, so that stale model output cannot revive work or change facts.
57. As a workflow operator, I want queued work redispatched, lost running work failed, and completed model results deterministically finalized after restart, so that recovery reflects the actual execution phase.
58. As a workflow operator, I want Engine and Outbox incidents recoverable through a precise retry-recovery command, so that infrastructure repair does not create a fake Task or Run.
59. As an administrator, I want trusted ActorRef and capabilities derived from an authenticated Operator Session, so that clients cannot forge the actor recorded in approvals and commands.
60. As an administrator, I want Workflow and Run events exposed as separate replayable SSE streams, so that governance history is not polluted by token traffic.
61. As an administrator, I want a bounded current Workflow Projection with complete retained event history, so that normal reads remain usable while full history stays replayable through SSE and storage.
62. As an administrator, I want startup reconciliation to finish before HTTP accepts traffic, so that clients never observe a half-recovered state.
63. As an administrator, I want state, receipts, events, incidents, and Outbox Jobs committed atomically, so that crashes cannot leave contradictory control-plane facts.
64. As an administrator, I want a read-only Workflow Doctor to check DB/Session pairing, claims, event sequence, effects, outbox, approvals, consistency, transcripts, and legacy residue, so that release and incident checks use one authority.
65. As a release operator, I want cutover preflight to bind database and Session-tree fingerprints in a Cutover Report, so that apply cannot operate on a different source.
66. As a release operator, I want legacy Requirements classified deterministically as archived history or pending re-entry, and standalone manual assets migrated as Reusable Assets, so that history is preserved without fake governance.
67. As a release operator, I want legacy archived packages marked `legacy_pre_policy` rather than assigned fabricated approvals, so that historical provenance remains honest.
68. As a release operator, I want active legacy Runs to block cutover, so that no old execution is silently abandoned or imported as governed output.
69. As a release operator, I want check, apply, repeated apply, reconciliation, and crash recovery exercised against generated real SQLite and Session fixtures, so that migration safety is demonstrated rather than mocked.
70. As a release operator, I want paired snapshot rollback available only before the first new business write, so that rollback never creates a mixed-history system.
71. As a release operator, I want zero-tolerance invariants to stop release or new writes, so that incorrect archive, digest mismatch, event gaps, orphan claims, invalid effect publication, exhausted Outbox, migration differences, or reachable legacy writes are never normalized.
72. As a release operator, I want a 24-hour guard period after the first new write, so that the team actively monitors the irreversible cutover boundary.
73. As a maintainer, I want the production entrypoint to construct only the Pi Model Driver, so that deterministic test drivers cannot be selected through environment or HTTP.
74. As a maintainer, I want all old role selectors, free-form Run prompts, Reviewer paths, shared Sessions, direct archive routes, old locks, tables, and compatibility adapters removed in the cutover release, so that only one architecture remains.
75. As a maintainer, I want the system delivered through seven dependency-ordered implementation slices whose first six are test-only assemblies, so that review can be incremental without deploying a half-built dual track.
76. As a maintainer, I want product metrics recorded but not gated until at least twenty real completed Workflows exist, so that future thresholds are evidence-based rather than invented.

## Implementation Decisions

### Domain and lifecycle

- A Requirement owns exactly one lifetime Workflow. A Workflow owns immutable PlanRevisions and Tasks; each Task owns Attempts; each governance Attempt owns exactly one Run.
- Workflow has seven persistent governance states: `pending`, `running`, `waiting_for_human`, `paused`, `failed`, `ready_to_archive`, and `archived`. Planning, analyzing, designing, reviewing, and reworking are Task-derived projections, not Workflow states.
- Workflow Engine is the sole state-transition authority. Commands use expected Workflow version and globally unique command identity; archived is the sole runtime terminal state and has no outgoing transition.
- Current state rows support query and recovery, while append-only Workflow Events support audit and SSE. Workflow version and event sequence are independent counters.
- Design Session stores Requirement-level human governance interaction only. It is not shared professional-role memory.

### Role Contracts and execution context

- First release has exactly four Agent roles: Orchestrator, Analyst, Architect, and Critic. Reviewer is removed rather than renamed or wrapped.
- Role Contracts are immutable and versioned. A PlanRevision pins input/output Schema, Skill version and digest, tool policy, read/write policy, and completion policy for every role it uses.
- Every Attempt has a fresh isolated Session and immutable Context Manifest containing exact Requirement, Plan, Task, policy, repository snapshot, Artifact revision, Decision, Finding, Human Directive, and version-vector references.
- Orchestrator is a zero-tool pure planner with no Artifact, Decision, Finding, gate, or governance side effects.
- Analyst is the sole Agent writer for analysis, scenario, use case, and function Artifact kinds. Architect is sole writer for design, architecture, data, and API. Requirement changes require a human governance command.
- Critic can read the frozen Review Bundle and write only Findings. Initial review is blind; verification review receives only targeted Finding Threads and disposition evidence.
- Tool-policy violation, output-Schema failure, or completion-policy failure ends the current Attempt. Repair uses a new Attempt; there is no hidden same-Session repair turn.

### Planning and deterministic execution

- Engine creates Planning Tasks; planning follows the same Task → Attempt → Run model as all execution.
- A PlanProposal is a complete, finite, immutable DAG. It can contain analyze, design, review, rework, and verify Tasks but cannot contain plan or Orchestrator Tasks.
- Tasks declare a stable key, fixed kind and role, objective, dependencies, closed input references, expected Artifact effects, a whitelisted completion policy, and bounded Attempts. They cannot contain executable DSL, tool lists, state commands, arbitrary runtime prompts, or “latest” references.
- Plan validation covers Schema, base versions and digests, unique keys, DAG acyclicity, depth and count, kind-role mapping, input ancestry, Artifact ownership, per-kind write set, completion-policy applicability, budgets, forbidden fields, non-empty unsatisfied work, and adoption-state guards.
- Valid automatic plans are adopted without a separate human plan-approval gate. Rework and dynamic branching always create a new PlanRevision; a current Plan is never patched or given back-edges.
- First release limits each PlanRevision to twelve execution Tasks and depth six, each Task to three Attempts, each Planning Task to two Attempts, and automatic progression to five consecutive PlanRevisions without human intervention.
- Each Workflow has one persistent no-TTL governance Attempt claim. Scheduling is serial in stable Plan order, with retry of the current Task before unrelated ready Tasks. One read-only Diagnostic Run may coexist under a separate claim.
- A PlanRevision may have only one writer Task for each Requirement plus Artifact-kind write key. Further work on that kind requires a new PlanRevision.
- Mutating tools write to a unified Attempt-effect ledger. Publication occurs atomically only after Role Result, completion policy, exact Task/Plan/input CAS, Artifact base revisions, and Effect Publication Token validate.

### Artifact, quality, and final approval

- Artifact content is governed by closed, versioned JSON Schemas for requirement, analysis, scenario, use case, function, design, architecture, data, and API.
- Analyst produces a structured Impact Profile for process, actors, behavior, architecture, data, and API. Engine derives Required Artifact Set: requirement, analysis, and design are always required; each `yes` dimension adds its corresponding Artifact; `unknown` blocks.
- Required current revisions must be pending or approved, valid for their kind Schema, traceable to exact source references, and uniquely current. Draft and rejected revisions cannot satisfy Readiness.
- Every required revision needs input provenance. Analysis, design, architecture, data, and API additionally need direct valid TraceLinks in one Evidence Snapshot bound to the ApprovalPacket.
- All open Decisions block. Critical and major Decisions require human disposition and approval; minor Decision deferral requires a reason, owner, and follow-up target.
- Critical Findings must be Critic-verified as resolved. Major Findings must be verified resolved or receive precise human risk acceptance. Minor and informational Findings may remain disclosed in the packet.
- Finding Threads use a stable fingerprint and permit at most two automatic rework/verify cycles before opening a human gate.
- Every Workflow requires current Critic coverage over the exact packet revisions. A zero-Finding report is valid only with complete coverage attestation.
- Consistency errors cannot be waived. Warning and informational results are disclosed in the packet. Missing current provenance transcript is an error.
- Readiness consists of eleven deterministic checks: terminal current work, no gate, complete Impact Profile, complete required Artifacts, no unpublished effects, evidence coverage, disposed Decisions, disposed Findings, current Critic coverage, no consistency error, and buildable ApprovalPacket.
- Engine builds an immutable SHA-256 ApprovalPacket. Approval binds exact packet identity, version, digest, Workflow version, governed inputs, policy versions, and provenance. Packet approval atomically approves included pending revisions and archives.

### Human control, identity, and audit

- Human takeover is a set of typed commands, not a lease, second workflow, or direct row mutation path.
- Supported commands cover start, steer, pause, resume, cancel-run, Task/planning/recovery retry, complete plan replacement, read-only diagnostic Run, Human Response, Requirement revision, Decision disposition, Artifact approval/rejection, major Finding risk acceptance, Approval revocation, and packet approval/rejection.
- There is no force-role governance command, force-skip, force-ready, critical Finding waiver, consistency-error waiver, direct status patch, or model-generated approval.
- Pause stops new dispatch and cancels queued-not-started work; a running exact-input Attempt may complete. Cancel-run explicitly terminates it and pauses. Steer records a Human Directive and replans at a safe point without modifying the active Context Manifest.
- Replacement Proposal uses the same complete Plan Schema and validators as an automatic proposal, creates a new PlanRevision, and supersedes old non-terminal Tasks and Attempts atomically.
- DecisionDisposition, Approval, and ApprovalRevocation are immutable append-only records. Effective active, stale, revoked, and superseded states are derived projections.
- Capabilities are `workflow:operate` and `workflow:approve`. First release does not require four-eyes separation, but Agent and service execution can never receive approval capability.
- ActorRef and capabilities come only from a trusted server-side Operator Session. A Bearer bootstrap establishes an HttpOnly, SameSite Strict same-origin cookie usable by EventSource.
- Every syntactically valid command against a known Workflow persists a success, business rejection, capability denial, version conflict, state conflict, or subject conflict receipt. Reusing an identity with a different request digest is an idempotency conflict.

### Persistence, API, events, and recovery

- SQLite remains the single governance source of truth. Persistence uses normalized current state plus content-addressed immutable Snapshot Documents for large contracts, plans, contexts, policies, results, repository views, packets, migration evidence, and actor snapshots.
- Run owns its isolated Session file and Pi Session identity directly; it does not reference a shared Design Session.
- State changes, receipts, events, incidents, staged-effect publication, claims, and Outbox Jobs use explicit SQLite transactions. Claim acquisition and Attempt/Run creation are atomic.
- Public creation atomically creates Requirement, baseline revision, Design Session, pending Workflow, fixed Policy Bundle binding, and creation event.
- All Workflow operations use one idempotent PUT command resource. Reads expose Requirement summaries, complete bounded Workflow Projection, immutable Plan/Task/Attempt/Run/Approval details, receipts, Design Packages, legacy imports, and workspace Reusable Assets.
- Workflow and Run event streams are separate. Both support SSE replay, Last-Event-ID, captured-watermark catch-up, live buffering, deduplication, and heartbeat; first release retains all events.
- Workflow stream carries governance and audit events, not model tokens. Run stream carries process, token, tool, result, abort, and late-result events.
- Durable Outbox Jobs perform model dispatch, finalization, abort, rescheduling, and other post-commit work with bounded retry. Exhaustion creates a Workflow Incident and fails safely.
- Startup recovery completes before HTTP listening. Queued Runs are redispatched; running Runs become process-lost failures and consume Attempt budget; completed Runs with result snapshots finish deterministic validation/publication; claims and staged effects reconcile idempotently.
- Missing an unpublished Attempt Session fails the Attempt. Missing a transcript used by current published provenance is a blocking consistency error.
- A read-only Workflow Doctor uses the same invariant checkers as CI and release operations.

### Operator experience

- The Requirement page defaults to a guided summary with state hero, one primary action, five-step progress story, and Artifact/pending/status summaries.
- Workflow details expand on the same page and show stable Task order, current Attempt and Run, Artifact revisions, Decision/Finding/Evidence facts, and progressively disclosed takeover controls.
- Approval uses a focused mode on the same page. Full Workflow/Run event, receipt, incident, version, and digest history is retained immutably and reachable through SSE replay and Workflow Doctor; no separate audit view is provided.
- Advanced controls are disclosed by risk: normal summary exposes only the primary action; details expose pause and cancel; advanced takeover exposes steer, replace-plan, and diagnostic Run.
- Gate Queue processes one exact subject at a time: critical Decision, required Human Input, major Finding disposition, then Artifact rejection or command-conflict recovery; ties use opened event sequence.
- UI never optimistically mutates governance state. It presents persisted receipt separately and waits for Workflow SSE and Projection to confirm actual state.
- When live updates stale an open form or packet, submission is disabled, draft input is preserved, and the user must inspect differences and reload; the client never auto-rebases.

### Cutover and delivery

- Implementation is organized as seven dependency-ordered vertical slices: S1 deterministic contract harness; S2 Workflow governance kernel; S3 planning and Task execution; S4 Artifact quality loop; S5 human control and public API; S6 Web operator experience; S7 cutover and hard deletion.
- Slices one through six are reviewable and testable but can only be assembled through test entrypoints. They must not register new production routes or UI. Slice seven creates the only deployable new runtime.
- Production uses only PiModelDriver. ScriptedModelDriver and deterministic Clock, IDs, digests, repository snapshots, actor, model usage, Outbox transport, and crash injector exist only in test assembly.
- Cutover is a write-paused `check → apply` operation bound to paired database and Session-tree fingerprints. No dual write, runtime feature flag, compatibility adapter, shadow write, or old-runtime read fallback is allowed.
- Legacy Requirements receive deterministic baseline revisions. Existing archives become read-only `legacy_pre_policy` Design Packages backed by Legacy Requirement Bundle and Migration Attestation, not fabricated Approval. Unarchived items re-enter as pending Workflows. Standalone manual scenario/use case/function content becomes Workspace-level Reusable Assets without fake Requirement or Run.
- Active legacy Runs block cutover. Apply uses a numbered forward-only transaction, reconciles counts and digests, and removes obsolete database surfaces.
- The cutover release simultaneously registers the new HTTP/Web entrypoints and removes manual role Run creation, shared professional Sessions, Reviewer, direct archive, old global Run stream, old locks, old client controls, compatibility helpers, and obsolete schema.
- Paired snapshot plus old binary rollback is permitted only before the first new business write. After that point, failures stop new writes and are fixed forward.
- Release includes a 24-hour Guard Period. Incorrect archive, subject/digest mismatch, event gaps, receipt inconsistency, orphan claim, invalid effect publication, consistency error, missing current transcript, exhausted Outbox, migration discrepancy, or reachable legacy write surface has zero tolerance.

## Testing Decisions

- The highest and primary test seam is the final public HTTP Workflow API assembled with ScriptedModelDriver. End-to-end deterministic tests should create a Requirement, issue real commands, consume receipts, Projection and Workflow/Run SSE, drive scripted role behavior through the same model/tool boundary, and reach or reject archive according to external contracts.
- Tests should assert observable state, immutable records, receipts, event envelopes, published Artifact revisions, packet digest, and HTTP/SSE behavior. They should not assert private call order between Store and Engine modules except where the public ScriptedModelDriver contract explicitly makes model/tool order observable.
- Pure contract/policy tests are a necessary auxiliary seam for JSON Schema validation, plan static rules, Artifact policy, Readiness checks, role/tool ownership, API/event catalog cross-references, removed-surface lists, and deterministic digest construction.
- Real subprocess crash tests are a necessary auxiliary seam for transaction boundaries, Outbox delivery, Run dispatch/ack/result/finalization, staged-effect publication, claim restoration, and cutover crash points. Recovery must be tested through restart and public Projection/Doctor results, not internal mocks alone.
- Browser tests are a necessary auxiliary seam for Lit behavior that HTTP cannot prove: single primary action, same-page details, Gate Queue, focused approval, receipt-versus-projection feedback, stale draft locking, reconnect behavior, dialogs, live regions, keyboard/focus restoration, and desktop/tablet/mobile layouts.
- Existing Node test plus TSX conventions are prior art for runtime unit and SQLite integration tests. Existing Vitest component tests and Playwright three-viewport E2E tests are prior art for Web verification. Existing network-none Compose smoke is retained as the deployment-level seam but rewritten to use the final automatic Workflow API and ScriptedModelDriver test assembly.
- Contract tests must include a minimal positive and targeted negative fixtures for every Plan rule, every Artifact kind, Role input/output, tool permission, ownership rule, completion policy, command/state/capability combination, and removed surface.
- Each of the eleven Readiness checks must have a test where it alone is false while the other ten pass. There must be no force-ready path.
- Runtime crash tests cover at least: command commit before Outbox delivery; Attempt/Run commit before model dispatch; dispatch before running acknowledgment; result snapshot before Attempt finalization; staged effects before publication; publication commit before Outbox delivery; external side effect before Outbox completion; claim restore before redispatch.
- Cutover uses declarative manifests to generate real temporary legacy SQLite databases and Session trees for: empty; complete archive; missing attachment; pending re-entry; manual asset source; mixed classifications; active Run block; DB/Session fingerprint mismatch; invalid legacy JSON; repeated apply.
- Cutover also terminates a real child process after paired backup, after Cutover Report, during migration transaction, after commit before startup, and after startup before first business write. Restart must yield a complete old or complete new state, never a mixture.
- Every pull request runs no-key deterministic contract, runtime unit/typecheck, SQLite integration, recovery/crash, cutover fixture, Web unit/build, three-viewport Playwright, static legacy-surface negative scan, and network-none Compose automatic Workflow smoke gates.
- Release Candidate adds a real-model Golden Requirement suite and isolated real-copy cutover rehearsal. The eight cases are: minimal loop; full architecture/data/API impact; required Human Input; critical Decision; Critic rework closure; major Finding risk acceptance; steer-safe replanning; recovery from an initially invalid plan or result.
- Each Golden Requirement runs three times. Safety invariants must pass 100%; each case must achieve its expected gate or `ready_to_archive` at least two of three times; overall expected-result rate must be at least 90%; all successes must remain within established budgets.
- Golden tests compare Schema, governed facts, evidence, gates, and terminal state—not natural-language wording, exact Task count, or specific design prose.
- Workflow Doctor, release checks, and CI use the same invariant validators. Product metrics such as first-plan pass rate, revisions, retries, rework, takeover, time-to-ready, token/latency, and Finding closure are recorded but receive no release thresholds until at least twenty real completed Workflows exist.

## Out of Scope

- A general chat interface, arbitrary tool execution, or an open-ended multi-Agent platform.
- Runtime creation of roles or separate Agents for scenario, use case, or function work.
- More than the four fixed Orchestrator, Analyst, Architect, and Critic Role Contracts.
- Model-driven final approval, unattended archive, force-ready, force-skip, or critical-risk waiver.
- Multi-tenant identity, account directory, mandatory four-eyes approval, or per-user Workflow ownership.
- Distributed queues, multiple Gateway schedulers, PostgreSQL, Redis, or cross-workspace parallel orchestration.
- Concurrent governance Attempts within a Workflow in the first release.
- Model auto-selection, cost routing, automated Skill changes, Gene feedback, or self-learning behavior.
- Long-term coexistence of manual role Runs and automatic Workflow orchestration.
- Dual write, shadow write, runtime feature flags, compatibility adapters, or post-write rollback to the old system.
- A new metrics service or product analytics backend for the initial release.
- Modification of target repositories or implementation of their business code; BaiZe produces requirement-design artifacts and plans only.

## Further Notes

- This specification synthesizes the completed Wayfinder effort “BaiZe 自动优先需求设计编排.” Its resolved tickets remain the authoritative detailed rationale; the machine-readable contracts remain the authoritative closed enums, Schemas, policies, API, event, recovery, concurrency, operator-experience, cutover, and implementation-plan definitions.
- The confirmed main test seam is the final public HTTP Workflow API plus ScriptedModelDriver test assembly. Auxiliary seams are intentionally limited to pure policy validation, real crash/restart processes, browser interaction, Golden Requirements, and Workflow Doctor.
- Implementation must proceed in S1 → S7 dependency order. S1–S6 are not independently deployable; S7 is the atomic production cutover and legacy deletion.
- No unresolved in-scope product or governance decision remains. The next step is to split this specification into dependency-linked tracer-bullet implementation tickets using `/to-tickets`; each ticket should then be implemented in a fresh context with `/implement`.
- If implementation reveals a need to change a governance invariant rather than clarify code structure, open a new decision effort instead of silently diverging from this specification.
