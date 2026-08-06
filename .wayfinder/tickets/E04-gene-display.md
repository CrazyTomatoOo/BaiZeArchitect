# E04 — gene 展示重构 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by:

## Question

gene 现展示(摘要列表)难让人获得"经验"。怎么重构?子问题:

- gene 卡片该含什么(when-to-use / procedure / 来源设计 / 信号)?可点开?
- gene 作为资产库一部分(用户方向④),进哪个 tab?与 ADR 复用池关系?
- 如何让"经验"可被新设计检索复用?

输入:用户方向④;`/api/genes` 现仅 summary 列表;`evolver-home` 本地 gene store。

## Resolution(2026-08-06,grilling 3 答)

- **展示 = 列表-详情(与资产库一致)**:左列表(摘要 + 信号 chips + 质量分);右详情(`preconditions`[when-to-use] / `strategy`[procedure 含代码路径] / `validation` / `constraints` / `_source` 全显,用 E05 `baize-markdown` 渲染 strategy/validation)。根因:现状只露 summary,藏了可复用的 preconditions/strategy/validation——「难获经验」根因。gene 真实结构(evolver-home/assets/genes.jsonl):preconditions/strategy/validation/constraints/_source{quality{score,threshold}}/asset_id。
- **落位 = 合「沉淀」tab**:决策记录(归档设计包,E01)+ gene 合并成一个 tab,内部分「决策记录」|「gene」两段(各列表-详情)。资产库 → **5 tab**(需求管理/场景/用例/功能/沉淀)。不各起独立 tab。
- **检索复用 = 混合(自动推荐 + 人工增减)**:设计 run 启动按需求/上下文信号调 `evolver_search_assets` 语义匹配 N 个 gene 自动推荐;需求详情「依据区」(E01 定的设计起点依据区)显示推荐 gene,设计者可增减;最终注入设计 prompt 作参考。

实施含义(交实施,非本图):`/api/genes` 扩展返回 full gene(非仅 summary);设计 run 集成 `evolver_search_assets` 推荐;依据区 UI 展示推荐 gene + 增减;`baize-markdown` 渲染 strategy/validation。
