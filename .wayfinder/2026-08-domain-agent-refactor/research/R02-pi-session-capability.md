# Pi SDK 会话持久化与流式执行可行性

## 结论

已安装的 Pi SDK 0.83.0 可提供 JSONL 会话树持久化与恢复、事件订阅、取消和 steering；BaiZe 不应继续使用 `SessionManager.inMemory`。但 Pi 不是 BaiZe 的运行控制面：运行、授权、并发、审计与 SSE 重放仍须由 Gateway + SQLite 负责。

## 可直接复用的能力

- `SessionManager.create/open/continueRecent/list`：JSONL 会话树创建、打开、续接；`createAgentSession` 可从 manager 恢复消息、模型和 thinking。
- `session.subscribe(listener)`：提供消息、工具、turn、队列与 agent 生命周期事件；可用于生成 Run Event。
- `session.abort()`：中止当前操作并等待 idle；`dispose()` 也会 abort。
- `session.steer()`、`followUp()` 及 `prompt(..., { streamingBehavior })`：可让执行中的会话接收新输入。steer 在当前 assistant turn 的工具调用完成后、下一次模型调用前生效，并不立即打断工具调用。

## BaiZe 必须自建的控制面

- `runId → piSessionFile/sessionId`、需求/模型/Skill 快照与运行状态。
- 用户、权限、审批、同需求并发锁、取消/steer 的 HTTP 契约。
- 递增事件序号、SSE 重放和进程重启后的运行收敛。
- 对进程死亡时 in-flight 模型或工具调用的失败处理；Pi 只能恢复已经落盘的上下文。

## 最小落地建议

1. 创建 Run 时改用 `SessionManager.create(repoPath, BAIZE_SESSION_DIR)`，将 session 文件与 id 写入 SQLite。
2. 恢复时使用 `SessionManager.open(savedFile, BAIZE_SESSION_DIR, repoPath)` 后交给 `createAgentSession`。
3. Gateway 只在内存维护活动 Run 的 `{ session, unsubscribe }`；增加 `steer` 与 `cancel` 端点，分别委托 `session.steer()` 与 `session.abort()`。
4. 用 `session.subscribe` 映射为按 Run 持久化的事件；删除全局 `Set<ServerResponse>` 广播。
5. 将 Session 生命周期从 `runStage` 的 `finally dispose()` 上移到 Gateway Run 生命周期。

## 证据

- 当前实现：`agent-runtime/cli.ts:711-815`、`agent-runtime/gateway.ts:607-616`。
- 已安装 SDK：`agent-runtime/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts`、`agent-session.d.ts`、`agent-session.js:983,1165`。
- 官方资料：<https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/docs/sdk.md>、<https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/src/core/session-manager.ts>、<https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/src/core/agent-session.ts>。

## 不确定性

尚未对真实模型 provider 进行取消与 steering 时延测试；不同 provider 对取消时延和 `sessionId` 亲和的支持不同。
