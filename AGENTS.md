## Agent skills

### Issue tracker

票与规格是 GitHub issue（`CrazyTomatoOo/BaiZeArchitect`）；本机跑 `gh` 必须先去掉代理。见 `docs/agents/issue-tracker.md`。

### Triage labels

triage 的五个角色沿用默认标签词（`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`）。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文：仓库根 `CONTEXT.md` 是域模型的单一来源，决策在 `docs/adr/`。见 `docs/agents/domain.md`。

## 开发约定

- 提交前与 CI 都跑 `npm run check`（类型检查 + 测试 + 构建 + skill 结构 + fixture 严格校验 + 装包冒烟）。启用提交前钩子（每个 clone 一次）：`git config core.hooksPath .githooks`。
- 写代码与写测试的规矩见 `CODING_STANDARDS.md`。
