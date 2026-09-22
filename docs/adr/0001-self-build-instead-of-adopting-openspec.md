# 自建套件，不寄生 OpenSpec

我们调研过 OpenSpec 与 Superpowers，最终决定**纯自建**：自己的条目模型、自己的极薄 CLI、自己的 skills、自己写会话启动注入。

理由是 OpenSpec 的完成模型是**文件存在性**（`status` 用 fast-glob 匹配 `generates`），而本项目的核心价值是**图校验**——覆盖率（IR 的每条验收线索是否被 `covers` 到）、孤儿、陈旧传播——它一条都算不了，且**没有内容校验的扩展点**。寄生它等于框架照付、校验器还得自己写。同时它是 change/delta 模型（对 capability 基线做增量），我们是**分解树**（条目 + 单亲 + 覆盖 + 陈旧），形状不同。

Superpowers 只借**概念**（会话启动注入、skill 写作纪律），不作运行时依赖。

## Considered Options

- **寄生 OpenSpec**（写自定义 `schema.yaml`，用它的 `instructions` / `status` / `archive` / 打包）：否。完成模型是文件存在性，`validate` 只做 markdown 结构；artifact DAG 是「产出**文件**的阶段」，我们的六段是「产出**条目**的阶段」——硬套会让每个 artifact 的 `generates` 指向同一片 glob，`requires` 边退化。
- **把 OpenSpec 当库**（复用它的 artifact graph / parser / validator）：**技术上不可行**，实测两条——`await import('@fission-ai/openspec/dist/core/artifact-graph/index.js')` 报 `ERR_PACKAGE_PATH_NOT_EXPORTED`（`exports` map 只暴露 `"."`）；公开 API 实测只导出配置与路径助手（`OPENSPEC_ROOT_DIR`、`getGlobalConfig`、`ensureOpenSpecRoot`、store/registry 等），不含 artifact graph、parser、validator。
- **寄生 Superpowers**（只做 skills，靠它的注入机制承载）：否。它提供**机制**不提供**数据模型**，而数据模型是产品本体；且本项目只需要 pi 与 Claude Code 两个 harness，不必继承它为 10 个 harness 维护 10 份 manifest + 4 套注入实现的税。

## Consequences

- CLI、两个 harness 的打包与注入、skill 写作纪律，全部由本项目承担——但这三样正是产品本体（地图已定「极薄 CLI + skills 两半」），不是额外开销。
- 上游漂移风险归零，代价是拿不到它们的修复与评测积累（Superpowers 的 Quorum eval lab 就不在可继承范围内）。
- 调研笔记仍作**参考**保留在 `.wayfinder/research/`：OpenSpec 的 delta 文法、`validate` 的 ERROR/WARNING 分级、`instructions --json` 的契约形状、schema 三级覆盖；Superpowers 的 SDO（description 只写何时用）、RED-GREEN-REFACTOR 的 skill 写作法与注入机制。
