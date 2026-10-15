# 极薄 CLI 是必需的（发号与校验不能交给 skills）

本项目带三条命令的 CLI：`baize new <layer>`（发号 + 建文件）、`baize validate`、`baize status`。技术形态 **Node + TypeScript**，唯一运行时依赖是 `yaml`（v2.9.1，实测零传递依赖）。`validate` 默认只在 ERROR 时失败（exit 1），`--strict` 把 WARNING 也算失败；默认作用域是全仓，`--chain <id>` 限定到一条链。 → 命令族后来扩编：`accept` 见 ADR-0005，`rename` / `migrate` 见 ADR-0006；全量以 `README.md` 与 `src/cli.ts` 为准，「三条」是当年的快照。

**为什么一个 skill 套件必须带 CLI，而 Superpowers 不带**：Superpowers 证明了纯散文的技能套件可行，但它没有**跨条目的不变量**。本项目有两个散文管不住的东西：

1. **id 发号需要唯一权威**。两个 session 各自「读目录找最大号 +1」必然撞号，而撞号意味着两条需求共用一个 id——追溯图当场损坏，且损坏是静默的。
2. **图校验无法由模型可靠完成**：线索级覆盖率、孤儿、陈旧传播都是跨条目的计算。更关键的是——**校验器静默出错是最坏的失败模式**，它让人以为查过了。

所以 skills 的职责被限定为「判断与写作」，机械的不变量交给 CLI：**skills 不自己发号、不自己校验，只调用**。

## Considered Options

- **零运行时依赖，手写 YAML 子集解析**：否。frontmatter 要支持 map（`acceptance: {a1: …}`）、多行字符串、引号与转义，手写子集会在真实输入上静默出错。而 `yaml` 本身就是零传递依赖，所谓「零依赖」并不因此更干净。
- **Python**：否。pi 的扩展是 TS（`@earendil-works/pi-coding-agent`）、Claude Code 的 hook 生态是 node/bash，同语言才能让注入与 CLI 共享代码；且 Python 标准库同样没有 YAML。
- **单文件脚本、无构建**：否。TS 的类型是这类图校验的第一道防线。
- **CLI 可选，没有 CLI 时 skills 靠约定发号**：否。见上文第 1 条——撞号是静默损坏。
- **`validate` 一律只报不失败（exit 0）**：否。这会让 #126 定下的门禁失去机械依据，CI 与 pre-commit 也用不上它。
- **默认 WARNING 也算失败**：否。会让渐进拆分一路红灯——那正是 #126 明确否掉的。
- **必须指定作用域（`--chain` / `--item`）**：否。「刚 clone 下来先看看整体健不健康」不该是三步操作。

## Consequences

- 产品形态就此定形：**CLI + skills 两半**，CLI 是「唯一权威」，skills 是「判断与写作」。
- `status --json` 成为 **skills 的稳定输入契约**——它必须稳定，因为 skills 要解析它做门禁判定。
- **exit code 是门禁的机械依据**：#126 的三处门禁（IR 录入阻塞 / SR→AR 提醒 / 功能拆分阻塞）靠它，而不是靠模型自觉。
- `baize confirm` 是否作为第四条命令存在，取决于「人工确认的记录方式与失效规则」工单——若确认记录落在阶段状态文件里，`confirm` 可能只是 `new`/写命令的一部分。 → 已定：确认与复核共用 `baize accept`，确认记在条目上（`confirmed` / `reviewed`），不进阶段状态文件（见 `CONTEXT.md`「确认」与 ADR-0005）。
- 后三层（场景 / 用例 / 功能）的目录名待「场景/用例/功能三层的挂载点与层级语义」工单。 → 已定：`scenarios/` / `usecases/` / `function-items/` / `function-points/`（`src/layers.ts` 的 `dir`）；「后三层」实为四层。
