# 自动工作流与人工接管交互原型 `wayfinder:prototype`

status: closed
assignee: pi(prototype with user)
blocked-by: [人工接管、决策与审批语义](A05-human-takeover-and-approval-semantics.md), [编排持久化、API、事件与恢复契约](A06-persistence-api-events-and-recovery.md)

## Question

Web 需求页应如何从“手动选择角色并启动 Run”转为“开始/继续自动工作流”，同时让用户清楚看到当前状态、下一任务、证据、阻塞原因和接管入口？原型需要验证：

- 主操作、暂停/继续/取消、补充信息、处理 Decision、接受风险和请求归档的层级；
- Plan、Task、Run、Artifact 与 Finding 在同一需求页中的信息层次；
- 正常自动路径是否隐藏角色选择，高级接管如何暴露且明确审计后果；
- waiting_for_human、rework_required、failed、ready_to_archive 等状态的可理解反馈；
- 页面如何以 Workflow 当前投影 + 独立 Workflow/Run SSE 恢复状态，展示 stale command receipt/recovery incident，并通过 operator session cookie 让 EventSource 安全重连；
- 删除 Reviewer Agent 后，人工审批材料和最终确认界面如何呈现。

输出应链接低成本交互原型和经用户确认的行为规格，不直接实现正式 UI。

## Resolution（2026-08-11）

用户已通过三变体原型逐项评审并确认本契约。原型是 throwaway 讨论资产，不是正式 UI 实现：

- [可交互原型](../prototypes/operator-experience/index.html)
- [运行与评审说明](../prototypes/operator-experience/README.md)
- [机器可读交互契约](../assets/operator-experience-v1.json)

### 1. 默认信息架构

- 采用原型 **B「引导式焦点」**作为需求详情页默认视图；首屏只呈现 Workflow 状态、当前含义、一个主动作和五段进程故事。
- Plan、Task、Run、Artifact revision、Decision/Finding/Evidence 及高级接管使用原型 A 的信息结构，但通过“工作流详情”在当前需求页内展开，不跳出当前 Requirement 上下文。
- 原型 C 成为独立审计视图，承载 Workflow/Run 事件、Command Receipt、Incident、版本、digest 和游标，不作为默认操作台。
- URL 必须保存可恢复的视图状态，例如 `panel=summary|workflow|approval`；刷新或分享链接不得丢失当前层级。
- 正常路径永久删除角色选择、自由 Run prompt 和 Reviewer 入口。用户操作 Workflow，不手工串联 Agent。

### 2. 一个状态只给一个主动作

| Workflow / Task 投影 | 默认主动作 | 含义 |
| --- | --- | --- |
| `pending` | 开始自动设计 | 发出一次显式 `start`；之后默认自动推进 |
| `running` | 查看后台进度 | 只展开同页详情，不发送治理命令 |
| `waiting_for_human` | 处理当前门禁 | 进入确定性 Blocking Gate 队列 |
| `paused` | 继续自动执行 | 发出 `resume`；若本地底稿 stale，则改为“检查变化并恢复” |
| `failed` | 查看故障并恢复 | 只显示与 Incident class 合法的恢复方式 |
| `ready_to_archive` | 审阅并批准设计包 | 进入同页专注审批模式 |
| `archived` | 查看已归档设计包 | 只读 Design Package，无治理命令 |
| Task `reworking/reviewing` 投影 | 查看 Finding Thread | 查看返工/验证事实，不直接改变 Workflow |

- 默认页不常驻命令工具栏。pause 只在工作流详情显示；cancel-run 只在当前 Run 详情显示。
- steer、完整 replace-plan、只读 diagnostic-run 统一放入“高级接管”，并在执行前解释审计和失效影响。
- 不出现 force-skip、force-ready、治理型 force-role 或任意 PlanPatch。

### 3. 同页工作流详情

展开区域按稳定顺序展示：

1. 当前 PlanRevision 与 Task 稳定拓扑顺序；
2. 当前 Attempt/Run、Context digest、模型/工具执行状态；
3. Required Artifact revisions、Evidence 和审批状态；
4. Decision、Finding Thread、Blocking Gate 与 Consistency/Readiness；
5. pause/cancel 和高级接管；
6. 指向完整审计视图的入口。

展开/收起只改变客户端视图，不发送 Workflow Command。running 默认仍明确提示“无需操作，系统会自动继续”。

### 4. 多重 Blocking Gate

- waiting 主动作打开确定性单项队列；一次只处理一个精确 subject，但允许查看完整待处理列表和当前位置。
- 排序固定为：critical Decision → 必填 Human Input → major Finding 风险处置 → Artifact rejection/command conflict 恢复；同级按 `openedEventSeq` 升序。
- 每项表单固定 subject id/version/digest，使用独立 commandId 和 receipt；不把多项回答、Decision disposition 或 Approval 批量合并。
- HumanResponse 只解决当前 Gate；Requirement 修订必须进入独立 `revise-requirement` 流程，界面不得从自然语言回答猜测修订意图。

### 5. Workflow Projection、双 SSE 与断线恢复

- 页面首次读取当前 Workflow Projection，再分别订阅 Workflow SSE 与活动 Run SSE；两个流各自保存并提交 `afterSeq`。
- 普通状态、Task、Run、Artifact 和事件可实时更新；SSE 时间戳不作为排序依据。
- 任一流断线时显示 reconnecting，并禁用所有治理命令；恢复时先补齐两个事件流，再重新读取当前 Projection，最后重新启用动作。
- cursor 过旧、事件缺口或 server boot/recovery 未完成时必须整体重取 Projection，不能用局部客户端推断修补状态。
- Operator 身份来自 Bearer bootstrap 换得的 HttpOnly、SameSite=Strict Cookie；EventSource 使用该 Cookie，UI 不允许提交 actor 或 capability。

### 6. 正在编辑的 subject 变为 stale

- 打开门禁、Decision、风险接受、Artifact/Packet 审批表单时固定当时的 subject version/digest。
- 若 SSE 表明相关对象变化，立即锁定提交，保留尚未提交的用户输入，并展示 expected/actual version 与变化摘要。
- 用户必须先“查看变化并重载”，再明确决定是否把原输入重新应用到新 subject；客户端永不自动 rebase，也不把旧命令重放到 latest。
- ApprovalPacket stale 时锁定整页专注审批模式，禁用批准与拒绝，直到新 Packet 完整加载。

### 7. Command Receipt 与状态反馈

- 人工动作打开时创建 commandId；重复点击、网络超时或页面恢复必须复用同一 commandId 和 request digest。
- 提交后不做乐观 Workflow 状态跳转。先显示持久 Command Receipt：`accepted` 只表示命令事务已提交，真实状态仍由 SSE/Projection 决定。
- `rejected/conflict` 在原动作上下文展示 expected/actual version、业务原因和重新读取入口；不生成第二条隐式命令。
- 网络结果不明时查询或重新 PUT 同一 Command Resource。审计视图允许复制 commandId、request digest、workflowVersion、eventSeq 与 incidentId。
- 外部副作用仍在执行时，界面区分“命令已接收”“正在执行”“投影已更新”，不把三者压成一个成功 toast。

### 8. 专注 ApprovalPacket 审批

- `ready_to_archive` 主动作在同一需求页进入完整审批模式，不使用摘要弹窗或 Reviewer 建议。
- 顶部固定当前 packetId/version/digest、Workflow version、生成时间和 PolicyBundle 版本。
- 正文依次展示 Required Artifact revisions、Decision dispositions、Finding/风险接受、Critic coverage、Consistency warning/info、11 项 Readiness、Schema/Policy 版本以及 provenance/transcript 链接。
- “批准并归档”固定在页面底部，绑定当前完整 digest；无需无意义的逐项确认框。
- “打回”是次级动作，必须选择至少一个结构化 target 并填写 reason；任何 stale 事件都立即禁用两个动作。

### 9. 故障与恢复呈现

| Incident class | 可显示恢复动作 |
| --- | --- |
| 执行/Attempt 失败 | `retry-task`（若策略允许）、replace-plan、diagnostic-run |
| Planning 失败 | `retry-planning`、replace-plan、diagnostic-run |
| Engine/Outbox recovery Incident | `retry-recovery`、diagnostic-run |

- UI 不能对错误类别展示无效恢复命令，也不能把 diagnostic-run 描述成修复动作。
- failed 页面先解释哪些事实已发布、哪些暂存副作用已丢弃、预算是否消耗，再显示恢复选项。

### 10. 对正式实现与切换的约束

- 「自动编排切换与旧路径删除策略」必须删除当前需求页的角色下拉、自由 prompt、手工 Run 主流程、Reviewer 和直接 archive；不保留隐藏兼容入口。
- 正式 Web 使用现有设计系统重建本信息架构，不复制原型的静态 HTML、mock 数据或样式。
- 「实施切面、测试矩阵与发布门禁」至少覆盖：各 Workflow 状态主动作、同页详情、门禁队列、双 SSE 补流、断线禁用、stale 表单保留、receipt accepted/rejected/conflict、Incident 恢复矩阵、Packet stale 锁定及最终审批 digest。
- 首版不在 UI 中加入自学习建议、自动风险接受、模型审批意见或角色运行调参。
