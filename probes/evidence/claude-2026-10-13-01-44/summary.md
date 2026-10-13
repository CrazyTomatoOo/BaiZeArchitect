# 探针汇总 · claude · 2026-10-13-01-44-

- 跑了 30 条：PASS 28 / FAIL 2 / ERROR 0
- harness：claude；skill 来源：本地 checkout `/Volumes/work/Project/BaiZeArchitect`（未发布）
- 判定口径：机械判定只管「目标 skill 的动作在记录里查到/查不到」；触发后干得对不对由人看 transcript.jsonl。

| id | skill | 场景 | 结果 | 实际打开的 skill | 记录 |
|---|---|---|---|---|---|
| ub-trigger | using-baize | trigger | PASS | using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/ub-trigger |
| ub-miss | using-baize | miss | PASS | using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/ub-miss |
| ub-trap | using-baize | trap | PASS | using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/ub-trap |
| ir-trigger | baize-ir | trigger | PASS | baize-ir、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/ir-trigger |
| ir-miss | baize-ir | miss | PASS | baize-ir、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/ir-miss |
| ir-trap | baize-ir | trap | PASS | baize-sr、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/ir-trap |
| sr-trigger | baize-sr | trigger | PASS | baize-sr、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/sr-trigger |
| sr-miss | baize-sr | miss | PASS | baize-sr、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/sr-miss |
| sr-trap | baize-sr | trap | FAIL | baize-sr、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/sr-trap |
| ar-trigger | baize-ar | trigger | PASS | baize-ar、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/ar-trigger |
| ar-miss | baize-ar | miss | PASS | baize-ar、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/ar-miss |
| ar-trap | baize-ar | trap | PASS | baize-scenario、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/ar-trap |
| sc-trigger | baize-scenario | trigger | PASS | baize-scenario、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/sc-trigger |
| sc-miss | baize-scenario | miss | PASS | baize-scenario、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/sc-miss |
| sc-trap | baize-scenario | trap | PASS | baize-usecase、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/sc-trap |
| uc-trigger | baize-usecase | trigger | PASS | baize-usecase、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/uc-trigger |
| uc-miss | baize-usecase | miss | FAIL | baize-scenario、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/uc-miss |
| uc-trap | baize-usecase | trap | PASS | baize-function、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/uc-trap |
| fn-trigger | baize-function | trigger | PASS | baize-function、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/fn-trigger |
| fn-miss | baize-function | miss | PASS | baize-function、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/fn-miss |
| fn-trap | baize-function | trap | PASS | baize-ir、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/fn-trap |
| va-trigger | baize-validate | trigger | PASS | baize-validate、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/va-trigger |
| va-miss | baize-validate | miss | PASS | baize-validate、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/va-miss |
| va-trap | baize-validate | trap | PASS | baize-ir、baize-review、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/va-trap |
| rw-trigger | baize-review | trigger | PASS | baize-review、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/rw-trigger |
| rw-miss | baize-review | miss | PASS | baize-review、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/rw-miss |
| rw-trap | baize-review | trap | PASS | using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/rw-trap |
| rv-trigger | baize-revise | trigger | PASS | baize-revise、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/rv-trigger |
| rv-miss | baize-revise | miss | PASS | baize-revise、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/rv-miss |
| rv-trap | baize-revise | trap | PASS | baize-ar、using-baize | /Volumes/work/Project/BaiZeArchitect/probes/results/claude-2026-10-13-01-44-/rv-trap |
