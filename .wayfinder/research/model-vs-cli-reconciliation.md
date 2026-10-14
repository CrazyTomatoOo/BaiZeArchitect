# 对账：模型说的 vs CLI 真做的（票 #170）

> research 票产出。对账范围：`CONTEXT.md`（必要时 `README.md`）对 CLI 行为的承诺 vs `src/*.ts`、`bin/baize.ts`、`scripts/*.mjs`、`test/**` 的实际行为。
> **方法限制（如实记录）**：产出此报告的 agent 工具集只有 `read/grep/glob/web_search`，**没有 shell**，因此未实跑 `npm test` / `npx baize validate`；行为证据来自**源码逐行阅读 + 仓库自带测试断言**（`test/cli.test.ts` 是本 CLI 的可执行规格，`scripts/check-fixture.mjs` 是构建后的 fixture 严格校验入口）。

## 结论

14 条承诺里 **12 条与 CLI 实现一致**，**2 条只见于文档（未实现）**；未发现「代码做了文档没说」或「实现与文档不一致」的条目。

### 两条「只见于文档」（本票的主要发现）

1. **改 slug 由 CLI 自动改写所有引用 —— 没做。**
   `CONTEXT.md:49` 承诺「改 slug（改语义）是显式的破坏性操作，由 CLI 自动改写所有引用」。
   事实：`src/cli.ts:302-312` 的 `dispatch` 只认 `new|validate|status|accept` 四个命令；`src/catalogs.ts:33-47` `readSlugSet` 只读清单、不写；`src/` 与 `bin/` 全仓无改写引用的函数或命令；test 无对应用例。
   **补充（主 agent 复核）**：这条承诺**同时写在 skill 散文里**——`skills/baize-scenario/SKILL.md:31`「改分类的 slug 是显式破坏性操作，由 CLI 自动改写全部引用，不手工编辑」。所以两个面（文档 + skill）都在承诺一件代码没做的事。

2. **`acceptance` 超过约 7 条报 WARNING —— 没做。**
   `CONTEXT.md:138` 承诺「超过阈值（约 7 条）报 WARNING『这条 IR 该拆了』」。
   事实：`src/validate.ts` 的全部 17 条规则（`id.*` / `field.*` / `ref.*` / `sr.unallocated` / `stage.*` / `coverage.*` / `stale.*`）里没有按验收线索条数报 WARNING 的规则；`src/` 与 `test/` 全仓 grep（`该拆|阈值|拆了|threshold`）零命中。
   **补充（主 agent 复核）**：这条承诺**同时写在 skill 散文里**——`skills/baize-ir/SKILL.md:23`「线索太多（约七条以上）是『该拆了』的信号：拆成多条 IR」。所以它不是「只有 CONTEXT.md 在说」，而是「文档与 skill 都在说、代码没做」。

### 两处「需要留意但不判不一致」

- **指纹范围**：`src/fingerprint.ts:16-51` 的 `substantiveFields` 实际取 `statement` + `acceptance` + 五个出边（缺省 `null`），不是字面上的「只取两个字段」。但确认只写给 IR（`src/confirm.ts:106` `isIr`），而 IR 没有出边（`CONTEXT.md:214` 自己的脚注），所以正常态下与文档等价。
- **「阻塞」的形态**：门禁只以 `status` 视图呈现（`blocking` 标志），加上 IR 门禁在 `validate --strict` 下的提醒级兜底；**没有任何 CLI 命令在写入时真正拦截**，功能拆分签字与跳过记录也没有 CLI 写命令（`chains/*.yaml` 代码只读不写，靠手工编辑）。这与文档自述相符（`CONTEXT.md:191`「只有判据算不出来的门禁才留记录」、`:193`「机械兜底是一条提醒级报告（--strict 下挡）」）。

## 逐条对账表

| # | 承诺（文档位置 + 短引） | 代码事实（file:line + 符号） | 判定 |
|---|---|---|---|
| 9 | `CONTEXT.md:138`「超过阈值（约 7 条）报 WARNING『这条 IR 该拆了』」 | `src/validate.ts` 17 条规则中无按 acceptance 条数报 WARNING 者；src/test 全仓 grep 零命中 | **只见于文档** |
| 8b | `CONTEXT.md:49`「改 slug…由 CLI 自动改写所有引用」 | `src/cli.ts:302-309` `dispatch` 仅四命令；`src/catalogs.ts:33-47` 只读；全仓无改写引用逻辑 | **只见于文档** |
| 8a | `CONTEXT.md:43-44,47`「引用不存在的 id 是 ERROR」；「一份清单＝一个 YAML ＋一个顶层键」 | `src/catalogs.ts:33-57` `readSlugSet`（architecture.yaml→`components`；scenario-catalogs.yaml→`catalogs`）；`src/validate.ts:198-230` `ref.unknown-element`、`:233-244` `ref.unknown-catalog`；test `cli.test.ts:1476-1508,1624-1647` | 一致 |
| 1 | `CONTEXT.md:188-193` 三处门禁（IR 录入阻塞／SR→AR 提醒／功能拆分阻塞＋人签） | `src/status.ts:197-245` `gatesOf()`：`ir-entry` blocking:true、`sr-ar` blocking:false、`function-split` blocking:true＋签字；`src/status.ts:20` `FUNCTION_SPLIT_CRITERION` 与文档逐字相同；`src/validate.ts:255-273` `stage.upstream-unconfirmed` WARNING；test `cli.test.ts:2690-2732,2761-2840` | 一致 |
| 2 | `CONTEXT.md:173-179` 覆盖率按验收线索级、未覆盖 ERROR；`validate`/`status` 同源 | `src/coverage.ts:30-67` `computeCoverage`；`src/validate.ts:287-298` `coverage.missing-clue`；`src/status.ts:151-154,298` 同一函数；test `cli.test.ts:2177-2220` | 一致 |
| 3 | `CONTEXT.md:177` 孤儿 ERROR；「每条 SR 必须有 AR」WARNING | `src/validate.ts:78-86` `ref.orphan`；`:190-201` `sr.unallocated`；test `cli.test.ts:1696-1709` | 一致（孤儿规则在代码里覆盖全部非 IR 层，SR/AR 在内） |
| 4 | `CONTEXT.md:226-230` 陈旧由指纹算出、不落盘、不级联；直接下游阻塞、闭包内提醒 | `src/stale.ts:33-59` `staleFindings`（BFS 分 direct/transitive）；`:100-135` `staleIssues`（direct WARNING / transitive INFO 永不升级）；test `cli.test.ts:1875-1905,2473-2490,2540-2548` | 一致 |
| 5 | `CONTEXT.md:146-153,214` `confirmed:{by,at,fingerprint}`；指纹只取 `statement`＋`acceptance`；`by` 缺省 `unknown`、不回落 git | `src/confirm.ts:108-113` 写 `confirmed`（仅 IR，`:106`）；`:93-100` `confirmationOf`；`src/fingerprint.ts:16-32`；`src/confirm.ts:17` `DEFAULT_USER="unknown"`、`src/cli.ts:286`；test `cli.test.ts:927-948` | 一致（细微差别见上「需要留意」） |
| 6 | `CONTEXT.md:208-209` 实质字段＝`statement`＋`acceptance`＋出边 | `src/fingerprint.ts:16-19` `EDGE_FIELDS`；`:26-32` `substantiveFields` | 一致 |
| 7 | `CONTEXT.md:196-197` 阶段状态只存跳过记录与功能拆分签字 | `src/chainstate.ts:36-39,64-83` `ChainState{skipped,gates}`；`src/validate.ts:315-337` `stage.skip-missing-reason`；全仓无写 `chains/*.yaml` 的路径 | 一致 |
| 10 | `CONTEXT.md:92-114` `allocates` 标量；`covers` 必填可空数组；`appearsIn`/`realizes` 多对多、记在后创建一方 | `src/layers.ts:174-178,147-151,331-336,375-380`；`src/validate.ts:203-230`；`src/cli.ts:141-142`；test `cli.test.ts:2071-2105,1579-1622` | 一致 |
| 11 | `CONTEXT.md:55-57` 场景六字段全必填、允许空数组、缺字段＝没想 | `src/layers.ts:209-260`；`src/fieldcheck.ts:33-50` 区分 absent 与 empty；test `cli.test.ts:2281-2308` | 一致 |
| 12 | `README.md:81` 退出码 0/1/2；`CONTEXT.md:193`（--strict 下挡） | `src/cli.ts:220-230` `failing = ERROR \|\| (strict && WARNING)`；`src/errors.ts:8-16` 默认 2；`stale.transitive` 为 INFO 永不升级 | 一致 |
| 13 | `README.md:9` 四命令；`CONTEXT.md:227` 受影响只在 status 汇总 | `src/cli.ts:233-271` 三入口；`src/render.ts:150-157` `renderChainStale`；test `cli.test.ts:2540-2548` | 一致 |
| 14 | `CONTEXT.md:112` 只存单向、反向是查询 | `src/coverage.ts:32-66`、`src/validate.ts:183-201`、`src/status.ts:317-341,346-365,390-399`；无反向写盘 | 一致 |

## 可复现的行为证据（测试锚点）

- 退出码：`cli.test.ts:353-371`；WARNING 与 `--strict`：`:1712-1723`；陈旧分级：`:1875-1905`。
- 覆盖率同源：`:2177-2220`（`status` 的 covered ＋ `validate` 的 missing ＝ total）。
- 门禁：`:2690-2732`（顺序 `ir-entry`/`sr-ar`/`function-split`）、`:2761-2840`（签字齐→passed）、`:2872-2926`（三项自动挡）。
- IR 门禁兜底：`:3045-3088`（未确认→每个下游一条 WARNING；确认后消失；改实质内容→确认失效）。
- fixture 契约：`scripts/check-fixture.mjs:37-61`（对 `test/fixtures/chain-sample` 跑 `validate --strict --json` 必须零问题、`status --chain IR-001` 必须七层各一条）。fixture 七份条目已逐份核对，与契约自洽。

## 未验证项

`npm test` / `npx baize validate` 的**运行级**输出本轮未采集（无 shell 工具）。两条「未实现」结论基于 src 与 test 的穷举 grep，属确定结论；若要运行级铁证，有 shell 的一侧跑 `npm test` 并 grep 规则表即可复现。
