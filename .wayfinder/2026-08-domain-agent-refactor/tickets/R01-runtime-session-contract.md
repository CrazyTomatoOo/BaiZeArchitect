# 首版运行边界与设计会话契约 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by:

## Question

首版 BaiZe 的“持续运行、但非通用 Agent”具体运行契约是什么？需要共同确定：

- 一个设计会话的身份、开始/暂停/恢复/结束边界，以及 Requirement、Workspace、Session、Run 的关系；
- Gateway 是否成为唯一入口，CLI 的最终定位；
- Agent 可自主做哪些领域动作、何时必须向人请求信息或审批；
- 是否采用“一个主设计 Session + 隔离评审 Run”的模型；
- session、run、event 和 checkpoint 的最小持久化语义。

输出应成为后续数据模型、工具策略和迁移计划的约束，而不是实现细节。

## Resolution（2026-08-07）

1. **Gateway 唯一入口，CLI 退役为客户端**：`gateway.ts` 是唯一长期运行进程；`cli.ts` 不再独立跑 architect+critic 流水线，降级为调用 Gateway API 的调试/一次性客户端；删除 `server.ts` 旧 `/runtime/plan`。
2. **一个 Requirement = 一个持久主会话**：pi JSONL 会话与 Requirement 绑定，澄清、调查、起草、评审在同一上下文延续；会话在归档后转为只读。
3. **一 Session 顺序多 Run，归档后只读**：主会话在其生命周期内顺序执行多个 Run（每次 prompt/steer 一个 Run）；Run 完成后会话继续存活，下次输入开新 Run；归档后主会话冻结。
4. **异步 Run，可恢复，事件可重放**：Run 先落库再执行；支持取消、重试、steering；SSE 按 Run 订阅且事件持久化可重放；重启后“运行中”的 Run 收敛为失败可重跑。Pi 管对话 transcript，BaiZe SQLite 拥有 Run/事件/锁/审批状态。
5. **证据驱动门禁**：Agent 可自主澄清、查代码、起草/修改 Artifact、发起评审、记录 Finding；仅在 `raise_decision`（重大/不可逆）、最终归档和阻塞裁决时阻塞人；日常打回不强制逐阶段审批。
6. **Critic = 主会话内隔离子 Run**：需要独立判断的角色（首版 Critic）在主会话内开隔离子 Run（独立 pi session、只读上游 Artifact），用完即弃，不污染主会话上下文；不做多 Agent 平台。
