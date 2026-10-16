# 最小链 fixture（chain-sample）

一条真跑得通的**最小**七层链：1 IR / 1 SR / 1 AR / 1 场景 / 1 用例 / 1 功能项 / 1 功能点 + 两份受控清单。

它的用处只有一个：给 `validate --strict` 当靶子——`npm run check` 里的 `scripts/check-fixture.mjs` 拿它跑严格模式，那份规格要求（#147「`validate --strict` 进 pre-commit / CI」）就落在这条链上。本仓库是工具，自己没有 `baize/` 数据，所以需要一个 fixture 当被校验的仓库。

**别把它当示例数据随手改**：它刻意保持「严格模式零问题」——每条 SR 都有 AR、每条验收线索都被覆盖、每条用例都被功能项 realizes，而且**链根 IR-001 带 `confirmed` 块**（IR 录入门禁：未确认的 IR 会让它的下游条目报 `stage.upstream-unconfirmed`，严格模式下就红）。要加东西可以，加完跑 `npm run check:fixture`。

改过 `IR-001` 的 `statement` 或 `acceptance` 之后，那份确认就失效了，得重认一次：

```bash
cd test/fixtures/chain-sample && BAIZE_USER=fixture node ../../../dist/bin/baize.js accept IR-001
```

`baize/ids.yaml` 是**发号账本**（#193）：每层记着已发出去的最大编号，`baize new` 会更新它。fixture 里它与各层条目一一对应（都是 `001`）。手工往层目录里加条目时，要一并把它改到不小于目录里的最大号，否则 `validate --strict` 会多报一条 `id.ledger-behind`——`scripts/check-fixture.mjs` 要求零问题，INFO 也不放行。
