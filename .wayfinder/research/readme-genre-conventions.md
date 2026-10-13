# 同体裁 README 的惯例：pi-package / Claude Code plugin / skill 套件

## Question

本体裁的根 README 惯常覆盖哪些段落？首屏惯例放什么？

本体裁 = 「agent 能力分发包」（pi-package ＋ Claude Code plugin ＋ skill 套件＋薄 CLI），**不是应用**。本仓库里零份同类样例可参照，所以取真实样本逐份记录：仓库形态与读者、首屏第一句、段落清单与顺序、图、安装段（发布了的 vs 只能从 checkout 装的）、「未发布 / 实验性」状态声明。

方法与范围：5 份真实样本（primary source，全部锁定 `main` HEAD 短 SHA，下文以 `@<sha>` 标注），覆盖三种形态各至少一份——pi-package ×2、Claude Code plugin ×1（另 marketplace 形态 ×1）、skill 套件 ×3（与前三者有重叠）。按本仓规矩，每条惯例挂在具体样本与链接上，无样本支撑的落 `## Risks`。

引用方式：README 正文均指对应 SHA 处渲染的 `README.md`（GitHub 短 SHA 链接可解析）。

## Findings

### 样本总览

| # | 仓库 | 形态 | 读者 | 发布状态 |
|---|---|---|---|---|
| 1 | [danielvm-git/bigpowers](https://github.com/danielvm-git/bigpowers) `@812d57a917` | npm 包（`pi` 字段 + `bin` CLI + 81 个 skill），关键词含 `pi-package` | 用 AI agent（Claude Code/Gemini/Cursor/pi）做开发的个人开发者 | npm 已发布（bigpowers@2.88.9，实测 npm registry） |
| 2 | [narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions) `@a7cc32691b` | pi 扩展 monorepo：根 `package.json` 的 `pi` 字段显式列出 36 个扩展 + 3 个 skill 目录；每包一个 workspace | pi 用户与扩展作者 | 子包按 `@narumitw` scope 发布；**根本身为 `private: true, version 0.0.0` 未发布**（package.json, narumiruna/pi-extensions@a7cc32691b） |
| 3 | [kenryu42/cc-safety-net](https://github.com/kenryu42/cc-safety-net) `@33e4b00f1d` | Claude Code plugin（[`.claude-plugin/plugin.json`](https://github.com/kenryu42/cc-safety-net/blob/33e4b00f1d/.claude-plugin/plugin.json) v2.6.10）+ [`.claude-plugin/marketplace.json`](https://github.com/kenryu42/cc-safety-net/blob/33e4b00f1d/.claude-plugin/marketplace.json)，npm CLI 分发 | 用 16 种 coding CLI（含 Claude Code、pi）的终端用户 | npm 已发布 |
| 4 | [github/spec-kit](https://github.com/github/spec-kit) `@6c62e10d5a` | skill 套件 + Python CLI（PyPI `specify-cli`）；slash command / skill 装进多种 agent | 走 SDD 流程的 agent 用户；扩展作者 | PyPI 已发布 + git 源安装两条官方渠道并列（[Installation](https://github.github.io/spec-kit/installation.html)，实测抓取 2026-10-13） |
| 5 | [anthropics/skills](https://github.com/anthropics/skills) `@dbd4588f9e` | skill 套件 + Claude Code plugin marketplace（[`.claude-plugin/marketplace.json`](https://github.com/anthropics/skills/blob/dbd4588f9e/.claude-plugin/marketplace.json) 声明 5 个插件，全部 `source: "./"` 直挂本仓） | Claude 用户（Claude Code / Claude.ai / API 三路） | 仓库即分发渠道（marketplace add 本仓）；无 npm 包 |

本体裁判定依据：pi 官方文档 [packages.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)（`pi` 字段 / `pi-package` 关键词 / `pi install npm:|git:|本地路径` 安装协议）与本仓 `package.json` 形态逐字段吻合。

### 1. 首屏第一句：全部是「一句话定位」，徽章 4/5

- 5/5 样本首屏第一句都是**一句话定位**（这是什么 + 给谁/解决什么），不是徽章墙、不是 demo 输出：
  - bigpowers：H1 后紧跟粗体句 "**Agent skills synthesizing 17 years of software engineering discipline … into a single, prescriptive methodology for solo developers.**"（README.md:3-5 @812d57a917）
  - pi-extensions："Independently installable Pi Coding Agent extensions and reusable extension libraries for … Install only what you need."（README.md:5-8 @a7cc32691b）
  - cc-safety-net：logo 图片 H1 + 徽章 + 多语言链接之后，第一段 "CC Safety Net … blocks destructive commands and access to secrets … It is not a sandbox: …"（README.md:17-21 @33e4b00f1d）——定位句里同时写清**边界**（不是什么）。
  - spec-kit：居中 logo + 斜体 tagline "*Build with a spec, fix a bug, or assess an idea — with your coding agent.*"（README.md @6c62e10d5a）
  - anthropics/skills：H1 后第一段定义 "Skills are folders of instructions, scripts, and resources that Claude loads dynamically to improve performance on specialized tasks."（README.md:7-9 @dbd4588f9e）
- 徽章 4/5：bigpowers（License/npm version/skills-81，skills 数由 `sync-skills.sh` 自动盖章）、pi-extensions（npm scope/License）、cc-safety-net（CI/codecov/Version/License）、spec-kit（release/stars/license/docs）。仅 anthropics/skills 无版本徽章（有一个 skills.sh 目录徽章）。没有样本堆技术栈徽章。

### 2. 段落顺序：首尾稳、中间按「读者路径」组织

各样本的 H2 顺序（从 5 份 README 逐份提取）：

- bigpowers：`How to Read This README`（读者分流表）→ `Quick Start`（npm/npx/交互安装器/From source 四小节）→ `Prerequisites` → `Features` → `Lifecycle`（含 ASCII 流程图）→ `Philosophical Stack`（含图）→ `Hierarchy of Truth` → `Project Structure` → `pi Support`（`pi install .` / `pi install npm:bigpowers`）→ `MCP Server` → `Maintenance（更新/卸载）` → `Development` → `Contributing` → `Acknowledgements` → `License`
- pi-extensions：`Quick start`（`pi install npm:…` / `pi -e …`）→ `Extensions I use every day`（作者推荐）→ `Choose an extension`（5 张分类表，每行 = 包 + 用途 + 安装命令）→ `Extension libraries` → `Advanced installation`（`<details>` 折叠：`pi install git:github.com/narumiruna/pi-extensions` 整仓 + 资源过滤器）→ `Local development` → `Releases`（changesets 流程）→ `Repository structure` → `License`
- cc-safety-net：`How it works`（原理图）→ `Supported coding CLIs`（16 个 CLI 图标表）→ `Features` → `Quick start`（`npx -y cc-safety-net@latest install`）→ `Development` → `License`——**注意 Quick start 不在第二位，而在「这是什么/支持谁/能干什么」之后**
- spec-kit：`Choose your process`（三流程分流表）→ `Get started`（前置 + 安装 + 「这些是 agent skills，不是终端命令」的用法提醒）→ 三个流程各自的详解 → `Customize or bring your own process` → `Documentation` → `Star history` → `Support and contributing` → `License`
- anthropics/skills：`About This Repository`（含 `Disclaimer` 块引用）→ `Skill Sets`（目录指针）→ `Try in Claude Code, Claude.ai, and the API`（三路安装/使用，`/plugin marketplace add anthropics/skills` + `/plugin install …`）→ `Creating a Basic Skill`（模板）→ `Partner Skills`

跨样本稳定的只有首尾：**首屏定位 → 安装/上手**（cc-safety-net 把安装放 Features 后，但仍在首屏一屏半内）、**末尾 License**（5/5，其中 4/5 是最后一个 H2）。中间段没有统一顺序，共同点是都包含一个「读者分流」装置（bigpowers 的分流表、spec-kit 的 choose-your-process、pi-extensions 的分类表）和一段「这东西怎么运转/怎么用」。

### 3. 图：工作原理图与截图，没有「模型结构图」

- cc-safety-net：首屏 demo 视频（user-attachments 链接）+ `How it works` 一张自绘 SVG 原理图（明暗两套 `prefers-color-scheme` 源图，README.md:25-33 @33e4b00f1d）。
- bigpowers：2 张图——交互安装器截图（`docs/images/interactive-installer.png`）、philosophy 分层图（`docs/images/philosophy_diagram.jpg`），外加 2 段 ASCII 流程图（生命周期、8 步 build-epic 循环，纯文本无需图片）。
- spec-kit：居中 logo（`media/logo_large.webp`）+ star-history 图；正文无架构图。
- pi-extensions、anthropics/skills：**零图**。
- 没有样本放模型结构图/神经网络图；图只用于「工作原理」和「装完长什么样」。

### 4. 安装段：发布渠道与 checkout 渠道并列给出；爱写「避坑注」

- **发布渠道**（5/5 都有）：
  - npm/npx：bigpowers `npm install -g bigpowers@latest` + 专门警告 "Always pin `@latest`"（解释 stale global binary 陷阱，README.md Quick Start @812d57a917）；cc-safety-net `npx -y cc-safety-net@latest install` 并解释 "@latest qualifier" 原因（README.md Quick start @33e4b00f1d）——**两份都教读者避开 npx/npm 缓存陷阱**。
  - pi：`pi install npm:@narumitw/pi-goal`（pi-extensions）；`pi install npm:bigpowers` 与 `pi install .`（bigpowers 的 pi Support 节）。
  - Claude marketplace：`/plugin marketplace add anthropics/skills` → `Browse and install`（anthropics/skills）。
  - PyPI：`uv tool install specify-cli`（spec-kit）。
- **checkout / 源码渠道**（5/5 都有，形态各异）：
  - bigpowers：`git clone … && npm install && bash scripts/install.sh`（小节标题就叫 "From source (contributors)"）。
  - pi-extensions：`pi install git:github.com/narumiruna/pi-extensions`（整仓）+ `pi -e ./packages/pi-goal`（本地试单个）+ resource filter 示例。
  - cc-safety-net：README 层面只有 `npx`（npm 渠道）；开发指引指向 CONTRIBUTING.md。
  - spec-kit：`uv tool install specify-cli --from git+https://github.com/github/spec-kit.git@vX.Y.Z`，且明确**推荐 pin release tag**、声明「source 安装与 PyPI 安装是两条并列官方渠道，都受支持」（Installation 页，实测抓取 2026-10-13）。
  - anthropics/skills：无 checkout 概念——仓库本身就是渠道（marketplace 直挂本仓）。
- 另：pi 官方 [packages.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md) 给出本体裁的安装命令全集（`pi install npm:|git:|URL|./本地路径`、`pi -e` 一次性试用、`pi update --extensions` 更新），并带安全提示（"Review third-party package source before installing it"）。

### 5. 「未发布 / 实验性」状态声明

- **实验性声明下沉到具体对象**（pi-extensions）：不宣布「本仓是实验项目」，而是在 TypeSafe AI 分类表头写 "These TypeSafe AI integrations are experimental and may change as they are evaluated in real workflows."（README.md @a7cc32691b）；对未按常规渠道发布的包，用表格里的链接标注 "Install from source" 例外。
- **免责块**（anthropics/skills）：`> **Disclaimer:** These skills are provided for demonstration and educational purposes only… implementations and behaviors you receive from Claude may differ…`（README.md Disclaimer @dbd4588f9e）——块引用、放靠前位置（About 节内）。
- **边界声明写进定位句**（cc-safety-net）："It is not a sandbox: it does not contain processes…"（README.md:21 @33e4b00f1d）。
- **事实性短注**（cc-safety-net）：`> [!NOTE] Full documentation → … This README is the short version.` 用 GitHub alert 框承认 README 不完整并指向文档站。
- **没有样本做「本仓尚未发布/早期」的正面横幅**。最接近的实证是 pi-extensions 根本身 `private: true, version 0.0.0`（未发布元包），其 README **只字不提发布状态**，直接给可运行的安装命令（npm scope 包 + git 源安装）。即：未发布状态在该样本里不是「需要宣布的新闻」，而是安装段里渠道自然缺失的事实。
- bigpowers 的 "0.0.0-β" 是**消费者项目**的版本约定（由工具生成的项目脚手架），不是仓库自身的早期声明，不算正面示范。

## Recommendation

给本仓（pi-package ＋ Claude Code plugin ＋ skill 套件 ＋ 薄 CLI；`private: true` v0.0.0 未发布；根 README 缺失）的可执行建议。**样本支撑点随条标注；综合排序属推断的部分见 Risks。**

首屏（H1 之前到第一屏结束，样本支撑：§1）：

1. H1 仓名。
2. **一句话定位**：一句话说清「是什么 + 给谁」。建议句式参照 cc-safety-net/spec-kit：是什么之外用半句写边界（"不是应用，是装进 AI coding agent 的能力包"——边界写法有 cc-safety-net 样本支撑）。
3. 徽章可选（4/5 样本有；至少 License；若 CI 存在可加 CI）。

段落顺序（样本支撑：§2 的首尾稳定性 + 各样本共有段）：

1. **是什么 / 组件清单**（一小段 + 列表：CLI `baize <new|validate|status|accept>`、十个 skill、pi 扩展、Claude plugin）——对应 anthropics/skills 的 About + Skill Sets 与 bigpowers 的 Project Structure，本体裁读者首先要知道「包里有什么」。
2. **安装**：两个渠道并列小节——
   - 从 checkout：`pi install ./`（pi-package 渠道，pi 官方文档支撑）；Claude Code 侧 `claude --plugin-dir .` 或 `/plugin marketplace add <本地路径>`（Claude Code 官方 plugins 文档支撑，**无 README 样本支撑**，见 Risks）。
   - 发布渠道：一句事实陈述「尚未发布到 npm / 公开 marketplace，暂无对应渠道」——写法参照 §5 pi-extensions 的「状态即事实」而非横幅。
3. **Quick start**：一条命令的端到端演示（`baize new …` 的输入输出），30 秒量级；样本中 demo 输出未出现在任何首屏，放第二屏以后（§1）。
4. **How it works**：`baize/` 条目生命周期一张图（自绘 SVG 或 ASCII 流程图——ASCII 流程图有 bigpowers 样本支撑，零图片成本；pi-extensions/anthropics/skills 证明图不是必需）。
5. **skill 清单**：表格（skill 名 + 一句话 description 摘要），对应 pi-extensions 的分类表。
6. **开发**：build / test / check 命令（bigpowers 的 Development、pi-extensions 的 Local development 支撑）。
7. **License**（5/5 样本的最后一段）。

「未发布」处理（样本支撑：§5）：不做 experimental/early 横幅；在安装段用一句话事实陈述渠道现状即可。若将来要对 skill 内容做能力免责，用 anthropics/skills 式块引用 Disclaimer，而不是给整仓贴「实验性」标签。

避坑注（样本支撑：§4）：若给 npx/npm 安装命令，附 `@latest` 之类的 pin 提示与原因——两个 npm 样本都这么做。

## Risks

- **样本偏差**：5 份全是高星、维护活跃的项目，且 bigpowers 与 spec-kit 的 README 已高度「产品化」（大表格、图、外部文档站）。本仓是未发布的私有早期项目，照抄其体量不合适；本笔记只取结构惯例，不取篇幅。
- **以下结论属推断（样本只有间接支撑）**：
  - 「未发布状态不做横幅、只在安装段事实陈述」——正面证据只有 pi-extensions 一个样本（其根本身未发布却只字不提），属 absence-of-evidence + 单样本推断。
  - 段落 1–7 的**综合排序**是从 5 份顺序各异的样本里归纳的；样本只稳定支持「首屏定位在前、安装/上手紧跟、License 收尾、中间含读者分流装置」。
  - Claude Code plugin 的 checkout 安装命令（`--plugin-dir`、`marketplace add <路径>`）来自 [Claude Code 官方 plugins 文档](https://code.claude.com/docs/en/plugins)（实测抓取 2026-10-13），**没有 README 样本用过它**——样本 cc-safety-net 虽持有 plugin.json 但 README 完全没写 plugin/marketplace 安装法（只写 `npx install`）。即：plugin 形态样本的 README 与其 plugin 分发形态是脱节的，本体裁若 pi 与 Claude 两翼并重，README 需要比任何单一样本都更「双渠道」。
- **证据冲突**：bigpowers README 的 pi 安装注释写 "`pi install npm:bigpowers`（once published with pi-package keyword）"，但实测 npm registry 该包已发布（2.88.9，keywords 含 `pi-package`）——README 滞后于事实。本笔记以 registry 实测为准；也提示样本 README 自身会过时。
- **时效**：5 份 README 均锁定 2026-10-13 抓取的 HEAD 短 SHA；三个平台的安装协议（pi 的 `pi install`、Claude 的 `/plugin`、skills 的加载机制）仍在演化，落笔根 README（#163）前值得对安装命令做一次实测。
- 未取到「纯 Claude Code plugin、以 marketplace 为主要分发渠道、README 详写 plugin 安装」的理想样本（排除 superpowers/OpenSpec 后的可见高星样本里 plugin.json 与 README 多为脱节状态）；这是样本缺口，不是「该惯例不存在」的证据。
