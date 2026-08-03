# T07 — 逐阶段 agent pipeline → store `wayfinder:task`

status: open
assignee: (unclaimed)
blocked-by: T01, T02

## Question

把 5 阶段工作流接到 agent(扩展现有 runDesign),每阶段人工触发、产物入 store:

- 每阶段 = 一次 agent run,输入=需求+上游资产+repo 证据,输出=本阶段资产
  (分析→需求分析结论;场景→场景库条目;用例→用例库条目;功能分解→功能域/功能项)。
- 复用现有 customTools(submit_plan 模式)→ 新增 submit_stage_assets 工具,结构化收资产。
- 产物写 SQLite store(T02)+ 阶段态推进(待审→人工审→完成)。
- ws 事件流复用(阶段 run 实时可视)。

这是 task(做而非决定):实现 pipeline;答案记录做法与 store 写入事实。
