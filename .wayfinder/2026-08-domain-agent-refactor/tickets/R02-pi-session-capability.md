# Pi SDK 会话持久化与流式执行可行性 `wayfinder:research`

status: closed
assignee: pi(research)
blocked-by:

## Question

Pi SDK 当前版本能原生提供哪些可用于 BaiZe 首版的会话持久化、恢复、事件订阅、工具执行中断和 steering 能力？哪些状态必须由 BaiZe 自己保存？

调研须基于已安装 SDK 类型、源码或官方文档，给出：

- 可复用的原生能力及 API 证据；
- 不能依赖的能力；
- 推荐的最小 Session/Run/Event 持久化边界；
- 对 `SessionManager.inMemory`、`createAgentSession`、SSE 实现的替换或封装建议。

不实现代码；结论供“首版运行边界与设计会话契约”与后续迁移决策使用。

## Resolution（2026-08-07）

Pi 0.83.0 原生支持 JSONL 会话创建/恢复、订阅、取消和 steering；首版应使用其 JSONL 作为 Agent transcript，而由 BaiZe SQLite 持久化 Run、会话映射、锁、审批与可重放事件。不可依赖 Pi 恢复进程死亡时的 in-flight 调用。详细结论：[调研记录](../research/R02-pi-session-capability.md)。
