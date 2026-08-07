# 领域工具、Skill 与证据策略 `wayfinder:grilling`

status: open
assignee:
blocked-by: [首版运行边界与设计会话契约](R01-runtime-session-contract.md), [Pi SDK 会话持久化与流式执行可行性](R02-pi-session-capability.md)

## Question

首版需求设计 Agent 需要哪些受限工具和可组合 Skill，才能自主完成澄清、代码调查、设计修改、校验和人工升级，同时不退化为通用 coding agent？需要决定：

- 面向代码知识、设计记忆、Artifact、Decision、Review 的工具表面及输入输出；
- 是否禁用原始 shell，何时提供只读 repository inspection；
- 角色模式与 Skill 的关系、版本和输入输出校验；
- 证据如何进入推理上下文并如何被 Artifact/Decision 引用；
- 工具权限、超时、结果裁剪和审计边界。

产出是受控工具目录与策略，不实现 MCP 平台。
