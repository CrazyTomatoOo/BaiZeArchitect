# E03 — 架构浏览器范围与形态 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by: E02

## Question

架构浏览器(B)具体含哪些 + 页面形态?子问题:

- 目录树、架构图(依赖图?)、C4 哪几层(context/container/component)?
- 是独立页还是系统页子页?与现证据页的"架构"部分关系(现证据页 architecture 段拆出去)?
- 数据来自 `/api/evidence` 的 architecture 字段 + 可能新 C4 源(E02 定)。

输入:用户方向②;E02 调研结论。

## Resolution(2026-08-06,grilling 3 答 + C4 订正)

- **视图清单**:目录树(文件/目录浏览,从 repoPath 扫)+ 代码结构图(clusters/boundaries/hotspots 渲染,诚实标注「非 C4」,数据来自 `/api/evidence`)+ C4 视图(嵌套缩放)。
- **C4 深度 = Context + Container**(不做 Component/Code):Component 与代码结构图重叠且反推成本高;Code 冗余。
  - Context:系统 + 外部 actor/依赖,需生成(依赖分析 + LLM),缓存 `evidence/<repo>.c4.json`(按 head_sha 键)。
  - Container:**可独立运行单元(web/API/DB 等,非 K8s)**,从构建配置(package.json scripts / Dockerfile / compose services)+ 目录结构抽取。
- **落位**:取代现「证据」nav(baize-dashboard 被 E01 分空:快照移需求流、ADR/gene 移资产库),改名「架构」,仍在管理组(**管理:系统·架构**)。目录树/代码结构图/C4 作该页子视图(tab 或 section)。
- **与现证据页关系**:baize-dashboard 的 architecture 部分(代码结构图)迁入本页;ADR/gene 已由 E01 移资产库;证据快照已由 E01 织入需求流。baize-dashboard 退役「证据」角色,改造为架构浏览器(或新组件 `baize-architecture-browser`)。

C4 订正(用户反馈触发调研):Container ≠ Docker/K8s(是可独立运行/部署单元),Component ≠ React/Leiden 聚类(是 interface 后的职责块),四层是嵌套缩放非可挑并列视图。E02 旧映射(Component=clusters/Container=K8s)作废,以本 Resolution 为准。

实施含义(交实施,非本图):新组件 `baize-architecture-browser`(目录树+代码结构图+C4 Context/Container 视图切换);gateway `generateC4` 缓存端点;Container 从构建配置/目录结构抽取、Context LLM 生成;用 E05 `baize-markdown`+mermaid 渲染 C4 图。
