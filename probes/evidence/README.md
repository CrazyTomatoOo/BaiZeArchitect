# 探针证据（精选，入库）

这里放**被 `RESULTS-*.md` 引用的**探针完整记录，随仓库走。

为什么不整批入库：原始批次目录（`probes/results/`）里每个探针还带一份 fixture 项目副本（`projects/`），几百 MB、没有审计价值。而**只留在盘上的证据会消失**——已经发生过一次：pi 侧 2026-10-12 全量的原始记录随 subagent 的 worktree 一起被删掉，现在只剩 `RESULTS` 里的引文（引文本身还查得到，逐条 transcript 查不到了）。

## 一次全量之后要做的

```bash
RUN=pi-2026-10-13-01-00-          # probes/results/ 下的批次目录名
DEST=probes/evidence/$RUN
mkdir -p "$DEST"
cp probes/results/$RUN/summary.md probes/results/$RUN/summary.json "$DEST/"
for id in sr-trap uc-miss ir-trigger; do cp -r "probes/results/$RUN/$id" "$DEST/"; done
```

拷哪些：**`summary.md` + `RESULTS` 里引用的每一条**——FAIL 全拷（判读的对象），PASS 至少拷一两条当基线代表作。

## 现有

| 批次 | harness | 内容 |
|---|---|---|
| `claude-2026-10-13-01-44/` | claude 2.1.296 / `k3[1M]` | 全量 30 条的汇总 + `sr-trap`、`uc-miss`（两条 FAIL）+ `ir-trigger`（基线代表） |
| `pi-2026-10-12-11-32/` | pi 1.1.0 / `glm-5.2` | description 改后四条必过探针：`va-trigger` / `va-miss` / `rw-trigger` / `rw-miss` |

每个探针目录里是：`prompt.txt`（那一句自然语言）、`cmd.txt`（实际起的命令）、`stdout.txt`（最终回复）、`stderr.txt`、`transcript.jsonl`（完整会话）、`meta.json`。
