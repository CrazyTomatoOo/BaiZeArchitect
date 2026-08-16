# R01 角色资产 schema 与身份契约

status: closed
assignee: pi(grilling with user)
blocked-by: none
labels: wayfinder:grilling

## Question

用户角色作为第四类 ReusableAsset kind=`role`，其 content schema、身份模型与唯一性约束的精确定义是什么？

## 已锁定的决策边界（grilling 2026-08）

- 身份模型：仅 store 级 `assetId` 唯一身份；content **不带 slug id**。与 scenario/usecase/function 一致。
- content 最小形状：`{ "name": string, "description": string }`；name 在 workspace 内唯一。
- 不引入权限/职责枚举/继承（RBAC 结构留作可加字段，不在首版）。
- 纯资产库操作：不触发审批/readiness/workflow 事件；与现有三种资产同权。

## 本票要决议的细节

1. schema 标识与版本：`artifact/role/v1`？与 artifact-content 的 kind 枚举关系（`analysis|scenario|usecase|function|design|architecture|data|api` 是否加 `role`，还是资产库层独立常量）？
2. name 唯一性：是否全局唯一？大小写/空白规范化规则？创建+PATCH 的 409 冲突语义？
3. description 是否必填/可空；PATCH 时 name/description 各自是否可选更新；追加 revision 时是否保留 revisionNo 递增与 digest 规则（复用 ReusableAssetRevision）。
4. kind 枚举扩展的落点：store 层类型、`mapLegacyArtifactKind`、`KINDS` 常量、web `assetKindLabel` 的中文显示（角色库）是否统一。
5. 术语与 GLOSSARY：与 Agent 角色（Orchestrator/Analyst/Architect/Critic）的区分如何写进术语；UI 文案命名。

## Resolution（2026-08）

1. **术语**：新增领域术语 **Actor（业务参与者）**——场景/用例中的参与者、workspace 级可复用资产的共享事实源；与既有 **Role Contract（Agent 角色）** 明确区分。资产 kind 英文标识为 `actor`（与 scenarioItem.actors / usecaseItem.actor / Impact Profile actors 维度对齐），中文显示「参与者」。
2. **身份模型**：仅 store 级 `assetId` 唯一身份；content **不带 slug id**。与 scenario/usecase/function 资产一致。
3. **content schema（asset/actor/v1）**：`{ "name": string(必填非空), "description": string(可空，缺省/null 归一化为 ""）}`。
4. **title=name 镜像**：actor 资产行级 `title` 即 content.name 的镜像——创建时 title=name，PATCH 改名时同步更新 title；唯一性约束加在 content.name（业务键），title 仅作行级展示冗余。
5. **唯一性规则**：workspace 内按 `trim + 大小写不敏感` 归一化后判定唯一；创建与 PATCH 冲突均返回 409。
6. **schema 落点**：资产库层独立契约 `asset/actor/v1`，**不进 `artifact-content-v1.schema.json`**（该文件是设计阶段 Artifact 契约，本图不动）；校验按 kind 侧规则实现，规格文档记录契约块。
7. **代码落点**：抽共享 `ReusableAssetKind = 'scenario'|'usecase'|'function'|'actor'` 与校验器，store/server/web 统一引用；DB 侧**新 migration 重建 reusable_assets 表**把 kind CHECK 扩含 `'actor'`（SQLite 不能 ALTER CHECK）；`mapLegacyArtifactKind` 不加 actor（legacy 无 actor 数据）；web `assetKindLabel: actor → "参与者"`。
8. **治理边界**：纯资产库操作——不触发审批/readiness/workflow 事件；PATCH 更新 API 的端点细节归 R03 决议。