# 领域工具、Skill 与证据策略 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by: [首版运行边界与设计会话契约](R01-runtime-session-contract.md), [Pi SDK 会话持久化与流式执行可行性](R02-pi-session-capability.md)

## Question

首版需求设计 Agent 需要哪些受限工具和可组合 Skill，才能自主完成澄清、代码调查、设计修改、校验和人工升级，同时不退化为通用 coding agent？需要决定：

- 面向代码知识、设计记忆、Artifact、Decision、Review 的工具表面及输入输出；
- 是否禁用原始 shell，何时提供只读 repository inspection；
- 角色模式与 Skill 的关系、版本和输入输出校验；
- 证据如何进入推理上下文并如何被 Artifact/Decision 引用；
- 工具权限、超时、结果裁剪和审计边界。

产出是受控工具目录与策略，不实现 MCP 平台。

## Resolution（2026-08-07）

1. **纯领域工具集，禁用原始 shell**：`inspect_repository`(只读目录/文件树)、`search_code`(符号/调用/路径)、`get_architecture`(快照)、`search_prior_designs`(历史 DesignPackage)、`get_artifact`/`patch_artifact`(起草/修改产物)、`raise_decision`(提重大决策)、`record_finding`(Critic/评审)、`run_consistency_check`(校验)、`request_human_input`(澄清/门禁)。禁用 `bash`/`read`/`grep`/`find` 任意 shell，避免退化为通用 coding agent。
2. **角色模式 + 版本化 Skill**：不拆多独立 Agent；同一持久主会话内按角色模式(analyst/architect/critic/...)加载对应 Skill；Skill = 可版本化、带输入输出 JSON Schema 校验的方法包；Skill 状态 DRAFT→STABLE，首版不做完整 registry。Critic 用隔离子 Run(R01)。
3. **Agent 主动调用工具获取证据 + TraceLink 引用**：Agent 按需调用 `get_architecture`/`search_code` 获取证据，结果在推理上下文里被 TraceLink 引用到 ArtifactRevision/Decision；不自动全量注入(避免上下文爆炸)。
4. **工具治理 = 超时+裁剪+审计+门禁分层**：每工具默认超时(检索 30s / LLM 校验 120s)；只读工具结果裁剪(N 条/N 字符)；所有工具调用落库审计(runId/tool/args/result 摘要/耗时/状态)；只读工具自动放行，写工具(patch_artifact/raise_decision/record_finding)受 R01 证据驱动门禁约束。
