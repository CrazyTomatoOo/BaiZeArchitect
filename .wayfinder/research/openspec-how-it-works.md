# OpenSpec 工作原理

## Question

OpenSpec（npm `@fission-ai/openspec`，GitHub `Fission-AI/OpenSpec`）作为一个 spec-driven development 工具，**机制上**是如何工作的：磁盘上写什么、谁（CLI 还是 AI agent）在什么时候读写、spec/delta 的文法由哪个解析器用哪条正则接受、archive 如何把 delta 合并进主 spec、validation 的规则集、`--strict` 多查什么、slash command / skill 与 CLI 之间的契约、以及它有哪些仓库之外的状态和网络行为。

范围：以 v1.x（OPSX 工作流）为准，源头锁定 `main` HEAD `bae58cf61479986431bb798acbe5a688a591c18c`（下称 `@bae58cf`）与 npm 最新版 `1.13.1`。行为类结论另附本地实测（npm 1.13.1，node v24.21.0，scratch 项目端到端跑通）。

不在范围内：与其他工具（Spec Kit / Kiro 等）的对比（README 里有一句事实性对比，见 Findings §1 末尾，仅此而已）；旧版 `/openspec:*` 单文件 change 工作流只在"遗留清理"处提及，不作为主线。

版本关系（重要）：npm 1.13.1 发布于 2026-09-17T01:14:12Z，而 `@bae58cf` 提交于 2026-09-17T06:31:19Z —— npm 包比 HEAD **早约 5 小时，二者不是同一棵树**。本文中源码引用一律指 `@bae58cf` 所在树，行为引用以 1.13.1 实测为准（npm registry dist-tags 与 time 字段，npm @fission-ai/openspec@1.13.1）。

## Findings

### 0. 两套文档树，可信度不同

- 仓库里存在**两个文档树**：`docs/` 与 `docs-lab/`。`docs-lab/README.md:1-7` 自述：docs-lab 是逐页重写的并行文档工程，"The live site builds from this tree: `website/docs.sync.config.mjs` maps these files to published pages, and the old `docs/` tree is no longer used by the site"（docs-lab/README.md:1-7, OpenSpec@bae58cf）。
- 现状：docs-lab 大部分页面仍是骨架（"real headings plus a one-line `>` job statement"），已起草的参考页是 `docs-lab/reference/cli.md`（2295 行，逐命令契约）与 `docs-lab/reference/skills.md`（每个 skill 的 Arguments/Creates/Response 契约表，其头部注释说明由 subagent 对照 `src/core/templates/workflows/` 逐条核验，并显式丢弃了旧 `docs/commands.md` 中无支撑的表述，如 apply "runs tests"）（docs-lab/reference/skills.md:1-30, OpenSpec@bae58cf）。
- 结论：`docs/`（含 `opsx.md`、`commands.md`、`how-commands-work.md`）内容更丰富但属于**遗留散文**，与源码冲突时以源码为准；docs-lab 是站点事实来源但多数页未写完。本文引用散文时会标注来自哪棵树。

### 1. 机制总览：一个项目，两个半

- OpenSpec 的机制核心是**两个半**：终端里的确定性 CLI（`openspec ...`）与 AI 聊天里的 slash command / skill（`/opsx:...`）。`docs/how-commands-work.md:1-8`（docs 树，遗留散文）把这点称为 "The one thing to know"，并给出心智图：CLI 是 engine（知道 change 目录长什么样、artifact 依赖、如何 merge delta），slash command 是 steering wheel，`openspec init` 在终端运行后才把命令/技能**安装**进 AI 工具。
- 两个半的分工是硬边界：CLI 只做确定性操作（建目录、解析校验 markdown、merge delta、移动目录、生成技能文件）；**规划/写作全部由 agent 完成**，agent 通过 `openspec status/instructions ... --json` 拉取"下一个工件该写什么"的契约（见 §3、§9）。
- 一行事实性对比（非评测）：README 自述相对 Spec Kit "lighter… iterate freely"、相对 Kiro 不锁 IDE（README.md "How we compare", OpenSpec@bae58cf；散文，仅供参考）。

### 2. 磁盘工件布局：谁拥有哪个文件

- 根目录约定全部由常量定义：`openspec/`（`OPENSPEC_ROOT_DIR`）、`openspec/config.yaml`、`openspec/specs/`、`openspec/changes/`、`openspec/changes/archive/`、默认 schema `spec-driven`；`openspec/specs` 与 `openspec/changes/archive` 会种 `.gitkeep` 锚点（`ANCHORED_OPENSPEC_DIRS`）（src/core/openspec-root.ts:11-22, OpenSpec@bae58cf）。本地实测 `openspec init --tools claude` 后磁盘上确实只有：`openspec/config.yaml`、`openspec/changes/archive/.gitkeep`、`openspec/specs/.gitkeep`（本地实测，npm @fission-ai/openspec@1.13.1）。
- **change 目录**：`openspec/changes/<name>/` 持有 `.openspec.yaml`（change 元数据，含 `schema:` 必填、`created:`、`skip_specs`、`retire_capabilities`、`goal` 等；zod schema 定义于 src/core/change-metadata/schema.ts:8-49, OpenSpec@bae58cf）+ 各 artifact 文件（默认 schema 下为 `proposal.md`、`design.md`、`tasks.md`、`specs/<capability>/spec.md`）。`openspec new change <name>` 只脚手架目录和 `.openspec.yaml`，不创建 proposal（src/commands/change.ts:129-133, OpenSpec@bae58cf）。实测 `openspec new change demo-export --json` 写出 `openspec/changes/demo-export/.openspec.yaml`，内容 `schema: spec-driven` + `created: 2026-09-22`（本地实测）。
- **主 spec（main spec）**：`openspec/specs/<capability>/spec.md`，由 archive 从 delta 创建或就地重写（见 §5）。
- **archive**：`openspec/changes/archive/YYYY-MM-DD-<name>/`，是 change 目录的**整体移动**（含 `.openspec.yaml` 与 delta 原文），不是拷贝（src/core/archive.ts:2055-2063, OpenSpec@bae58cf；本地实测确认目录移动且 delta 原样保留在 archive 内）。
- `openspec/config.yaml`（项目配置）：`schema:`、`context: |`（项目上下文文本）、`rules: {specs: [...], tasks: [...], design: [...]}`（按 artifact 注入的规则）。实测：设置 `context`/`rules` 后 `openspec instructions proposal --change <id> --json` 的响应里出现与配置逐字相同的 `context` 字符串与 `rules` 数组；不配置则这两个 key 缺席 —— 这坐实了"migration guide 所称项目上下文被主动注入每个规划请求"（本地实测；注入实现见 src/commands/workflow/instructions.ts:169-179, OpenSpec@bae58cf）。
- **schema 目录三级覆盖**：`openspec/schemas/`（项目内）→ 用户全局 data dir 的 `schemas/` → npm 包内置 `schemas/`（src/core/artifact-graph/resolver.ts:135-169, OpenSpec@bae58cf）。npm 包经 `package.json` 的 `files: ["dist","bin","schemas"]` 把 `schemas/spec-driven/` 打进发布产物（package.json, OpenSpec@bae58cf）。
- **不存在 `openspec/project.md`**：它只出现在遗留清理逻辑里（"preserved, migration hint only"，检测到也不删，只给迁移提示；`openspec/AGENTS.md` 则被删除）（src/core/legacy-cleanup.ts:553-565、755-766, OpenSpec@bae58cf）。当前版本不再生成它。
- **仓库之外的全局状态**：`~/.config/openspec/config.json`（`$XDG_CONFIG_HOME` 优先；Windows `%APPDATA%\openspec`）存 `profile`、`delivery`、`workflows`、`telemetry`、`featureFlags`、机器级默认 store（src/core/global-config.ts:6-8、45-47、52-77, OpenSpec@bae58cf）；`~/.local/share/openspec/`（`$XDG_DATA_HOME` 优先）存用户级 schema 覆盖与 stores 注册表 `stores/registry.yaml`（src/core/store/foundation.ts:30-31、77-83, OpenSpec@bae58cf）。

### 3. artifact graph：`schemas/spec-driven/schema.yaml` 是重心

- 默认工作流 schema 是 npm 包内/仓库内的 `schemas/spec-driven/schema.yaml`：`name: spec-driven, version: 1`，声明 4 个 artifact —— `proposal`（`generates: proposal.md`，`requires: []`）→ `specs`（`generates: "specs/**/*.md"`，`requires: [proposal]`）与 `design`（`generates: design.md`，`requires: [proposal]`）→ `tasks`（`generates: tasks.md`，`requires: [specs, design]`）；顶层 `apply:` 块：`requires: [tasks]`、`tracks: tasks.md`（schemas/spec-driven/schema.yaml, OpenSpec@bae58cf）。
- 每个 artifact 带 `template`（指向同目录 `templates/*.md`）与一段自由文本 `instruction:` —— 后者是写给 agent 的生成指令（specs 的 instruction 里直接写了 delta 四种操作的文法、scenario 必须 4 个 `#`、Purpose ≥50 字符等约束原文）（schemas/spec-driven/schema.yaml, OpenSpec@bae58cf）。
- 图语义由 `ArtifactGraph` 实现：加载时 zod 校验 + 查重 artifact id、`requires`/`apply.requires`/`apply.tracks` 引用有效性、DFS 查环（src/core/artifact-graph/schema.ts 函数清单, OpenSpec@bae58cf）；`getBuildOrder()` 用 Kahn 拓扑排序（src/core/artifact-graph/graph.ts, OpenSpec@bae58cf）。
- **完成状态 = 文件存在性**：`resolveArtifactOutputs(changeDir, generates)` 对 `generates` glob 做 fast-glob 匹配，命中即 `done`（src/core/artifact-graph/outputs.ts:97-100, OpenSpec@bae58cf）。这解释了模板与技能文件里反复强调的警告："`status` is file-existence only, so a `done` artifact still lists its `requires` edges —— 必须沿 `requires` 边传递地构造必需集"（src/core/templates/workflows/ff-change.ts:102-105, OpenSpec@bae58cf）。实测：新建 change 上 `proposal=ready`、`specs/design=blocked(missing proposal)`、`tasks=blocked(missing specs,design)`（本地实测）。
- **agent 侧的契约入口是 `openspec instructions [artifact] --change <id> --json`**：返回 key（实测逐字）`artifactId, changeDir, changeName, context, dependencies, description, existingOutputPaths, instruction, outputPath, planningHome, resolvedOutputPath, root, rules, schemaName, template, unlocks`；`planningHome = {kind:"repo", root:"<abs>", changesDir:"<abs>/openspec/changes", defaultSchema:"spec-driven"}`（本地实测；生成实现 src/commands/workflow/instructions.ts:169-182, OpenSpec@bae58cf）。schema 解析优先级：显式 `--schema` → `.openspec.yaml` 的 `schema:` → `openspec/config.yaml` → 默认 `spec-driven`（src/core/artifact-graph/instruction-loader.ts:256-259 与 src/utils/change-metadata.ts:159-162, OpenSpec@bae58cf）。
- `apply` 的门槛只看 schema 的 `apply.requires`（默认即 tasks），并追踪 `tracks: tasks.md`：缺 artifacts → `blocked`；`tasks.md` 存在但 0 任务 → `blocked`；`remaining===0 && total>0` → `all_done`（"ready to be archived"）；否则 `ready`（src/commands/workflow/instructions.ts:534-636, OpenSpec@bae58cf）。`skip_specs` 的 artifact 计为 satisfied——其文件**必须不存在**（src/commands/workflow/instructions.ts:541-548, OpenSpec@bae58cf）。

### 4. spec / delta 文法：解析器实际接受什么

**主 spec**（`openspec/specs/<cap>/spec.md`）：

- 由 `MarkdownParser.parseSpec` 解析：必须有 `## Purpose`（内容进 `overview`）和 `## Requirements` 两个 section，缺一抛 `Spec must have a Purpose/Requirements section`（src/core/parsers/markdown-parser.ts:28-53, OpenSpec@bae58cf）。
- requirement 头：`### Requirement: <name>`，正则 `/^###\s*Requirement:\s*(.+)\s*$/i`（大小写不敏感）；名字做 ATX closing-hash 规整（`### Requirement: Foo ###` 的 `###` 不算名字一部分，`C#` 保留），见 `normalizeRequirementName`（src/core/parsers/requirement-blocks.ts:17-24、38, OpenSpec@bae58cf）。
- scenario：任何非代码围栏内的 `#### ` 开头行都是 scenario（`SCENARIO_HEADER = /^####\s+/`），不要求字面 `Scenario:` 前缀；空体（header 下无内容）不算 scenario（src/core/parsers/requirement-text.ts:31、src/core/parsers/markdown-parser.ts:165-181, OpenSpec@bae58cf）。schema 的 instruction 明确警告：scenario 必须恰好 4 个 `#`，用 3 个 `#` 或 bullet 会**静默失败**（schemas/spec-driven/schema.yaml specs.instruction, OpenSpec@bae58cf）；WHEN/THEN 是模板的 bullet 约定（`- **WHEN** ... / - **THEN** ...`），不是解析器强制的结构。
- 所有标题解析都先经代码围栏掩码，围栏内的 `#` 标题不参与结构识别（src/core/parsers/markdown-parser.ts:23-26 与 code-fence.ts, OpenSpec@bae58cf）。

**delta spec**（change 内 `specs/<cap>/spec.md`）：

- delta 操作头：`## ADDED|MODIFIED|REMOVED|RENAMED Requirements`，正则 `/^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/i`（src/core/parsers/spec-structure.ts:6, OpenSpec@bae58cf）；解析入口 `parseDeltaSpec`（src/core/parsers/requirement-blocks.ts:214, OpenSpec@bae58cf）。
- ADDED/MODIFIED：canonical `### Requirement:` 块；REMOVED 额外接受 bullet 形态 `- * + ### Requirement: <name>`（src/core/parsers/requirement-blocks.ts:431-456, OpenSpec@bae58cf）。
- RENAMED：不用 requirement 块，用 `FROM: ### Requirement: <a>` 紧跟 `TO: ### Requirement: <b>` 配对（正则见 src/core/parsers/requirement-blocks.ts:498-499）；pair 定义是 "一个 `FROM:` 后紧跟 `TO:`，中间不得插入第二个 `FROM:`"，其余形态全部记入 `unpaired` 上报而不是默默吸收（src/core/parsers/requirement-blocks.ts:460-507, OpenSpec@bae58cf）。
- 非 canonical 的 `###` 头（如 `## Add Requirements` 拼错、无名字的 `### Requirement:`）被记为 `skippedHeaders`/`orphanedRequirements` 供 validate 报 INFO（src/core/parsers/requirement-blocks.ts:124-185, OpenSpec@bae58cf）。
- 名字匹配大小写敏感（`normalizeRequirementName`），另有一个仅用于 typo 检测的 case/空白折叠 `foldRequirementName`（src/core/parsers/requirement-blocks.ts:26-35, OpenSpec@bae58cf）。

**RFC 2119 约定**：validator 强制 requirement **正文行**（header 下一行）含 SHALL 或 MUST；关键词只出现在 header 时会报 "...must contain SHALL or MUST in the requirement body, not only in the header"（src/core/validation/validator.ts:1005-1037, OpenSpec@bae58cf）。WARNING 级消息带 "(RFC 2119 best practice for English specs)" 后缀（同上）。注意这是英文规约习惯，不是 schema 文法的一部分。

### 5. archive 的 delta 合并语义（`src/core/specs-apply.ts` + `src/core/archive.ts`）

代码路径：`archiveChange` → `findSpecUpdates(changeDir, mainSpecsDir)`（src/core/specs-apply.ts:116）扫描 change 的 `specs/**/spec.md` → 每个 delta 先经 `buildUpdatedSpec`（src/core/specs-apply.ts:163）在内存重建主 spec 并计数 → 全部成功后才 `writeUpdatedSpec`（src/core/specs-apply.ts:1231）落盘 → `retireSpec`（src/core/specs-apply.ts:1047）处理 capability 删除 → 最后 `moveDirectory` 把 change 移入 archive（src/core/archive.ts:2055-2063）。任何一步失败即中止，写盘在全部校验通过之后（src/core/archive.ts:1753-1788, OpenSpec@bae58cf）。

- **应用顺序**：`RENAMED → REMOVED → MODIFIED → ADDED`（注释原文，src/core/specs-apply.ts:443-444, OpenSpec@bae58cf）。
- **RENAMED**：把 FROM 块的原始内容（含全部 scenario）搬到 TO 名下；FROM 不存在、TO 已存在、TO 与现存 requirement 仅差大小写/内部空白，均抛错拒绝（src/core/specs-apply.ts:455-477, OpenSpec@bae58cf）。配不成对的 FROM/TO 行在更早的 plan 校验就抛 "RENAMED entry has no matching TO:/FROM: ... Write each rename as a FROM: line followed immediately by its TO: line."（src/core/specs-apply.ts:223-234, OpenSpec@bae58cf）。
- **REMOVED**：按名字删除块；REMOVED-only 的 delta 若会把 capability 删空，需要 `.openspec.yaml` 声明 `retire_capabilities: true` 才删除主 spec 文件，否则拒绝（"Spec must have at least one requirement"）（src/core/specs-apply.ts retireSpec 及 src/core/change-metadata/schema.ts:42-48, OpenSpec@bae58cf）。对新 capability（主 spec 尚不存在），REMOVED 被警告并忽略（src/core/specs-apply.ts:383-390, OpenSpec@bae58cf）。
- **MODIFIED**：**整块替换**——用 delta 提供的 raw（含 header 到全部 scenario）替换主 spec 中的同名块；header 必须与块内首行一致，否则报 "header mismatch in content"（src/core/specs-apply.ts:525-539, OpenSpec@bae58cf）。**scenario 丢失检查**：`findMissingCurrentScenarios` 比较当前块与传入块中**所有 `####` 头**（不限 `Scenario:` 前缀，与 spec 路径的 scenario 计数规则严格对齐），当前 spec 有而 MODIFIED 块没有的 scenario 会使 archive 拒绝："current spec contains scenario(s) not present in the modified block: ... Refresh the change spec before archiving"（src/core/specs-apply.ts:531-545、src/core/parsers/requirement-blocks.ts:531-596, OpenSpec@bae58cf）。这就是"只有 scenario 的头"也算 scenario 的依据——它参与丢失检测，被删会被拒。
- **ADDED**：追加新块；与现存 requirement 仅差大小写/空白时报错并提示用 MODIFIED（src/core/specs-apply.ts:577-579, OpenSpec@bae58cf）。
- **冲突即拒绝，无优先级**：同名出现在多个 section（MODIFIED∩REMOVED、ADDED∩REMOVED、MODIFIED∩ADDED、RENAMED∩REMOVED、RENAMED-TO∩ADDED）、section 内重复、MODIFIED 引用 RENAMED 的旧名，全部在应用前抛错（src/core/specs-apply.ts:267-341, OpenSpec@bae58cf）。case/空白折叠只用于把这些判定为"同一个错误"（src/core/parsers/requirement-blocks.ts:26-35, OpenSpec@bae58cf）。
- **Purpose 归属**：新 capability 的 delta 首个 section `## Purpose` 会被 archive 逐字拷进新建主 spec（实测确认：`# data-export Specification` + `## Purpose` 与 delta 完全相同）；delta 没写 Purpose 则写占位句 `TBD - created by archiving change <name>. Update Purpose after archive.`（`PURPOSE_PLACEHOLDER_PREFIX/SUFFIX`，src/core/validation/constants.ts:14-20, OpenSpec@bae58cf）。对已有 capability，delta 里的 `## Purpose` 被忽略，改 Purpose 需直接编辑主 spec（schemas/spec-driven/schema.yaml specs.instruction, OpenSpec@bae58cf）。
- **archive 命名**：`YYYY-MM-DD-<name>` 前缀来自 `ARCHIVE_DATE_PREFIX_PATTERN = /^\d{4}-\d{2}-\d{2}-/`；名字已有该前缀则原样使用，**绝不叠第二层日期**——注释引用 issue #1309（"under a day on which the change did not happen"）（src/core/archive.ts:50、1401-1408, OpenSpec@bae58cf）。实测：`archivedAs: "2026-09-22-demo-export"`（本地实测）。
- **前置门禁**：tasks.md 里未完成 checkbox >0 时 archive 拒绝，抛 `ArchiveBlockedError('archive_tasks_incomplete', ...)`，除非 `-y/--yes`（交互确认或 `--yes` 放行并打警告）（src/core/archive.ts:1358-1395, OpenSpec@bae58cf）。archive 默认先跑 validation，`--no-validate` 需确认；`--skip-specs` 跳过 spec merge（src/cli/index.ts:479-486, OpenSpec@bae58cf）。

### 6. validation 规则集与 `--strict`

- 入口 `Validator`（strictMode 构造参数，src/core/validation/validator.ts:42-47）；报告三级 `ERROR/WARNING/INFO`。**普通模式 `valid = errors===0`；`--strict` 下 `valid = errors===0 && warnings===0`**（src/core/validation/validator.ts:979-986, OpenSpec@bae58cf）。即 `--strict` 的增量就是把 WARNING 也变成失败。
- change 目录级规则（`validateChangeDir`，src/core/validation/validator.ts:146-530）：`specs/` 下的 `.md` 若不在 capability 子目录（root-level `spec.md`）→ ERROR "Delta specs must be a spec.md inside a capability folder"；delta section 内无 requirement 块 → ERROR；找不到任何 delta section → ERROR（附 `GUIDE_NO_DELTAS` 修复建议）；section 内重复 requirement、跨 section 冲突、RENAMED 重复 FROM/TO、unpaired rename → 全 ERROR（validator.ts:279-296、369-415、381-388, OpenSpec@bae58cf）；ADDED/MODIFIED 无 scenario → ERROR "must include at least one scenario"；requirement 无正文行且 header 也无 SHALL/MUST → ERROR，有正文但无 SHALL/MUST → WARNING（guidance，validator.ts:285-306、320-341, OpenSpec@bae58cf）；orphan `## Purpose` → WARNING；非 canonical `###` 头 → INFO（validator.ts:216-224, OpenSpec@bae58cf）；`.openspec.yaml` 非法 → ERROR；`skip_specs: true` 与 `specs/` 下有文件冲突 → ERROR，无文件 → INFO "zero deltas accepted"（validator.ts:489-522 与 src/core/validation/constants.ts:38-43, OpenSpec@bae58cf）。**0 delta 默认 ERROR** "Change must have at least one delta"，除非 `skip_specs`（实测空 change `--strict` 即报此错；补全 proposal+delta spec+tasks 后 "is valid"）（本地实测）。
- 主 spec 级规则（`applySpecRules`，validator.ts:774-852）：结构问题（delta 头出现在主 spec、requirement 落在 `## Requirements` 之外、重复 requirement 名）→ ERROR（src/core/parsers/spec-structure.ts:9-53, OpenSpec@bae58cf）；Purpose 缺失 → ERROR（zod `SPEC_PURPOSE_EMPTY`），<50 字符 → WARNING `PURPOSE_TOO_BRIEF`，仍是 archive 占位句 → WARNING `PURPOSE_IS_PLACEHOLDER`（src/core/validation/constants.ts:14-31, OpenSpec@bae58cf）；requirement 无 scenario → WARNING；requirement 正文 >500 字符 → INFO（同上）；requirement 正文缺 SHALL/MUST → ERROR（无正文）/ WARNING（有正文）（validator.ts:825-849, OpenSpec@bae58cf）。
- 额外面：`validate --archived` 检查已归档 change 的所有 checkbox 已完成（WARNING 级，供 pre-commit lint）（validator.ts:558-577, OpenSpec@bae58cf）；tasks 编号连续性检查（内置 spec-driven schema 时，validator.ts:574-576）；**预演合并**：`--strict`/archive 前用 `findArchiveBlockers` 干跑 merge，把 "Archive would refuse this delta: ..." 报为 INFO（validator.ts:930-976, OpenSpec@bae58cf）。
- 消息文案集中在 `VALIDATION_MESSAGES`（src/core/validation/constants.ts:34-66, OpenSpec@bae58cf），可直接引用。

### 7. 端到端生命周期（实测顺序）

1. `openspec init --tools claude --no-animation` → 写 `openspec/config.yaml` + 技能/命令文件 + `.gitkeep`；打印 "6 skills and 6 commands in .claude/" 与 "6 more workflows are available (new, continue, ff, bulk-archive, verify, onboard). Add them with `openspec config profile`"（本地实测）。
2. 聊天里 `/opsx:propose <idea>`（agent 侧）→ skill 过程：先 `openspec list --json`/`openspec context --json` 确认 root，再 `openspec new change "<name>"`，然后 `status --json` → 对 `ready` 的 artifact 循环 `openspec instructions <artifact> --change <id> --json` → 按返回的 `template`/`instruction` 写到 `resolvedOutputPath` → 再跑 `status` 直到全部 `done`（生成的 SKILL.md 正文即此流程，见 §9；流程文本 src/core/templates/workflows/propose.ts:104-151, OpenSpec@bae58cf）。
3. `openspec validate <change>`（人/agent）→ 见 §6。
4. `/opsx:apply`（agent 侧）：`openspec instructions --change <id> --json` 返回 apply 状态机（blocked/ready/all_done），agent 执行 tasks.md 并把 checkbox 标 `x`（`x` 任意大小写/间距都算 done，`- [~]`、`- []`、无 checkbox 都不算）（schema.yaml tasks.instruction 对 checkbox 形态的逐字约定，OpenSpec@bae58cf；进度解析 src/utils/task-progress.ts）。
5. `/opsx:archive`（agent 驱动）或 `openspec archive <name> --yes`（CLI）→ §5 的门禁 + merge + 目录移动。实测 JSON 输出：`{archive:{change, archivedAs:"2026-09-22-demo-export", path, specsUpdated:true, totals:{added:1,...}}}`，且新主 spec 出现在 `openspec/specs/data-export/spec.md`（本地实测）。
- specs 是**就地重写**（同名文件整体替换内容），change 是**目录移动**；archive 不是 git 操作，纯文件系统（src/core/archive.ts:1753-1788、2055-2063, OpenSpec@bae58cf）。

### 8. CLI 命令面（`src/cli/index.ts`，Commander 注册，@bae58cf）

- 顶层：`init [path]`（`--tools`、`--language`、`--force`、`--profile`、`--no-animation`、`--copilot-cloud/--no-copilot-cloud`；隐藏别名 `experimental`）（src/cli/index.ts:221-276）；`update [path]`（`--force`）（:289-292）；`list`（`--specs/--changes/--sort/--json`）（:354-357）；`view`（dashboard）（:393-395）；`archive`（`-y/--yes`、`--skip-specs`、`--no-validate`、`--json`、`--store`）（:480-486）；`validate [item]`（`--all/--changes/--specs/--archived/--report/--type/--strict/--json/--concurrency`）（:508-520）；`show [item]`（`--type change|spec`、`--deltas-only`、`--diff`、`--requirements`、`--no-scenarios`、`-r/--requirement`）（:534-543）；`feedback <message>`（`--body`）（:565-568）；`completion generate/install/uninstall`（:580-614）；隐藏 `__complete <type>`（:626-628）。
- workflow 组（agent 的确定性底座）：`status`（`--change/--all/--schema/--json`）（:644-648）、`instructions [artifact]`（`--change/--schema/--json`）（:669-673）、`templates`（:694-697）、`schemas`（:709-712）、`new change <name>`（:728-734；`--initiative/--areas` 保留为隐藏选项仅用于报错提示）。
- 通过 register 函数挂入：`spec`、`config`、`schema`、`store`、`doctor`、`context`、`workset`（src/cli/index.ts:489-505）。其中 `openspec config` 子命令含 `profile [preset]`（src/commands/config.ts:605, OpenSpec@bae58cf）——实测 1.13.1 `config --help` 列出 `profile [preset]  Configure workflow profile (interactive picker or preset shortcut)`；preset 快捷值只有 `core`，交互 picker 无 TTY 时拒绝并提示用 `openspec config profile core`；保存 `profile`+`workflows` 到全局 config 并提示接着跑 `openspec update`（本地实测）。注意 `openspec config --json` 不存在（unknown option），只有 `config list --json`（本地实测）。
- 隐藏选项 `--store-path`：故意保留注册只为让 resolver 给出"请注册该路径"的明确报错，而不是 Commander 的 generic unknown-option（src/cli/index.ts 顶部注释, OpenSpec@bae58cf）。
- 已弃用：`openspec change show|list|validate` 名词式命令仍可用但 preAction 打弃用警告（src/cli/index.ts:415-422, OpenSpec@bae58cf）。`docs-lab/reference/cli.md:11-56`（docs-lab 树）给出同一命令面的表格版，可作对照。

### 9. AI 工具集成：`openspec update` 生成什么、注入机制、slash-command 契约

- **生成物两类**：(a) **skills**——每个工作流一个 `<toolSkillsDir>/skills/openspec-<workflow>/SKILL.md`（如 `.claude/skills/openspec-propose/SKILL.md`）；(b) **commands**——按各工具的 command adapter 写到工具特定路径，如 Claude `.claude/commands/opsx/<id>.md`（frontmatter `name/description/allowed-tools/category/tags`）、Cursor `.cursor/commands/opsx-<id>.md`（frontmatter `name: /opsx-<id>`）、Amazon Q `.amazonq/prompts/opsx-<id>.md`（`@opsx-` 调用）（adapter 源码 src/core/command-generation/adapters/claude.ts:20-22、cursor.ts:20-22；调用形态表 docs/how-commands-work.md:74-80, OpenSpec@bae58cf）。**技能名与命令名不是一一对应**：实测 `/opsx:apply` ↔ skill `openspec-apply-change`、`/opsx:sync` ↔ `openspec-sync-specs`、`/opsx:update` ↔ `openspec-update-change`（本地实测；映射常量 src/core/profile-sync-drift.ts 的 WORKFLOW_TO_SKILL_DIR，docs-lab/reference/skills.md:14-16 引用之）。
- **40 个工具的目标目录表**硬编码在 `AI_TOOLS`（`skillsDir` 决定技能写哪，如 claude→`.claude`、cursor→`.cursor`、codex/zed/antigravity/通用 fallback→共享 `.agents`、oh-my-pi→`.omp`），另有 `detectionPaths`（靠用户已有文件探测工具）与 `requiresIdeRestart`（src/core/config.ts:40-104, OpenSpec@bae58cf）。
- **delivery 三态**（全局 config `delivery: both|skills|commands`，默认 `both`，src/core/global-config.ts:45-47）：`shouldGenerateSkillsForTool`/`shouldGenerateCommandsForTool` 决定每个工具写哪类；delivery=commands 时会**删除**技能目录、delivery=skills 时会 reconcile/删除命令文件（src/core/command-surface.ts:29-43 与 src/core/init.ts:1275-1279, OpenSpec@bae58cf）。无 adapter 且非 codex 的工具（如纯 skills-only 目标）在 delivery=commands 下什么都得不到，init 会打印纠正提示（src/core/init.ts:1386-1405, OpenSpec@bae58cf）。
- **profile**：`core` 固定安装 6 个工作流 `['propose','explore','apply','update','sync','archive']`；全集 12 个（另有 `new/continue/ff/bulk-archive/verify/onboard`）；`custom` 按用户选择并在 archive/bulk-archive 前自动补 `sync`（src/core/profiles.ts:14-64, OpenSpec@bae58cf）。实测 init 默认写 6 命令 + 6 技能，与 core 集一致（本地实测）。
- **生成的 SKILL.md 即契约本体**：YAML frontmatter（`name/description/allowed-tools: Bash(openspec:*)`/`license/compatibility/metadata{author,version,generatedBy:"1.13.1"}`）+ 正文是一段完整过程（规划边界 → `openspec list --json` 读 `root` 确认项目 → `openspec context --json` → `openspec new change` → `status --change <id> --json` → 循环 `openspec instructions <artifact> --change <id> --json` → 按 `template`/`instruction` 写到 `resolvedOutputPath` → 复跑 `status`），并内嵌 "`status` is file-existence only...必须沿 `requires` 边传递构造" 的警告与"禁止手工在 `openspec/changes/` 下建目录（会缺 `.openspec.yaml`）"的禁令（本地实测读取生成文件；同文模板 src/core/templates/workflows/explore.ts:195-198、propose.ts:148-151, OpenSpec@bae58cf）。`openspec update` 判定"过期"有**两条**依据，不只是版本戳：(1) `generatedBy` 版本戳（`status.needsUpdate` → `fromVersion → OPENSPEC_VERSION`，src/core/update.ts:656-658, OpenSpec@bae58cf）；(2) **内容比对**——`findToolsWithDriftedSkills` 用 `generateSkillContent(template, OPENSPEC_VERSION, transformer)` 重新生成，再与磁盘上的 `SKILL.md` 归一化后比较，不一致即判过期（src/core/update.ts:603-630, OpenSpec@bae58cf）。注释自述这是对旧行为的修补："Skill freshness was decided solely by the `generatedBy:` line, so a body edited after generation … left `update` reporting the install healthy"（src/core/update.ts:588-593, OpenSpec@bae58cf）。含义：手工改过的 SKILL.md 会被 `openspec update` 覆盖，这正是 `docs-lab/customize/skills.md` 被 upstream 自己 park 掉的原因。
- **marker block 注入：当前版本不做，反而移除**。`<!-- OPENSPEC:START -->`/`<!-- OPENSPEC:END -->` 标记只剩两个用途：(1) `legacy-cleanup` 检测并**从** `AGENTS.md`/`CLAUDE.md`/`CLINE.md` 等根配置文件**剥掉**旧内容——文件本身绝不删除（src/core/legacy-cleanup.ts:304-307、537-613、657-663、837-839, OpenSpec@bae58cf）；(2) shell completion 安装器在 `.bashrc`/`.zshrc`/PowerShell profile 里写 `# OPENSPEC:START/END` 管理块（src/core/completions/installers/bash-installer.ts:18-21 等, OpenSpec@bae58cf）。旧版"把指令块注进 AGENTS.md"的机制已退役，取而代之的是工具原生的 skills/commands 文件。
- skill 对"无 root"项目的行为契约：agent 自动选中时直接放弃 OpenSpec 正常作答；用户显式调用时停下询问（init / `--store` / 放弃）；任何 skill 都不会自己创建 `openspec/` 目录（docs-lab/reference/skills.md:26-42, docs-lab 树）。

### 10. 网络、telemetry 与仓库外状态

- **Telemetry（默认开，opt-out）**：每个命令执行向 PostHog 发 capture 事件，走自家反代 `https://edge.openspec.dev/batch/`（公网明文 key 只许写），1 秒超时、fire-and-forget、永不重试（src/telemetry/index.ts:30-33、133-152, OpenSpec@bae58cf）。载荷：命令名 + 版本 + 匿名 UUID（`anonymousId` 首次随机生成并持久化到全局 config）（src/telemetry/index.ts:98-120 与 src/core/global-config.ts:14-22, OpenSpec@bae58cf）；README 的 Telemetry 折叠块承诺 "only command names and version... No arguments, paths, content, or PII"（README.md, OpenSpec@bae58cf）。关闭优先级：env `OPENSPEC_TELEMETRY`（非 on 值即关）/ `DO_NOT_TRACK` → CI 环境自动关 → 全局 config `telemetry.enabled:false` → **全局 config 文件无法解析时视为关**（src/telemetry/index.ts:64-97 与 src/telemetry/opt-out.ts:16-30, OpenSpec@bae58cf）。
- **版本检查**：向 npm registry（默认 `https://registry.npmjs.org`，仅在 `npm_config_registry` 为 https 时才用自定义源，否则**禁用检查**而非回退公网）读 `latest` dist-tag，1.5s 超时、256KB 响应上限、SemVer 严格校验后才打印升级提示（src/core/version-check.ts:14-16、51-69、126、160、287-290, OpenSpec@bae58cf）。
- **全局状态**（见 §2 末）：`~/.config/openspec/config.json`（profile/delivery/workflows/telemetry/featureFlags/默认 store）、`~/.local/share/openspec/`（用户 schema 覆盖、telemetry identity、stores 注册表 `stores/registry.yaml`）（src/core/global-config.ts:52-130、src/core/store/foundation.ts:77-83, OpenSpec@bae58cf）。`openspec feedback` 会开 GitHub issue（docs/README.md "Where else to get help", OpenSpec@bae58cf）。

## Recommendation

对正在评估"把 OpenSpec 当作 skill/资产套件引入"的项目（如本仓库）：

1. **值得采用的部分是确定性 CLI 半 + artifact graph 约定**。`openspec/` 布局、`schema.yaml` 的 artifact 依赖图、`status/instructions --json` 的契约、`validate`/`archive` 的 delta 合并都是纯本地、确定、可进 git 的资产；planning home 可解析到独立 store 仓库，意味着规划层可以跨代码仓共享（多 repo 场景）。引入成本主要是 `openspec init` 写下的技能/命令文件需要提交进仓库。
2. **agent 半是"生成的一次性过程文档"，不是运行时依赖**。SKILL.md 本质是 CLI 的调用说明书（`new change → status → instructions --json → 写文件`），升级 OpenSpec 后必须重跑 `openspec update` 刷新（`generatedBy` 版本戳会判定过期）。评估时把"生成的技能文件纳入版本控制 + CI 跑 `openspec validate --all` 与 `validate --archived`"作为最低 adoption 门槛即可拿到大部分收益。
3. **`--strict` 与 archive 前置 validation 适合进 pre-commit/CI**：普通模式只挡 ERROR（结构破坏类），WARNING（无 SHALL/MUST、Purpose 过短、缺 scenario）正是人类评审想拦的。
4. **关闭或知晓 telemetry**：企业/内网环境应设 `DO_NOT_TRACK=1` 或 `telemetry.enabled false`；注意默认开、且 version-check 与 telemetry 共享同一套 opt-out 语义（src/telemetry/opt-out.ts 头注释, OpenSpec@bae58cf）。纯内网 npm 镜像（非 https 或自定义 registry）会让版本检查自动禁用，行为可接受。
5. 本 harness（Oh My Pi）在 `AI_TOOLS` 里有官方目标目录 `.omp`（src/core/config.ts:40-104, OpenSpec@bae58cf），`openspec init --tools oh-my-pi` 即可生成对应技能树。

## Risks

- **版本错位**：npm 1.13.1（2026-09-17T01:14Z）早于 HEAD `@bae58cf`（2026-09-17T06:31Z）约 5 小时，源码行号以 HEAD 为准，实测行为以 1.13.1 为准；发布后合入的提交（如 #1864/#1806/#1860 等 fix）尚未进任何已发布版本，升级时合并语义可能再变（Sources 列 SHA）。
- 上游处于快速迭代期（单周多个 fix 级提交 + docs-lab 全站重写中）；docs/ 树的散文随时可能与源码漂移，docs-lab 多数页仍是骨架，**不要**把任一文档树当作机制的唯一依据。
- delta 文法的若干硬性约定（scenario 必须 `####`、FROM:/TO: 必须相邻配对、MODIFIED 必须整块含全部 scenario）违反时**静默失败或 archive 拒绝**的边界较多，团队写作习惯需要一次校准；`skip_specs`/`retire_capabilities` 两个 `.openspec.yaml` 标记语义细（前者要求 `specs/` 必须为空，后者授权不可恢复删除），误用代价不对称。
- 本 note 的"本地实测"来自 scratch 目录的一次端到端运行（npm 1.13.1 / node v24.21.0）：覆盖 init/new/status/instructions/validate/archive 主路径，未实测 REMOVED/RENAMED 合并、stores（beta）、workset、multi-language、`--language` 等旁路；这些只由源码阅读支撑，标注为未实测。
- 合并内部细节（§5）引自 `src/core/specs-apply.ts` 的阅读；`@bae58cf` 之后若再合入 parser/archive fix，行号与文案会变。

## Sources

- `Fission-AI/OpenSpec` @ `bae58cf61479986431bb798acbe5a688a591c18c`（main HEAD, 2026-09-17T06:31:19Z "docs: fix Docslab links to unfinished pages (#1903)"）——全部 `src/**`、`schemas/spec-driven/**` 行号引用。克隆于 /tmp/openspec-upstream。
- npm `@fission-ai/openspec@1.13.1`（dist-tags: latest=1.13.1, next=0.3.0, beta=1.6.0-beta.1；engines node>=20.19.0；ESM；bin→`bin/openspec.js`；发布时间 2026-09-17T01:14:12Z）——发布产物事实与"本地实测"环境（https://registry.npmjs.org/@fission-ai/openspec）。
- 本地实测（npm @fission-ai/openspec@1.13.1, node v24.21.0, scratch 项目）：§2 布局、§3 status/instructions JSON、§5 archive JSON、§7 生命周期、§8 `config profile`/`config --json`、§9 SKILL.md 内容与命名映射、§6 validate 报错/通过。
- `docs/` 树（OpenSpec@bae58cf，**遗留散文**，站点已不再构建自它）：`docs/how-commands-work.md:1-80`（两半模型）、`docs/commands.md:1-60`（slash 命令参考）、`docs/README.md`（telemetry/feedback 表述）。
- `docs-lab/` 树（OpenSpec@bae58cf，站点事实来源，多数页为骨架）：`docs-lab/README.md:1-120`（两树关系、页面归属）、`docs-lab/reference/cli.md:1-60`（CLI 参考表）、`docs-lab/reference/skills.md:1-50`（skill 契约与核验说明）。
