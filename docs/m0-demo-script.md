# M0 演示脚本

本文档用于在没有真实企业仓库的情况下，演示 M0 技术验证 PoC。目标是证明链路成立，而不是证明已经完成真实企业试点。

## 1. 演示目标

用 10-15 分钟展示：

```text
需求案例 → 真实本地代码证据 → 结构化 Artifact → 决策记录 → 追踪矩阵 → Design Package → CLI 校验
```

核心讲法：

> 当前 PoC 使用本地构造的 `pilot-backend` 仓库模拟企业存量系统。它证明了证据链、Artifact 契约和归档校验流程可运行。未来接入真实仓库时，只需替换 `repositoryId/commitSha/filePath/symbol/line` 证据来源，不改变核心流程。

## 2. 演示前准备

进入项目目录：

```bash
cd /Volumes/work/Project/BaiZeArchitect
```

旧 M0 校验命令已在当前 Gateway/SQLite 重构中移除；本文件仅保留演示讲稿和历史材料索引。
历史材料曾记录 M0 baseline 与 Design Package 校验通过；当前不再执行旧脚本。

## 3. 演示流程

### 3.1 开场，1 分钟

讲解词：

> 这次演示不是一个完整平台，而是 M0 技术验证。我们要验证的是：一个需求变更能否被追踪到代码证据，并进一步形成结构化设计、决策记录、追踪矩阵和归档包。

展示文件：

- `docs/m0-tech-validation.md`
- `docs/m0-review-report.md`

强调边界：

- 已完成本地 PoC。
- 尚未完成真实企业仓库试点。
- 不直接进入生产平台建设。

### 3.2 展示本地试点仓库，2 分钟

展示路径：

```text
pilot-backend/
```

说明：

> `pilot-backend` 是一个本地构造的 Java/Go 后端样例仓库，用来模拟企业存量系统中的 Controller、Service、Repository、SQL migration 等结构。

重点文件：

- `pilot-backend/src/main/java/example/FileController.java`
- `pilot-backend/src/main/java/example/ObjectStorageClient.java`
- `pilot-backend/src/main/java/example/UserController.java`
- `pilot-backend/src/main/resources/db/migration/V12__create_user.sql`
- `pilot-backend/internal/report/handler.go`
- `pilot-backend/internal/job/worker.go`

展示 commit：

```bash
git -C pilot-backend rev-parse --short=12 HEAD
```

当前样例 commit：

```text
3dc359fceb1f
```

### 3.3 展示 5 个需求案例，2 分钟

展示文件：

```text
examples/m0/cases.json
```

讲解词：

> 这里有 5 个变更需求案例，每个案例至少绑定两条代码证据。证据不是泛泛引用，而是包含 repositoryId、commitSha、filePath、symbol、lineStart、lineEnd 和 claim。

5 个案例：

1. M0-001 文件上传。
2. M0-002 异步导出任务。
3. M0-003 模型推理灰度路由。
4. M0-004 K8s 配额审计。
5. M0-005 用户创建幂等。

重点展示 M0-001：

- `FileController.upload`
- `ObjectStorageClient.putObject`

重点展示 M0-005：

- `UserController.createUser`
- `users.email_unique`

### 3.4 代码证据校验（历史记录），2 分钟

旧 M0 校验器已移除。本节仅说明历史演示曾检查案例数量、仓库路径、commit、文件、行号和符号；新的试点应使用当前 Gateway/SQLite 流程。
历史仓库映射说明已归档；当前流程不再使用 `--repo-root`。
新的试点应遵循根目录 `README.md` 中的 Gateway/SQLite 测试流程。

### 3.5 展示样例 Artifact，3 分钟

展示路径：

```text
examples/m0/artifacts/
```

重点文件：

- `examples/m0/artifacts/M0-001.json`
- `examples/m0/artifacts/M0-005.json`

讲解词：

> 每个样例 Artifact 包含三类产物：RequirementSpecification、ArchitectureSpecification 和 DecisionRecord。M0 的重点不是文档好看，而是这些产物能结构化校验、能引用证据、能进入评审。

重点说明：

- `requirementSpec` 表达需求边界、NFR、验收条件、假设和开放问题。
- `architectureSpec` 表达组件变更、运行流、数据流、部署影响、风险和证据引用。
- `decisionRecord` 表达决策问题、候选方案、约束、质量属性、后果和复审触发条件。

### 3.6 展示追踪矩阵和 Design Package，2 分钟

展示文件：

- `examples/m0/design-package/traceability.json`
- `examples/m0/design-package/manifest.json`

讲解词：

> 追踪矩阵把需求、领域概念、架构组件、API、数据、决策和证据连起来。manifest 则记录需求基线、代码基线、Schema、Artifact、Skill、MCP 和验证命令。这是后续设计归档和审计的基础。

历史 Design Package 校验器已移除；manifest 与追踪矩阵仍作为归档材料供人工检查。
> 历史归档材料记录 Design Package 的引用关系；当前不再执行旧校验器。

### 3.7 结论，1 分钟

讲解词：

> M0 本地 PoC 已经证明技术链路可行：需求可以被结构化，设计可以绑定代码证据，重大决策可以被记录，追踪矩阵和 Design Package 可以被校验。下一阶段不应直接大规模做平台，而是替换为真实企业仓库和真实历史需求，验证人工修改比例和架构师接受度。

建议结论：

> 批准进入真实企业试点仓验证；暂不直接进入完整 M1 平台开发。

## 4. 历史演示命令

旧 M0 校验命令已移除；`pilot-backend`、案例和 Design Package 仅作为历史材料保留。

## 5. 演示时必须主动说明的限制

- 当前仓库是本地样例，不是真实企业存量仓库。
- 当前 Artifact 是人工构造样例，不是模型自动生成结果。
- 当前校验器验证证据链和归档结构，不验证设计质量本身。
- 当前没有实现 Agent Runtime、MCP Gateway、Platform API、审批和审计服务。
- 进入 M1 前仍需真实仓库、真实需求和人工评审数据。

## 6. 推荐会后动作

1. 用 `docs/m0-review-checklist.md` 完成人工评审。
2. 记录是否认可 M0 本地 PoC 链路。
3. 等真实仓库具备后，用 `--repo-root` 替换试点仓库路径。
4. 将真实试点结果回填到 M0 评审报告。
