# 需求分解层级（IR / SR / AR）术语调研

## Question

用户提出的 skill 套件流程为 **IR 录入 → SR 拆分 → AR 拆分 → 场景分析 → 用例分析 → 功能拆分**。本次只回答前置事实问题：IR / SR / AR 这三个层级在需求工程领域的**约定含义**是什么？谁拥有这些术语的定义（标准条款号、方法论出处）？分配需求（allocated requirement）与派生需求（derived requirement）的区分归谁定义？是否存在标准的追溯关系模型？

范围：术语与层级命名本身；不含需求管理工具（DOORS/Jama/Polarion）调研，不含"用户该建什么"的建议。

方法说明：ISO/IEC/IEEE 29148:2018 的术语条款经 ISO 官方 Online Browsing Platform（OBP）页面用真实浏览器逐字核对（非搜索摘要）；IREB CPRE Glossary 下载了 IREB 官方 PDF 逐字核对；Automotive SPICE PAM 3.1 下载了 VDA QMC 官方 PDF 逐字核对；OMG SysML 1.6 下载了 OMG 官方规范 PDF 逐字核对；NASA/SP-2016-6105 Rev.2 下载了 NTRS 官方 PDF 逐字核对；FAA 报告下载了 faa.gov 官方 PDF 逐字核对。付费标准正文未直接读取的，一律标注 `[secondary]` 或 UNRESOLVED。

## Findings

### 1. ISO/IEC/IEEE 29148:2018 定义的需求层级与精确条款号

经 ISO OBP 官方页面（`iso.org/obp/ui`，29148:2018(en)）逐字核对，该标准的层级体系是**按"信息项"（information item）组织的一套规格说明文档层级**，而非 IR/SR/AR 式缩写：

- **requirement（3.1.19）**：原文 "statement which translates or expresses a need and its associated constraints and conditions"；Note 1 to entry 明确 "**Requirements exist at different levels in the system structure**"——"需求存在于系统结构的不同层级"是标准自己的措辞，这是"层级化"概念的标准出处（ISO OBP, ISO/IEC/IEEE 29148:2018 3.1.19）。
- **Business requirements specification / BRS（3.1.4）**：对应 **6.2 Business or mission analysis process**（业务/任务分析过程）；§8.2 给出 BRS 大纲（ISO OBP, 29148:2018 3.1.4、6.2、8.2）。
- **Stakeholder requirements specification / StRS（3.1.29）**：原文 "structured collection of the requirements [characteristics, context, concepts, constraints and priorities] of the stakeholder and the relationship to the external environment"；对应 **6.3 Stakeholder needs and requirements definition process**（利益相关方需要与需求定义过程）；§8.3 给出 StRS 大纲（ISO OBP, 29148:2018 3.1.29、6.3、8.3）。
- **System requirements specification / SyRS（3.1.33）**：原文 "structured collection of the requirements [functions, performance, design constraints, and other attributes] for the system and its operational environments and external interfaces"；对应 **6.4 System [System/Software] Requirements definition process**（系统[系统/软件]需求定义过程）；§8.4 给出 SyRS 大纲（ISO OBP, 29148:2018 3.1.33、6.4、8.4）。
- **Software requirements specification / SRS（3.1.27）**：原文 "structured collection of the essential requirements [functions, performance, design constraints and attributes] of the software and its external interfaces"，标注来源 IEEE Std 1012:2016 modified；§8.5 给出 SRS 大纲，§9.6 给出 SRS 内容（含 **9.6.9 Apportioning of requirements**，需求分配）（ISO OBP, 29148:2018 3.1.27；ITEH 官方预览版目录, ISO/IEC/IEEE 29148:2018 §8.5/§9.6.9, cdn.standards.iteh.ai）。
- **allocated requirement 不是 29148 的术语**。OBP 全文检索无 "allocated requirement" 词条；3.1 全部 37 个术语清单（acquirer…validation）中无 allocated requirement。allocation 仅作为概念出现在 **3.1.23 requirements traceability** 的 "derivation path (upward) and **allocation/flow-down path (downward)**"（见 §6）（ISO OBP, 29148:2018，全文检索 + 3.1 术语清单核对）。
- **derived requirement 是 29148 的术语（3.1.10）**：原文 "requirement deduced or inferred from the collection and organization of requirements into a particular system configuration and solution"，来源标注 EIA 632:1999 modified；Note 给出 parent/child 措辞（ISO OBP, 29148:2018 3.1.10）。
- 版本沿革：29148:2018 "cancels and replaces the first edition (ISO/IEC/IEEE 29148:2011)"；其 SRS 内容框架继承 IEEE 830《IEEE Recommended Practice for Software Requirements Specifications》(IEEE Std 830-1998) 一路的 SRS 实践——IEEE 830-1998 出现在 IREB 术语表参考文献 [IEEE830] 中（ISO OBP 29148:2018 Foreword；IREB CPRE Glossary v2.2.0 References p.31）。

**结论**：29148 的"标准阶梯"是 **BRS → StRS → SyRS → SRS**（业务 → 利益相关方 → 系统 → 软件），配 derived requirement（3.1.10）与 allocation/flow-down 概念（3.1.23），但没有 IR/SR/AR 缩写，也没有 "allocated requirement" 词条。

### 2. 是否存在标准或主流方法论使用 IR / SR / AR 字面缩写？

**没有国际标准或主流认证体系把 IR/SR/AR 作为标准层级缩写。**逐域核对：

- **ISO/IEC/IEEE 29148:2018**：无。OBP 全文检索 "allocated requirement" 无结果，3.1 术语表 37 条无 IR/SR/AR 相关词条（ISO OBP 核对）。
- **IREB CPRE Glossary v2.2.0（2025-10-01，Martin Glinz，IREB e.V. 官方 PDF）**：缩写表（p.29）全部条目为 CCB、CPRE、DFD、ER、ERD、IREB、RE、SRS、SyRS、UML——**无 IR/SR/AR**（IREB CPRE Glossary v2.2.0 p.29）。
- **INCOSE**：搜索索引显示 INCOSE IS2013 演示文稿《The Development V》使用 **SR = Stakeholder Requirements、AR = Allocated Requirements** 的配对 `[secondary]`——incose.org 对本环境返回 403，未能直接核对原文（incose.org, IS2013-pdf/4-5-3.pdf，经搜索索引转述）。
- **NASA**：NASA/SP-2016-6105 Rev.2 使用 stakeholder expectations / technical requirements / logical decomposition / **allocated（作为动词与定语）/ derived requirements**，不使用 IR/SR/AR 缩写（NASA/SP-2016-6105 Rev.2 §4.0、§4.2、§4.3，NTRS 20170001761，逐字核对）。
- **DO-178C**：使用 **high-level requirements (HLR) / low-level requirements (LLR) / derived requirements**，不用 IR/SR/AR（RTCA DO-178C；定义经 FAA 官方报告逐字引用 DO-178B 同文 glossary，见 §3）。
- **Automotive SPICE 3.1**：层级以**过程号**表达：SYS.1 Requirements Elicitation、SYS.2 System Requirements Analysis、SYS.3 System Architectural Design、SWE.1 Software Requirements Analysis——过程名原文逐字核对自 VDA QMC 官方 PAM 3.1 PDF（Automotive SPICE PAM v3.1, VDA QMC, p.13；vda-qmc.de 官方 PDF）。
- **ISO 26262**：其术语核心是 safety requirement / safety goal 等功能安全概念，未见 IR/SR/AR 层级缩写——但其正文付费，**全文未核对，UNRESOLVED**（仅依据公开摘要层面的检索）。
- **中国国标 lineage**：GB/T 9385-2008《计算机软件需求规格说明规范》、GB/T 8567-2006《计算机软件文档编制规范》均无任何 IR/SR/AR 缩写（见 §4）。
- **企业/厂商约定（这是 IR/SR/AR 的实际出处）**：华为云 ProjectMan 官方用户手册《Requirement Management Process / Managing IPD-System Device Project Requirements》记载 **IR（Initial Requirement，初始需求）→ SR（System Requirement，系统需求）→ AR（Allocated Requirement，分配需求）** 的需求分层，AR 定义为"将系统需求分配、细化到硬件、软件、结构、服务或具体子系统/模块"的执行性需求 `[secondary]`——support.huaweicloud.com 被验证码拦截无法直接读取，内容经搜索索引转述，**需人工复核原文**（support.huaweicloud.com, projectman_01_8004.html）。同类 RR（Raw Requirement 原始需求）→IR→SR→AR 四层变体见于 IPD 实践转述 `[secondary]`（cnblogs.com 等二手来源，不采信为定义出处）。

**结论**：IR/SR/AR 是**企业级（IPD/华为式）需求管理约定**，最接近的标准化对应是 29148 的 StRS/SyRS + allocation 概念，以及 ASPICE 的 SYS.1→SYS.2→SYS.3→SWE.1 过程链。INCOSE 材料中 SR 偶指 Stakeholder Requirements，缩写必须结合上下文。

### 3. 分配需求（allocated requirement）vs 派生需求（derived requirement）

**派生需求的标准 owner 明确，分配需求没有单一标准 owner**：

- **derived requirement**：
  - ISO/IEC/IEEE 29148:2018 **3.1.10**（原文见 §1）：由"需求集被组织成特定系统构型与方案"而**推断/演绎**出来的需求，标注来源 EIA 632:1999（ISO OBP 逐字核对）。
  - DO-178B/DO-178C glossary："**Additional requirements resulting from the software development process, which may not be directly traceable to higher-level requirements**"——由设计决策产生、可能无法直接追溯到高层需求的新增需求；FAA 官方报告 DOT/FAA/AR-08/34 逐字引用（FAA AR-08-34, p.6，PDF p.18，faa.gov 官方 PDF 核对）。DO-178C 保留同套定义，并由 FAA AC 20-115D 认可为适航符合性方法（FAA AC 20-115D, faa.gov/documentLibrary/media/Advisory_Circular/AC_20-115D.pdf）。
- **allocated requirement**：
  - 29148 **未定义该词条**；最接近的标准措辞是 3.1.23 的 "allocation/flow-down path (downward)"（ISO OBP 核对）。
  - SEBoK（BKCASE 维护、INCOSE 背书的系统工程知识体系，引用 INCOSE Needs and Requirements Manual v1.1, 2022）给出权威表述："**Allocation is the process by which the requirements at one level of the physical architecture are assigned to those entities at the next lower level of the architecture that have a role in the implementation of the allocated requirement**"；下层生成的需求称为 allocated parent 的 child requirements（SEBoK v2.14, System Requirements Definition 词条, sebokwiki.org，逐字核对）。
  - NASA/SP-2016-6105 Rev.2 §4.3 Logical Decomposition："**decompose top-level (or parent) requirements and allocate them down to the lowest desired levels** of the project"，产出 "sets of derived technical requirements"；§4.2 含 Figure 4.2-3 "**The Flowdown of Requirements**"（父→子需求流图，图像本体未 OCR）（NASA/SP-2016-6105 Rev.2 pp.68、73-76，NTRS 20170001761 逐字核对）。
- **区别**（三方来源一致的语义）：**分配（allocation）回答"哪个下层架构元素负责满足这条既有需求"**——需求内容沿架构指派，通常带预算拆分（budgeting：质量、功耗、时延等指标在元素间分摊，SEBoK 同词条）；**派生（derivation）回答"分析/设计过程中新推断出哪条原本没人提的需求"**——需求条数增加。二者正交：DO-178C 中 derived requirement 可以是 HLR 也可以是 LLR（FAA AR-08-34 p.7）；一条 allocated requirement 也可以同时是 derived。

### 4. 中文实践与国标 lineage 中各术语归谁

- **GB/T 9385-2008《计算机软件需求规格说明规范》**：全国标准信息公共服务平台（std.samr.gov.cn，官方）详情页载明——推荐性国标、**现行**，2008-04-11 发布、2008-09-01 实施，2022-01-10 复审**结论"继续有效"**，全部代替 GB/T 9385-1988《计算机软件需求说明编制指南》，TC28/SC7 归口（std.samr.gov.cn GB/T 9385-2008 详情页逐字核对）。注：镜像站 biaozhun.org 标其"废止"，与官方平台冲突，**不采信镜像**。该标准给出 SRS 编制要求与 SRS 提纲示例（含"需求分配"类条目，镜像摘要转述 `[secondary]`，正文图片版未逐页核对）（GB/T 9385-2008 内容简介；biaozhun.org 页面）。
- **GB/T 9385-1988**：平台标注其"非等效采用 IEEE 830:1984"（std.samr.gov.cn 检索页转述 `[secondary]`）——即中国 SRS 规范的美系源头是 IEEE 830  lineage。
- **GB/T 8567-2006《计算机软件文档编制规范》**：作为相近标准列于 GB/T 9385-2008 官方详情页，是 SRS 文档模板的国标归属（std.samr.gov.cn 详情页"相近标准"列表核对）。
- **原始需求 / 初始需求 / 系统需求 / 分配需求**：中文里这套四分（RR/IR/SR/AR）是**企业流程术语**（华为 IPD 式，见 §2），**没有任何中国国标或检索到的权威行业标准把"原始需求/初始需求/分配需求"定义为标准层级术语——UNRESOLVED**（已检索 std.samr.gov.cn、GB/T 9385/8567 lineage、公开教材层面；未见国标定义）。中文教材体系的通行分层是**业务需求 / 用户需求 / 系统需求（功能需求）**三层，出自 Karl Wiegers《Software Requirements》(3rd ed., Microsoft Press, 2013) `[secondary]`（纸质书，未在线核对原文）；清华大学软件工程教材样章述"用户需求和软件需求集中在一起描述"的两分 `[secondary]`（tup.tsinghua.edu.cn 样章）。
- 中文语境下 **系统需求=System Requirement、软件需求=Software Requirement** 有国标锚点（GB/T 9385-2008 名称本身即"软件需求规格说明"）；**原始需求/初始需求/分配需求** 只有企业实践锚点。

### 5. IREB CPRE 命名了哪些层级、是否定义分解链

IREB CPRE Glossary v2.2.0（IREB e.V. 官方 PDF，逐字核对）命名的层级类术语：

- **business requirement**（p.3）："A requirement stating a business goal, objective or need of an organization"。
- **stakeholder requirement**（p.21）："A requirement expressing a stakeholder desire or need. Note: …typically written by stakeholders and express their desires and needs from their perspective."
- **user requirement**（p.26）："expressing a user need… a subset of stakeholder requirements"。
- **system requirement**（p.24）："A requirement pertaining to a system"。
- **kind of requirement**（p.12）分类：system requirements（=functional + quality + constraints）/ project requirements / process requirements。
- **requirements specification**（p.18）区分 customer requirements specification（客户写）与 system/software requirements specification（供方写）；缩写 SRS、SyRS 入缩写表（p.29）。

**CPRE 不定义 derived requirement、allocated requirement、IR/SR/AR，也不定义任何显式分解链**；其 traceability 定义（p.25）为"ability to trace a requirement back to its origins, forward to its implementation in design and code and its associated tests"（IREB CPRE Glossary v2.2.0，上述页码）。即 IREB 的"层级"止于 business / stakeholder(user) / system 三层视角区分。

### 6. 层级间追溯模型：关系类型与 owner

存在多个成文的追溯关系模型，关系类型与 owner 如下：

- **ISO/IEC/IEEE 29148:2018 3.1.23 / 3.1.24**（原文逐字）：requirements traceability = "**identification and documentation of the derivation path (upward) and allocation/flow-down path (downward)** of requirements in the requirements set"；Note 定义 **parent requirement（上）/ child requirement（下）**；requirements traceability matrix（3.1.24）链接需求到其高层需求/需要或低层实现（ISO OBP 核对）。关系词：**derivation（向上溯源）、allocation/flow-down（向下分配）、parent/child**。
- **OMG SysML 1.6 §16.1 Requirements**（OMG 官方规范 PDF，p.181 起，逐字核对）：需求关系集 = **containment**（UML 命名空间包含，构成 requirements hierarchy / 分解为 child requirements）、**«deriveReqt»**（derived requirement 指向 source requirement，"generally correspond to requirements at the next level of the system hierarchy"）、**«satisfy»**（设计/实现元素满足需求）、**«verify»**（测试用例验证需求）、**«refine»**、**«copy»**（master/slave 复用）、**trace**。这是目前最成文、最可操作的关系类型集合（OMG SysML v1.6, §16.1, omg.org/spec/SysML/1.6）。
- **Automotive SPICE PAM 3.1**：**SYS.2 outcome 6** "consistency and **bidirectional traceability** are established between **stakeholder requirements and system requirements**"；SWE 过程组职责原文 "management of **software requirements derived from the system requirements**"（VDA QMC PAM 3.1 pp.13、40，官方 PDF 逐字核对）。关系词：bidirectional traceability（stakeholder ↔ system；system → software derive）。
- **NASA/SP-2016-6105 Rev.2**：stakeholder expectations → technical requirements → logical decomposition（decompose + allocate）→ derived technical requirements → design solution 的递归流（§4.0 p.50、§4.3 p.73 逐字核对）。
- 综合关系词汇表（跨来源对齐）：**derives / derived-from**（29148 derivation path；SysML «deriveReqt»；ASPICE derive）、**satisfies**（SysML «satisfy»；15288/15289 体系亦用 satisfy 描述架构元素与需求关系）、**verifies**（SysML «verify»）、**allocates / flow-down**（29148 3.1.23；SEBoK/NASA allocation；无对应 SysML 原语，SysML 用单独 §15 Allocations 表达功能到结构的分配——本调研未展开）、**parent/child（containment）**（29148 Note；SysML containment）、**refines**（SysML «refine»）。

## Recommendation

（仅术语锚定建议，产品形态属设计会话决策。）

1. **不要把 IR/SR/AR 当作有标准背书的术语引用**。写 skill 文档时，三级应各挂两个名字：企业别名（IR/SR/AR）+ 标准锚（29148 StRS/SyRS + allocation 概念；IREB stakeholder requirement/system requirement）。评审时只对标准锚负责。
2. **SR 是唯一一个三方一致、零歧义的字母**：System Requirement（29148 3.1.33/6.4；IREB p.24；ASPICE SYS.2）。IR 与 AR 必须在使用处给出定义，因为 IR 至少有两种常见读法（Initial Requirement / Interface Requirement），AR 在 INCOSE 材料之外基本只有 Allocated Requirement 一读。
3. **追溯关系词汇建议直接采用 SysML 1.6 §16.1 的关系集**（satisfy / verify / deriveReqt / refine / trace / containment + 29148 的 allocate/flow-down），它是唯一一个把关系类型完整枚举为规范原语的成文来源，且与 29148/ASPICE 的追溯语义兼容。
4. 若 skill 套件面向中文企业用户，"原始需求→初始需求→系统需求→分配需求"的链条可直接引用华为云 ProjectMan 手册作为厂商出处，但需在文档中显式标注其为**厂商约定而非标准**，并给出与 29148 四级信息项（BRS/StRS/SyRS/SRS）的映射表。

## Risks

- **华为云手册原文未直接读取**（Tencent EdgeOne 验证码拦截），IR/SR/AR 的定义表述经搜索索引转述；该来源同时是"IR=Initial Requirement"最直接的一手出处，**人工复核原文前不要逐字引用**（support.huaweicloud.com/intl/en-us/usermanual-projectman/projectman_01_8004.html）。
- **INCOSE 一手文档全部未直接读取**：GTWR v4（INCOSE-TP-2006-004-04）与 NRM v1.1（INCOSE-TP-2021-002-01）需付费/会员，incose.org 对本环境 403；本文 INCOSE 侧表述均经 SEBoK（INCOSE 背书知识体）转述，SEBoK 页面本身已逐字核对但仍是二手。
- **ISO 26262 全文未核对**（付费），其是否在某条款使用 SR/AR 类缩写属 UNRESOLVED；按该标准主题（功能安全）判断可能性低。
- **GB/T 9385-2008 正文未逐页核对**（官方平台"查看全文"为图片版/需登录）；其 SRS 提纲含"需求分配"条目系镜像站摘要转述 `[secondary]`。另注意 biaozhun.org 标该标准"废止"与官方平台"现行（2022 复审继续有效）"冲突，已采信官方平台，如用于合规引用请再确认。
- **NASA 手册 Figure 4.2-3（The Flowdown of Requirements）为图像**，未 OCR，本文只引用其标题与周边正文。
- ISO OBP 核对依赖 Vaadin 单页应用渲染，已通过真实浏览器取回正文；若 ISO 修订页面结构，引用路径（OBP term 锚点）可能失效，但条款号稳定。

## Sources

- **ISO/IEC/IEEE 29148:2018**《Systems and software engineering — Life cycle processes — Requirements engineering》——拥有：requirement(3.1.19)、BRS(3.1.4/6.2/8.2)、StRS(3.1.29/6.3/8.3)、SyRS(3.1.33/6.4/8.4)、SRS(3.1.27/8.5/9.6)、derived requirement(3.1.10)、traceability(3.1.23/3.1.24)。条款原文经 ISO 官方 OBP 逐字核对：https://www.iso.org/obp/ui/en/#iso:std:iso-iec-ieee:29148:ed-2:v1:en ；目录/§9.6.9 另经 ITEH 官方预览版核对：https://cdn.standards.iteh.ai/samples/72089/62bb2ea1ef8b4f33a80d984f826267c1/ISO-IEC-IEEE-29148-2018.pdf
- **IREB CPRE Glossary v2.2.0**（Martin Glinz, IREB e.V., 2025-10-01）——拥有：business/stakeholder/user/system requirement 定义、kind of requirement 分类、SRS/SyRS 缩写、traceability 定义；同时证明其**不含** derived/allocated/IR/SR/AR。IREB 官方 PDF：https://cockpit-v1.ireb.org/media/pages/downloads/cpre-glossary/510f672cfd-1760005471/ireb_cpre_glossary_en_2.2.pdf
- **Automotive SPICE Process Assessment Model v3.1**（VDA QMC 官方 PDF）——拥有：SYS.1/SYS.2/SYS.3/SWE.1 过程名与目的、SYS.2 outcome 6 双向追溯、SWE 组"software requirements derived from the system requirements"。https://vda-qmc.de/wp-content/uploads/2023/02/Automotive_SPICE_PAM_31_EN.pdf
- **OMG SysML v1.6**（OMG 官方规范 PDF）——拥有：§16.1 需求关系原语集（containment/deriveReqt/satisfy/verify/refine/copy/trace）。https://www.omg.org/spec/SysML/1.6/PDF
- **NASA/SP-2016-6105 Rev.2, NASA Systems Engineering Handbook**（NTRS 官方）——拥有：§4.0 四个系统设计过程、Figure 4.2-3 The Flowdown of Requirements、§4.3 Logical Decomposition（decompose + allocate + derived technical requirements）。https://ntrs.nasa.gov/citations/20170001761 （PDF: /api/citations/20170001761/downloads/20170001761.pdf）
- **SEBoK v2.14, System Requirements Definition**（BKCASE/INCOSE 背书知识体，转述 INCOSE NRM v1.1 2022）——拥有：allocation 的过程定义、budgeting、requirement tree、追溯模型图。https://sebokwiki.org/wiki/System_Requirements_Definition
- **FAA DOT/FAA/AR-08/34, Requirements Engineering Management Phase I Findings Report**（faa.gov 官方 PDF）——逐字引用 DO-178B glossary 的 HLR/LLR/derived requirement 定义（DO-178C 沿用）。https://www.faa.gov/sites/faa.gov/files/aircraft/air_cert/design_approvals/air_software/AR-08-34.pdf
- **FAA AC 20-115D**——DO-178C/ED-12C 的适航认可文件。https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_20-115D.pdf
- **全国标准信息公共服务平台 GB/T 9385-2008 详情页**（官方）——拥有：标准名称、现行状态、复审结论（2022-01-10 继续有效）、代替 GB/T 9385-1988、TC28/SC7 归口、相近标准列表（含 GB/T 8567-2006）。https://std.samr.gov.cn/gb/search/gbDetailed?id=71F772D7FB12D3A7E05397BE0A0AB82A
- **华为云 ProjectMan 用户手册《Requirement Management Process》**（厂商一手文档，`[secondary]` 经搜索索引转述，原文被验证码拦截）——拥有：IR（Initial Requirement）→SR（System Requirement）→AR（Allocated Requirement）企业分层定义。https://support.huaweicloud.com/intl/en-us/usermanual-projectman/projectman_01_8004.html
- **Karl Wiegers & Joy Beatty, Software Requirements, 3rd ed., Microsoft Press, 2013**（纸质书，`[secondary]` 未在线核对）——拥有：business requirement / user requirement / system requirement 三层模型的方法论出处。
- **INCOSE IS2013《The Development V》演示文稿**（incose.org，`[secondary]` 经搜索索引转述，直接访问 403）——SR=Stakeholder Requirements、AR=Allocated Requirements 的 INCOSE 侧缩写用例。https://www.incose.org/wp-content/uploads/legacy/presentation/IS2013-pdf/4-5-3.pdf
