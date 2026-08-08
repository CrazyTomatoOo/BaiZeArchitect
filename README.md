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
- 不需要模型 API Key；冒烟测试只验证 Run 控制面终态，不依赖模型产出。

## Docker 体验环境

`demo` 服务提供一个可交互的体验环境：只发布到本机回环地址 `127.0.0.1:18789`，不挂载任何宿主目录或 Docker Volume；SQLite、证据、GitNexus 索引、会话和设计归档全部写入容器内 tmpfs，容器删除后数据全部清除，不会在主机留下任何运行产物。

```bash
docker compose up -d demo    # 首次会自动构建镜像并种子化 fixtures/test-repo
docker compose ps            # 等待 STATUS 变为 healthy
open http://127.0.0.1:18789  # 打开 Web 控制台
```

体验步骤：

1. 打开控制台后先在「系统 → 设置」配置模型 provider/modelId/apiKey（保存即生效）。
2. 在「工作区」页基于种子仓库 `/tmp/baize/repos/test-repo` 创建工作区（自动触发 GitNexus 证据生成）。
3. 新建需求并触发通用 Run，在 Run Rail 观察 SSE 事件流与归档结果。

停止并清除体验环境（数据全部随容器删除）：

```bash
docker compose down
```

## 测试闭环

```text
镜像内 /fixtures/test-repo（只读种子）
                    │ copy + git init
                    ▼
容器 tmpfs /tmp/baize-smoke-*/repos/test-repo
                    │
                    ├─ Gateway 启动与系统诊断
                    ├─ GitNexus 证据生成
                    ├─ Workspace/Requirement 创建与通用 Run
                    ├─ SQLite DesignPackage 快照归档
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
