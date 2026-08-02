# M0 人工评审清单

本清单用于评审 M0 技术验证是否可以进入真实企业试点仓验证，或进一步进入 M1 平台骨架开发。

## 1. 基本信息

| 项目 | 填写 |
|---|---|
| 评审日期 |  |
| 评审人 |  |
| 评审角色 | 产品 / 架构 / 后端 / Agent / 安全 / 测试 / 运维 |
| 评审对象 | M0 本地 PoC |
| 评审结论 | 通过 / 有条件通过 / 不通过 |

## 2. 快速验收

评审前执行：

```bash
uv run scripts/validate_m0.py
uv run scripts/validate_m0_package.py
```

| 检查项 | 通过 | 备注 |
|---|---|---|
| M0 baseline 校验通过 |  |  |
| M0 package 校验通过 |  |  |
| 5 个案例存在 |  |  |
| 每个案例至少 2 条代码证据 |  |  |
| 证据绑定真实 commit |  |  |
| 证据文件和行号有效 |  |  |
| 至少 2 个完整 Artifact 案例 |  |  |
| Design Package manifest 存在 |  |  |
| TraceabilityMatrix 存在 |  |  |

## 3. 需求 Artifact 评审

| 检查项 | 通过 | 备注 |
|---|---|---|
| businessGoal 清晰 |  |  |
| scope.included / scope.excluded 边界明确 |  |  |
| 功能需求可转为开发任务 |  |  |
| NFR 不空泛 |  |  |
| 验收条件可测试 |  |  |
| 假设与开放问题明确 |  |  |
| 不把聊天记录作为唯一状态 |  |  |

## 4. 架构 Artifact 评审

| 检查项 | 通过 | 备注 |
|---|---|---|
| systemContext 能说明变更位置 |  |  |
| componentChanges 能指导开发 |  |  |
| runtimeFlow 与代码证据一致 |  |  |
| dataFlow 不凭空创造字段 |  |  |
| deploymentImpact 可信 |  |  |
| qualityAttributeResponses 与需求相关 |  |  |
| risks 不是泛泛而谈 |  |  |
| evidenceRefs 足以支撑关键结论 |  |  |

## 5. 决策记录评审

| 检查项 | 通过 | 备注 |
|---|---|---|
| 决策问题是真实权衡 |  |  |
| 至少两个候选方案 |  |  |
| 每个方案有优缺点 |  |  |
| 约束和质量属性明确 |  |  |
| 后果和风险可理解 |  |  |
| reviewTriggers 可操作 |  |  |
| 没有自动替代人工重大决策 |  |  |

## 6. 代码证据评审

| 检查项 | 通过 | 备注 |
|---|---|---|
| repositoryId 合理 |  |  |
| commitSha 可追溯 |  |  |
| filePath 指向正确模块 |  |  |
| symbol 与设计结论相关 |  |  |
| lineStart / lineEnd 范围合适 |  |  |
| claim 没有超出证据能证明的内容 |  |  |
| 证据覆盖关键结论而非装饰性引用 |  |  |

## 7. 追踪矩阵评审

| 检查项 | 通过 | 备注 |
|---|---|---|
| 需求能追踪到架构组件 |  |  |
| 架构组件能追踪到 API 或数据 |  |  |
| 决策能追踪到需求或证据 |  |  |
| 证据引用没有断链 |  |  |
| 追踪关系对开发和测试有帮助 |  |  |

## 8. 人工修改量评估

| Artifact | 是否可接受 | 大幅重写比例估计 | 主要修改点 |
|---|---|---:|---|
| M0-001 RequirementSpecification |  |  |  |
| M0-001 ArchitectureSpecification |  |  |  |
| M0-001 DecisionRecord |  |  |  |
| M0-005 RequirementSpecification |  |  |  |
| M0-005 ArchitectureSpecification |  |  |  |
| M0-005 DecisionRecord |  |  |  |

M0 进入真实企业试点建议门槛：人工大幅重写比例不高于 30%。

## 9. 是否进入下一阶段

请选择一个结论：

- [ ] 通过：进入真实企业试点仓验证。
- [ ] 有条件通过：修复以下问题后进入真实企业试点仓验证。
- [ ] 不通过：M0 技术链路不足，需要重做 PoC。

条件或阻塞问题：

| 编号 | 问题 | 严重级别 | 负责人 | 截止时间 |
|---|---|---|---|---|
|  |  | BLOCKER / MAJOR / MINOR |  |  |

## 10. 评审签署

| 角色 | 姓名 | 结论 | 日期 |
|---|---|---|---|
| 产品负责人 |  |  |  |
| 架构负责人 |  |  |  |
| 后端负责人 |  |  |  |
| Agent 工程负责人 |  |  |  |
| 安全/治理负责人 |  |  |  |
| 测试负责人 |  |  |  |
