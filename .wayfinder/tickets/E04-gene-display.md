# E04 — gene 展示重构 `wayfinder:grilling`

status: open
assignee:
blocked-by:

## Question

gene 现展示(摘要列表)难让人获得"经验"。怎么重构?子问题:

- gene 卡片该含什么(when-to-use / procedure / 来源设计 / 信号)?可点开?
- gene 作为资产库一部分(用户方向④),进哪个 tab?与 ADR 复用池关系?
- 如何让"经验"可被新设计检索复用?

输入:用户方向④;`/api/genes` 现仅 summary 列表;`evolver-home` 本地 gene store。
