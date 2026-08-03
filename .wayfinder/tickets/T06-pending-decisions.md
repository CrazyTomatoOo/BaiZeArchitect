# T06 — 待决策项页(critic + 审批 + 人工)`wayfinder:prototype`

status: closed
assignee: pi(UI built)
blocked-by: T02

## Question

待决策项(pending decisions)的聚合与解决流:

- 来源:critic findings(严重度/置信度)+ approval gate(pending design-package)+ 人工手动添加。
- 统一 decision 实体(来源/标题/严重度/状态 open/resolved/关联需求或 package)。
- 解决交互:approve/reject/补充意见 → 写回(更新 package 审批态 / 记 resolution)。
- 页内按严重度/来源筛选、排序。

产出:原型页 + gateway /api/decisions CRUD + resolve。
