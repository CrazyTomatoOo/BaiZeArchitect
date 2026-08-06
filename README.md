# BaiZe Architect

证据驱动的设计 agent:对仓库做架构设计,产出带**真实代码证据**的设计方案(Design
Package),经独立 critic 评审 + 审批门后归档。设计经验双沉淀(ADR + 可复用 gene),
下次设计复用。

> 2026-08 重构:砍掉 Go platform-api + React 前端(归档 `_archived/`),收敛成单进程
> 本地 agent(`docker run → cli.ts`)。旧 2.0 多服务架构见 `DESIGN.md` 与
> `docs/`(均为 pre-refactor,仅作历史参考)。

## 快速开始

```sh
# 跑一次设计(~5-6min,glm-5.2 两 phase)
DASHSCOPE_API_KEY=... ./scripts/run.sh lws "你的设计需求"
# → out/design-package-lws-<ts>.md(真实证据 + critic 发现),容器自退
# 归档:git add out/*.md && git commit(原 archive.sh 已移除,按需手动)
```

下次 `run.sh lws` 时,architect prompt 自动注入三层复用:

- **mcp 结构化证据**(hotspots/boundaries/clusters/layers)— `evidence.sh` 预产
- **历史 ADR**(复用,避免重复决策)— `manage_adr(update)` 手动沉淀(原 `evolve.sh` 已移除)
- **可复用 gene**(经 `evolver_recall` mid-design 查)— 容器 evolver-mcp

## 架构

```
宿主 (mac, 有 codebase-memory-mcp binary)          容器 (baizearchitect-baize, linux)
─────────────────────────────────────────         ─────────────────────────────────────────
evidence.sh ──get_architecture/manage_adr──►      /evidence/<repo>.json        (ro 挂载)
                                                       │
                                docker run ──────►   cli.ts
                                                     ├ architect phase (submit_plan)
                                                     ├ critic phase   (record_critique)
                                                     ├ evolver-mcp stdio 子进程 (BAIZE_EVOLVER=1)
                                                     └ read/grep 定位真实行号
                                                       ▼
                                                out/design-package-<repo>-<ts>.md
```

- **单进程**:`docker run` → `agent-runtime/cli.ts`(pi SDK `createAgentSession` + 内联
  bailian provider + `.pi/skills` 6 角色)。
- **两 phase**:architect(`submit_plan` 工具产 5 类 artifact + 真实证据)→ critic(独立
  session,`record_critique` findings,grep 复核证据)。
- **审批门**:`BAIZE_AUTO_APPROVE`(默认 1 auto-approve)→ design-package 头 "审批状态:
  accepted|pending"。
- **容器隔离**:容器自带 pi SDK(不挂宿主 `~/.pi`),`.pi/skills` COPY 进镜像,目标仓库 +
  evidence + out + evolver-home 经 volume 挂载,`DASHSCOPE_API_KEY` env 透传。

## 三层复用

| 层 | 沉淀 | 复用注入 | 工具 |
| --- | --- | --- | --- |
| mcp 证据 | — | `evidence.sh` `get_architecture` → cli.ts prompt | codebase-memory-mcp(宿主 mac binary) |
| ADR | `manage_adr(update)` 手动(原 `evolve.sh` 已移除) | `evidence.sh` `manage_adr(get)` → cli.ts "历史决策" | codebase-memory-mcp |
| gene | `distill-gene.ts` 手动 → `./evolver-home/assets`(原 `evolve.sh` 已移除) | 容器 `evolver_recall`(`listApprovedGenes`,mid-design) | `@evomap/evolver-mcp`(stdio) |

## 脚本

| 脚本 | 作用 |
| --- | --- |
| `scripts/run.sh <repo-dir> <requirement>` | 先 `evidence.sh`,再 `docker compose run` 跑 architect+critic |
| `scripts/evidence.sh <repo-path> [repo-id]` | codebase-memory-mcp → `evidence/<repo-id>.json` |

> 经验沉淀(ADR/gene)原由 `evolve.sh` 一键完成,已移除;改为直接调
> `manage_adr(update)` 与 `agent-runtime/distill-gene.ts`(按需,非必需)。

## 环境变量 (compose.yaml)

| Var | Default | 用途 |
| --- | --- | --- |
| `DASHSCOPE_API_KEY` | (必填) | bailian/glm-5.2 鉴权 |
| `BAIZE_AUTO_APPROVE` | `1` | 1=auto-approve,0=pending |
| `PI_PROVIDER` | `bailian` | LLM provider |
| `PI_MODEL` | `glm-5.2` | LLM model |
| `BAIZE_EVOLVER` | `1` | 启用容器内 evolver-mcp |
| `EVOLVER_HOME` | `/evolver-home` | gene store(挂 `./evolver-home`) |
| `EVOLVER_IPC_TOKEN` / `EVOLVER_PROXY_URL` | (空) | 可选 hub proxy 接入;空=local-only |

## 文件

```
agent-runtime/
  cli.ts              单进程入口(architect+critic 两 phase,evidence/evolver 注入)
  evolver-client.ts   evolver-mcp stdio JSON-RPC 客户端(手写,未装 MCP SDK)
  distill-gene.ts     design-package → evolver_distill_conversation → gene
  Dockerfile          node:22-slim + pi SDK + .pi/skills
compose.yaml          baize 服务(evidence/out/evolver-home 挂载 + env)
scripts/              run.sh / evidence.sh
.pi/skills/           6 角色(architect/critic/orchestrator/analyst/reviewer/translator)
schemas/              design artifact JSON schemas
```

## 状态 / 约束

- **glm-5.2 慢**:单次设计 5-7min(两 phase:architect 分析 + critic 复核)。pre-existing。
- **codebase-memory-mcp 是宿主 mac binary**:容器 linux 跑不了 → 宿主 `evidence.sh`
  预产 `evidence.json` 挂载。agent 不直接调 mcp,用结构化证据。
- **evolver-mcp local-only**(无 `EVOLVER_IPC_TOKEN`):gene 只在本机 `./evolver-home`
  store;要接 hub proxy 设 token + url。
- 多 phase(analyst/orchestrator/reviewer/translator)尚未拆成独立 session——intentional
  deferral(现在拆是 speculative structure,等真实需求驱动)。

## 开发

```sh
cd agent-runtime && npm install && npx tsc --noEmit   # 类型检查
docker compose build baize                            # 建镜像
docker compose run --rm -v "$PWD/lws:/repo:ro" \
  baize --repo /repo --repo-id lws --requirement "..." # 直接跑(不经 run.sh)
```
