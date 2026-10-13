# 最小链 fixture（chain-sample）

一条真跑得通的**最小**七层链：1 IR / 1 SR / 1 AR / 1 场景 / 1 用例 / 1 功能项 / 1 功能点 + 两份受控清单。

它的用处只有一个：给 `validate --strict` 当靶子——`npm run check` 里的 `scripts/check-fixture.mjs` 拿它跑严格模式，那份规格要求（#147「`validate --strict` 进 pre-commit / CI」）就落在这条链上。本仓库是工具，自己没有 `baize/` 数据，所以需要一个 fixture 当被校验的仓库。

**别把它当示例数据随手改**：它刻意保持「严格模式零问题」（每条 SR 都有 AR、每条验收线索都被覆盖、每条用例都被功能项 realizes）。要加东西可以，加完跑 `npm run check:fixture`。
