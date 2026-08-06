# Wayfinder Map — 证据页重构方案(A+B,A 为主) `wayfinder:map`

## Destination

一份评审通过的《证据页重构方案》:把证据 + 决策记录绑入需求设计流程(A 主)、新增架构浏览能力(B)、gene 资产化、markdown/mermaid 渲染。产出为 `docs/web-redesign-plan.md` 的增补章节 or 独立 doc。本图只产决策与方案,不动代码(实施另起 effort)。

## Notes

- Domain:BaiZe web 证据/资产/需求设计流程重构。
- Tracker:local-markdown(无 git remote);票在 `tickets/`,blocking 用 body 约定;research 产出在 `research/`。
- Skills:grilling、domain-modeling、prototype、research。
- 用户 charting 输入(2026-08-06,已定方向,不另起票):
  - 总体:**A+B,A 为主**。A=证据/决策记录作为需求设计流程一部分,生命周期绑需求;B=架构浏览(目录/架构图/C4)独立能力。
  - ① 证据是决策依据,决策是设计过程产物,绑需求生命周期。
  - ② 架构浏览含目录、架构图、C4 等。
  - ③ 现位置不合理:设计期决策记录属需求设计,归档后属资产。
  - ④ 经验沉淀(gene)属资产,但现展示难获"经验"。
  - ⑤ markdown 必须渲染(非原文本),图支持 mermaid。
- 现有基础:`baize-dashboard.ts`(证据页:hotspots/boundaries/clusters + ADR + gene)、`baize-requirement.ts`(需求 6 阶段流水线)、`baize-asset-library.ts`(资产 4 tab:需求管理/场景/用例/功能)、gateway `/api/evidence/<repo>` + `/api/genes` + `manage_adr`。
- 数据现状:`/api/evidence/<repo>` → architecture{hotspots[{name,qualified_name,fan_in}]/boundaries[{from,to,call_count}]/clusters[{label,members,cohesion,top_nodes}]/total_nodes/total_edges/node_labels/edge_types} + priorAdr.content(大段 markdown)+ /api/genes(摘要列表)。
- 上一张图(web 重构)已归档 `archive/2026-08-web-redesign/`(其 §11 偏离记录为本图起点之一)。

## Decisions so far

- [E02 架构浏览器 C4 数据源调研](tickets/E02-arch-browser-c4-source.md) — 两系统均无原生 C4(codebase-memory/gitnexus 只到 function/community/boundary);gateway 扩展点 generateC4。**C4 映射订正于 E03(Container≠K8s/Component≠clusters,以 E03 为准)**。findings: research/E02-arch-browser-c4-source.md
- [E05 markdown/mermaid 渲染方案](tickets/E05-markdown-mermaid-render.md) — marked + `mermaid.render(id,code)` 注入 shadow DOM(非 `run()`,跨不了 shadow 边界);主题 hex 映射(themeVariables 只收 hex,运行时 getComputedStyle 解 CSS vars);共享 `baize-markdown` 组件。findings: research/E05-markdown-mermaid-render.md
- [E01 证据/决策绑需求 + 归档资产化](tickets/E01-evidence-decision-requirement-binding.md) — 证据=设计时快照(req-keyed,新增绑定);决策记录=设计包绑 req id(不再只 repo+ts),归档入资产库后**喂下次设计替代 repo 级 priorAdr**成闭环;页面织入流水线(依据区 + 归档阶段产物 rendered);归档=archive 阶段 approve 触发,扩资产库 tab(划分交 E04/E06)。
- [E03 架构浏览器范围与形态](tickets/E03-arch-browser-scope.md) — 视图=目录树+C4 全四层(Context⊃Container⊃Component⊃Code 嵌套缩放,**Code 取代代码结构图**,clusters/boundaries/hotspots 并入 Component/Code);C4 深度=全四层(用户修订,原仅 Context+Container;Container 从构建配置/目录结构抽取非 K8s、Context/Component LLM 生成缓存 .c4.json);落位=取代「证据」nav 改名「架构」(管理:系统·架构),baize-dashboard 退役证据角色。订正 E02 的 C4 误读。
- [E04 gene 展示重构](tickets/E04-gene-display.md) — 展示=列表-详情(摘要+信号 chips+质量分 / preconditions+strategy+validation+constraints+source 全显,baize-markdown 渲染);落位=合「沉淀」tab(决策记录+gene 两段,资产库→5 tab);检索复用=混合(设计 run 按 signals 调 evolver_search_assets 自动推荐 N + 人工增减,依据区显示)。

## Not yet specified

- prior 决策输入选择(待资产库有决策记录后):下次设计读哪些归档决策记录作 prior(全部?同 workspace?最新 N?)——gene 检索机制已由 E04 定(混合:evolver_search_assets 自动推荐+人工增减),决策记录或可复用同机制,待实施时定。

## Out of scope

- 实施写码 —— 本图只产方案。
- gateway 后端大改(若需新端点记入方案,不实施)。
- TUI(独立 surface)。

## Tickets(frontier = open+unblocked+unclaimed)

- [E01 证据/决策绑需求 + 归档资产化](tickets/E01-evidence-decision-requirement-binding.md) `grilling` — **closed**:证据=设计时快照(req-keyed);决策记录=设计包绑 req、归档喂下次设计;页面织入流水线;归档=archive approve、扩资产库 tab。
- [E02 架构浏览器 C4 数据源调研](tickets/E02-arch-browser-c4-source.md) `research` — **closed**:无原生 C4;C4 映射订正于 E03。findings 落盘
- [E03 架构浏览器范围与形态](tickets/E03-arch-browser-scope.md) `grilling` — **closed**:目录树 + C4 全四层(Code 取代代码结构图);取代证据 nav 改名架构。
- [E04 gene 展示重构](tickets/E04-gene-display.md) `grilling` — **closed**:列表-详情(全显 preconditions/strategy/validation)+ 合「沉淀」tab + 混合检索(evolver_search_assets 自动推荐+人工增减)。
- [E05 markdown/mermaid 渲染方案](tickets/E05-markdown-mermaid-render.md) `research` — **closed**:marked + mermaid.render 注入 shadow DOM + 主题 hex 映射。findings 落盘
- [E06 IA 重构](tickets/E06-ia-restructure.md) `grilling` — 证据拆分 + ADR/gene 进资产 + sidebar/系统页(**可取**:E01/E04 已闭环)
