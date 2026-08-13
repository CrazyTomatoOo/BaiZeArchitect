# 11 — 认证 Operator 并开放统一 Command 资源

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 在测试服务器装配中开放最终公开传输边界：可信 Operator Session、原子 Requirement 创建和一个统一幂等 Workflow Command 资源，而不是为每个操作继续增加临时 Route。

**Blocked by:** 10 — 从十一项 Readiness 生成不可变 ApprovalPacket

**Status:** ready-for-agent

- [x] Bearer bootstrap 在配置凭据时完成认证，并建立 HttpOnly、SameSite=Strict、TLS 下 Secure 的同源 Operator Session cookie；EventSource 可使用该 cookie。
- [x] ActorRef 与 `workflow:operate` / `workflow:approve` capabilities 只来自服务端配置和 Session，request body 中 actor 被拒绝。
- [x] 公开 Requirement creation 通过 HTTP 原子产生完整 pending Workflow，并返回 requirementId、workflowId、state、version 和 lastEventSeq。
- [x] 所有治理操作使用 `PUT /api/workflows/:workflowId/commands/:commandId` 的封闭 envelope；不存在通用 status patch。
- [x] Command transport 区分 malformed/unauthenticated/unknown resource 与应持久化 Receipt 的 accepted/denied/conflict/rejected 结果。
- [x] 同 commandId 重放、不同 digest 冲突、expected Workflow/subject version 与 digest 冲突均保持既定 HTTP 与 Receipt 语义。
- [x] 非 loopback 绑定必须配置 Bearer token；客户端不能通过生产接口选择 Scripted Model Driver。
- [x] 新 server assembly 仅用于测试，生产 Gateway main 在 S7 前仍不注册这些 Route。
