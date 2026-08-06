# E02 — 架构浏览器 C4 数据源调研 `wayfinder:research`

status: closed
assignee: pi(research)
blocked-by:
research: research/E02-arch-browser-c4-source.md

## Question

架构浏览器(B)要含 C4 图,数据从哪来?调研:

- codebase-memory-mcp(`get_architecture`/`search_graph`/`query_graph`/`get_graph_schema`)与 gitnexus 是否产出 C4(context/container/component/code)层级数据?现有 clusters/boundaries/hotspots 能否映射到 C4?
- 若无现成 C4,生成路径:LLM 从架构图生成 C4?手动维护?还是降级用 clusters/boundaries 近似?

产出:`research/E02-arch-browser-c4-source.md`(C4 数据源结论 + 对 BaiZe 的可行路径 + 推荐)。

## Resolution(2026-08-06,research 子代理)

findings 落盘:`research/E02-arch-browser-c4-source.md`(9.8KB)。
gist:两套系统均无原生 C4 — codebase-memory/gitnexus 只到 function/community/boundary;全仓 grep c4=0。映射潜力分层:Component≈clusters+boundaries+layers(可即时,须诚实标注非 C4);Container 仅 K8s 仓库可经 INFRA_MAPS 确定性抽取;Context 无 actor 抽象须 LLM 生成;Code 层冗余(=现有函数/类图)。推荐分层混合:Component view 先行(零新基建)→ Container(K8s 确定性+LLM 回退)→ Context(LLM 一趟,缓存 evidence/<repo>.c4.json+mermaid,按 head_sha 键);gateway 扩展点 generateC4(gateway.ts L77 旁)。解锁 E03。
