# M2 开发计划

> 基于开发输入文档 16.3 演进路线,承接 M1 MVP。本计划为**精简版**:剥离企业特性,聚焦三件事。

## 1. M2 目标(精简)

M1 已奠定完整闭环基座(REST/PostgreSQL、审核、决策、归档、SRS、PG 持久化 + testcontainers e2e + compose 全栈 + CI service)。M2 在此之上只做三件:

1. **自建需求系统**:BaiZe 自带需求管理(不依赖外部 Jira/TAPD),在 M1 requirement 基础上强化基线/版本/文档导入。
2. **多仓能力**:runtime 跨仓证据聚合(M1 已有 bind/list 多仓,扩展 runtime)。
3. **AgentRuntime 用 pi 实现**:用 Pi Core(Pi SDK)写一个 HTTP 适配服务响应 `/runtime/plan`,替代 deterministic,接真实 LLM。

## 2. 剥离的企业特性(不在 M2 范围)

以下延后到后续阶段(原 M2 "企业集成" 范围,现剥离):

- GitLab/外部 Git 提供商对接(GitLab 代码集成已做,保留作 Git 提供商扩展,不作为 M2 焦点)
- 外部需求系统导入(Jira/TAPD)
- API Registry / CMDB 对接
- 企业 SSO(SAML/OIDC)/ 多租户隔离
- 企业 RBAC 强化

## 3. M2 子项

### 3.1 AgentRuntime 用 pi 实现 ✅ 核心

新建 `agent-runtime/`(Node + Pi SDK),作为 `AGENT_RUNTIME_URL` 指向的外部 Agent Runtime 服务:

- HTTP `POST /runtime/plan`,收 BaiZe request(runId/requirementContent/repositoryId/branch/commitSha)
- 用 `createAgentSession({cwd: <evidence root>/<repoId>, tools:["read","bash","grep"], modelRuntime, systemPrompt})` 起 pi agent
- `session.prompt(结构化 prompt)` 让 LLM 分析仓库 + 产出 JSON(contextSummary/evidenceCandidates/requirementContent/architectureContent/restApiContent/dataDesignContent/decisionTitle/findingTitle)
- 容错解析 agent 输出 JSON → BaiZe `runtimeAdapterResponse` → 200 返回
- BaiZe 侧 `httpRuntimeAdapter` timeout 调大(10s → 可配,真实 LLM 慢)

设计详见 `agent-runtime/README.md`。

### 3.2 多仓能力(runtime 跨仓证据聚合) ✅

M1 `runtimeInput` 取 `repositories[0]`,M2 扩展为遍历所有绑定仓库:`runtimeAgentInput.Repository` → 多仓,evidence 候选跨仓聚合(`repositoryEvidenceCandidates` 已支持单仓 `WalkDir`,按仓循环 + LLM 多仓上下文)。

**完成**:`runtimeAgentInput.Repositories` + `runtimeInput` 多仓 + `repositoryEvidenceCandidates` 遍历多仓 + `httpRuntimeAdapter` 请求 `repositories[]` + agent-runtime `scanEvidence` 跨仓。验证:`runtime_evidence_candidates_test.go` 跨 pilot-backend + test-repo-2 聚合 5 evidence;端到端 2 repo bind + runtime-runs + SRS ready。
### 3.3 自建需求系统 ✅

M1 已有 `requirementVersion`(version/content/status)+ `requirement_routes.go` + DB `requirement_version` 表 + `m0_imports` baseline 导入。M2 强化:

- 需求文档导入(文本/文件,FR-002 "导入文本、文档或需求系统内容")
- 需求状态机(DRAFT → BASELINE → SUPERSEDED)
- 版本对比(后续)

**完成**:`createRequirement` 加 status(DRAFT 可选)+ `transitionRequirement`(baseline DRAFT→BASELINED / supersede BASELINED→SUPERSEDED)+ DB `UpdateRequirementStatus` sqlc + `requirement_routes.go` transition API。验证:导入需求文档(DRAFT)→ baseline → design run → runtime-runs → SRS ready → supersede 全状态机端到端。
## 4. M2 验收标准

- `agent-runtime/` 服务起后,设 `AGENT_RUNTIME_URL`,BaiZe `POST /design-runs/:id/runtime-runs` 走真实 LLM(pi)产 plan,端到端跑通审批→归档→SRS(`ready:true`)。
- 多仓:一个 project 绑定多个仓库,runtime 聚合跨仓 evidence。
- 自建需求系统:导入需求文档 → 版本 → design run。
- 继承 M1 全部验收基建(testcontainers e2e + compose 全栈 + CI service)。

## 5. 风险与边界

- **真实 LLM 依赖**:pi runtime 需 LLM key(本机 `~/.pi/agent/auth.json` 或 `ANTHROPIC_API_KEY`),无 key 则 runtime 起不来(但 BaiZe 仍可 fallback deterministic)。
- **LLM 输出结构化**:LLM 不保证严格 JSON,需 prompt 强制 + 容错解析。
- **LLM 延迟**:真实 LLM + 多轮 tools 远超 BaiZe 原 10s timeout,需调大。
- **AGENT_RUNTIME_URL** 现为 deterministic fallback;M2 后默认指向 pi runtime 服务。
