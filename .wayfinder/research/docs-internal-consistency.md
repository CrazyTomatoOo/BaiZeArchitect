# 域文档内部的自相矛盾（票 #169）

> research 票产出。范围：`CONTEXT.md`、`docs/adr/*.md`、`README.md`、`docs/agents/*.md`、`CODING_STANDARDS.md`、`skills/**/SKILL.md` 之间的自相矛盾。
>
> **复核状态**：本文件条目由只读调查 agent 产出，主 agent 逐条复核了下面标 ✔ 的（用自己的 grep/read 看过两侧原文）；标 ◻ 的是报告方给出、主 agent **未独立复核**（引用与位置照抄，采信但未验证）；标 ✎ 的是主 agent **更正**过的。所有「为什么不一致」的措辞已按复核结果重写。

## 一、清单（按强度排序）

### 1. 「尚未定（见「未定」）」——悬空引用 ＋ 过时句 ✔

- 位置：`CONTEXT.md:144`（另一侧：同文件 `:146-147`、`:153`）
- 原文：「『人已确认』在模型里怎么表示、改动后是否失效——**尚未定**（见「未定」）」／「**记在条目上**：`confirmed: { by, at, fingerprint }`……**只有这两个字段被改才失效**」
- 为什么不一致：全文没有「未定」这一节（悬空引用）；且紧邻的两处已把表示方式与失效规则写全——这句话是早期措辞残留。
- 已开票：「CONTEXT.md 的悬空「未定」与过时句」

### 2. 字段拼写两套：`alternateFlows`（场景）／`alternativeFlows`（用例）✔

- 位置：`CONTEXT.md:57` vs `CONTEXT.md:62`；代码同样分叉：`src/layers.ts:249` vs `:331`
- 为什么不一致：同一个概念（偏差与异常怎么走）在两张 schema 里是两个字段名，只差一个字母。文档与代码各自自洽，但**模型本身**不该有两个拼写——传抄一次就错一次。

### 3. 功能项「只有 title + description」 vs 代码把它当必填字段 ✔

- 位置：`CONTEXT.md:66-67`「**只有 `title` + `description`**」 vs `src/layers.ts:383-388`（`domain`，`nonEmpty: true`，空则 `field.empty`）；`skills/baize-function/SKILL.md:10` 又说「短名 + 一句话说明 + 功能域——只有这些」
- 为什么不一致：`domain` 是必填字段（缺了 `validate` 报错），却被两处「只有……」的句式排除在外；`CONTEXT.md:163` 自己也说「功能项所属的功能域」是字段。

### 4. `stakeholders` 既「全必填」又「不校验」 ✔

- 位置：`CONTEXT.md:57`（场景字段「**全必填**」）vs 同文件「stakeholders」词条「内联自由文本，**不校验**、不建条目类型……不参与任何已定校验」
- 为什么不一致：`src/layers.ts:263-268` 实际会因缺失报 `field.absent`——**存在性是被校验的**。「不参与任何已定校验」是过度陈述（真实意思应是「不做内容级校验、不建条目类型」）。

### 5. 场景必填字段：模型六项 vs skill「五件」✔

- 位置：`CONTEXT.md:57`（六字段含 `stakeholders`）vs `skills/baize-scenario/SKILL.md:18`（前置／触发／主流程／备选／预期结果，「五件少一件，这条场景就没写完」）
- 为什么不一致：skill 的计数与清单都吞掉了 `stakeholders`，而 CLI 要求它存在。照 skill 干活会撞 `field.absent`。

### 6. 用例必填字段：模型六项 vs skill 五项 ✔

- 位置：`CONTEXT.md:62`（`goal`／`preconditions`／`mainFlow`／`alternativeFlows`／`postconditions`／`stakeholders`）vs `skills/baize-usecase/SKILL.md:10`（「目标 + 前置 + 主流程 + 备选 + 后置承诺」）
- 为什么不一致：同上，`stakeholders` 缺席。

### 7. ADR-0003「三条命令」 vs README「四条命令」（含 `accept`） ✔

- 位置：`docs/adr/0003-thin-cli-is-mandatory.md:3`「带三条命令的 CLI」 vs `README.md:9`「`baize <new|validate|status|accept>`」
- 为什么不一致：`src/cli.ts:302-312` 实为四条。ADR 是决策当时的记录，但**读者会拿它当现状**。

### 8. ADR-0003 把 `baize confirm` 当悬而未决 ✔

- 位置：`docs/adr/0003-thin-cli-is-mandatory.md:27`「`baize confirm` 是否作为第四条命令存在，取决于……工单」 vs `CONTEXT.md:148`「共用一条命令 `baize accept`」
- 为什么不一致：`accept` 已定（`README.md:9`、ADR-0005:23）；ADR 里那条分支（确认记在阶段状态文件里）已被现实否决（确认记在条目上）。

### 9. INFO 这一级在域文档里缺席 ✎（更正）

- 位置：`README.md:75` 示例输出「ERROR 3 / WARNING 0 / INFO 0」 vs `CONTEXT.md` 全文**未定义 INFO**（只定义「错误级／提醒级」两档）
- 报告方原判「README 引入无定义的第三级」——**这个判法不对**：`src/stale.ts:172-173` 真的产出 `level: "INFO"` 的 `stale.transitive`，示例没写错。
- 更正后的真问题：**代码有三级、域文档只定义两级**；「传递闭包只提醒」这条在文档里没有落到任何一个级别名上。

### 10. 「提醒级」的定义把可算报告排除在外 ✔

- 位置：`skills/baize-validate/SKILL.md:29`「提醒级 = CLI **判不了对错**、只提醒（SR 还没分配、出现陈旧）」 vs `CONTEXT.md:193` 把「上游 IR 未确认」的机械兜底也叫**提醒级**（在 ADR-0005:5 定为 `WARNING`）
- 为什么不一致：未确认这件事**是**算得出的（`CONTEXT.md:191`「前两处由事实算出」），却被归进「判不了对错才提醒」的定义里。skill 的定义窄于实际用法——agent 照定义推理会漏掉这一类。

### 11. 同一条报告两种叫法：提醒级 vs 提示级 ✔

- 位置：`CONTEXT.md:193`「**提醒级**报告」 vs `skills/baize-sr/SKILL.md:28`「**提示级**，`--strict` 下挡」（`baize-validate` 又用「提醒级」）
- 为什么不一致：同一条 WARNING 在两份技能正文里两个词，agent 对不上词表。

### 12. ADR 里「目录名待工单」——工单早已落地 ✔

- 位置：`docs/adr/0002-...md:27`、`docs/adr/0003-...md:28`（后三层目录名待工单） vs 现实：`test/fixtures/chain-sample/baize/` 下 `scenarios/`、`usecases/`、`function-items/`、`function-points/` 四个目录已定；`CONTEXT.md:200` 已写「功能拆分这一段产出两个层级」
- 为什么不一致：ADR 留着当时的待办口吻，且「后三层」把功能拆分段的两个层级算作一层。

### 13. `id` 的产生者两套说法 ✔

- 位置：`CONTEXT.md:119`「由 CLI 发号」 vs `CONTEXT.md:140`「其余（`id` / `title` / `priority` / `source` / `rationale`）**agent 起草即可**」
- 为什么不一致：`id` 由 CLI 发号，不该出现在「agent 起草即可」的清单里（判断依据是：起草 ≠ 发号，混在一起会让 agent 以为可以自己编号）。

## 二、查过但一致的地方（择要）

1. **六段链路与三处门禁**：`CONTEXT.md:82/:187-188`、ADR-0003:26、ADR-0005:5、`skills/baize-review`、`skills/using-baize` 全一致（IR 录入阻塞／SR→AR 提醒／功能拆分阻塞；`kind: auto|signed`）。
2. **skill 计数 10**：README（6 段 + 3 纪律 + `using-baize`）、`AGENTS.md`、`CODING_STANDARDS.md`、`skills/` 目录一致。
3. **七层条目**：`docs/agents/domain.md`、README 链图、`CODING_STANDARDS.md`、fixture 七条目一致。
4. **探针 30**：`AGENTS.md`「10 条 ×3 次 = 30 次运行」、`probes.yaml` 头注释、`probes/README.md` 一致。
5. **受控清单**：`CONTEXT.md` 与 ADR-0004（两份清单、`components`／`catalogs` 顶层键、`slug → {name, description?}`）一致；与 `src/catalogs.ts:33-57` 一致。
6. **功能点五项必填**：`CONTEXT.md:71` 与 `skills/baize-function`、`src/layers.ts:409-412` 一致。
7. **确认机制内部自洽**：`CONTEXT.md:147`（指纹取实质字段）、`:153`（只有两字段被改才失效）、`:214`（确认只用在 IR，IR 无出边）三处互相调和，与 `src/confirm.ts` 实现一致。
8. **陈旧机制**：`CONTEXT.md:216-217` 与 `skills/baize-revise`、`CODING_STANDARDS.md`「能算的不写盘」一致。
9. **功能拆分门禁判据**：`CONTEXT.md:189`（自动三样 + 固定文案）与 `skills/baize-function`、`skills/baize-review` 一致；`src/status.ts:20` 的 `FUNCTION_SPLIT_CRITERION` 与文档逐字相同。

## 三、复核方式（可复现）

- `grep -n "未定\|INFO\|提醒级\|提示级\|三条命令\|confirm" CONTEXT.md README.md docs/adr skills`
- `grep -n "五件\|只有\|stakeholders\|alternateFlows\|alternativeFlows\|domain" skills/*/SKILL.md src/layers.ts`
- `read CONTEXT.md:117-121,138-142`、`read skills/baize-usecase/SKILL.md:8-14`
- 代码侧的字段存在性以 `src/layers.ts` 的 `name`/`nonEmpty` 与 `src/fieldcheck.ts` 的 `field.absent`/`field.empty` 为准；行为断言在 `test/cli.test.ts`（`npm run check` 89/89 全绿）。
