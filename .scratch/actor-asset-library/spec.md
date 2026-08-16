# BaiZe 资产库用户角色（Actor）定义规格

Label: ready-for-agent
Status: Ready for ticketing

## Problem Statement

资产库（`baize-asset-library`）目前只有三种可复用资产：场景（scenario）、用例（usecase）、功能（function），且场景/用例中的参与者是以自由字符串（`actors: string[]` / `actor: string`）写的。同一参与者在不同场景里可能写成「管理员」「系统管理员」「Admin」而互不关联；参与者没有任何定义与出处，设计人员无法复用一套共享的参与者事实源，也无法在场景之间保持参与者语义一致。当设计阶段或资产库侧需要把场景当作可检索、可复用的输入时，这种自由字符串让「谁参与了场景」成为不可消歧的文本噪声。

同时，资产库缺少对参与者的生命周期管理：无法修正参与者定义（名称/描述笔误无法就地改，只能删除重建，而删除会破坏引用）、删除时也不检查是否仍被场景/用例引用、导出导入跨 workspace 时不处理引用映射，导致引用悬空或错配。操作员需要把「用户角色」作为一等资产来定义、引用、修正和复用。

## Solution

新增第四类 workspace 级可复用资产：**Actor（业务参与者，kind=`actor`）**。每个 Actor 资产包含唯一的 name（workspace 内 trim + 大小写不敏感唯一）与可空的 description；身份完全由 store 级 assetId 决定，content 不带 slug。场景与用例资产中的参与者字段改为**浮引用**——content 只存 `assetId`，展示时解析到参与者资产的最新修订——从而在新资产中替代自由字符串；存量资产与设计阶段 Artifact schema 保持不变（归档宽准入）。

资产库为参与者补齐生命周期：新增仅对 kind=actor 开放的 PATCH 更新（追加不可变 revision、`title` 随 name 同步）；删除前扫描同 workspace 场景/用例的 current revision 引用，被引用则拒绝（409 `asset_referenced`）；导出时把引用替换为内嵌快照 `{assetId, name, description}`，导入时按 name 复用或新建参与者并重写引用方 assetId（快照不作覆盖源）。引用校验在 operator-server 的 create/import 分支执行，聚合返回全部无效引用（`invalid_actor_ref` + `invalidRefs`），导入批量内先建立参与者再建立引用方。

Web 资产库页新增「参与者库」tab：参与者新建采用结构化双字段表单（名称/描述）；新建与编辑场景/用例时表单下方提供可用参与者只读提示；详情视图三态渲染参与者引用（引用解析 / 存量原文 / 悬空占位）并保留完整 content JSON；删除被引用参与者时明确列出引用方。参与者资产与既有资产同权，纯资产库操作，不触发审批、readiness 或 workflow 事件，不引入 RBAC 结构。

## User Stories

1. 作为操作员，我想在资产库中新建一个参与者资产（仅名称必填、描述选填），以便为场景/用例建立共享的参与者事实源。
2. 作为操作员，我想在工作区内以「名称」唯一地识别参与者（trim + 大小写不敏感），以便不会因「Admin」「 admin」创建出语义重复的角色。
3. 作为操作员，我想在参与者名称写错时通过 PATCH 就地修正名称与描述（追加新修订），以便维护定义而无需删除重建、破坏引用。
4. 作为操作员，我想在 PATCH 参与者名称为同名已有名称时得到 409 冲突错误，以便唯一性不被破坏。
5. 作为操作员，我想在新建场景时用 `actors: [{ assetId }]` 引用参与者，以便场景的参与者可被解析为当前最新的角色定义。
6. 作为操作员，我想在新建用例时用 `actor: { assetId }` 引用单一参与者，以便用例参与者与参与者库保持一致。
7. 作为操作员，我想在新建/导入场景或用例时，若引用的参与者不存在则收到一次列出全部无效引用的错误，以便一次修正而不是反复提交。
8. 作为操作员，我想看到存量场景/用例（actors 为自由字符串）继续原样展示，以便历史资产不被破坏。
9. 作为操作员，我想删除未被任何场景/用例引用的参与者，以便清理废弃的角色库条目。
10. 作为操作员，我想删除被场景/用例引用的参与者时收到 409 与引用方清单，以便知道谁在依赖该角色。
11. 作为操作员，我想把资产库导出为 JSON（引用自动带参与者定义快照），以便跨 workspace 或备份时不丢失参与者语义。
12. 作为操作员，我想把导出的资产导入另一 workspace（按名称复用或自动新建参与者并重写引用），以便跨 workspace 复用场景而不出现悬空引用。
13. 作为操作员，我想在资产库中看到「参与者库」tab，以便像场景/用例/功能一样浏览参与者资产。
14. 作为操作员，我想用结构化表单（名称/描述）新建参与者，以便避免手写 JSON 出错。
15. 作为操作员，我想在新建/编辑场景时看到当前可用参与者（id+name）的只读提示，以便正确填写引用。
16. 作为操作员，我想在详情中看到参与者引用解析为名称与最新描述，以便阅读场景时理解参与者是谁。
17. 作为操作员，我想在设计阶段产出的场景归档进资产库时保持原样（不强制转引用），以便归档不被资产库引用规则阻断。
18. 作为操作员，我想参与者的新建/更新/删除与既有资产一致地不产生审批/readiness 负担，以便角色库轻量维护。

## Implementation Decisions

- **kind 与模型**：资产库新增 `kind=actor`（第四类 ReusableAsset）。抽共享 `ReusableAssetKind = 'scenario' | 'usecase' | 'function' | 'actor'` 与校验器，store/server/web 统一引用；web `assetKindLabel`: actor → 「参与者」。`mapLegacyArtifactKind` 不加 actor（legacy 迁移无 actor 数据）。
- **Schema（asset/actor/v1）**：content 为 `{ name: string(必填非空), description?: string(可空，缺省归一化为 "") }`，additionalProperties: false。行级 `title` 是 content.name 的镜像（创建同步、PATCH 改名同步）。身份仅 store 级 assetId，content 无 slug。
- **唯一性**：workspace 内按 `trim + 大小写不敏感`（normalize = name.trim().toLowerCase()）判定；创建与 PATCH 冲突均返回 409 `name_conflict`。
- **引用形状（同字段不同形状）**：scenario `actors` 由 `string[]` 变为 `[{ assetId }]`；usecase `actor` 由 string 变为 `{ assetId }`；function 不受影响。旧字符串形状仅存量兼容展示，不加形状标签。浮引用：只存 assetId，展示解析最新 revision。
- **Schema 落点**：`asset/actor/v1` 为资产库层独立契约，**不进 `artifact-content-v1.schema.json`**（设计阶段 Artifact 契约不动）；校验按 kind 侧规则实现。
- **DB**：新 migration（SQLite 不能 ALTER CHECK）重建 `reusable_assets` 表，把 kind CHECK 扩含 `'actor'`；revision 追加复用现有 `reusable_asset_revisions`（revisionNo 递增 + snapshot_documents 不可变 content + digest 重算）。
- **PATCH**：`PATCH /api/assets/:id` 仅对 kind=actor；body `{ name?, description? }` 至少一项否则 400 `malformed_body`；成功=追加新 revision（revisionNo 递增、digest 重算），content 合并 `{ name, description }`，title 随 name 同步；返回 `200 { revisionId, revisionNo }`；非 actor kind / 不存在 → 404 `unknown_asset`；无乐观锁（与现有 create 一致）。
- **删除守卫**：DELETE 前扫描同 workspace 内所有 scenario/usecase 的 **current revision** content，凡引用该 actor assetId 者记入；非空 → 409 `{ error: "asset_referenced", refs: [{ kind, assetId }] }`（只列引用方资产）；未引用 → 200 `{ deleted: true }`；扫描与删除同事务。
- **引用校验（server 层）**：operator-server 的 create 与 import 分支解析 scenario/usecase content 引用、查同 workspace actor 资产；聚合返回 `400 { error: "invalid_actor_ref", invalidRefs: [{ assetId, path }] }`（path 如 `actors[1]`），无部分写入。store 层不校验（保持宽松）。**归档宽准入**：workflow archive → ReusableAsset content 原样（字符串 actors），不转引用、不校验。
- **导入批量内自包含**：import 按「批内先建/重映射所有 kind=actor → 再建 scenario/usecase」执行；校验视野 = 本批新建 + 存量。
- **导出**：现有导出数组形状不变；含引用的 scenario/usecase 中 `actors`/`actor` 引用替换为内嵌快照 `{ assetId, name, description }`；旧字符串 shape 原样。
- **导入重映射**：每个内嵌快照按 name（trim + 大小写不敏感）查找目标 workspace 参与者——找到则复用其 assetId（快照不作覆盖源、不校验定义）；找不到则用 name+description 新建（source=import）并以新 assetId 重写引用方 content；随后按引用校验规则通过。
- **展示 enrich**：GET `/api/assets/:id` 对含引用的 scenario/usecase 额外返回 `resolvedActors: [{ assetId, name, description }]`（后端 enrich，content 本体不动）；前端零二次请求。存量字符串 shape 原样。
- **Web**：资产库页 KINDS 增加 actor → 「参与者库」tab；参与者新建为结构化双字段表单，其它 kind 维持 JSON/纯文本 textarea；新建/编辑场景用例时表单下方显示「可用参与者」只读提示（复用 listAssets 过滤 kind=actor）；`invalid_actor_ref` 按 path 逐条红字；详情三态渲染（引用解析 / 存量原文 / 悬空占位「参与者 N（已不存在）」）+ content JSON 保留 `<pre>` 块；空态沿用现有模式并补充参与者库引导；409 删除冲突提示引用方标题。前端 kind 联合类型加 `'actor'`，`AssetDetail` 加可选 `resolvedActors`；导出/导入 UI 格式不变（快照嵌/重映射后端透明）。
- **审计/治理**：role 操作与现状一致——不记录 actorSnapshot；纯资产库操作，不触发审批/readiness/workflow 事件；不引入权限/职责枚举/继承等 RBAC 结构。
- **术语**：Actor（业务参与者，kind=actor，中文「参与者」）与 Agent 角色（Role Contract）及操作者身份（可信 Actor/ActorRef，中文「操作员」）区分；CONTEXT.md 已加消歧说明。

## Testing Decisions

- **总原则**：只测外部行为（HTTP 契约与可观察的 store 效果），不测实现细节；机器验收资产 `.wayfinder/2026-08-user-role-assets/assets/actor-asset-spec-v1.json` 的 `acceptanceMatrix` 是判据的来源（行为×变量六维：actor CRUD / 引用校验 / 禁删 / 导入重映射 / 导出形状 / 归档宽准入）。
- **主 seam（HTTP 契约）**：扩展现有 `operator-server.test.ts` 与 `operator-reads.test.ts`（headless runtime 注入真实 store）——覆盖 PATCH 追加 revision 与 title 同步、`name_conflict`/`malformed_body`/`unknown_asset` 错误、删除守卫 409（引用方清单）、create/import 引用校验聚合错误、导入批量自包含与重映射（复用/新建）、导出内嵌快照形状与旧字符串原样、GET 详情 `resolvedActors`。
- **迁移 seam**：沿用 migration 测试模式（同现有 `negative-scan`/migration 相关测试）——验证新 migration 重建表后 `reusable_assets.kind` CHECK 含 `'actor'`、存量行不丢、revision 约束不变。
- **Web seam**：新增 `baize-asset-library` 组件单测（同 `baize-workflow.test.ts` 模式，jsdom + Lit）——覆盖「参与者库」tab 出现、结构化表单提交 content 形状、可用参与者只读提示渲染、详情三态渲染（引用/存量/悬空）、删除冲突错误文案。
- **Prior art**：现有 `operator-server.test.ts`（HTTP 契约断言）、`operator-reads.test.ts`（读模型）、migration/negative-scan 测试、`web/src/baize-workflow.test.ts`（web 组件测试）。
- 归档宽准入（archive → asset 不校验）与唯一性规则（trim+大小写）在主 seam 覆盖。

## Out of Scope

- 设计阶段 Artifact schema 变更：`artifact-content-v1.schema.json`（`scenarioItem.actors`、`usecaseItem.actor`）保持 stringList/string，不改引用。
- 角色权限/职责枚举、角色继承等 RBAC 结构；schema 仅 name + description。
- 参与者资产纳入审批/readiness/治理生命周期；纯资产库操作，不触发 governance。
- 全 kind 统一更新 API；PATCH 仅对 kind=actor 开放，scenario/usecase/function 维持 create/delete。
- 存量资产自动迁移/升级：存量字符串 actors 不转引用、不强制升级。
- 设计态检索：未来 Task 把含参与者浮引用的 ReusableAssetRevision 作为输入来源时的解析问题，另行评估。
- 角色库大规模分页/检索/去重；沿用资产库现状。
- 多租户、跨 workspace 权限、分布式。

## Further Notes

- 本规格的决策来源：wayfinder 图 `.wayfinder/2026-08-user-role-assets/`（R01–R05 全部 closed）；机器验收资产 [`actor-asset-spec-v1.json`](../../.wayfinder/2026-08-user-role-assets/assets/actor-asset-spec-v1.json) 为机器可读判据，人类评审入口为 [`docs/资产库用户角色定义规格.md`](../../docs/资产库用户角色定义规格.md)。
- 术语消歧已写入 CONTEXT.md（**Actor**：业务参与者 kind=actor 中文「参与者」 vs 操作者身份 ActorRef/actor snapshot 中文「操作员」）。
- 本图为终点图：评审通过后实现直接走本 repo 的既有实现流程（切面化落地 + 测试矩阵执行），不再开新 wayfinder 决策图。