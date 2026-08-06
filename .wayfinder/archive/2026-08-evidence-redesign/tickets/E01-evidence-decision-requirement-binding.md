# E01 — 证据/决策绑需求 + 归档资产化 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by:

## Question

证据(架构现状:hotspots/boundaries/clusters)与决策记录(ADR)如何绑定到具体需求的设计流程?子问题:

- **数据模型**:需求的证据是设计时快照(固化该次设计所依据的架构事实)还是实时引用?决策记录(ADR)存哪张表、与 requirement/stage 什么关系?
- **页面**:需求详情页(`baize-requirement` 6 阶段流水线)如何展示"本设计的证据 + 本设计过程的决策"?证据/决策是否成为流水线的一环(如某阶段的产物或依据)?
- **归档**:设计归档后,决策记录如何资产化(进资产库?哪个 tab?ADR 复用池?)?归档触发点(approve 末阶段?)?

输入:用户方向①③;`baize-requirement` 现有 6 阶段;`baize-dashboard` 现证据页独立(与本需求脱钩)。

## Resolution(2026-08-06,grilling 4 答)

- **证据 = 按需求的设计时快照**:冻结该次设计所依据的架构事实,新增快照绑定(req-keyed);审核时看到的就是 AI 当时看到的。不取实时引用(与"证据=审核依据"初衷相悖)。
- **决策记录 = 设计包**:绑 requirement id(不再只 repo+ts);归档设计包入资产库后**反过来喂下次设计输入,替代 repo 级 priorAdr**(`evidence/<repo>.json.priorAdr`),成闭环。
- **页面 = 织入流水线**(符合①):证据快照=设计起点「依据」(详情顶/分析阶段卡显示该设计所依据的事实);设计包=**归档阶段产物**(阶段产物列表 + 可展开 rendered 阅读,用 E05 的 `baize-markdown`)。
- **归档 = archive 阶段 approve 触发**(末阶段,设计包此时落库);设计包(决策记录)+ gene **进现有资产库扩 tab**(具体 tab 划分交 E04/E06,不另起独立「沉淀」区)。

实施含义(交实施 effort,非本图):新增 req↔evidence 快照表/字段;设计包 req-keyed;资产库加决策记录+gene tab;priorAdr 输入源从 repo 级迁到资产库。
