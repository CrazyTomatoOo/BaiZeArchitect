# E06 — IA 重构 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by: E01, E04

## Question

证据/决策/gene 重构后,sidebar 与系统页怎么改?子问题:

- 证据拆成「设计流程内证据(需求详情)」+「架构浏览器(独立页)」,现 `baize-dashboard` 证据页怎么拆?
- ADR/gene 进资产库(E01/E04 定 tab),sidebar 资产库组怎么扩?
- 系统 page 还剩什么(设置?)?证据 nav 去留?

输入:web-redesign §4(现四区:总览/工作/资产库/管理)+ 用户方向③。

## Resolution(2026-08-06,grilling 1 答 + 前序综合)

- **证据拆分(sub-Q1,综合 E01/E03)**:`baize-dashboard` 退役「证据」角色 → 改造为 `baize-architecture-browser`(E03)。证据快照→需求流程内「依据区」(E01);架构部分(hotspots/boundaries/clusters)→架构浏览器(E03);ADR/gene→资产库「沉淀」tab(E01/E04)。
- **资产库扩(sub-Q2,E04)**:资产库 → 5 tab(需求管理·场景库·用例库·功能库·**沉淀**)。
- **系统页(sub-Q3,本答)**:系统页 = **设置 + 系统状态诊断**(模型配置 provider/modelId/apiKey + 偏好;evidence 索引状态/gitnexus 健康/ws 诊断 + 手动重新索引按钮)。证据 nav → 改名「架构」管理组(E03)。
- **最终 sidebar**:总览 / 工作(需求·待决策) / 资产库(需求管理·场景库·用例库·功能库·沉淀) / 管理(系统·架构)。

实施含义(交实施,非本图):`baize-dashboard`→`baize-architecture-browser` 改造;资产库加「沉淀」tab(决策记录+gene 两段);系统页加系统状态诊断区;sidebar 资产库组加沉淀、管理组证据→架构。
