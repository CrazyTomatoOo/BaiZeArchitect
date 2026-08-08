# M0 技术验证评审报告

## 1. 评审结论摘要

M0 当前已完成一个可本地复现的技术验证闭环：需求案例、真实本地代码仓、真实 Git Commit、代码证据、样例 Artifact、决策记录、追踪矩阵和 Design Package manifest 均已建立，并可通过 CLI 校验。

本阶段结论：

- M0 本地 PoC 已达到“可提交架构评审”的状态。
- 该 PoC 证明了设计证据链和归档结构可落地。
- 该 PoC 尚不能替代真实企业试点结论，因为当前试点仓库是本地构造样例，不是企业存量系统。

建议：通过 M0 本地 PoC 评审后，进入“真实试点仓验证”；真实试点通过后再启动 M1 平台骨架开发。

## 2. 本次 M0 交付范围

### 2.1 代码与案例

| 交付物 | 路径 | 说明 |
|---|---|---|
| M0 技术验证说明 | `docs/m0-tech-validation.md` | M0 目标、范围、流程、退出条件 |
| 本地试点仓库 | `pilot-backend/` | Java/Go 后端样例仓库 |
| M0 案例集 | `examples/m0/cases.json` | 5 个变更需求案例和代码证据 |
| 样例 Artifact | `examples/m0/artifacts/` | M0-001、M0-005 的需求、架构、决策产物 |
| 设计包 manifest | `examples/m0/design-package/manifest.json` | M0 Design Package 清单 |
| 追踪矩阵 | `examples/m0/design-package/traceability.json` | 需求到证据的追踪关系 |

### 2.2 Schema 与校验器

| 交付物 | 路径 | 说明 |
|---|---|---|
| 需求 Schema | `schemas/requirement-spec.schema.json` | RequirementSpecification 契约 |
| 架构 Schema | `schemas/architecture-spec.schema.json` | ArchitectureSpecification 契约 |
| 决策 Schema | `schemas/decision-record.schema.json` | DecisionRecord 契约 |
| 代码证据 Schema | `schemas/code-evidence.schema.json` | CodeEvidence 契约 |
| 历史 M0 校验器 | 已在当前 Gateway/SQLite 重构中移除 | 保留结构化案例与追踪矩阵作为历史材料 |

## 3. 已验证能力

| 能力 | 状态 | 证据 |
|---|---|---|
| 5 个需求案例 | 已完成 | `examples/m0/cases.json` |
| 每个案例至少 2 条代码证据 | 历史评审材料 | 旧校验器已移除 |
| 证据绑定 repositoryId | 已完成 | `pilot-backend` |
| 证据绑定 commitSha | 已完成 | `3dc359fceb1f` |
| 证据绑定文件、符号、行号 | 历史评审材料 | 旧校验器已移除 |
| 样例需求 Artifact | 已完成 | `examples/m0/artifacts/M0-001.json`、`M0-005.json` |
| 样例架构 Artifact | 已完成 | 同上 |
| 样例决策记录 | 已完成 | `DEC-2026-0001`、`DEC-2026-0005` |
| 追踪矩阵 | 已完成 | `examples/m0/design-package/traceability.json` |
| Design Package manifest | 已完成 | `examples/m0/design-package/manifest.json` |
| CLI 可复现校验 | 历史评审材料 | 旧校验器已移除 |

## 4. 历史验证记录

旧 M0 校验器已在当前 Gateway/SQLite 重构中移除。本节原记录仅作为历史评审结论保留；当前验证入口见根目录 `README.md`。

## 5. 与 SRS 的覆盖关系

| SRS 编号 | 能力 | M0 覆盖状态 | 说明 |
|---|---|---|---|
| FR-006 | 需求结构化 | 部分覆盖 | 通过样例 RequirementSpecification 证明结构可表达 |
| FR-011 | 架构设计 | 部分覆盖 | 通过 ArchitectureSpecification 证明可绑定代码证据 |
| FR-018 | 代码结构索引 | 替代验证 | M0 未实现索引服务，但用真实仓库文件、commit、符号、行号验证证据契约 |
| FR-020 | 代码证据 | 覆盖 | 每个案例至少 2 条代码证据，校验真实存在 |
| FR-022 | 影响分析 | 部分覆盖 | 样例架构产物包含组件变更与风险，但未实现自动影响分析 |
| FR-023 | 决策发现 | 部分覆盖 | 每个案例有决策候选，2 个案例有完整 DecisionRecord |
| FR-024 | 决策管理 | 部分覆盖 | 已定义 DecisionRecord Schema，未实现审批状态机 |
| FR-025 | Artifact 管理 | 部分覆盖 | 已有 Artifact JSON，未实现版本、Patch、diff 服务 |
| FR-026 | 设计归档 | 部分覆盖 | 已有最小 Design Package manifest，未实现对象存储归档 |
| FR-034 | 审计追踪 | 未覆盖 | M0 未实现运行审计事件 |
| AC-001 | 文件上传案例 | 覆盖 M0 样例 | M0-001 已完成需求、架构、决策和证据 |
| AC-004 | 重大存储选型 | 部分覆盖 | M0-001 形成上传方式决策候选 |
| AC-008 | 设计批准归档 | 部分覆盖 | 生成 Design Package manifest，但未实现审批和下载 |

## 6. 当前缺口

### 6.1 技术缺口

- 尚未接入真实 Code Knowledge Service。
- 尚未实现自动 Agent Runtime 或 LangGraph 流程。
- 尚未对 JSON Schema 做完整实例级校验，只做 M0 必需结构检查。
- 尚未实现 Artifact 版本、Patch 和 diff。
- 尚未实现审批、审计、SSE 和运行状态机。
- 尚未接入真实模型、Skill Registry 或 MCP Gateway。

### 6.2 试点缺口

- 当前 `pilot-backend` 是本地构造样例仓库。
- 尚未使用企业真实 Java/Go 存量仓库。
- 尚未由架构师记录人工修改比例。
- 尚未对 30-50 个历史需求建立黄金案例。

## 7. 风险判断

| 风险 | 当前判断 | 建议 |
|---|---|---|
| PoC 过于理想化 | 中 | 必须引入真实企业试点仓库复验 |
| 证据契约不足 | 低到中 | M1 前补充证据类型、置信类型和索引版本 |
| Artifact Schema 过粗 | 中 | M1 前冻结 Schema v0.2，并引入实例校验 |
| 决策记录不可执行 | 中 | M1 需要审批状态机和 supersedes 关系 |
| 平台化过早 | 高 | 真实试点未通过前不建议大规模建设平台 UI |

## 8. M0 退出条件状态

| 退出条件 | 状态 | 说明 |
|---|---|---|
| 至少 5 个案例完成验证 | 已完成 | 5 个本地案例 |
| 每个案例至少 2 条代码证据 | 已完成 | CLI 校验通过 |
| 每条证据包含仓库、Commit、文件、符号和行号 | 已完成 | CLI 校验通过 |
| 每个案例至少产出 1 个架构影响结论 | 部分完成 | 2 个案例有完整架构 Artifact，5 个案例有候选能力与证据 |
| 至少 3 个案例识别决策候选 | 已完成 | 5 个案例均有 decisionCandidate |
| 架构师确认输出可作为设计评审输入 | 待人工评审 | 需使用 `docs/m0-review-checklist.md` |

## 9. 进入 M1 的建议门槛

只有满足以下条件后，才建议进入 M1 平台骨架开发：

1. 至少 1 个真实企业 Java/Go 仓库完成同样校验。
2. 至少 5 个真实历史需求完成案例替换。
3. 架构师确认 2 个完整 Artifact 可作为评审输入。
4. 人工大幅重写比例不高于 30%。
5. 证据引用被评审认为可信。
6. Artifact Schema v0.2 冻结。
7. 明确 Platform API 采用 Java 还是 Go。
8. 明确 Agent Runtime 是否独立 Python 服务。

## 10. 评审建议

建议本次评审只做一个决策：

> 是否认可 M0 本地 PoC 的技术链路，并批准进入真实企业试点仓验证。

不建议本次直接批准进入完整 M1 平台开发。
