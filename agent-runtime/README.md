# BaiZe Agent Runtime

单进程设计 Agent Runtime，提供 architect、确定性证据校验、critic、Gateway API 和 Web SPA 服务能力。

## Docker 中的用途

Docker 镜像只用于一次性、自闭环的集成测试：

```bash
cd ..
docker compose build test
docker compose run --rm test
```

测试容器不接受宿主目录挂载，不暴露端口，也不持久化任何运行数据。固定测试仓库打入镜像，执行时复制到容器 tmpfs 后再由 GitNexus 建立索引。

## 容器运行目录

| 路径 | 用途 |
| --- | --- |
| `/app` | 只读应用、Web SPA、技能和 Schema |
| `/app/fixtures/test-repo` | 只读测试仓库种子 |
| `/tmp/baize-smoke-*` | 单次测试的 SQLite、证据、归档和可写仓库 |

Compose 设置 `BAIZE_CONTAINER_TEST=1`，并将 `BAIZE_DB_PATH`、`BAIZE_EVIDENCE_DIR`、`BAIZE_REPOS_ROOT` 和 `EVOLVER_HOME` 指向容器内 `/tmp`。测试退出后这些数据全部销毁。

## 主要模块

| 文件 | 职责 |
| --- | --- |
| `agent.ts` | 持久 Agent 会话、角色 Run 和需求澄清 |
| `gateway.ts` | 唯一 Gateway、通用 Run API、SSE 和 SQLite 归档 |
| `evidence.ts` | 容器内 GitNexus 证据生成 |
| `evidence-candidates.ts` | 代码证据路径、符号和行号校验 |
| `store.ts` | SQLite 状态存储与领域实体 |
| `Dockerfile` | 自包含测试镜像 |

## 源码检查

```bash
npm ci
npm test
npm run typecheck
```
