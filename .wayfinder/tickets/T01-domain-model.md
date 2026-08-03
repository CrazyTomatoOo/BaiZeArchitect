# T01 — 领域模型:需求/场景/用例/功能(域/项)实体 + 5 阶段态 `wayfinder:grilling`

status: open
assignee: (unclaimed)
blocked-by: —

## Question

定义需求工程工作台的实体模型与关系,使 5 阶段工作流与资产库有统一 schema:

- 需求(Requirement):字段(id/title/description/workspace/状态)、与 repo 的关系。
- 场景(Scenario)、用例(UseCase)、功能(Function:功能域 FunctionDomain + 功能项 FunctionItem)
  各自的字段与父子/引用关系(需求→场景→用例→功能分解)。
- 5 阶段(录入→分析→场景→用例→功能分解)在需求上的进度态如何表示
  (每阶段:未开始/进行中/待审/完成;产物指向对应资产)。
- 资产库(场景库/用例库/功能库)是跨需求复用池还是按需求分组?

产出:实体关系图 + 每实体字段清单(供 T02 落 SQLite schema)。用 /domain-modeling。
