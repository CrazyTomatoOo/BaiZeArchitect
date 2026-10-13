# 编码标准

给**评审**看的（`/code-review` 读它）。实现期该守的硬约束大多已经被 `npm run check` 与测试守住——**工具已经保证的，评审不要再报一遍**。

## 这份文件管什么

只写**判断类**规矩：正则抓不住、但每次评审都要同一个答案的那些。能机械化的不在这里，在 `scripts/` 与 `test/cli.test.ts` 里（见文末）。

## 测试

- **唯一的缝是 CLI 的可观察边界**：给定 `argv` + 初始目录状态 → 确定的 `stdout` / `exit code` / 目录变化。断言写在这条缝上。
- **不进 `test/cli.test.ts` 的**：不断言内部函数、不 mock 内部模块、不 snapshot 时间与绝对路径。要验一个内部算法是否对，用**一次性脚本**跑一遍看结果，别把它焊进永久测试。
- **不断言源文本**（文案、注释、文件内容的措辞）。要验形状（frontmatter、字段、结构），断言**解析后的数据**；形状检查放 `scripts/`，不放测试。
- **永久的测试只留会复现的消费者可见缺陷**：行为、边界、不变量、状态迁移、优先级、错误。测试失败要么是真缺陷，要么是测试写错了——不存在「改一下期望值让它过去」。
- **唯一的测试替身是时钟**：`confirmed.at` / `skipped.at` / 门禁的 `at` 由外部注入，不读真实时间。

## 单一来源

- **能算的不写盘**。进度、覆盖率、陈旧、算得出来的门禁状态都不落文件；落盘的只有「算不出来的东西」（跳过记录、功能拆分的签字）。
- **同一事实只许算一处**：同一个数字/结论被两处各算一遍，必然有一天不一致。`status` 与 `validate`、`--json` 与人读，都从同一份数据出发。
- **关系只存单向**（子指父、SR 指 IR、AR 指元素、用例指场景、功能项指用例）。反向关系是查询，不落盘。
- **目录是位置，边是语义**：条目属于哪条链由 `parent` 边决定，不由目录决定。
- **域模型只有一处**：`CONTEXT.md`。写代码时用它的词，别另造一套。

## 规则与输出

- **rule id 只增不改**，且必须挂在六个域之一（`ref` / `coverage` / `field` / `stale` / `id` / `stage`；`sr.unallocated` 是既有的例外）。域是给人和 skill 用的分区——**新规则要能被归到「去改条目」「去看上游义务清单」「去补字段」「去复核」「去找人签字」里的一个**。
- **输出契约只增不改**：`--json` 的顶层带 `schemaVersion`，删字段或改语义 = 升版本。
- **两个研究方向都要有结论**：`validate` 的每条规则要么报、要么不报，都有测试；不要留「大概会报」的灰区。

## 语言与提交

- **中文优先**：域模型、错误文案、skill 正文、提交信息。代码标识符用英文。
- **提交信息**：中文 conventional commit（`feat(cli): … (#149)`），**带票号**。
- 本仓库**不使用 PR**（见 `docs/agents/issue-tracker.md`）。

## 并行实现

多个 agent 同时改这个仓库时，**先按文件分区**。已知的热点（同一次并行里被改到同一处就会冲突）：

| 文件 | 谁都想动它的地方 |
|---|---|
| `src/layers.ts` | 各层的字段 schema |
| `src/validate.ts` | 每张票各加自己的 rule |
| `src/status.ts` / `src/render.ts` | 各视图的新字段 |
| `test/cli.test.ts` | 每张票各加自己的用例与夹具 |

切票时让「同一个 schema 区域 / 同一个视图」只归一张票；跨票共享的新模块（如 `coverage.ts`）先由一张票落地，其余票只调用。

## 已经机械化的（评审别再报）

`npm run check` = 类型检查 → 测试 → 构建 → skill 结构 → fixture 严格校验 → 装包冒烟：

- `tsc --noEmit`：类型
- `test/cli.test.ts`：exit code 语义（0/1/2）、`--json` 与人读同源、rule id 形状、各规则的报与不报
- `scripts/check-skills.mjs`：十个 skill 齐全、`name` 与目录一致、`description` 以 `Use when` 开头、正文非空且中文
- `scripts/check-fixture.mjs`：拿 `test/fixtures/chain-sample`（最小七层链）跑 `validate --strict`，零问题；并断言那条链确实覆盖七层
- `scripts/check-pack.mjs`：`npm pack` 出来的包装进干净项目后 `baize new ir` 真能跑
- `.githooks/pre-commit` 与 `.github/workflows/check.yml`：上面这套在提交前与 CI 各跑一次

**故意不在 `npm run check` 里的**：探针门槛集（`node probes/run.mjs --gate`）。它要**真实模型调用**（花钱、要密钥、结果本身带方差），干的是另一件事——`npm run check` 拦「结构错了」，探针让「行为退化了」有人看得见。改了 `skills/` 下任何文件就跑它（何时跑见 `AGENTS.md`，怎么跑与观察项见 `probes/README.md`）。
