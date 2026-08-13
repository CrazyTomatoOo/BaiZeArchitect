# BaiZe Architect

<p align="center">
  <strong>自动优先的需求设计编排系统</strong><br />
  描述需求、明确开始、在真正需要判断时介入、最后批准。
</p>

---

## 概述

BaiZe Architect 是一个自动优先的需求设计编排系统。每个 Requirement 创建时同时建立唯一的、处于 `pending` 的 Workflow。用户首次明确开始后，确定性的 Workflow Engine 创建 Planning Task，由零工具 Orchestrator 提出完整、有限、不可变的 Task DAG；Engine 校验并采用 PlanRevision，再依次执行 Analyst、Architect 和 Critic Task。

所有角色都在隔离 Attempt Session 中运行，只通过版本化 Context Manifest、Artifact revision、Decision、Finding 和证据交接。Engine 独占 Workflow 状态转换、计划采用、Task 调度、副作用发布、质量判断和归档控制。

### 四个固定角色

| 角色 | 职责 |
| --- | --- |
| Orchestrator | 零工具纯规划，提出完整 PlanProposal DAG |
| Analyst | 分析、场景、用例、功能 Artifact 的唯一写入者 |
| Architect | 设计、架构、数据、API Artifact 的唯一写入者 |
| Critic | 读取冻结 Review Bundle，只写 Finding |

Reviewer 角色已移除，不是重命名或包装。

## 快速体验

`demo` 服务提供一个可交互的本机体验环境：只发布到 `127.0.0.1:18789`，不挂载宿主目录或 Docker Volume；SQLite、会话和设计归档全部写入容器内 tmpfs，容器删除后数据全部清除。

```bash
docker compose up -d demo    # 首次会自动构建镜像
docker compose ps            # 等待 STATUS 变为 healthy
open http://127.0.0.1:18789  # 打开引导式 Workflow 页面
```

## Docker 测试环境

```bash
docker compose build test
docker compose run --rm test
```

Compose 配置约束：
- 不挂载宿主目录或 Docker Volume
- 不向宿主暴露端口
- 运行阶段禁用外部网络 (`network_mode: none`)
- 根文件系统只读，唯一可写位置是容器内 tmpfs `/tmp`
- 使用非 root 的 `node` 用户运行
- 不需要模型 API Key；冒烟测试验证 Workflow 控制面

## 本地开发

```bash
# Runtime tests + typecheck
cd agent-runtime
npm ci
npm test
npm run typecheck
npm run test:contracts

# Web unit + build + e2e
cd ../web
npm ci
npm test
npm run typecheck
npm run build
npx playwright test --reporter=line
```

## 生产部署

```bash
cd agent-runtime
BAIZE_DB_PATH=<db> \
BAIZE_SESSION_DIR=<sessions> \
BAIZE_PORT=18789 \
BAIZE_OPERATORS="<token>=<actorRef>:workflow:operate,workflow:approve" \
npx tsx main.ts
```

`main.ts` 是唯一生产入口。它组装 Operator Server（HTTP 传输层）、PiModelDriver（真实模型驱动）、Workflow Governance Kernel（SQLite 治理内核）和 Web SPA 静态服务。ScriptedModelDriver 和确定性测试夹具仅存在于测试装配中，生产配置不可选择。

### 生产 HTTP 契约

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/session` | Bearer bootstrap → Operator Session cookie |
| GET | `/api/session` | Session 自省 |
| POST | `/api/workspaces/:id/requirements` | 原子创建 Requirement + baseline + Workflow |
| GET | `/api/requirements?workspaceId=` | 需求摘要列表 |
| GET | `/api/requirements/:id` | 需求详情 |
| GET | `/api/workflows/:id` | 有界 Workflow Projection |
| PUT | `/api/workflows/:id/commands/:commandId` | 统一幂等命令资源 |
| GET | `/api/workflows/:id/commands/:commandId` | 命令 Receipt 详情 |
| GET | `/api/workflows/:id/receipts` | 命令 Receipt 列表 |
| GET | `/api/workflows/:id/incidents` | Workflow Incident 列表 |
| GET | `/api/workflows/:id/events` | Workflow 事件 JSON |
| GET | `/api/workflows/:id/events/stream` | Workflow 事件 SSE |
| GET | `/api/runs/:id/events` | Run 事件 JSON |
| GET | `/api/runs/:id/events/stream` | Run 事件 SSE |
| GET | `/api/plan-revisions/:id` | Plan Revision 详情 |
| GET | `/api/tasks/:id` | Task 详情 |
| GET | `/api/tasks/:id/attempts` | Task Attempt 列表 |
| GET | `/api/attempts/:id` | Attempt 详情 |
| GET | `/api/runs/:id` | Run 详情 |
| GET | `/api/approval-packets/:id` | Approval Packet 详情 |
| GET | `/api/legacy-imports/:id` | Legacy Import 记录 |
| GET | `/api/design-packages/:id` | Design Package 记录 |
| GET/POST/DELETE | `/api/assets` | Reusable Asset CRUD |
| GET | `/api/assets/export` | 导出 Reusable Assets |

旧的手动 Run 创建、steer/cancel、direct archive、global Run stream、evidence/design-package Route、client-supplied actor endpoint 和 C4 architecture Route 均不存在。

## Cutover

历史迁移使用写暂停式 `check → apply` 操作，绑定数据库和 Session 树指纹。详见 [Cutover Runbook](docs/cutover-runbook.md)。

## 目录结构

```text
agent-runtime/
  main.ts                唯一生产入口
  model-config.ts        Pi 模型 provider 配置
  workflow/              Workflow 治理内核
    headless-runtime.ts  无头运行时公共 API
    operator-server.ts   唯一生产 HTTP 传输层
    pi-model-driver.ts   生产模型驱动
    model-driver.ts      ModelDriver 接口
    plan-types.ts        Plan 类型
    plan-validator.ts    Plan 静态校验
    role-result.ts       Role Result 类型
    impact-profile.ts    Impact Profile 派生
    workflow-doctor.ts   只读不变量检查
    contracts/           可执行契约加载与 Schema 编译
  persistence/
    workflow-store.ts    SQLite 治理内核
    migrations/          编号化前向迁移
  cutover/
    cutover-checker.ts   只读预检
    cutover-applier.ts   原子应用
    legacy-schema.ts    旧 Store schema (测试夹具)
    legacy-fixture-builder.ts  旧数据夹具构造
  testing/
    deterministic-fixtures.ts  确定性测试夹具
    scripted-model-driver.ts  测试专用模型驱动
web/
  src/
    baize-workflow.ts    引导式 Workflow 页面 + 审计视图
    workflow-client.ts   类型化 API 客户端
    main.ts              唯一 Web 入口
docs/
  cutover-runbook.md    生产 Cutover Runbook
fixtures/               容器测试种子仓库
scripts/                冒烟测试
```

## 状态说明

BaiZe Architect 的自动优先 Workflow 编排系统已通过七个依赖实施切面 (S1-S7) 完成生产切换。旧的手动角色选择、共享 Session、Reviewer、直接归档、旧 API/UI/数据库路径已硬删除。系统不保留双写、兼容适配器或运行时功能开关。
