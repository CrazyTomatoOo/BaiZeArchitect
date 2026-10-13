# 探针集与回归（#159）

探针回答一个问题：**装好之后，一个新会话里 skill 会不会在对的时刻被触发。**
它挡的是「我看了一眼，触发了」这种无法核对的断言——每条探针都是
**干净会话 + 一句自然语言 + 完整记录**，判定只对着记录做。

## 怎么跑

前置：Node ≥ 24（跑 CLI 与 runner）；`pi` 或 `claude` 在 PATH；
pi 侧模型已 `pi auth check` 过。skill 走**本地 checkout**（不发布）：
pi 靠探针目录里项目侧 `.pi/settings.json` 指向本仓库；claude 靠 `--plugin-dir`。

```bash
node probes/run.mjs --list                 # 列出 30 条探针
node probes/run.mjs                        # 全部跑，默认 harness=pi
node probes/run.mjs --harness claude       # 换 Claude Code
node probes/run.mjs --only ir-miss         # 只跑一条（快回归）
node probes/run.mjs --only ub-trap --only va-miss   # 可重复
```

每条探针跑的是真实 harness + 真实模型（会有真实调用与耗时），一条一条来：
干净目录（`mktemp`）→ fixture 搭初始状态（并用真 CLI 校验状态到位）→
一句自然语言起会话 → 完整记录落到 `probes/results/<harness>-<时间戳>/<id>/`
（`prompt / cmd / stdout / stderr / transcript.jsonl / meta.json`，项目目录也保留在
`projects/` 下备查）→ 按期望机械判定 → 打表并写 `summary.md`。

结果目录不入库（`.gitignore` 的 `probes/results/`）；一次真实全量的汇总与
代表性完整记录见同目录 `RESULTS-<日期>.md`。**被 `RESULTS` 引用的那几条探针
记录另拷一份进 `probes/evidence/`，那一份入库**——盘上的原始批次会随
worktree 清理/换机器消失（已经发生过一次），精选的那几份才带得走。
规则与拷贝命令见 `probes/evidence/README.md`。

## 三个场景各挡什么（#134）

每个 skill 三条，共 10 × 3 = 30：

| 场景 | 挡的是什么 |
|---|---|
| `trigger` 正常触发 | 基线：description 的主句要接得住 |
| `miss` 该触发没触发 | description 写偏了——用**换措辞的同一件事**（投诉不说「需求」、派活不说「架构」、改个词不说「陈旧」）去探漏报 |
| `trap` 不该触发却触发 | **跨段误触发**——词面撞段名（「要一个大屏功能」）、前置不满足（IR 未确认就催拆）、时刻不对（查引用不是审阅）。六段各有判断，用错段就是用错标准 |

## 判定口径（机械判定只取证）

- **skill 被触发 = 它的正文被打开**：转录里出现该 `SKILL.md` 的一级标题
  （读文件的结果），或有指向 `skills/<id>/SKILL.md` 的工具调用 / claude 的
  `Skill` 调用。名字或 description 出现不算——系统级清单（pi 的系统提示、
  claude 的 `skill_listing`）天生包含全部 skill 的名字，当证据就会永远「命中」。
- **baize-validate** 额外认一条：工具调用里真的跑了 `baize … validate`。
- **using-baize** 的正文是会话启动必注入的，「触发」只能看 agent 是否**按它
  行动**——判最终回复是否以套件作答（提到 baize / 六段 / 设计条目）；
  `ub-trap` 反向判回复**不得**向无关会话推销六段链。
- 判定只管「触没触发」；**触发后干得对不对由人看 `transcript.jsonl`**——
  机械判定不装懂语义。跑不起来的探针记 ERROR 连原因进汇总，不静默跳过。
- 个别探针的正则边界在 `probes.yaml` 每条的 `why` 里写明（如 `va-trap`
  只判 skill 未开：审阅流程里顺带跑 validate 不算误触发）。

## 为什么不追求 Superpowers 那种强度

Superpowers 的做法是每变体 5+ 次 fresh-context 采样、无指引对照组、把方差当
指标。#134 否掉了照搬，原话：**那套强度是为了区分「近乎相同」的措辞变体
（A/B 对比），而我们只有一版措辞，要回答的是「它会不会被触发」；在只有一版
的前提下，重复采样测的是模型随机性，不是措辞质量。**等真做措辞对比时再上
那套强度。所以本集默认仍是**每条单次采样、不设对照组**；唯一的例外是**门槛集**（每个 skill 一条 trigger）跑 N=3 取多数决——那不是为了区分措辞变体，而是因为单采样翻转已经实测到了，一次翻转不该判成退化（见下）。

## 回归姿势：门槛集

改了 `skills/` 下**任何**文件（description 或正文）后，跑门槛集：

```bash
node probes/run.mjs --gate                            # 门槛集 ×3 次取多数决（30 次运行，实测约 1 小时）
node probes/run.mjs --only <改到的那几条>              # 先跑改动的：那个 skill 的 trigger + miss + trap
node probes/run.mjs                                   # 全量 30 条：发版前 / 大改之后
```

- **门槛集**（`probes.yaml` 里 `gate: true`）= 10 个 skill 各一条 `trigger`——「每段还接得住」是底线；`miss` / `trap` 按「改谁跑谁」补。
- **N=3 多数决**（`--repeat`，门槛集默认 3）：单采样会翻转——实测 `rw-trigger` 在 v1 过、v3/v4 不过——一次翻转不该被判成退化。汇总里同时报「3 次里哪几次 PASS」，**翻转本身**是下一轮改文案的证据。（`#134` 否掉的是 Superpowers 那种全量适配：每变体 5+ 次采样 + 无指引对照组 + 方差当指标。）
- **观察项**（`observe: true`，目前只有 `va-trap`）：照跑、照记录，**不计分**。它判的是路径（`baize-validate` 该不该被打开），在两个模型上分叉（claude 稳过、pi 不稳），而修它会让必过的那几条回落——留着给观察，不再占必过的位置。
- **它不在 `npm run check` 里**：探针要真实模型调用（花钱、要密钥、结果带方差），而 `npm run check` 的职责是「结构错了拦下来」。为什么这么分，见 `CODING_STANDARDS.md`。

skill 的退化恰好是感觉不到的——表现为「某类请求不再触发」，而你会以为只是没遇到那类请求。**`miss` 场景就是给这类退化立的哨；门槛集是让「改完就跑」真的发生。**

## 判定口径里最容易读错的一条

**「打开 skill」≠「照它做」**。跨段误触发类（`va-trap` / `rw-trap` / `ir-trap` 这类）判路径是对的——开错段本身就是那件事；但**前置不满足类**（`sr-trap`：上游没准备好就催拆）判的是**结果**——正确结果是拒绝拆、把人推回确认，而「读那个 skill 查它的前置条件」是正确动作的一部分。所以 `sr-trap` 的判据是「有没有真的建出 SR 条目」（跑 CLI 或直接写文件都算），不是「有没有打开 `baize-sr`」。

## 文件

- `probes.yaml` —— 30 条探针（id / skill / 场景 / fixture / 一句自然语言 / 期望 / why）
- `fixtures.mjs` —— 初始项目状态（含用真 CLI 的状态断言）；
  项目装的是本地 checkout 的 baize 包（`file:<repo>`），agent 跑的是真 CLI
- `run.mjs` —— runner（本文开头那几条命令）
- `evidence/` —— 入库的精选记录（被 `RESULTS` 引用的那几条；见它自己的 README）
- `RESULTS-*.md` —— 一次真实全量的汇总表与代表性完整记录
