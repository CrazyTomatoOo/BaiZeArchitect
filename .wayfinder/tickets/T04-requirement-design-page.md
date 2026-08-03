# T04 — 需求设计页:5 阶段进展 + 资产 + 逐阶段触发 `wayfinder:prototype`

status: open
assignee: (unclaimed)
blocked-by: T01, T02

## Question

需求设计页如何呈现一个需求的设计进展并驱动逐阶段工作流:

- 阶段条(录入→分析→场景→用例→功能分解)各态(未开始/进行中/待审/完成)可视化。
- 每阶段产物(场景/用例/功能)在页内展示(来自资产库)。
- "触发本阶段 agent run" 按钮 → 调 gateway → agent 产出本阶段资产入 store → 人工审 → 推进。
- 与现有 run/watch(ws 事件流)的整合(阶段 run 复用 ws 流)。

产出:原型页 + gateway /api/requirements/:id/stage/:stage/run。
