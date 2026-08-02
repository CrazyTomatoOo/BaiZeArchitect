# M0 技术验证方案

本目录定义智能需求设计与决策治理 Agent 系统的 M0 技术验证基线。M0 的目标不是交付完整平台，而是证明核心链路可行：输入企业存量系统变更需求后，系统能够形成结构化需求、架构设计、重大决策候选，并把关键结论绑定到代码证据。

## 验证目标

M0 必须回答四个问题：

1. 能否把非结构化变更需求转换为结构化 `RequirementSpecification`。
2. 能否基于代码证据生成 `ArchitectureSpecification`，而不是泛化设计建议。
3. 能否识别关键技术决策并生成 `DecisionRecord` 候选。
4. 能否用统一证据格式绑定 `commitSha`、文件、符号和行号。

## M0 范围

### 范围内

- 单个 Java 或 Go 后端仓库。
- 5 个历史或模拟变更需求案例。
- 3 个首批 Artifact Schema：需求、架构、决策。
- 统一 `CodeEvidence` 结构。
- 离线校验脚本，验证 M0 基线资产完整性。

### 范围外

- 完整平台 API。
- Web Console。
- 多角色完整返工闭环。
- 自动发布 Skill。
- 真实生产系统写操作。

## 交付物

```text
docs/m0-tech-validation.md
schemas/requirement-spec.schema.json
schemas/architecture-spec.schema.json
schemas/decision-record.schema.json
schemas/code-evidence.schema.json
examples/m0/cases.json
scripts/validate_m0.py
```

## 验证流程

1. 选择一个试点 Java/Go 后端仓库，固定 `repositoryId`、`branch` 和 `commitSha`。
2. 为 5 个变更需求补全 `examples/m0/cases.json` 中的真实证据。
3. 使用代码知识工具确认证据中的文件、符号和行号存在。
4. 用 Agent Runtime PoC 生成三个 Artifact：需求、架构、决策。
5. 使用 `scripts/validate_m0.py` 执行离线基线校验。
6. 由架构师审查每个案例的人工修改比例和结论可采纳性。

## 退出条件

M0 通过必须同时满足：

- 至少 5 个案例完成验证。
- 每个案例至少包含 2 条代码证据。
- 每条证据包含仓库、Commit、文件、符号和行号。
- 每个案例至少产出 1 个架构影响结论。
- 至少 3 个案例识别出重大或中等决策候选。
- 架构师确认输出可作为设计评审输入。

## 当前状态

当前仓库尚未绑定真实 Java/Go 试点代码仓，因此本 M0 基线先提供结构化契约、案例模板和离线校验。真实代码证据验证需在选定试点仓库后完成。

## 使用方式

```bash
uv run scripts/validate_m0.py
```

脚本会检查 Schema、案例数量、证据结构、决策候选和退出条件覆盖情况。
