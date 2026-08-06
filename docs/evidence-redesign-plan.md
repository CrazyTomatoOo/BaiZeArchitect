# BaiZe 证据页重构方案

> Wayfinder 图「证据页重构方案(A+B,A 为主)」的终点产物。
> 决策来源:E01-E06 六票(见 §10 附)。本图只产方案,不动代码;实施另起 effort。
> 总体:**A+B,A 为主**。A=证据/决策记录作为需求设计流程一部分,生命周期绑需求;B=架构浏览(目录/架构图/C4)独立能力。

## 1. 概述

把现证据页(`baize-dashboard`,带「证据」标签的原始代码分析数据 dump,5 硬伤:词抽象/术语堆砌/纯数据无叙事/ADR raw markdown 不可读/跟设计审核脱钩)重构为:

- **A(主)**:证据 + 决策记录绑入需求设计流程,生命周期与需求关联(证据是决策依据,决策是设计过程产物)。
- **B(辅)**:独立架构浏览能力(目录树 + C4 全四层)。
- **通则**:markdown 必须渲染(非原文本),图支持 mermaid;gene 作为资产,展示让人获得"经验"。

不做:换栈(Vite+Lit 不变)、TUI、gateway 后端大改(仅按需加端点)。

## 2. 数据模型变更(E01)

### 2.1 证据 = 按需求的设计时快照

- 冻结该次设计所依据的架构事实,新增 **req ↔ evidence 快照绑定**(req-keyed)。
- 审核:看到的就是 AI 当时看到的(不取实时引用——与"证据=审核依据"初衷相悖)。
- 数据:复用 `/api/evidence/<repo>` 的 architecture(hotspots/boundaries/clusters),按 requirement 固化快照。

### 2.2 决策记录 = 设计包,绑 requirement id

- 现状:`out/design-package-<repoId>-<ts>.md`(按 repo+ts,不绑 req id)。改:**绑 requirement id**。
- 归档:设计包入资产库后,**反过来喂下次设计输入,替代 repo 级 priorAdr**(`evidence/<repo>.json.priorAdr`)——成闭环。
- store 现无 decisions/adr 表;新增 req↔evidence 快照表/字段 + 设计包 req-keyed。

### 2.3 归档触发

- `archive` 阶段 approve(末阶段)触发:设计包 + gene 落库进资产库。

## 3. 页面与 IA(E01 + E03 + E06)

### 3.1 最终 sidebar(四区)

```
总览
工作:需求 · 待决策
资产库:需求管理 · 场景库 · 用例库 · 功能库 · 沉淀
管理:系统 · 架构
```

对照 `web-redesign-plan.md` §4 现:总览/工作(需求·待决策)/资产库(需求管理·场景库·用例库·功能库)/管理(系统·证据)——资产库加「沉淀」,管理「证据」改名「架构」。

### 3.2 证据拆分(baize-dashboard 退役证据角色)

现 `baize-dashboard` 证据页被三向拆空 → 退役证据角色,改造为 `baize-architecture-browser`(或新组件):

- 证据快照 → 需求设计流程依据区(E01)
- architecture 部分(clusters/boundaries/hotspots)→ 架构浏览器 Code 层(E03)
- ADR/gene → 资产库沉淀 tab(E01/E04)

### 3.3 系统页(E06)

- **设置**:模型配置(provider/modelId/apiKey)+ 偏好。
- **系统状态诊断**:evidence 索引状态 / gitnexus 健康 / ws 诊断 + **手动重新索引按钮**。

## 4. 架构浏览器 B(E03)

落位:取代现「证据」nav,改名「架构」,管理组(管理:系统·架构)。子视图(tab/section):

### 4.1 目录树

文件/目录浏览,从 repoPath 扫。

### 4.2 C4 全四层(嵌套缩放 Context⊃Container⊃Component⊃Code)

**修订(2026-08-06)**:原 E03 仅 Context+Container,用户改做全四层;**Code 层取代原"代码结构图"独立视图**(clusters/boundaries/hotspots 不再单独成"非-C4"视图,并入 Component/Code 作支撑数据)。

| 层 | 含义 | 数据来源 |
| --- | --- | --- |
| Context | 系统 + 外部 actor/依赖 | LLM 生成,缓存 `evidence/<repo>.c4.json`(按 head_sha 键) |
| Container | 可独立运行单元(web/API/DB 等,**非 K8s**) | 从构建配置(package.json scripts / Dockerfile / compose services)+ 目录结构抽取 |
| Component | interface 后的职责块(一组相关类) | 从代码反推滤 model/util 噪声 + LLM 命名(成本高,用户要求做全) |
| Code | C4 Code 层(取代原代码结构图) | 并入 clusters/boundaries/hotspots 作支撑 |

**C4 订正**:Container ≠ Docker/K8s(是可独立运行/部署单元);Component ≠ React/Leiden 聚类(是 interface 后的职责块);四层是嵌套缩放,非可挑并列。E02 旧映射(Component=clusters/Container=K8s)作废。

### 4.3 渲染

C4 图用 E05 的 `baize-markdown` + mermaid 渲染。

## 5. gene 资产化(E04)

### 5.1 展示(列表-详情,与资产库一致)

- **左列表**:摘要 + 信号 chips + 质量分。
- **右详情**:`preconditions`(when-to-use)/ `strategy`(procedure 步骤,含代码路径)/ `validation` / `constraints` / `_source` 全显;`baize-markdown` 渲染 strategy/validation。
- 根因对症:现状只露 summary,藏了可复用的 preconditions/strategy/validation;新版全显。

### 5.2 落位(合「沉淀」tab)

- 资产库 → **5 tab**:需求管理 / 场景 / 用例 / 功能 / **沉淀**。
- 「沉淀」tab 内部分「决策记录」|「gene」两段(各列表-详情)。

### 5.3 检索复用(混合)

- 设计 run 按 signals 调 `evolver_search_assets` 自动推荐 N gene + 设计者在需求详情「依据区」(E01)可增减 → 最终注入设计 prompt。
- 用现有 evolver 检索基建(`evolver_search_assets` 语义按 signals 匹配)。

## 6. markdown / mermaid 渲染(E05)

### 6.1 库与方案

- **marked**(sync parse)+ **mermaid.js**(dynamic import ~280KB code-split);markdown-it 备选。
- 关键:用 `mermaid.render(id, code)` 返回 SVG **自行注入 shadow DOM**(非 `mermaid.run()`——后者扫 document 跨不了 shadow 边界),零全局副作用。

### 6.2 主题集成

- mermaid `themeVariables` 只收 hex 不收 CSS vars(open #6860);运行时 `getComputedStyle` 读 `--bg/--text/--surface/--border` 解 hex 喂 `theme:'base' darkMode:true`。

### 6.3 时序

`marked.parse(sync)` → `unsafeHTML` 注入 → `updated()` → `dynamic import('mermaid')` + `initialize(once)` → 循环 `await mermaid.render()` 每个 `.mermaid` 占位。

### 6.4 落地

共享 `baize-markdown` 组件(代码骨架在 `research/E05-markdown-mermaid-render.md`)。各页(需求设计包、ADR、gene 详情、C4 图)共用。

## 7. 迁移 / 实施顺序建议

1. **`baize-markdown` 组件**(E05):基础件,各页共用。
2. **数据层**:req↔evidence 快照表/字段 + 设计包 req-keyed + 归档触发(E01)。
3. **资产库扩 5 tab**(沉淀:决策记录+gene,E04):列表-详情 + `baize-markdown` 渲染。
4. **`baize-architecture-browser`**(E03):目录树 + C4 全四层;gateway `generateC4` 缓存端点。
5. **需求详情织入**(E01):依据区(证据快照)+ 归档阶段产物(设计包 rendered)+ gene 推荐增减(E04)。
6. **系统页**(E06):设置 + 系统状态诊断 + 手动重索引。
7. **IA 收口**:sidebar 四区 + 证据 nav 改名架构。
8. **priorAdr 输入源迁移**:从 repo 级 evidence 迁到资产库决策记录(E01 闭环)。

## 8. 验收标准

- [ ] sidebar 四区 + 资产库 5 tab(含沉淀)+ 管理组(系统·架构)渲染。
- [ ] 需求详情:依据区(证据快照)+ 归档阶段产物(设计包 rendered via `baize-markdown`)+ gene 推荐增减。
- [ ] 架构浏览器:目录树 + C4 全四层(Context/Container/Component/Code),Code 层含 clusters/boundaries/hotspots 支撑。
- [ ] C4 图 mermaid 渲染 + 主题对齐(石墨靛蓝 dark)。
- [ ] gene 详情全显 preconditions/strategy/validation,`baize-markdown` 渲染。
- [ ] 设计 run 自动检索推荐 gene(`evolver_search_assets`)+ 人工增减 → 注入 prompt。
- [ ] 归档:archive 阶段 approve → 设计包 + gene 进资产库沉淀 tab。
- [ ] 闭环:下次设计读资产库决策记录作 prior(替代 repo priorAdr)。
- [ ] 系统页:设置 + 状态诊断 + 手动重索引可用。
- [ ] markdown 全站渲染(非 raw pre),mermaid 图正常。
- [ ] 现有功能不退化:6 阶段流水线 run/approve、资产 CRUD、证据/ADR/gene 可视化(迁移后)。

## 9. Not yet specified(交实施时定)

- prior 决策输入选择:下次设计读哪些归档决策记录作 prior(全部?同 workspace?最新 N?)——依赖资产库形态落地后再 sharp。
- 逐页微布局(组件内卡片排列)——实施时按 tokens 落。

## 10. 附

- 决策票:`.wayfinder/tickets/E01`~`E06`(全 closed,决议在各票 Resolution 段)。
- research:`.wayfinder/research/E02-arch-browser-c4-source.md`(C4 数据源 + Correction)、`.wayfinder/research/E05-markdown-mermaid-render.md`(渲染方案 + 代码骨架)。
- 上游方案:`docs/web-redesign-plan.md`(web 重构,tokens/IA 基础)。
- wayfinder 图:`.wayfinder/map.md`(Decisions so far 索引)。
