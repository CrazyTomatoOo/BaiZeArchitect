# BaiZe 软件全量设计

本上下文描述一套「软件全量设计」skill 套件所操作的领域语言：把一条需求从录入开始，逐层拆成可追溯、可校验的设计条目。

标准锚以 ISO/IEC/IEEE 29148:2018 与 OMG SysML 1.6 为准；本项目自带的企业别名（IR/SR/AR）与之并列，评审时只对标准锚负责。

## 需求层级

**初始需求（IR, Initial Requirement）**:
干系人提出的一项需求，尚未分解；是链条的顶端，语义等价 29148 的 Stakeholder Requirements（StRS）。业务/任务级需求（BRS 层）不建模。
_Avoid_: 原始需求、业务需求、用户需求、stakeholder requirement（作为正式用词）

**系统需求（SR, System Requirement）**:
由初始需求分解而来、描述系统应当做什么的一项需求；语义等价 29148 的 SyRS。
_Avoid_: 软件需求、功能需求、system requirement（作为正式用词）

**分配需求（AR, Allocated Requirement）**:
系统需求在架构元素上的指派：**哪一条既有 SR 由哪个元素负责满足**。分配不新增需求内容，只指定责任归属。
_Avoid_: 派生需求、derived requirement、架构需求、设计约束

> **分配与派生正交。** `allocates` 回答「谁负责满足这条既有需求」（条数不变，可带指标分摊）；`derives` 回答「分析/设计中新推断出哪条原本没人提的需求」（条数增加）。本项目**只做分配**——派生需求不进模型。

## 结构

**需求条目（Requirement Item）**:
需求的最小单位：可独立标识、独立引用、独立追溯。模型**只有条目级**——不存在文档级资产；说明书是条目的渲染产物，不属于模型。
_Avoid_: 需求文档、需求说明书、SRS、章节、段落

**需求树（Requirement Tree）**:
IR → SR → AR 的单亲分解结构：每一条下层需求有且仅有一条父需求。
_Avoid_: 需求图、需求网络、DAG

> **已接受的代价（单亲的冗余）。** 一条下层需求事实上同时满足两条上层需求时（例如一条统一的导出服务同时满足「支持 CSV/Excel」与「导出可审计」两条 IR），模型要求**复制**成两条、各挂一条父。选择单亲是为了让校验便宜；代价是同一件事写两遍、改的时候要改两处。

**架构元素（Architecture Element）**:
分配需求所指向的组件、子系统或模块；AR 的归属对象。其来源与层级**尚未定**（见「未定」）。
_Avoid_: 模块、服务、包

## 关系

**parent**:
子条目 → 父条目。必填，单亲。反向查询由 CLI 推导，不落盘。
_Avoid_: children、upstream

**covers**:
SR → IR 的**验收线索**（`IR-001#a3`）。必填，**允许空数组**。
_Avoid_: satisfies、coversRequirement

**allocates**:
AR → 架构元素。必填。
_Avoid_: assigns、mapsTo

> **只存单向**（子指父、SR 指 IR、AR 指元素），反向关系是查询不是数据——两边都存必然漂移。关系名用短英文，不套 SysML 的 `«»` 记法；文档里给映射表即可（`covers` ≈ `«satisfy»`，`parent` ≈ containment，`allocates` ≈ 29148 的 allocation/flow-down）。
>
> **`covers` 必填且允许空数组**是刻意的：`covers: []` 是「明确声明一条验收线索都不覆盖」，缺字段是「忘了」。两者必须分得开，否则 `validate` 报的「未覆盖」里混着遗漏与故意，人就再也不信它。

## 字段

**id**:
永不变的顺序编号（`IR-001` / `SR-014` / `AR-003`），由 CLI 发号。语义放 `title`，改语义不断引用。
_Avoid_: slug、UUID、路径

**title**:
人类可读的短名，可随意改。
_Avoid_: name、heading

**statement**:
一句话陈述。可判定的正向要求：可证伪、不含「等等 / 尽量 / 尽可能」。**不强制** SHALL/MUST 句式。
_Avoid_: description、body、正文

**acceptance**:
验收线索，逐条可寻址（`a1`、`a2`…）。**只有 IR 必填**（≥1 条）；SR/AR 可选，其验收基准从父 IR 继承。
_Avoid_: 验收标准、test case、AC

> **必须由人确认的字段有两个：`acceptance` 与 `statement`**；其余（`id` / `title` / `priority` / `source` / `rationale`）agent 起草即可。
>
> 理由：`acceptance` 是 `covers` 的对账基准，没人确认整条覆盖率校验就是空的；`statement` 是「这条需求到底在说什么」的最终定义，agent 起草的措辞必须由人认领才算数。
>
> 「人已确认」在模型里怎么表示、改动后是否失效——**尚未定**（见「未定」）。

**确认（Confirmation）**:
人对 `statement` 与 `acceptance` 的认领；未经确认的需求不算「录入完成」。
_Avoid_: 审批、approval、审核通过

> `priority` / `source` / `rationale` 可选。

## 覆盖率

**覆盖率（Coverage）**:
IR 的每条验收线索是否被至少一条 SR 的 `covers` 指向。按**验收线索级**判定——条目级只说明「有人理过这条需求」，不说明「每条验收线索都有人负责」。
_Avoid_: 完成度、进度

> **分级**：未覆盖的验收线索在 `validate` 里是 ERROR；`status` 单独显示进度（`IR-001 2/3 已覆盖`）。渐进拆分不被门禁误伤，门禁又真挡得住。孤儿（SR/AR 无 `parent`）是 ERROR；**「每条 SR 必须有 AR」是 WARNING**——SR→AR 是架构决策，硬挡会逼人写假 AR。
>
> `validate` 与 `status` **共用同一份覆盖率数据**，不各算一套。

## 未定

以下术语尚未在工单中锁定，暂不写入正文：

- 架构元素的来源、标识与层级（工单：架构元素的来源、标识与层级）
- 人工确认的记录方式与失效规则（工单：人工确认的记录方式与失效规则）
- 验收线索的粒度与书写规范（工单：验收线索的粒度与书写规范）
- 场景 / 用例 / 功能 三类分析产物的术语与挂载点
- 资产存储与目录约定、CLI 的形态与输出契约
