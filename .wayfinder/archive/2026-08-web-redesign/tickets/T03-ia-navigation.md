# T03 — 新信息架构/导航结构 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by: T01, T02

## Question

BaiZe web 的新 IA/导航怎么组织?输入:T01/T02 调研 + 现有页(需求/工作区/总览/决策/dashboard)。

- 导航形态:tab 条 → sidebar?分区怎么切(工作区/需求/资产库/决策/系统)?
- 页面清单与层级:哪些页合并、拆分、新增;旧 baize-dashboard 的归宿。
- 作用域概念:OpenClaw 的 agent 作用域、Hermes 的 profile/machine 分层,在 BaiZe 对应什么(workspace? requirement?)。
- 默认落地页与新/老用户旅程是否变化(现:新用户 工作区→需求,老用户直接进需求)。

产出:IA 决策(导航结构 + 页面清单 + 用户旅程),作为方案文档骨架。

## Resolution(2026-08-05,grilling 4 答)

- **导航**:tab 条 → 左侧 sidebar。顶部 = 当前 workspace 切换器;中部页面三区;底部常驻系统状态区(ws 连接、运行中 run 数 —— 借 Hermes 常驻区)。
- **页面(6 页三区)**:工作 —— 需求(列表+详情,6 阶段流水线)、**资产库(新增)**:场景·用例·功能 workspace 复用池、总览;治理 —— 待决策(pending+approve,琥珀 attention chip 提醒,借 OpenClaw);管理 —— 工作区(CRUD)、系统(收编旧 baize-dashboard:证据/ADR/gene + 设置)。
- **作用域**:workspace 单作用域,全站页面随之过滤;切非默认 workspace → Hermes 防歧义三连(switcher 变色 + amber banner + `?workspace=` 深链)。需求是列表项,不当全局作用域。
- **落地页**:localStorage 记住上次页(借 OpenClaw ui.prefs 做法);首次访问 —— 有 workspace → 需求页,无 → 工作区页。
