# 旧仓库可复用领域资产清单

**来源**：本地分支 `backup/2026-09-22` @ `7d91cda7a0c6132b54075a02fa283fd479b9f81f`（2026-09-22T14:29:34+08:00）。
**性质**：Wayfinder 工单「从旧仓库提取可复用领域资产清单」的取物结果。**只盘点，不复用**——复用决策留给下游工单。
**只读**：本清单的每一条都指向旧仓库的具体路径，未改动任何旧文件。

---

## 1. 资产内容 schema（9 类 artifactKind）

**权威文件**：`.wayfinder/2026-08-auto-orchestration/assets/artifact-content-v1.schema.json`（25.5 KB，JSON Schema，`oneOf` 九个 `$defs`）。
同一份文件在 `agent-runtime/contracts/` 下有副本。

所有 artifact 继承 `$defs.common`，**必填** `schemaVersion` + `artifactKind` + `summary` + `sourceRefs`（数组、`uniqueItems`），另有可选 `diagrams`。

| artifactKind | 专属必填字段（除 common 外） | 其余字段 |
|---|---|---|
| `requirement` | `title` `description` | `goals` `nonGoals` `constraints` |
| `analysis` | `goals` `nonGoals` `constraints` `acceptanceCriteria` `impactProfile` `openQuestions` | — |
| `scenario` | `domains` | — |
| `usecase` | `useCases` | — |
| `function` | `domains` | — |
| `design` | `changeUnits` `alternatives` `failureHandling` `testStrategy` `implementationOrder` `rolloutStrategy` `rollbackStrategy` | — |
| `architecture` | `components` `constraints` `nonFunctionalRequirements` | `layout` `relationships` |
| `data` | `entities` | `relations` |
| `api` | `openapi` `info` `paths` | `components` `security` `servers` `tags` |

### 1.1 嵌套层级定义（这是旧模型最值得看的部分）

| `$defs` | 必填 | 说明 |
|---|---|---|
| `scenarioDomain` | `nodeId` `title` `scenarios` | 场景域 |
| `scenarioNode` | `nodeId` `title` `variants` | 场景节点 |
| `scenarioVariant` | `nodeId` `title` `actors` `preconditions` `trigger` `mainFlow` `alternateFlows` `expectedOutcome` | **真正承载内容的叶子** |
| `functionDomain` | `nodeId` `title` `items` | 功能域 |
| `functionItemNode` | `nodeId` `title` `points` | 功能项 |
| `functionPoint` | `nodeId` `name` `responsibility` `inputs` `outputs` `businessRules` `acceptanceCriteria` | 功能点（叶子） |
| `impactProfile` | `process` `actors` `behavior` `architecture` `data` `api` | 六个布尔维度 |
| `component` | `componentId` `name` `responsibility` | 架构元素；另有 `boundary` `layer` |

**两条层级同构**：`场景域 → 场景节点 → 场景变体` 与 `功能域 → 功能项 → 功能点`，都是「域 → 节点 → 叶子」。

---

## 2. 资产层级与关系（旧模型怎么连）

**权威文件**：`web/src/baize-asset-library-constants.ts`（218 行）里的 `RELATION_TARGETS`。

旧模型把资产分成两类（`HIERARCHY_KINDS` vs 其余）：

- **层级型**：`scenario-domain`、`scenario`、`scenario-variant`、`function-domain`、`function-item`、`function-point`
- **内容型**：`requirement`、`analysis`、`usecase`、`design`、`architecture`、`data`、`api`、`stakeholder`

`RELATION_TARGETS` 的 contains / involves 边（原文）：

```
scenario-domain  --contains--> scenario
scenario         --contains--> scenario-variant
scenario-variant --contains--> usecase          --involves--> stakeholder
usecase          --contains--> function-domain  --involves--> stakeholder
function-domain  --contains--> function-item
function-item    --contains--> function-point
function-point   --contains--> api, data
design           --contains--> architecture
architecture     --contains--> api, data
```

**旧模型的链路是单亲 containment**：`场景变体 → 用例 → 功能域 → 功能项 → 功能点 → {api, data}`。

---

## 3. 三个分析角色

| 角色 | 职责（`README.md`） | 唯一写入的 kind |
|---|---|---|
| `scenario-analyst` | 场景 Artifact 唯一写入者 | `scenario` |
| `usecase-analyst` | 用例 Artifact 唯一写入者 | `usecase` |
| `function-analyst` | 功能 Artifact 唯一写入者 | `function` |

角色名出现在 `agent-runtime/workflow/plan-types.ts`、`model-config.ts`、`persistence/governance-kernel.ts`（`scenario: "scenario-analyst"` 等映射）、`contracts/plan-template-v1.json`（`{"role": "scenario-analyst"}`）等处。
`plan-types.ts` 里有一条值得注意的映射：`"scenario-analyst": ["analysis", "scenario", "usecase", "function"]`——分析系四个角色的可读 kind 集合相同。

**没有独立的 prompt 文件**：全仓 `git ls-tree | grep -i prompt` 只命中两个 Wayfinder 工单文件（`.wayfinder/archive/2026-08-workbench/tickets/T08-stage-prompts.md`、`.wayfinder/2026-08-auto-orchestration/tickets/A02-fixed-role-contracts-and-context-boundaries.md`）。**分析指令没有以可复用文本形式存在**——它散在 role contract 与模型调用路径里。这是盘点的一条**否定结论**，比"找到了什么"同样重要。

---

## 4. 六个角色 skill（`.pi/skills/`）

各 19-21 行，frontmatter 只有 `name` + `description`（与 Superpowers 的 SKILL.md 契约一致）：

| skill | description（原文摘录） |
|---|---|
| `analyst` | BaiZe 需求分析角色。拆解业务需求、识别约束与验收条件，并澄清领域术语和歧义。 |
| `architect` | BaiZe 架构设计角色。根据设计任务生成架构方案、备选决策及其权衡，并明确证据和约束。 |
| `critic` | BaiZe 设计评审角色。评审需求与架构方案，发现风险、遗漏和矛盾，并给出严重度与置信度。 |
| `orchestrator` | BaiZe 编排角色。解析需求并生成设计任务，分配各角色工作；收集发现、决策和审批结果后汇总最终输出。 |
| `reviewer` | BaiZe 人工审批角色。呈现方案选项和相关发现，记录人工审批的确认、拒绝或修改要求。 |
| `translator` | BaiZe 多语言翻译角色。将最终方案输出为目标语言，并校验术语、结构和技术含义的一致性。 |

**可直接复用**：`analyst` 的 description 措辞（拆解/约束/验收条件/术语澄清）与我们的 IR/SR 阶段几乎同义。

---

## 5. 术语表（两份，都值得取用）

- `docs/GLOSSARY.md`（46 行）：中文/英文/定义/UI 用法四列表，含「需求/领域/设计任务/决策/发现/审批/运行时/角色/用户/团队/架构投影快照/可见图」+ 六个 Agent 角色定义 + i18n 命名空间速查。
- `CONTEXT.md`（237 行）：**主上下文词表**，约 60 个词条，每个带 `_Avoid_`。与本次相关的：Requirement、Workflow、Plan Revision、Task、Attempt、Run、Design Session、Blocking Gate、Readiness Policy、Role Contract、Context Manifest、Review Bundle、Staged Effect、Approval Packet、Impact Profile、Required Artifact Set、Evidence Coverage、Finding Thread、Artifact Policy、Human Directive、Human Response、Decision Disposition、Approval、Concurrency Policy、Artifact Write Key、Workflow Projection、Artifact View、Gate Queue 等。
- `agent-runtime/persistence/CONTEXT.md`：Store 子域词表（Workspace / Reusable Asset / Actor / Snapshot Document），与主上下文用 `CONTEXT-MAP.md` 相连——**这是「多上下文仓库」的一个真实样例**。

---

## 6. 前端的展示契约

- `web/src/baize-asset-library-constants.ts`（218 行）：`TAB_KINDS`、`KIND_TO_TAB`、`HIERARCHY_KINDS`、`RELATION_TARGETS`、`SPECIALIZED_VIEW_KINDS`、`createDraft(kind)`，以及**每个 kind 的字段中文标签与控件类型**（`{ key, label, type }`，type 取 `text` / `textarea` / `list` / `object-list`）。
- 同目录另有 8 个资产库组件：`baize-asset-library.ts`(297) / `baize-asset-detail.ts`(312) / `baize-asset-form.ts`(357) / `baize-asset-list.ts`(211) / `baize-asset-entries.ts`(184) / `baize-asset-graph.ts`(180) / `baize-asset-import.ts`(206) / `baize-asset-relation-picker.ts`(105)。
- `docs/workspace设计模型资产化规格.md`：workspace 级设计模型资产化的规格文档。

**可复用点**：字段中文标签表（`{ key, label, type }`）是现成的**渲染契约**——将来若要由 CLI 生成人类可读的产物视图，这张表就是标题来源。

---

## 7. 与已定决策的对照（含一处**需要复核的前提错误**）

| 我们的决定 | 旧模型 | 关系 |
|---|---|---|
| 条目级、无嵌套（#125 Q3=A） | 层级型资产用 `contains` 嵌套三层 | **有意偏离**：旧模型的功能点/场景变体是文件内节点，没有独立 id，无法单独分配 |
| 单亲树（#125 Q4=B1） | 全链路单亲 `contains` | 一致 |
| **场景↔用例 = 多对多关联**（#130 Q9=C） | `scenario-variant --contains--> usecase`（**单亲**） | **有意偏离**，因为一条用例可服务多个场景 |
| 场景**不分级**、分类走词表（#130 Q5/Q7） | 场景三级：`场景域 → 场景节点 → 场景变体` | 见下 |
| 功能**两级**、功能域降为 `domain` 字段（#130 Q6=B） | 功能三级：`功能域 → 功能项 → 功能点` | **有意偏离**：域是分类不是分解 |
| 覆盖率按**验收线索级**（#125 Q8.1=A） | `requirement` 有 `goals`/`nonGoals`/`constraints`，`analysis` 才有 `acceptanceCriteria` | 旧模型把验收条件放在 `analysis` 而非 `requirement`——**我们没有对应物** |

### ⚠️ 需要复核的一处

**#130 Q5（场景不分级）的理由基于一个错误前提。** 我当时推荐时写的是「旧模型的场景三级是业务/系统/交互三种视角」——**这是错的**。旧模型的实际三级是 `场景域 → 场景节点 → 场景变体`，而**变体才是承载内容的那一层**（`actors` / `preconditions` / `trigger` / `mainFlow` / `alternateFlows` / `expectedOutcome`）。

按我们在 Q6 里给功能用的同一条判据（域是分类、节点到叶子是分解），**场景本应是两级（节点 → 变体）+ 一个域字段**，而不是扁平一层。用户的答案（「不分级但要支持分类」）本身仍可成立——把变体的字段直接放在扁平场景条目上即可——但**理由不成立，结论值得复核一次**。已在本工单的解决评论里标出。

---

## 8. 明确不复用（供下游工单排除）

- **`agent-runtime/`**（28.7k 行生产代码 + 14k 行测试）：编排、治理、投影、运维面。地图 **Out of scope** 已排除。
- **`web/`**（整个前端）：Out of scope 已排除。
- **模型网关 / 模型档 / 用量**（`model-config.ts`、`web/src/model-profiles.ts`）：Out of scope 已排除。
- **`.scratch/`、`.wayfinder/` 的历史工单**：是过程记录，不是资产。
