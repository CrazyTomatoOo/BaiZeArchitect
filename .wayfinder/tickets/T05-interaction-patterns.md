# T05 — 交互模式 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by: T01, T02

## Question

BaiZe web 采用哪些交互模式?

- 实时性:ws 事件流在新 UI 如何呈现(阶段 run 进度、流式输出)。
- chat 式交互:需求录入/对话式触发是否进入 IA(现无 chat)。
- 命令面板/键盘操作:要不要、覆盖哪些命令。
- 审批/待决策的交互流(现:pending 列表 + approve 按钮)。
- 浏览器本地 UI 状态(主题/偏好)存哪(参考 OpenClaw localStorage 做法)。

产出:交互模式决策清单。

## Resolution(2026-08-05,grilling 5 答)

- **实时性**:ws 真流式 + run rail。gateway 新建 ws 通道(现状纯 HTTP,需补基建),token/事件级流式进 400px 右列 rail;窄屏收成 compact pill;切页不丢(display:none 保活)。
- **chat**:需求录入 chat 化 —— agent 反问澄清 → 收敛为结构化需求(替代纯 textarea 表单)。
- **键盘**:⌘K 命令面板(切页/切 workspace/新建需求/触发阶段 run)+ ⌘B 折叠 sidebar + Esc 退出浮层;不占浏览器原生键。
- **审批**:consent gate ——「通过」弹本阶段产物摘要 + 确认;「打回」保留意见框;琥珀 attention chip 任意页直达待决策。
- **状态分界**:OpenClaw 分界线 —— UI 偏好(上次页/折叠态/rail 态)存 localStorage,键带版本号 `baize.ui.v1.*`;领域数据全走服务端。
