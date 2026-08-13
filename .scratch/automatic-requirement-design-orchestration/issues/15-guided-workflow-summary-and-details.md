# 15 — 交付引导式 Workflow 概览与同页详情

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 把 Requirement 页面变为自动优先的引导式操作界面：用户先理解当前状态和唯一主动作，需要时再在同页展开计划、执行与治理细节。

**Blocked by:** 14 — 分别重放 Workflow 与 Run 事件流

**Status:** completed

- [x] pending、running、waiting_for_human、paused、failed、ready_to_archive、archived 均有清晰状态 hero，正常页面每个状态只显示一个主动作。
- [x] 概览呈现五段设计进程、Artifact 完成摘要、待处理数量和审计摘要，不要求用户选择角色或填写 Run Prompt。
- [x] running 主动作只展开后台进度，不伪装成治理命令；task reworking 投影可进入 Finding Thread。
- [x] Workflow details 在同一 Requirement 页面展开，显示 stable Task order、current Attempt/Run、Artifact revisions、Decision/Finding/Evidence 和 exact versions/digests。
- [x] pause 与 cancel 只在 details 暴露；steer、replace-plan、diagnostic-run 只在高级接管区暴露。
- [x] UI 只调用新 Projection、detail、Command 和双 SSE 契约；不使用旧 Run 列表/创建/steer/cancel/direct archive endpoint。
- [x] Receipt 与 eventual Projection 分别呈现，客户端不做 optimistic governance state mutation。
- [x] Web 单元与 Playwright 覆盖至少 running summary→details、pending start 和 archived package navigation。
- [x] 本票 UI 只在测试装配可访问，生产 shell 在 S7 前不切换。
