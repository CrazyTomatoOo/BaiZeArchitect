# 17 — 交付专注审批（原含独立审计视图，已作废）

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 为最终真实人工判断提供同页专注 ApprovalPacket 审阅，而不是恢复 Reviewer Agent。（原范围含「完整 Workflow/Run/Receipt/Incident 历史的独立审计视图」——2026-08-18 起作废，审计视图已删除，见 [审计视图删除](../../../.wayfinder/2026-08-audit-view-removal/map.md)。）

**Blocked by:** 16 — 处理 Gate Queue、恢复选择与 stale 表单

**Status:** completed

- [x] ready 主动作进入同页 focused Approval review，展示 exact packet digest、Required Artifact revisions/diffs、Decision、Finding/risk、Critic coverage、Consistency warning/info、Readiness、Policy/Schema 和 provenance/transcript links。
- [x] 批准为明确 sticky primary action，精确绑定 current Packet；打回为 secondary action并要求 reason 与 structured targets。
- [x] Packet SSE stale 时锁定审阅页、禁用批准、保留阅读位置并提供 diff/reload；不能把旧批准意图应用到新 digest。
- [x] approve Receipt 与 archived Projection 分阶段反馈；reject 后呈现自动重新规划或 paused 等待 resume 的实际结果。
- [x] ~~独立审计视图可查看 Workflow events、Run events、Command Receipts、Incidents/recovery、Actor、exact versions 和 digests。~~ **作废 2026-08-18**：审计视图已删除（见上文链接）。
- [x] ~~审计视图支持 SSE replay/reconnect，不把 token 混入 Workflow event 时间线。~~ **作废 2026-08-18**：视图随删；SSE 双流保留于主流程，「token 不混入 Workflow 时间线」约束仍由 stream 测试守卫。
- [x] Web 不包含 Reviewer Agent、角色选择、自由 Prompt Run、direct archive、force-ready 或 force-skip 控件。
- [x] 三 viewport、键盘流程、焦点、dialog/live region 和 ready Packet stale 场景 E2E 通过。
- [x] accepted operator-experience 原型仅作为行为参考，正式页面不依赖其 throwaway 实现。
