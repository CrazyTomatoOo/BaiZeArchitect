# 首版运行边界与设计会话契约 `wayfinder:grilling`

status: open
assignee:
blocked-by:

## Question

首版 BaiZe 的“持续运行、但非通用 Agent”具体运行契约是什么？需要共同确定：

- 一个设计会话的身份、开始/暂停/恢复/结束边界，以及 Requirement、Workspace、Session、Run 的关系；
- Gateway 是否成为唯一入口，CLI 的最终定位；
- Agent 可自主做哪些领域动作、何时必须向人请求信息或审批；
- 是否采用“一个主设计 Session + 隔离评审 Run”的模型；
- session、run、event 和 checkpoint 的最小持久化语义。

输出应成为后续数据模型、工具策略和迁移计划的约束，而不是实现细节。
