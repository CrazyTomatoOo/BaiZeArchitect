# T01 — 领域模型:需求/场景/用例/功能(域/项)实体 + 5 阶段态 `wayfinder:grilling`

status: closed
assignee: pi(grilling resolved)
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

## Resolution(领域模型,grilling 四答)

实体(workspace=1 repo;资产=workspace 级复用池):
- Workspace{id,repoPath,name}
- Requirement{id,workspaceId,title,description,source}
- StageProgress{requirementId,stage∈[录入,分析,场景,用例,功能分解],status∈[未开始,进行中,待审,完成],artifactRefs}
- Scenario{id,workspaceId,title,description}(复用池;Requirement M↔N Scenario)
- UseCase{id,workspaceId,scenarioId,precondition,mainFlow,exceptions,postcondition}(Scenario 1→N)
- FunctionDomain{id,workspaceId,name,description}
- FunctionItem{id,workspaceId,domainId,description}(Domain 1→N;UseCase M↔N FunctionItem)

关系链:需求→(场景分析)→场景→(用例分析)→用例→(功能分解)→功能项→功能域。
阶段产物:录入=Requirement;分析=分析结论(范围/约束/风险);场景=Scenario 条目;用例=UseCase 条目;功能分解=Domain/Item。
推进:run 产出→待审→人工审(可改)→完成→解锁下一阶段。
供 T02 落 SQLite schema(better-sqlite3 v13)。
