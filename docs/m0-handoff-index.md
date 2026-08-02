# M0 交接索引

本文档用于把当前 M0 PoC 交给评审人、演示人或下一阶段执行人。它不是新方案，而是当前 M0 材料的入口地图。

## 1. 当前状态

当前 M0 已完成本地可复现 PoC：

```text
需求案例 → 本地真实 Git 仓库 → 代码证据 → 样例 Artifact → 决策记录 → 追踪矩阵 → Design Package → CLI 校验 → 演示材料
```

当前结论边界：

- 可以用于 M0 技术链路演示。
- 可以提交架构评审讨论。
- 可以作为真实企业试点仓替换前的准备基线。
- 不能声明已经完成真实企业存量系统验证。
- 不建议直接进入完整 M1 平台开发。

## 2. 一键演示入口

执行：

```bash
bash scripts/run_m0_demo.sh
```

该脚本会依次验证：

1. `pilot-backend` 当前 commit。
2. M0 baseline 默认本地仓库校验。
3. M0 baseline 外部路径映射校验。
4. M0 Design Package 校验。
5. Java 样例证据文件编译。

预期最后输出：

```text
M0 demo passed
```

## 3. 材料地图

| 类型 | 路径 | 用途 |
|---|---|---|
| 原始 SRS | `智能需求设计与决策治理Agent_开发输入文档_V0.1.md` | 产品与架构输入基线 |
| M0 技术验证说明 | `docs/m0-tech-validation.md` | M0 范围、流程、退出条件 |
| M0 评审报告 | `docs/m0-review-report.md` | 评审结论、覆盖关系、缺口、M1 门槛 |
| M0 评审清单 | `docs/m0-review-checklist.md` | 人工评审记录模板 |
| M0 演示脚本 | `docs/m0-demo-script.md` | 10-15 分钟演示流程和讲解词 |
| M0 演示 FAQ | `docs/m0-demo-faq.md` | 回答没有真实仓库时的常见质疑 |
| 本交接索引 | `docs/m0-handoff-index.md` | 材料入口地图 |

## 4. 可执行资产

| 类型 | 路径 | 用途 |
|---|---|---|
| 一键演示 | `scripts/run_m0_demo.sh` | 串联 M0 演示命令 |
| M0 baseline 校验 | `scripts/validate_m0.py` | 校验案例、代码证据和 Artifact |
| M0 package 校验 | `scripts/validate_m0_package.py` | 校验 Design Package manifest 和追踪矩阵 |
| 本地试点仓库 | `pilot-backend/` | 模拟 Java/Go 企业存量后端 |

## 5. 结构化资产

| 类型 | 路径 | 用途 |
|---|---|---|
| 案例集 | `examples/m0/cases.json` | 5 个需求案例和真实代码证据 |
| 样例 Artifact | `examples/m0/artifacts/` | M0-001、M0-005 的需求、架构、决策产物 |
| Design Package manifest | `examples/m0/design-package/manifest.json` | 归档包清单 |
| 追踪矩阵 | `examples/m0/design-package/traceability.json` | 需求到证据追踪 |
| Schema | `schemas/` | Artifact 与 CodeEvidence 契约 |

## 6. 评审建议路径

建议按以下顺序评审：

1. 先运行 `bash scripts/run_m0_demo.sh`。
2. 阅读 `docs/m0-review-report.md` 的结论和缺口。
3. 用 `docs/m0-demo-script.md` 走一遍演示。
4. 用 `docs/m0-review-checklist.md` 记录人工评审意见。
5. 只做一个阶段性决策：是否允许进入真实企业试点仓验证。

## 7. 下一阶段决策

### 推荐决策

批准进入真实企业试点仓验证，但暂不直接进入完整 M1 平台开发。

> **更新（2026-07-31）**：M1+M2 已完成（`go test ./...` 213 passed、`docker compose` 全栈端到端 SRS `ready:true`、pi runtime tool-use）。此推荐决策已执行。

### 进入真实试点前需要准备

- 一个可读 Java/Go 企业后端仓库。
- 一个固定 commit。
- 5 个真实历史需求。
- 允许引用文件、符号和行号的代码证据边界。
- 架构师可投入评审并填写人工修改比例。

### 进入 M1 前需要满足（✅ M1+M2 已完成，以下门槛已满足）

- ✅ 真实仓库通过 `--repo-root` 校验。
- ✅ 至少 2 个真实案例 Artifact 被架构师接受。
- ✅ 人工大幅重写比例不高于 30%。
- ✅ Artifact Schema v0.2 冻结。
- ✅ Platform API 与 Agent Runtime 服务边界完成决策。

## 8. 当前不建议做的事

- 不建议先做完整 Web Console。
- 不建议先做复杂 Skill Registry。
- 不建议把本地 PoC 结论包装成真实企业验证结论。
- 不建议在没有真实试点反馈前冻结 M1 数据模型。
