# T02 — SQLite store schema + DB 位置 `wayfinder:prototype`

status: open
assignee: (unclaimed)
blocked-by: T01

## Question

把 T01 的实体模型落成 SQLite schema:

- 表结构(requirements/scenarios/use_cases/function_domains/function_items/
  stage_progress/decisions/workspaces)+ 外键/索引。
- DB 文件位置:全局单 DB vs 每 workspace 一 DB(grilling 定 workspace=1 repo)?
- 与现有产物的衔接:design-package(.md)、evidence.json、ADR、gene 如何被引用/关联?

产出:schema DDL + 一个 prototype(store.ts CRUD),验证增删查。依赖 T09 的 SQLite 选型。
