# Research workspace cascade-delete FK graph

Label: wayfinder:research
Assignee: charting research subagent CascadeFkInventory（2026-08-18）
Status: closed
blocked-by: none

## Question

工作区被**硬删除**（级联——2026-08-18 用户拍板：连同其下所有需求与资产一并清掉）时，哪些行随之一并消亡？——从 `workspaces` 出发的完整外键图、事务内删除顺序、`snapshot_documents` 孤儿/共享处置，以及「迁移（`on delete cascade`）vs 事务内逆序 DELETE」的裁决。site-local 源码盘点（migrations 0001–0013 + workflow-store 插入/引用路径 + engine 运行时对工作区行的引用）；只读，不写代码、不改仓库，不跑测试。

## 盘点面

1. **直接引用 `workspaces(id)` 的表**：表名、FK 列、`on delete` 行为（restrict/cascade）、约束来源（哪张迁移）。
2. **传递闭包**：经 `requirements` / `workflows` / `design_packages` / `reusable_assets` 等间接引用的全表清单（含路径与 FK 链）；显式标注 ENGINE 运行时行（`outbox_jobs`、claims、runs、attempts、命令/回执、事件、approval_packets、decision/finding、plan revision、context manifest、design_sessions）。附注：design_sessions 的 `session_file` 在磁盘（SESSION_DIR），删行留文件 = 孤儿文件风险。
3. **`snapshot_documents`**：内容寻址 + 不可变触发器（禁止 UPDATE/DELETE？）；是否可被**多个工作区**的行共享（digest 去重插入路径——查 store 插入方法是否有 get-or-create 按 digest 复用）；若删除被禁，孤儿必然累积——给出引用路径佐证与累积量级判断。
4. **活跃/排队运行**：workspace 下有 active/queued run 时删除的影响（engine 侧引用、启动 reconcile 对引用缺失行的行为）。
5. **输出**：事务内删除顺序（逆拓扑，单事务）+ 裁决：迁移 0014 加 `on delete cascade` 链 vs 事务内逆序 DELETE 即可（权衡移植面、触发器、已有行数）；风险清单（含 outbox 未投递作业、SSE 订阅者、磁盘孤儿文件）。

## Resolution（charting 研究子代理 CascadeFkInventory，2026-08-18；全量输出 agent://CascadeFkInventory）

**直接引用 `workspaces(id)`（全 `on delete restrict`）**：`requirements.workspace_id`（0001）、`reusable_assets.workspace_id`（0011，0013 重建同）、`design_packages.workspace_id`（0011）。

**传递闭包（33 表）**：经 requirements → artifacts / artifact_revisions（自引用 base_revision_id restrict）/ design_sessions / workflows / legacy_imports（requirement 侧）；经 workflows → workflow_events / outbox_jobs（唯一无删除触发器的运行时表）/ command_receipts / workflow_incidents / plan_revisions（自引用 restrict）/ tasks / task_attempts / runs / run_events / governance_claims / attempt_effects / evidence_snapshots / trace_links / impact_profiles / finding_threads / findings / decisions / critic_coverage_targets / approval_packets / human_directives / human_gates / approval_records / diagnostic_runs；经 reusable_assets → reusable_asset_revisions（`on delete CASCADE`，全库唯一 cascade 边，deleteReusableAsset 已有先例）。

**删除阻断触发器（22 个）**：除 outbox_jobs / finding_threads / findings / decisions / reusable_asset_revisions 外全部带 BEFORE DELETE 触发器 RAISE(ABORT)（含 workflow_delete_forbidden、design_packages_no_delete、legacy_imports_no_delete、run_events_no_delete）；snapshot_documents 另有 immutable update+delete 双触发器。实验验证（sqlite 3.51）：父表 `on delete cascade` 会触发子表 BEFORE DELETE 触发器，RAISE(ABORT) 中止整条级联。

**snapshot_documents**：digest 去重插入（get-or-create by (kind,digest)，workflow-store.ts:520-532）；不可变（update/delete 均 RAISE）；可跨工作区共享（policy_bundle 同 digest 复用为实例）→ 删除**跳过** snapshot_documents，孤儿有界累积（unique(kind,digest)），设计上不得级联进 document 边。

**运行/引擎引用**：runs / run_events / governance_claims 随行删除；outbox_jobs 同事务删除（未投递事件丢失 = 硬删除预期内，须在 spec 明示）；启动 reconcile 对任何 FK 违例 process.exit(1)（main.ts:201-215）→ 删除必须全事务原子、删后 foreign_key_check；SSE 订阅者收不到删除信号（护栏面归 10）；与运行中模型 run 竞争 → FK 错误（10「禁删 active run」依据）。

**磁盘孤儿**：design_sessions.session_file（`workflow-sessions/requirement-<id>.jsonl`）+ runs.session_file（`run-<attemptId>.jsonl`）删行留文件；`workspaces.repo_path` 是用户自有仓库目录，**只删 DB 行、永不删目录**。

**删除顺序（单事务，逆拓扑，33 表）**：step0 事务内 suspend/restore 22 个删除触发器（DDL 实时取自 sqlite_master，SQLite DDL 事务性可回滚；snapshot_documents 触发器不动）→ run_events → trace_links → workflow_events → command_receipts → outbox_jobs → evidence_snapshots → impact_profiles → legacy_imports → design_packages → approval_records → human_gates → human_directives → diagnostic_runs → critic_coverage_targets → findings → finding_threads → decisions → approval_packets → attempt_effects → governance_claims → runs → task_attempts → tasks → plan_revisions（自引用两遍：先作他人 base 的行）→ workflow_incidents → workflows → artifact_revisions（base 先行两遍）→ artifacts → design_sessions → requirements → reusable_asset_revisions → reusable_assets → workspaces。

**裁决：不需要迁移 0014**。`on delete cascade` 无法绕过 22 个触发器（实验证实）且需重建 ~22 表（SQLite 不能 ALTER FK 子句），还给未来任何父行删除永久武装「静默级联核弹」，且 snapshot_documents 边仍无法级联（跨工作区共享）。选**单事务逆拓扑 DELETE**：事务内 suspend/restore 触发器零漂移、部署 schema 与不变量在删除事务外字节不变、数据量小删除快；安全网 = 现有启动 reconcile 硬失败 + 删后 PRAGMA foreign_key_check + contract 测试（删全量填充工作区 → 重开 store 验证）。

**风险与缓解（摘要）**：触发器中止 → 事务内 suspend/restore + commit 后断言存在；孤儿式删除启动拒服 → 全事务原子 + foreign_key_check；snapshot_documents 孤儿累积 → 有界 + 未来独立 GC（须 suspend 触发器 + 引用计数）；并发引擎引用 → 删除门禁（无 active/queued run，归 10）+ 可选 workflow_deleted 终端事件；自引用 FK → 两遍删除；SQLITE_BUSY（busy_timeout 5000）→ 管理窗口 + 全索引；磁盘 jsonl → 最佳努力 GC（requirement-<id> / run-<attemptId>），repo_path 目录永不删。