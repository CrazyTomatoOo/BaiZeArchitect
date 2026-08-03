# Wayfinder Map — BaiZe 需求工程工作台 `wayfinder:map`

## Destination

需求工程工作台 Web UI:总览仪表盘、需求管理页、需求设计页(看需求的设计进展)、
待决策项、工作区管理;由 5 阶段工作流驱动(需求录入→需求分析→场景分析→用例分析→
功能分解),并积累设计资产:场景库、用例库、功能库(功能域+功能项)。

## Notes

- Domain:requirements engineering / architecture design workbench。
- Tracker:local-markdown(无 git remote);票在 `tickets/`,blocking 用 body 约定。
- Skills:ui-ux-pro-max(UI)、domain-modeling、grilling、prototype。
- Grilling 结论:资产存 SQLite/JSON store;workspace = 1 repo;工作流逐阶段人工触发;
  待决策项 = critic findings + approval gate + 人工添加。
- 现有基础:gateway.ts + web/(Vite+Lit dark,slices 1-4);evidence/ADR/gene 复用环。

## Decisions so far

- [Grilling 四答](#) — 资产=SQLite/JSON;workspace=1 repo;逐阶段人工触发;决策=critic+审批+人工。
- [T09 node SQLite 选型](tickets/T09-sqlite-options.md) — better-sqlite3 v13(prebuilds,slim 零编译);node:sqlite 仍 experimental。
- [T01 领域模型](tickets/T01-domain-model.md) — 7 实体+关系链(需求→场景→用例→功能项→功能域);资产=workspace 复用池;阶段=待审→人工审→完成。

- 资产复用/演化环:场景/用例/功能库如何反哺未来设计(与 gene/ADR 复用环的关系)。
- 跨 workspace 的资产搜索/共享。
- 资产跨需求修订的版本化。

## Out of scope

- TUI(独立 surface,非本 Web 工作台)。
- 鉴权/多用户硬化(token 门已存在,非本图核心)。

## Tickets(frontier = open+unblocked+unclaimed)

- [T01 领域模型](tickets/T01-domain-model.md) `grilling` — **closed**:7 实体+关系链+阶段态
- [T09 node SQLite 选型](tickets/T09-sqlite-options.md) `research` — **closed**:better-sqlite3 v13
- [T02 SQLite store schema+DB 位置](tickets/T02-store-schema.md) `prototype` — blocked by T01
- [T03 工作区管理页(1 repo=1 ws)](tickets/T03-workspace-mgmt.md) `prototype` — blocked by T02
- [T04 需求设计页(进展+资产+触发)](tickets/T04-requirement-design-page.md) `prototype` — blocked by T01,T02
- [T05 总览仪表盘内容](tickets/T05-overview-dashboard.md) `prototype` — blocked by T02
- [T06 待决策项页(critic+审批+人工)](tickets/T06-pending-decisions.md) `prototype` — blocked by T02
- [T07 逐阶段 agent pipeline→store](tickets/T07-stage-pipeline.md) `task` — blocked by T01,T02
- [T08 各阶段 LLM 抽取 prompts/skills](tickets/T08-stage-prompts.md) `research` — blocked by T07
