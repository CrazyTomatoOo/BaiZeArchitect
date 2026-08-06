# E02 — 架构浏览器 C4 数据源调研 `wayfinder:research`

> 状态:done(read-only investigation,未改任何源码)
> 关联票:E02;解锁 E03(架构浏览器范围与形态)。
> 调查对象:codebase-memory-mcp(已索引 `Volumes-work-Project-BaiZeArchitect-lws`,2724 节点/6732 边)+ gitnexus(`agent-runtime/extract-architecture.cjs` + `evidence/lws.json`)。
> 结论速览:**两套系统均无原生 C4(context/container/component)抽象**。现有 clusters/boundaries/hotspots/layers 可**近似 component 层**但不可自称 C4。推荐分层混合:Component 层直接复用现有数据(诚实命名"组件视图");Context+Container 层 LLM 从架构图+ADR+入口生成,产 mermaid 缓存;Code 层不另建(等价于现有函数/文件图)。K8s 仓库(lws 正是)的 Container 层优先用 codebase-memory 的 `Chart`/`Resource`/`INFRA_MAPS` 确定性提取,而非 LLM 猜测。

---

## 1. C4 model primer

C4(simonbrown)是 4 个抽象层级,从外到内 zoom,每层所需数据:

| 层级 | 是什么 | 每个节点所需数据 | BaiZe 现有数据能否覆盖 |
| --- | --- | --- | --- |
| **Context(1)** | 系统 + 外部 actors(users/外部系统)+ 跨界交互。回答"系统边界在哪、谁依赖它" | 系统名;外部依赖(actor/外部服务/外部 package);入站/出站调用;协议/技术 | 部分:`packages(external:true)` + `entry_points` + 跨包 `boundaries`,但无 actor/persona 抽象,无"用户角色"概念 |
| **Container(2)** | 可独立部署/运行的单元(进程、服务、DB、CLI、UI 包)。**不是 Docker container** | 容器名/类型(backend/api/db/cli);承载的 component;容器间调用/数据流;部署形态 | 部分(K8s 仓库):codebase-memory 的 `Chart`(Helm)+ `Resource`(k8s)+ `INFRA_MAPS{kind,service,workload}` 边;gitnexus lbug 无此等价物 |
| **Component(3)** | 容器内的逻辑组件包(package/module/控制器组),含其职责与相互调用 | 组件名;职责;组件间 calls/imports;所属容器 | 较好:`clusters`(Leiden 社区,label/members/cohesion/top_nodes)+ `boundaries`(顶层目录耦合)+ `layers`(core/internal)+ `packages`(fan_in/fan_out)。但这些是**涌现式聚类**,非声明式 component |
| **Code(4)** | 类/函数级,即 component 内部实现 | 类、方法、调用关系、复杂度 | 完备:Function/Method/Struct/Class/Interface + CALLS/IMPLEMENTS/DEFINES + 复杂度属性。等价于现有函数/文件图 |

关键点:C4 的 Context/Container 是**架构师声明**的抽象(actor、deployable unit),代码图天生没有——只能推断或人工声明。Component 可由聚类近似,Code 已等价于现有图。

---

## 2. codebase-memory-mcp 能力判定

实测工具:`list_projects` / `get_graph_schema` / `get_architecture` / `search_graph`(对 `Volumes-work-Project-BaiZeArchitect-lws`)。

### 2.1 图 schema(实测节点/边)

**节点标签**(16):Variable(694)、Function(587)、Section(393)、File(264)、Method(243)、Module(160)、Folder(103)、Package(100)、Struct(82)、Class(41)、Resource(37)、Interface(16)、Branch/Chart/Project/Type(各1)。**无 Container/Component/Service/Actor/Context 节点**。

**边类型**(16):DEFINES、USAGE、CALLS、DEFINES_METHOD、TESTS、CONTAINS_FILE、IMPORTS、WRITES、DEPENDS_ON、CONTAINS_FOLDER、OVERRIDE、TESTS_FILE、IMPLEMENTS、CONFIGURES、**INFRA_MAPS(6 条,带 `kind`/`service`/`workload` 属性)**、HAS_BRANCH。**无 CONTAINS(container→component)/RESPONSIBLE_FOR 等 C4 边**。

注意:`search_graph "container component context deployment module service"` 53 命中全部是 Go 函数名(`ensureService`/`buildService`/`ContainerRestarted`),**无架构语义的容器/服务节点**。

### 2.2 `get_architecture` 产物(对齐 gateway `/api/evidence` 形态)

返回:total_nodes/total_edges/node_labels/edge_types/languages/**packages**(fan_in/fan_out,含 external)/**entry_points**(`cmd.main`)/**hotspots**[{name,qualified_name,fan_in}]/**boundaries**[{from,to,call_count}](顶层目录级)/**layers**[{name,layer:core|internal,reason:fan-in/out}]/**clusters**[{id,label,members,cohesion,top_nodes,packages,edge_types}](Leiden 社区检测)。另有 `adr_present:true`。

### 2.3 能否映射到 C4?

| C4 层 | 映射可行性 | 说明 |
| --- | --- | --- |
| Context | 弱 | `packages(external)` + `entry_points` 给出"系统依赖了哪些外部库/入口在哪",但**无 actor/用户角色、无外部系统调用方**。需人工或 LLM 补 actor |
| Container | **K8s 仓库可确定性提取** | `Chart`(1,Helm chart)+ `Resource`(37,k8s 资源)+ `INFRA_MAPS{kind,service,workload}`(6)是 deployable-unit 的种子。**仅对 K8s/cloud-native 仓库有效**;普通仓库无等价物 |
| Component | 较好(涌现式) | `clusters`(Leiden)+ `boundaries`(目录耦合)+ `layers`(core/internal)+ `packages` 共同构成"组件包"视图。但聚类是算法产物,非架构师声明的 component,标签多为重复的 `pkg` |
| Code | 等价 | Function/Method/Struct/Class/Interface + 复杂度即 C4 Code 层 |

**判定:codebase-memory-mcp 无原生 C4 抽象。** 其 `clusters/boundaries/hotspots/layers` 可近似 Component 层(涌现式,需诚实命名);`Chart/Resource/INFRA_MAPS` 对 K8s 仓库可确定性产出 Container 层种子;Context 层缺 actor,必须额外生成。`manage_adr` + ADR 节点可作为人工架构声明的载体(见路径 b)。

---

## 3. gitnexus 判定

### 3.1 `agent-runtime/extract-architecture.cjs`(L1-119)

查询 LadybugDB(KuzuDB,`<repo>/.gitnexus/lbug`)产出**且仅产出**:`hotspots[{name,qualified_name,fan_in}]` + `boundaries[{from,to,call_count}]` + `clusters[{label,members,cohesion,top_nodes}]` + 统计(total_nodes/total_edges/node_labels/edge_types)。失败退空骨架(L104-117)。**无任何 C4 字段、无 container/component/context 提取逻辑**。

三条核心 Cypher:

- hotspots:`(f:Function)<-[r:CodeRelation]-() WHERE r.type="CALLS" ...`(L33-39)
- boundaries:`string_split(cf.filePath,"/")[1]` 顶层目录间 CALLS 计数(L42-49)
- clusters:`(s:Function)-[r:CodeRelation]->(c:Community) WHERE r.type="MEMBER_OF"`(L52-59)

### 3.2 `evidence/lws.json`(gateway 实际产物)

形态:`{repositoryId,project,repoPath,architecture{...},priorAdr{content(大段 markdown),status},generatedBy:"gitnexus"}`。`architecture` 内**仅** hotspots/boundaries/clusters/统计。`priorAdr.content` 是已沉淀的 ADR markdown(本例为 DS subdomain 校验决策)。

gitnexus lbug schema(从 evidence 推断)节点:Section/Function/Property/File/Method/Folder/**Process**(134)/**Community**(97)/Const/Struct/Variable/Interface;边含 **STEP_IN_PROCESS(481)**、MEMBER_OF、HAS_METHOD/PROPERTY、IMPLEMENTS、EXTENDS。`Process`+`STEP_IN_PROCESS` 是比函数高的流程抽象,但仍是**代码内业务流**,非 C4 container。

### 3.3 gateway 接入点(`gateway.ts` L77-111)

`generateEvidence` 只调 `extract-architecture.cjs` → 覆盖 `architecture` 字段 → 保留 `priorAdr` 等既有字段 → 写 `evidence/<repoId>.json`,`generatedBy:"gitnexus"`。**这是 C4 数据若要后端注入的唯一扩展点**。

**判定:gitnexus 亦无原生 C4。** 数据粒度同 codebase-memory(function/community/boundary 级)。但 lbug 的 `Process`/`STEP_IN_PROCESS` 与 codebase-memory 的 `Chart/Resource/INFRA_MAPS` 是**两套不同的"高层种子"**,后者对 Container 层更有价值。

---

## 4. BaiZe 的可行路径与权衡

> 前提:BaiZe 已有 agent-runtime(LLM 流水线)+ ADR(`manage_adr`)+ mermaid 渲染计划(E05)。架构浏览器是"独立能力"(wayfinder map.md),E03 待本票解锁。

### 路径 a — LLM 从架构图生成 C4(Context+Container)

**做法**:agent-runtime 增一 stage,输入 = `get_architecture` 全量(hotspots/boundaries/clusters/layers/packages/entry_points)+ `priorAdr.content` + 仓库 README/DESIGN.md,LLM 产出每仓库一份 `c4.json`{context:{actors[],system,interactions[]},containers[]{name,type,tech,components[],calls[]}} + 对应 mermaid 片段,缓存到 evidence(如 `evidence/<repo>.c4.json`)。gateway 新增 `GET /api/evidence/<repo>/c4`。

**优点**

- 能真正覆盖 Context(actor)+ Container,这是数据图天生缺的。
- 复用现有 LLM pipeline + ADR 语境,产出可含"技术栈/职责"等声明性字段。
- 每仓库一次性生成 + 版本戳,缓存命中即 O(1),不随访问放大。
- 可结合 mermaid 直接喂 E05 渲染。

**权衡/风险**

- LLM 可能臆造 actor/container(幻觉)。缓解:要求 LLM 仅引用 graph 中存在的 entry_points/external packages/boundaries,超范围标 `inferred:true`;ADR 作 ground truth 校准。
- 仓库大变更后需重生成(按 head_sha 失效缓存)。
- Context 层 actor 仍需人工确认(LLM 推断用户角色置信度低)。

### 路径 b — 手动维护 C4 文档随仓

**做法**:仓库内(或 `.baize/c4/`)维护 `context.md`/`container.md`/`component.md`(mermaid),gateway 读取并渲染。

**优点**

- 最忠实、零幻觉、可承载架构师声明性决策(谁是谁的 actor、为何这样切 container)。
- 与 ADR 同源,适合长期演进。

**权衡/风险**

- 维护成本高,易与代码漂移(无人更新即过时)。
- 与 BaiZe"证据驱动"理念冲突:无 graph 证据支撑的纯声明。
- 新仓库冷启动需人工写,无自动兜底。

**定位**:不应作主路径。宜作路径 a 产出的**覆写/校准层**——LLM 生成后,人工可编辑 `c4.override.json` 增删 actor/container,gateway 合并。

### 路径 c — 降级:用 clusters/boundaries 近似"组件视图",不自称 C4

**做法**:浏览器直接渲染现有 hotspots/boundaries/clusters/layers,命名为"组件视图 / 调用耦合图",**不挂 C4 牌**。目录树 = `Folder`/`CONTAINS_FOLDER`;架构图 = boundaries Sankey + clusters 力导;component drill-down = cluster→top_nodes。

**优点**

- 零新基建、零 LLM、零维护。今天就能上。
- 数据 100% 来自 graph,符合证据驱动。
- 对 E03 "目录树/架构图"诉求已足。

**权衡/风险**

- 无法满足"含 C4"的字面需求(map.md ②):缺 actor、缺 deployable container。
- clusters 标签多为重复 `pkg`,可读性差(需 LLM 或规则重命名)。

### 路径 d(增量,针对 K8s 仓库)— 确定性提取 Container

**做法**:扩展 `extract-architecture.cjs` 或 agent-runtime 增一提取器,查 codebase-memory 的 `Chart`/`Resource`/`INFRA_MAPS{kind,service,workload}`,确定性产出 `containers[]{name=workload, type=kind, source=chart}`。非 K8s 仓库该输出为空 → 回退路径 a。

**优点**

- K8s container 层**零幻觉**(workload/service 来自代码+Helm,非 LLM 猜)。lws 正是 K8s operator,直接受益。
- 与路径 a 互补:d 给 ground truth,a 补 actor/context。

**权衡/风险**

- 仅 cloud-native 仓库有效;普通仓库无收益。
- 需 codebase-memory 已索引(多一次依赖)或 lbug 增查(两套图 schema 不同)。

---

## 5. 推荐(解锁 E03)

采用**分层混合**,按"证据优先、声明补充、诚实命名"排序:

1. **Component 层(现在做)** = 路径 c。直接渲染 clusters/boundaries/layers + 目录树(Folder/CONTAINS_FOLDER),命名"组件视图/调用耦合",**不挂 C4 牌**。满足 E03 的"目录/架构图"诉求,零新基建。
2. **Container 层(K8s 仓库优先)** = 路径 d 为主 + 路径 a 兜底。K8s 仓库用 `Chart/Resource/INFRA_MAPS` 确定性提取 deployable unit;非 K8s 仓库 LLM 从 entry_points/external packages/boundaries 推断,标 `inferred`。
3. **Context 层** = 路径 a。LLM 从 `get_architecture` 全量 + ADR + README 生成 actor/system/interaction,缓存 `evidence/<repo>.c4.json` + mermaid,按 head_sha 失效。允许人工 `c4.override.json` 覆写(吸收路径 b 的优点)。
4. **Code 层** = 不另建。等价于现有 Function/Method/Struct/Class 图,浏览器做 cluster→symbol drill-down 即可。
5. **gateway 扩展点** = `generateEvidence`(gateway.ts L77)旁加 `generateC4`,产 `evidence/<repo>.c4.json`;新增 `GET /api/evidence/<repo>/c4`。前端按 E03 形态渲染 mermaid。

**对 E03 的输入**:E03 据此定"做几层"。建议 E03 范围 = 目录树 + 组件视图(路径 c,必做)+ Container/Context(路径 a/d,可选/按仓库类型开关)。**不建议** E03 尝试 C4 Code 层(冗余)。

**风险记录(给 critic/E03)**:① LLM Context actor 幻觉——靠 ADR + `inferred` 标 + 人工覆写三重兜底;② clusters 标签可读性差——需重命名 stage(可并入路径 a 的 LLM 产出);③ 两套图(codebase-memory vs lbug)schema 不一致——路径 d 需明确数据源(优先 codebase-memory,因其有 INFRA_MAPS;lbug 无);④ 缓存失效策略须按 head_sha,否则 C4 与 architecture 不同步。

---

## 附录:证据索引(便于复核)

- 票:`.wayfinder/tickets/E02-arch-browser-c4-source.md`
- codebase-memory schema:`get_graph_schema(Volumes-work-Project-BaiZeArchitect-lws)` — 16 节点标签 / 16 边类型(含 INFRA_MAPS),`adr_present:true`
- codebase-memory architecture:`get_architecture(同项目)` — hotspots/boundaries/clusters/layers/packages/entry_points
- gitnexus 提取器:`agent-runtime/extract-architecture.cjs`(L33-59 三条核心 Cypher;L77-117 产 `{hotspots,boundaries,clusters}`+统计)
- gateway 注入点:`agent-runtime/gateway.ts` L77-111(`generateEvidence`)
- 实样:`evidence/lws.json`(architecture 仅 3 数组 + 统计;priorAdr.content 含 ADR markdown;generatedBy:"gitnexus")
- 全仓 grep `c4` → 0 命中(web/agent-runtime/schemas/docs/.wayfinder,过滤函数名误报后)
- wayfinder 上下文:`.wayfinder/map.md`(B=架构浏览含目录/架构图/C4;E03 blocked-by E02)

## Correction(2026-08-06,post-user-feedback)

本 findings 的 C4 映射(Component=clusters 近似 / Container=K8s INFRA_MAPS / Context=LLM actor)有误,已被 E03 Resolution 订正:

- **Container ≠ Docker/K8s** —— 是可独立运行/部署单元(web/API/DB 等),从构建配置 + 目录结构抽取。
- **Component ≠ Leiden clusters** —— 是 interface 后的职责块,从代码反推 + LLM 命名。
- **四层是嵌套缩放**(Context⊃Container⊃Component⊃Code),非可挑并列视图。

「两系统无原生 C4」结论仍成立。映射以 E03 为准(Context+Container 深度,不做 Component/Code)。
