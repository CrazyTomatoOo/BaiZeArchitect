# 16 — 处理 Gate Queue、恢复选择与 stale 表单

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 让等待、失败、断线和并发变化成为可理解且不会误提交的操作流程：一次处理一个确定性 gate，只显示适用于当前 Incident 的恢复动作，并保护用户尚未提交的输入。

**Blocked by:** 15 — 交付引导式 Workflow 概览与同页详情

**Status:** completed

- [x] Gate Queue 按 critical Decision、required Human Input、major Finding risk disposition、Artifact rejection/command conflict 排序，同级按 openedEventSeq 升序。
- [x] 一次只提交一个 exact subject 的 Command，显示队列位置并允许只读查看全部，但禁止批量 disposition。
- [x] execution、planning、Engine/Outbox Incident 分别只显示其合法 retry/replace/diagnostic 组合。
- [x] Workflow 或 subject SSE 更新使打开的表单 stale 时，冻结提交、保留 draft、显示 expected/actual 差异并要求显式 reload。
- [x] stale draft 绝不自动 rebase 到新 subject，重复提交使用原 commandId/request digest，用户重读后新意图使用新 commandId。
- [x] 双 SSE 任一断开时禁用治理命令、显示 reconnecting；恢复时重放两条流并重新读取 Projection。
- [x] capability denial、version conflict、subject conflict 和 idempotency conflict 在原操作上下文显示，不跳转为通用错误。
- [x] 键盘、focus restoration、dialog labeling、live-region stale/reconnect/receipt announcements 可访问。
- [x] Playwright 覆盖 waiting Gate→Receipt、failed recovery、paused stale、断线重连和桌面/平板/手机 viewport。
