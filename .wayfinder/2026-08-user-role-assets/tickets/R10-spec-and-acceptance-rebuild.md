# R10 终点规格与验收资产重建

status: closed
assignee: pi(grilling with user)
blocked-by: none
labels: wayfinder:grilling

Part of [BaiZe 资产库用户角色定义](../map.md)

## Question

汇编 R06-R09 全部决议为机器可读验收资产 `stakeholder-asset-spec-v1.json` + 人类评审入口规格文档，作为本图新终点产物——其内容结构、契约块划分、测试矩阵与评审清单的精确定义是什么？

## 已锁定的决策边界（grilling 2026-08-25）

- R05 的验收资产 `actor-asset-spec-v1.json` 和人类评审入口 `docs/资产库用户角色定义规格.md` 已被 R06 删除（用户：不保留作历史参考）。
- R06-R09 全部决议已闭：stakeholder 重命名（R06）、asset_relations 显式关系表（R07）、归档自动 promote（R08）、导入导出与 API 契约适配关系表层（R09）。
- 本票是终点产物票——把四票决议汇编为评审可通过的规格 + 验收资产。
- R05 的测试矩阵六维框架保留（CRUD/引用校验/禁删/重映射/导出/归档），但维度内容需随 R06-R09 新形态扩展。

## 本票要决议的细节

1. 机器可读验收资产 `stakeholder-asset-spec-v1.json` 的结构：沿用 R05 的 spec-v1 schema（contracts/api/ui/displayResolution/acceptanceMatrix/reviewChecklist/releaseGate），还是新结构？各契约块如何映射 R06-R09 决议。
2. 人类评审入口规格文档命名与内容：`docs/资产库干系人定义规格.md`？内容覆盖 stakeholder schema（R06 改名后）、asset_relations 表 schema（R07）、归档自动 promote 机制（R08）、导入导出 API 契约（R09）四块。
3. 测试矩阵扩展：R05 六维（CRUD/引用校验/禁删/重映射/导出/归档）如何适配新形态——CRUD 加 stakeholder 重命名迁移验证、引用校验改为 relations 写入校验、禁删改为双向扫、重映射改为 title 映射重建边、导出改为含边表单段、归档改为同事务自动 promote。
4. 评审清单更新：R05 四项（契约完整/一致性/无兼容层/无越界）是否扩展？新增项如「关系类型白名单完整性」「归档去重幂等性」等。
5. 发布门禁：沿用 R05 的「用户人工评审通过 = 本图终点」。R10 闭后图到达 Destination，实现走 BaiZe 既有流程。

## Resolution（grilling 2026-08-25）

### 1. 机器可读验收资产结构：新结构按技术层分块

[stakeholder-asset-spec-v1.json](../assets/stakeholder-asset-spec-v1.json) 不沿用旧 spec-v1 的契约块划分，改为按技术层分块：
- `contracts.schema`：stakeholderAsset（R06 kind/schema/migration/label/CONTEXT）+ assetRelationsTable（R07 表/边类型/白名单/content字段处置）
- `contracts.runtime`：archiveAutoPromote（R08 同事务promote/去重/建边/幂等/手动接口/溯源）
- `contracts.api`：export/import/create/patch/delete/enrich/validation（R09 单段含边表/title映射/双向禁删/relations校验）

顶层保留 specVersion/status/derivedFrom/scope + acceptanceMatrix（八维）+ reviewChecklist（六项）+ releaseGate。

### 2. 人类评审入口规格文档

[docs/workspace设计模型资产化规格.md](../../../docs/workspace设计模型资产化规格.md) 覆盖四块：stakeholder schema（§1）、asset_relations 表（§2）、归档自动 promote（§3）、导入导出 API（§4）+ 八维测试矩阵（§5）+ 六项评审清单（§6）。旧文件 docs/资产库用户角色定义规格.md 已删除。

### 3. 测试矩阵：八维

R05 六维扩展为八维：CRUD / 引用校验(relations写入) / 禁删(双向扫) / 重映射(title映射重建边) / 导出(含边表单段) / 归档(同事务自动promote) / 关系建模(contains+involves白名单+DAG多父+resolvedGraph enrich) / 迁移(stakeholder重命名+无存量豁免+0013重写)。

### 4. 评审清单：六项

R05 四项扩展为六项：+ 关系类型白名单完整性 + 归档去重幂等性。

### 5. 发布门禁

沿用 R05 的「用户人工评审通过 = 本图终点」。R10 闭后图到达 Destination，实现走 BaiZe 既有流程。

### 资产链接

- 机器可读验收资产：[stakeholder-asset-spec-v1.json](../assets/stakeholder-asset-spec-v1.json)
- 人类评审入口：[docs/workspace设计模型资产化规格.md](../../../docs/workspace设计模型资产化规格.md)
