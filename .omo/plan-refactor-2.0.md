# BaiZeArchitect 2.0 重构设计计划

> 基于 `/grilling` 会话达成的 shared understanding。本计划由 Prometheus（规划）产出，后续由 worker 执行。

---

## 1. 设计决策汇总

| # | 决策 | 结论 |
|---|------|------|
| 1 | 前端位置 | 仓库根目录新建 `frontend/`，Vite 开发代理到 Go API，生产由 Go 托管静态文件 |
| 2 | 页面结构 | 左侧栏 Run List + 主区域 Run Detail，command-center 布局 |
| 3 | 审批流程 | Approve / Reject / Request changes，多 Decision 卡片并行展示 |
| 4 | 实时更新 | Server-Sent Events（SSE），降级到轮询 |
| 5 | i18n | react-i18next，中文默认，英文回退，术语与 CONTEXT.md glossary 对齐 |
| 6 | 角色体系 | Orchestrator / Architect / Critic / Analyst / Reviewer / Translator，颜色+图标区分 |
| 7 | 认证 | GitHub OAuth + JWT（httpOnly cookie），管理员分配用户到 Team |
| 8 | 状态管理 | TanStack Query（服务端）+ Zustand（客户端）+ React Hook Form（表单） |
| 9 | 样式组件 | Tailwind CSS + Headless UI，自定义 design tokens，支持暗色模式 |
| 10 | 部署策略 | 直接替换旧 Workbench，无 feature flag |
| 11 | 回滚方案 | 无需回滚（开发阶段项目），但保留 Git tag 和旧 Docker 镜像作为兜底 |
| 12 | 测试策略 | Vitest + React Testing Library + MSW + Playwright，关键路径 70%+ |
| 13 | 可访问性 | WCAG 2.1 AA，完整键盘导航，焦点管理，ARIA 标签，对比度 ≥4.5:1 |
| 14 | 性能 | Lighthouse >90，代码分割，懒加载，虚拟滚动，图片优化 |
| 15 | Findings 格式 | 结构化 JSON + Markdown 渲染，按角色分组，severity + confidence |
| 16 | 复杂输出 | 全部支持：代码 Diff、Mermaid 图表、文件树、表格、富文本 |

---

## 2. 领域模型

### 核心术语

| 中文 | 英文 | 定义 |
|------|------|------|
| 需求 | Requirement | 用户输入的原始业务诉求 |
| 领域 | Domain | 需求所属的业务领域 |
| 设计任务 | Design Task | 一次需求解析与方案生成的会话 |
| 决策 | Decision | 多选方案中的一次绑定选择 |
| 发现 | Finding | Agent 对需求/方案的分析结论 |
| 审批 | Approval | 人类用户对 agent 决策的确认、拒绝或要求修改 |
| 运行时 | Runtime | 一组 agent 角色按编排顺序执行的过程 |
| 角色 | Role | Agent 在运行时所承担的职责 |
| 用户 | User | 通过 GitHub OAuth 登录的个体 |
| 团队 | Team | 用户所属的组织单元，拥有操作权限 |

### 角色定义

| 角色 | 颜色 | 职责 |
|------|------|------|
| Orchestrator | 灰色 | 解析需求、分配任务、汇总输出 |
| Architect | 蓝色 | 生成架构/方案选项 |
| Critic | 橙色 | 评审方案、发现风险 |
| Analyst | 紫色 | 需求拆解、术语澄清 |
| Reviewer | 绿色 | 人工审批决策 |
| Translator | 粉色 | 多语言输出与一致性校验 |

---

## 3. 架构设计

### 3.1 前端工程

- **位置**：`frontend/`
- **技术栈**：React 18 + TypeScript 5 + Tailwind CSS 3 + Vite
- **路由**：TanStack Router
- **状态管理**：
  - TanStack Query：API 数据缓存、后台刷新、乐观更新
  - Zustand：UI 状态（侧边栏、选中 Run、语言）
  - React Hook Form：表单
- **i18n**：react-i18next + i18next
- **样式**：Tailwind + Headless UI，自定义 design tokens
- **图表**：Mermaid
- **代码 Diff**：Monaco Editor 或 Prism
- **测试**：Vitest + React Testing Library + MSW + Playwright

### 3.2 后端调整

- 保持 Go + `platform-api` 主结构。
- 新增 API：
  - `GET /api/workbench/config` → 运行时配置、当前用户、语言、可用角色
  - `GET /api/workbench/runs/:id` → 运行时状态与 findings/decisions
  - `GET /api/workbench/runs/:id/events` → SSE 事件流
  - `POST /api/workbench/decisions/:id/approve` → 确认
  - `POST /api/workbench/decisions/:id/reject` → 拒绝（需 reason）
  - `POST /api/workbench/decisions/:id/request-changes` → 要求修改（需 reason）
  - `GET /api/auth/github` → GitHub OAuth 登录
  - `GET /api/auth/github/callback` → OAuth 回调
  - `POST /api/auth/refresh` → 刷新 JWT
- 认证中间件从 `X-Team-Token` 迁移到 JWT。
- 现有 `workbench.go` 中的服务端渲染 HTML 在迁移完成后删除。

### 3.3 数据流

```
用户输入需求
   ↓
Orchestrator → 生成 Design Task
   ↓
Analyst / Architect / Critic → 并行产出 Findings
   ↓
Architect → 生成 Decision Options
   ↓
Workbench SPA → SSE 实时展示 Findings + Decisions
   ↓
Reviewer 审批 → Approve / Reject / Request changes
   ↓
Orchestrator 汇总 → 输出最终方案
   ↓
Translator（可选）→ 多语言版本
```

---

## 4. 工作包（Work Packages）

### WP1. 工程初始化
- 创建 `frontend/` 目录，初始化 Vite + React + TypeScript + Tailwind。
- 配置 ESLint、Prettier、TypeScript 严格模式。
- 配置 Tailwind design tokens（颜色、间距、字体、圆角、阴影）。
- 配置 react-i18next 和语言文件结构。
- 建立基础组件目录（Button、Card、Panel、Rail、Badge、Modal、Tree、Table、DiffViewer、MermaidRenderer）。

### WP2. 认证与用户体系
- 后端：实现 GitHub OAuth 登录、JWT 颁发与刷新、用户/团队模型。
- 前端：实现登录页、OAuth 回调处理、Token 存储与自动刷新。
- 中间件：JWT 认证替换 X-Team-Token。

### WP3. Workbench SPA 核心
- 实现左侧栏 Run List（虚拟滚动）。
- 实现 Run Detail 页：Progress Rail、Agent 输出流、Decision 审批面板。
- 实现 SSE 客户端与事件处理。
- 实现 Findings 卡片（Markdown 渲染、角色分组、severity/confidence）。
- 实现复杂输出组件：MermaidRenderer、DiffViewer、FileTree、DataTable。

### WP4. 审批流程
- 实现 Decision 卡片：标题、Findings、Options、Recommendation、Reasoning。
- 实现 Approve / Reject / Request changes 三种操作。
- Reject 和 Request changes 必须填写 reason。
- 审批状态实时同步到进度轨。

### WP5. Agent 角色扩展
- 后端：在 `platform-api/internal/agents/registry.go` 中注册 6 个角色。
- 定义每个角色的 prompt、输入/输出 schema。
- 更新 `runtime_runs.go` 的编排逻辑，支持 Analyst 和 Translator。
- 前端按角色渲染颜色和图标。

### WP6. 国际化落地
- 提取所有 UI 文案到 `locales/zh-CN.json` 和 `locales/en.json`。
- 建立术语表，确保与 `CONTEXT.md` glossary 一致。
- 后端错误消息支持语言键。
- 实现顶部语言切换器。

### WP7. 迁移与清理
- 用 SPA 替换 `workbench.go` 的 HTML 渲染。
- 删除旧的内联 JS/CSS。
- 更新 `DESIGN.md` 为 `DESIGN.md 2.0`。

### WP8. 测试与验证
- 单元测试：Vitest + React Testing Library。
- 集成测试：MSW mock API。
- E2E 测试：Playwright 覆盖核心旅程。
- 可访问性审计：axe-core。
- Lighthouse 性能审计。

---

## 5. 风险与假设

- **风险**：直接替换可能导致开发环境短暂不可用。
  - **缓解**：开发阶段项目，可接受；保留 Git tag 和旧镜像兜底。
- **风险**：OAuth 集成可能引入安全漏洞。
  - **缓解**：使用标准 OAuth 库，JWT 设置短期过期，httpOnly cookie。
- **风险**：复杂输出组件（Mermaid、Diff）可能增加包体积。
  - **缓解**：代码分割，按需加载。

---

## 6. 验收标准

- [ ] 新 Workbench 在桌面、平板、手机均可用，无水平滚动或截断。
- [ ] 切换中英文后，所有 UI 文案正确切换。
- [ ] GitHub OAuth 登录成功，JWT 自动刷新。
- [ ] SSE 实时更新 Agent 输出，断线时自动降级轮询。
- [ ] 审批面板支持 Approve / Reject / Request changes，reason 必填。
- [ ] Findings 支持 Markdown、Mermaid、代码 Diff、文件树、表格。
- [ ] 通过 Playwright E2E 核心旅程测试。
- [ ] 通过 axe-core 可访问性审计。
- [ ] Lighthouse 评分 >90。

---

## 7. 建议的下一步

1. 用户确认本计划。
2. 启动 `/wayfinder` 或 `/ulw-plan` 将工作包拆分为可执行 tickets。
3. 或直接使用 `/start-work` 从 WP1 开始执行。
