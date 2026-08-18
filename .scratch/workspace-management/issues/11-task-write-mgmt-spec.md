# Task: write workspace management spec for review

Label: wayfinder:task
Assignee: （未认领）
Status: open
blocked-by: 07-research-cascade-delete-fk-graph；08-decide-workspace-api-surface；09-decide-web-shell-navigation-and-state；10-decide-delete-guards

## Question

把 07–10 的决议汇总为可评审的实现 spec（Destination 交付物）：文档面修订清单、契约同步面、验收标准；**只写 spec，不实现**。评审通过后另行执行（新 effort）。

## 产出面

1. **master spec** `.scratch/automatic-requirement-design-orchestration/spec.md`：新增用户故事（工作区管理：登录首屏管理页、列表/创建/级联删除、进入/返回、记住最近）——编号策略按既有先例（编号保留、原地插入，防交叉引用失效）；操作体验节改写：登录 → 工作区管理页 → 进入 → 需求列表 → 详情。
2. **CONTEXT.md**：新增「工作区/Workspace」词条（草稿于 10，落实于此）。
3. **README**：端点表增补 `GET/POST/DELETE /api/workspaces`。
4. **契约目录**：`workflow-api-v1.json`（双侧：`agent-runtime/contracts/` 与 `.wayfinder/2026-08-auto-orchestration/assets/` 字节一致）改动清单。
5. **negative-scan.test.ts**：修「production web entry imports only baize-workflow」红断言（shell 现实化）；新组件命名登记（09 决议）。
6. **ADR 草稿**（10 决议）；验收标准清单（评审用）。
7. **收口**：本票关闭后 frontier 空，Destination = spec 交付评审。

## Answer（待前置决议）