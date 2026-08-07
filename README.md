# BaiZe Architect

证据驱动的设计 Agent：分析代码仓库，生成带真实代码证据的设计方案，并通过独立 critic 复核。

## Docker 测试环境

Docker 仅用于一次性集成测试，不承担开发数据持久化或产物交付。测试镜像包含应用、Web SPA、技能、Schema、GitNexus 和固定测试仓库；运行时数据全部写入容器内 `/tmp`。

```bash
docker compose build test
docker compose run --rm test
```

测试完成后容器立即删除。Compose 配置具有以下约束：

- 不挂载任何宿主目录或 Docker Volume。
- 不向宿主暴露端口。
- 运行阶段禁用外部网络。
- 根文件系统只读，唯一可写位置是容器内 tmpfs `/tmp`。
- 使用非 root 的 `node` 用户运行。
- SQLite、证据、GitNexus 索引、设计归档和临时仓库都随容器删除。
- 不需要模型 API Key；冒烟测试不调用 LLM。

## 测试闭环

```text
镜像内 /fixtures/test-repo（只读种子）
                    │ copy + git init
                    ▼
容器 tmpfs /tmp/baize-smoke-*/repos/test-repo
                    │
                    ├─ Gateway 启动与系统诊断
                    ├─ GitNexus 证据生成
                    ├─ 工作区/需求/阶段门禁
                    ├─ 确定性归档
                    └─ 进程停止 + 临时目录清理
```

测试入口为 `scripts/smoke-gateway.mjs`。脚本只能在 `BAIZE_CONTAINER_TEST=1` 的容器测试环境中运行。

## 镜像内容

`agent-runtime/Dockerfile` 基于 `node:22-slim`，安装并构建：

- Agent Runtime 及 pi SDK
- `better-sqlite3` 原生模块
- Git 与 GitNexus
- `.pi/skills` 和 `schemas`
- Web SPA (`/app/web/dist`)
- 固定测试仓库 (`/app/fixtures/test-repo`)
- 容器冒烟脚本 (`/app/scripts/smoke-gateway.mjs`)

## 本地开发检查

Docker 之外的源码检查仍可直接执行：

```bash
cd agent-runtime
npm ci
npm test
npm run typecheck

cd ../web
npm ci
npm run typecheck
npm run build
```

历史多服务、PostgreSQL 和宿主目录挂载方案均已废弃，不应再作为部署依据。
