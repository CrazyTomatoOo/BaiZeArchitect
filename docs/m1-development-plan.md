# M1 开发计划

本文档定义从 M0 PoC 进入 M1 平台骨架开发的实施计划。由于当前尚无真实企业仓库，M1 采用“先固化平台骨架与契约、暂缓冻结复杂业务规则”的策略，避免把本地 PoC 的假设过早固化为生产架构。

## 1. M1 目标

M1 的目标是交付一个最小可运行平台骨架，使 M0 已验证的链路可以通过平台接口和运行状态机执行：

```text
项目 → 需求版本 → 仓库绑定 → 设计运行 → Artifact 版本 → 决策记录 → Finding → Design Package
```

M1 不追求完整智能化设计能力，而是先建立权威数据模型、状态机、Artifact 版本、决策治理和可观测事件。

## 2. M1 成功标准

M1 完成时必须满足：

- 可以通过 API 创建项目、导入需求、绑定仓库、启动 DesignRun。
- DesignRun 有显式状态机和不可变事件流。
- Artifact 可以创建版本、读取版本、锁定版本。
- DecisionRecord 可以创建、进入评审、批准、拒绝、被 supersedes。
- ReviewFinding 可以创建、分派、关闭或接受风险。
- Design Package manifest 可以由平台生成。
- M0 的 `cases.json`、Artifact 和 manifest 可以导入平台成为一条设计运行。
- 所有核心 API 有契约测试。

## 3. M1 暂不做的事

- 不做完整 Web Console，只做最小管理页面或 API-first。
- 不做真实模型编排，只保留 Agent Runtime Adapter seam。
- 不做复杂 Skill Registry，只记录 skill name/version。
- 不做企业 SSO，多租户先保留字段和接口约束。
- 不做真实 Code Knowledge Service，只接入 M0 文件/commit 证据校验 Adapter。
- 不自动生成设计内容，M1 只保证平台能承载和治理设计产物。

## 4. 推荐代码仓结构

```text
design-agent-platform/
├── platform-api/          # 项目、运行、Artifact、Decision、Finding、归档
├── agent-runtime/         # M1 仅保留状态机 Adapter 和离线导入器
├── code-knowledge/        # M1 适配 M0 本地证据校验
├── schemas/               # Artifact / Decision / Finding / Evidence Schema
├── examples/              # M0 案例与 Design Package 样例
├── scripts/               # 校验、导入、演示脚本
├── deploy/                # docker-compose / Helm 占位
└── docs/                  # ADR、API、开发计划、评审材料
```

当前仓库已具备 `schemas/`、`examples/`、`scripts/`、`docs/` 和 `pilot-backend/`，M1 首先新增 `platform-api/`。

## 5. 模块设计

### 5.1 Platform API

Platform API 是 M1 的核心深模块。它的外部 Interface 是稳定 HTTP API 和数据库状态机，内部 Implementation 可以后续替换。

职责：

- 项目与成员。
- 需求版本。
- 仓库绑定。
- 设计运行状态。
- 事件流。
- Artifact 版本。
- DecisionRecord 状态。
- Finding 生命周期。
- Design Package manifest 生成。

技术栈已决策：M1 Platform API 采用 Go，见 `docs/adr/ADR-001-platform-api-go.md`。

Go 技术基线：

- Go 1.23+。
- HTTP：gin。
- 数据访问：sqlc + pgx/v5。
- 数据库迁移：goose。
- 日志：标准库 `log/slog`。
- 配置：caarlos0/env/v11。
- 测试：标准库 testing + testify/require。
- 后续集成测试：testcontainers。
- 质量门禁：gofumpt、golangci-lint v2、nilaway、go test -race -shuffle=on -count=1。

### 5.2 Artifact Store

Interface：

```text
createArtifact(projectId, runId, type, ownerRole)
appendArtifactVersion(artifactId, content, sourceRefs, evidenceRefs)
getArtifactVersion(artifactId, version)
lockArtifactVersion(artifactId, version)
```

M1 约束：

- Artifact JSON 是权威格式。
- 版本只追加，不覆盖。
- 已锁定版本不可修改。
- Markdown/Word/PDF 暂不作为权威状态。

### 5.3 Decision Store

Interface：

```text
createDecision(runId, title, type, significance, options)
submitDecisionForReview(decisionId)
approveDecision(decisionId, approver, comment)
rejectDecision(decisionId, approver, reason)
supersedeDecision(oldDecisionId, newDecisionId)
```

状态机：

```text
PROPOSED → UNDER_REVIEW → ACCEPTED / REJECTED → SUPERSEDED / DEPRECATED
```

M1 约束：

- ACCEPTED 决策不可原地修改。
- 替代必须通过 supersedes 关系。
- 所有状态变化写入 design_event。

### 5.4 Run State Machine

Interface：

```text
createRun(projectId, requirementVersionId)
transitionRun(runId, event)
appendRunEvent(runId, eventType, payloadSummary)
getRunState(runId)
```

M1 状态：

```text
CREATED
CONTEXT_PREPARING
ANALYZING
WAITING_INPUT
REQUIREMENT_REVIEW
DESIGNING
VALIDATING
REVIEWING
REWORK
FINAL_APPROVAL
ARCHIVING
COMPLETED
BLOCKED
FAILED
CANCELLED
```

M1 先做确定性状态转移，不接真实模型。

### 5.5 Evidence Adapter

Interface：

```text
validateEvidence(repositoryId, commitSha, filePath, symbol, lineStart, lineEnd)
```

M1 Adapter：

- 复用 M0 的本地文件 + Git commit 校验逻辑。
- 支持 repositoryId 到本地路径映射。
- 后续替换为 Code Knowledge Service。

### 5.6 Design Package Generator

Interface：

```text
generateManifest(runId)
generateTraceability(runId)
archivePackage(runId)
```

M1 先生成 manifest 和 traceability JSON，不接 MinIO。

## 6. 数据模型优先级

### P0 表

| 表 | 用途 |
|---|---|
| design_project | 项目元数据 |
| project_member | 成员与角色 |
| requirement_version | 不可变需求版本 |
| repository_binding | 仓库、分支、commit、路径映射 |
| design_run | 运行状态与成本摘要 |
| design_event | 不可变事件日志 |
| artifact | Artifact 元数据 |
| artifact_version | Artifact 版本内容 |
| decision_record | 决策元数据与状态 |
| decision_option | 决策候选方案 |
| review_finding | 审核问题 |
| approval_record | 人工审批记录 |
| evidence_reference | 证据引用 |

### P1 表

| 表 | 用途 |
|---|---|
| design_package | 归档包元数据 |
| skill_version_ref | Skill 版本引用 |
| mcp_tool_call | MCP 调用审计 |
| model_call | 模型调用摘要 |

## 7. API 计划

### Sprint 1 必做 API

```text
POST /api/v1/projects
GET  /api/v1/projects/{id}
POST /api/v1/projects/{id}/requirements
POST /api/v1/projects/{id}/repositories
POST /api/v1/design-runs
GET  /api/v1/design-runs/{id}
GET  /api/v1/design-runs/{id}/events
```

### Sprint 2 必做 API

```text
POST /api/v1/design-runs/{id}/artifacts
POST /api/v1/artifacts/{id}/versions
GET  /api/v1/artifacts/{id}/versions/{version}
POST /api/v1/decisions
POST /api/v1/decisions/{id}/review
POST /api/v1/decisions/{id}/approval
POST /api/v1/findings
POST /api/v1/findings/{id}/resolution
POST /api/v1/design-packages
```

## 8. Sprint 计划

### Sprint 0：Go 开发骨架，3-5 天

目标：建立工程和质量门禁。

任务：

- 创建 `platform-api/` Go module。
- 建立 `cmd/platform-api`、`internal/`、`migrations/`、`sql/`、`api/openapi/` 目录。
- 增加 `/healthz` HTTP 入口。
- 配置 `go.mod`，使用 Go 1.23+。
- 接入 gin、pgx/v5、sqlc、goose、slog、env/v11。
- 配置 gofumpt、golangci-lint v2、nilaway 的本地命令。
- 接入 PostgreSQL docker-compose。
- 建立首个 goose migration。
- 建立 sqlc 配置。
- 建立 OpenAPI 草案目录。

退出条件：

- 服务能本地启动。
- `GET /healthz` 返回 200。
- `go test -race -shuffle=on -count=1 ./...` 通过。
- 数据库迁移可执行。
- sqlc 可生成代码。
- 单个 Go 文件纯代码不超过 250 行。

### Sprint 1：项目、需求、仓库、运行状态，2 周

目标：打通项目到 DesignRun 的基础链路。

任务：

- 实现 project、requirement_version、repository_binding。
- 实现 design_run 创建与查询。
- 实现 design_event 追加。
- 实现 Run State Machine。
- 实现最小 SSE 或事件查询 API。
- 将 M0 cases 导入为 requirement_version。

验收：

- 能创建项目。
- 能导入需求版本。
- 能绑定 `pilot-backend` commit。
- 能创建设计运行。
- 能查询运行状态与事件。

### Sprint 2：Artifact、Decision、Finding，2 周

目标：承载 M0 样例 Artifact 与决策治理。

任务：

- 实现 artifact / artifact_version。
- 实现 artifact append-only 版本。
- 实现 DecisionRecord 状态机。
- 实现 DecisionOption。
- 实现 ReviewFinding 生命周期。
- 实现 ApprovalRecord。
- 导入 `examples/m0/artifacts/`。

验收：

- M0-001、M0-005 Artifact 可导入并读取。
- Decision 可从 PROPOSED 到 UNDER_REVIEW，再到 ACCEPTED/REJECTED。
- ACCEPTED 决策不可覆盖。
- Finding 可关闭或接受风险。

### Sprint 3：证据 Adapter 与 Design Package，2 周

目标：把 M0 的证据校验和归档包生成纳入平台。

任务：

- 实现 evidence_reference 表。
- 实现 Evidence Adapter。
- 支持 repositoryId 到本地路径映射。
- 实现 manifest 生成。
- 实现 traceability 生成。
- 实现 Design Package API。

验收：

- 平台能验证 M0 代码证据。
- 平台能生成与 `examples/m0/design-package/manifest.json` 等价的 manifest。
- 平台能生成追踪矩阵。
- 归档包可被 CLI 或 API 校验。

### Sprint 4：契约测试、试点准备、架构评审，1-2 周

目标：把 M1 骨架准备到真实试点前状态。

任务：

- 为核心 API 增加契约测试。
- 为状态机增加单元测试。
- 为 Artifact/Decision 不可变规则增加测试。
- 为 Evidence Adapter 增加测试。
- 输出 M1 ADR。
- 输出真实试点接入说明。

验收：

- M0 PoC 可以完整导入平台。
- API 契约测试通过。
- 状态机非法转移被拒绝。
- 证据校验失败时能生成明确 Finding 或错误。

## 9. 任务依赖

```text
工程骨架
  → 数据库迁移
  → 项目/需求/仓库
  → DesignRun 状态机
  → Artifact 版本
  → Decision 状态机
  → Evidence Adapter
  → Design Package Generator
  → 契约测试与评审
```

并行项：

- Schema v0.2 可以与 Sprint 1 并行。
- OpenAPI 草案可以与 API 实现并行。
- ADR 可以随 Sprint 决策逐步补。

## 10. 首批 ADR

| ADR | 主题 | 建议 |
|---|---|---|
| ADR-001 | Platform API 技术栈 | 已决策采用 Go，见 `docs/adr/ADR-001-platform-api-go.md` |
| ADR-002 | Agent Runtime 边界 | M1 只保留 Adapter seam，不接真实模型 |
| ADR-003 | Artifact 权威格式 | JSON 为权威格式，文档为派生物 |
| ADR-004 | Evidence Adapter | M1 使用本地 Git 文件校验，后续替换 Code Knowledge Service |
| ADR-005 | Decision 不可变性 | ACCEPTED 决策不可覆盖，只能 supersedes |
| ADR-006 | 事件日志 | design_event 作为不可变审计基础 |

## 11. 风险与控制

| 风险 | 控制 |
|---|---|
| 没有真实仓导致抽象失真 | M1 只做骨架和契约，不冻结复杂业务规则 |
| 平台 API 过早膨胀 | API-first，UI 暂缓 |
| Artifact Schema 太粗 | Sprint 1 并行推进 Schema v0.2 |
| Decision 状态不可审计 | 所有状态变化写入 design_event |
| Evidence Adapter 后续替换困难 | 以 `validateEvidence` 作为 seam，M1 不让调用方依赖实现细节 |

## 12. 立即下一步

下一步应做 Sprint 0：创建 `platform-api/` Go 工程骨架。

建议第一批提交只包含：

1. Go module 和目录结构。
2. `/healthz` HTTP 服务。
3. 基础配置解析。
4. 测试命令和最小单元测试。
5. 数据库 migration/sqlc 目录占位。
