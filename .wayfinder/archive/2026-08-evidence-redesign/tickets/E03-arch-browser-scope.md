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

## Resolution(2026-08-06,grilling 3 答 + C4 订正 + 用户修订)

- **视图清单**:目录树(文件/目录浏览,从 repoPath 扫)+ **C4 全四层**(Context⊃Container⊃Component⊃Code,嵌套缩放)。**C4 Code 层取代原"代码结构图"** —— clusters/boundaries/hotspots 不再单独成"非-C4"视图,作为 Component/Code 层的支撑数据并入。
- **C4 深度 = 全四层**(用户 2026-08-06 修订:原"Context+Container 不做 Component/Code"→ 改为做全):
  - Context:系统 + 外部 actor/依赖,LLM 生成,缓存 `evidence/<repo>.c4.json`(按 head_sha 键)。
  - Container:**可独立运行单元(web/API/DB 等,非 K8s)**,从构建配置(package.json scripts / Dockerfile / compose services)+ 目录结构抽取。
  - Component:interface 后的职责块(一组相关类),从代码反推滤 model/util 噪声 + LLM 命名;反推成本高,用户要求做全。
  - Code:C4 Code 层(取代原"代码结构图"独立视图);clusters/boundaries/hotspots 数据并入此层作支撑。
- **落位**:取代现「证据」nav(baize-dashboard 被 E01 分空:快照移需求流、ADR/gene 移资产库),改名「架构」,仍在管理组(**管理:系统·架构**)。目录树 + C4 全四层作该页子视图(tab 或 section)。
- **与现证据页关系**:baize-dashboard 的 architecture 部分迁入本页;ADR/gene 已由 E01 移资产库;证据快照已由 E01 织入需求流。baize-dashboard 退役「证据」角色,改造为架构浏览器(或新组件 `baize-architecture-browser`)。

C4 订正(用户反馈触发调研):Container ≠ Docker/K8s(是可独立运行/部署单元),Component ≠ React/Leiden 聚类(是 interface 后的职责块),四层是嵌套缩放非可挑并列视图。E02 旧映射(Component=clusters/Container=K8s)作废,以本 Resolution 为准。

**修订(2026-08-06,用户)**:C4 做全四层(原仅 Context+Container);Code 层取代"代码结构图"独立视图。

实施含义(交实施,非本图):新组件 `baize-architecture-browser`(目录树 + C4 全四层视图切换);gateway `generateC4` 缓存端点(Context/Component LLM 生成、Container 从构建配置/目录结构抽取、Code 并入 clusters/boundaries/hotspots);用 E05 `baize-markdown`+mermaid 渲染 C4 图。
