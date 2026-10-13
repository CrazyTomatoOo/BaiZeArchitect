# 探针汇总 · claude · 2026-10-13-06-47-

- 跑了 10 条 × 3 次 = 30 次运行（单条多跑取**多数决**）；计分 10 条：PASS 10 / FAIL 0 / ERROR 0
- harness：claude；skill 来源：本地 checkout `/Volumes/work/Project/BaiZeArchitect`（未发布）
- 判定口径：机械判定只管「目标 skill 的动作在记录里查到/查不到」；触发后干得对不对由人看 transcript.jsonl。**「打开 skill」≠「照它做」**——trap 类若不判路径（如 sr-trap），读它的前置条件是正确动作的一部分。

## 每条探针

| id | skill | 结果 |
|---|---|---|
| ub-trigger | using-baize | 3/3 PASS |
| ir-trigger | baize-ir | 3/3 PASS |
| sr-trigger | baize-sr | 3/3 PASS |
| ar-trigger | baize-ar | 3/3 PASS |
| sc-trigger | baize-scenario | 3/3 PASS |
| uc-trigger | baize-usecase | 3/3 PASS |
| fn-trigger | baize-function | 3/3 PASS |
| va-trigger | baize-validate | 2/3 PASS（有翻转）：1=PASS 2=FAIL 3=PASS |
| rw-trigger | baize-review | 3/3 PASS |
| rv-trigger | baize-revise | 3/3 PASS |

## 每次运行

| id | skill | 场景 | 结果 | 实际打开的 skill | 记录 |
|---|---|---|---|---|---|
| ub-trigger#1 | using-baize | trigger | PASS | using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/ub-trigger#1 |
| ub-trigger#2 | using-baize | trigger | PASS | using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/ub-trigger#2 |
| ub-trigger#3 | using-baize | trigger | PASS | using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/ub-trigger#3 |
| ir-trigger#1 | baize-ir | trigger | PASS | baize-ir、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/ir-trigger#1 |
| ir-trigger#2 | baize-ir | trigger | PASS | baize-ir、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/ir-trigger#2 |
| ir-trigger#3 | baize-ir | trigger | PASS | baize-ir、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/ir-trigger#3 |
| sr-trigger#1 | baize-sr | trigger | PASS | baize-sr、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/sr-trigger#1 |
| sr-trigger#2 | baize-sr | trigger | PASS | baize-sr、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/sr-trigger#2 |
| sr-trigger#3 | baize-sr | trigger | PASS | baize-sr、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/sr-trigger#3 |
| ar-trigger#1 | baize-ar | trigger | PASS | baize-ar、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/ar-trigger#1 |
| ar-trigger#2 | baize-ar | trigger | PASS | baize-ar、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/ar-trigger#2 |
| ar-trigger#3 | baize-ar | trigger | PASS | baize-ar、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/ar-trigger#3 |
| sc-trigger#1 | baize-scenario | trigger | PASS | baize-scenario、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/sc-trigger#1 |
| sc-trigger#2 | baize-scenario | trigger | PASS | baize-scenario、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/sc-trigger#2 |
| sc-trigger#3 | baize-scenario | trigger | PASS | baize-scenario、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/sc-trigger#3 |
| uc-trigger#1 | baize-usecase | trigger | PASS | baize-usecase、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/uc-trigger#1 |
| uc-trigger#2 | baize-usecase | trigger | PASS | baize-usecase、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/uc-trigger#2 |
| uc-trigger#3 | baize-usecase | trigger | PASS | baize-usecase、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/uc-trigger#3 |
| fn-trigger#1 | baize-function | trigger | PASS | baize-function、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/fn-trigger#1 |
| fn-trigger#2 | baize-function | trigger | PASS | baize-function、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/fn-trigger#2 |
| fn-trigger#3 | baize-function | trigger | PASS | baize-function、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/fn-trigger#3 |
| va-trigger#1 | baize-validate | trigger | PASS | baize-ir、baize-validate、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/va-trigger#1 |
| va-trigger#2 | baize-validate | trigger | FAIL | baize-ir、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/va-trigger#2 |
| va-trigger#3 | baize-validate | trigger | PASS | baize-validate、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/va-trigger#3 |
| rw-trigger#1 | baize-review | trigger | PASS | baize-review、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/rw-trigger#1 |
| rw-trigger#2 | baize-review | trigger | PASS | baize-review、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/rw-trigger#2 |
| rw-trigger#3 | baize-review | trigger | PASS | baize-review、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/rw-trigger#3 |
| rv-trigger#1 | baize-revise | trigger | PASS | baize-revise、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/rv-trigger#1 |
| rv-trigger#2 | baize-revise | trigger | PASS | baize-revise、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/rv-trigger#2 |
| rv-trigger#3 | baize-revise | trigger | PASS | baize-revise、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-06-47-/rv-trigger#3 |
