# R02 场景/用例引用角色与校验规则

status: closed
assignee: pi(grilling with user)
blocked-by: R01-role-asset-schema-and-identity.md
labels: wayfinder:grilling

## Question

新建/导入的 scenario 与 usecase 资产如何引用 role 资产？引用结构与存在性校验的精确规则是什么？

## 已锁定的决策边界（grilling 2026-08）

- 改动只落在资产库层；设计阶段 Artifact（`artifact/scenario/v1`）不动。
- 引用语义：**浮引用** —— content 只存 `assetId`，展示时解析最新 revision；不钉死 revision。
- 强度：**存量宽松、新建强制** —— 存量资产保持原样兼容展示；新建/导入的 scenario/usecase 若声明 actors，必须是引用结构且校验引用的 role 资产存在。
- 身份模型：role 身份仅 `assetId`（R01）。

## Resolution（2026-08）

1. **引用形状——同字段不同形状**：scenario content 的 `actors` 由 `string[]` 变为 `[{ "assetId": number }]`（浮引用，元素仅 assetId）；usecase content 的 `actor` 由 string 变为 `{ "assetId": number }`；`function` kind 无参与者字段、完全不受影响。旧字符串形状仅作存量兼容展示，不加形状标签。
2. **校验位置——server 层**：在 operator-server 的 create 与 import 分支对 scenario/usecase content 做「引用存在性校验」（解析引用结构、查同 workspace 内 actor 资产）；store 层不校验，维持现有宽松行为。server 是唯一校验入口。
3. **导入批量内自包含**：import 按「批内先建所有 kind=actor（含重映射）→ 再建 scenario/usecase」顺序执行；校验视野 = 本批新建的 actor + 存量 actor。单次导入完成，不要求用户拆两步。
4. **错误语义**：收集全部无效引用后一次性返回 `400 { error: "invalid_actor_ref", invalidRefs: [{ assetId, path }] }`（path 如 `actors[1]`）；不产生部分写入。
5. **归档宽准入**：workflow archive → ReusableAsset 产出的 scenario/usecase 资产走宽松路径——content 原样（字符串 actors），不转引用、不校验（Engine 确定性执行，不被资产库引用规则拒绝）。「强制引用」仅适用人工 create 与 import 两个入口；「存量」= 归档产物 + 历史资产。
6. **展示解析——后端 enrich**：GET /api/assets/:id 对含引用的 scenario/usecase 额外返回解析结果（如顶层 `resolvedActors: [{ assetId, name, description }]`），不修改 content 本体；存量字符串 shape 原样返回。前端无需二次查接口。
7. **术语消歧**：CONTEXT.md 现有「Actor」已指操作者身份（可信 Actor/ActorRef/actor snapshot），与新增「Actor（业务参与者）」英文撞名；以 CONTEXT.md 消歧说明区分两者领域（中文：操作员 vs 参与者），不改动既有术语。