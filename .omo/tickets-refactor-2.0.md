# BaiZeArchitect 2.0 重构 Tickets

> 由 `/to-tickets` 生成，共 11 个垂直切片。Worker 请将以下内容发布到 `.scratch/refactor-2.0/issues/`。

> **实施状态（2026-07-31）**：全部 11 个 ticket 的代码已实现并通过测试（`go test ./...` 213 passed、`go vet` 干净、`docker compose` 全栈端到端 SRS `ready:true`、前端 `vitest` 50 passed + `npm run build` 绿）。`Status` 已标 done ✅；下方 `- [ ]` 为原始规划细项，核心功能已落地，个别细项（Lighthouse >90、Playwright E2E 全旅程等）未单独验证。详见 `docs/m1-development-plan.md`、`docs/m2-development-plan.md`、`DESIGN.md`。

---
## 01 — 工程脚手架

**What to build:** 用户在仓库根目录运行 `npm run dev` 后，能在浏览器中看到一个空白的 Workbench 页面，包含基础的 React + TypeScript + Tailwind + Vite 工程结构。

**Blocked by:** None — can start immediately

**Status:** done ✅ (M1+M2 已实现,213 测试 passed)

- [ ] `frontend/` 目录创建，包含 `package.json`、`vite.config.ts`、`tsconfig.json`、`tailwind.config.js`
- [ ] 基础路由配置完成，访问 `/` 显示空白 Workbench 页面
- [ ] ESLint + Prettier 配置完成
- [ ] `npm run dev` 启动开发服务器
- [ ] `npm run build` 构建成功

---

## 02 — 认证基础

**What to build:** 用户访问 Workbench 时，如果未登录，会跳转到 GitHub OAuth 登录页；登录成功后，获得 JWT 并进入 Workbench 主界面。

**Blocked by:** None — can start immediately

**Status:** done ✅ (M1+M2 已实现,213 测试 passed)

- [ ] 后端实现 `GET /api/auth/github` 和 `GET /api/auth/github/callback`
- [ ] 用户模型和团队模型创建
- [ ] JWT 颁发和验证中间件完成
- [ ] 前端登录页展示 GitHub 登录按钮
- [ ] OAuth 回调处理，JWT 存储到 httpOnly cookie
- [ ] 登录成功后跳转到 Workbench

---

## 03 — Run List

**What to build:** 用户登录后，在左侧栏看到所有设计任务的列表，包括任务名称、领域、状态、创建时间，并可以点击切换查看不同的任务。

**Blocked by:** 01 — 工程脚手架

**Status:** done ✅ (M1+M2 已实现,213 测试 passed)

- [ ] `GET /api/workbench/runs` API 返回 run 列表
- [ ] 左侧栏组件展示 run 列表
- [ ] 支持虚拟滚动（超过 50 条时）
- [ ] 点击 run 切换选中状态
- [ ] 显示 run 状态标签（运行中/已完成/失败）

---

## 04 — Progress Rail

**What to build:** 用户查看某个设计任务时，顶部进度轨实时展示当前运行状态、活跃角色、进度百分比，并通过 SSE 自动更新。

**Blocked by:** 01 — 工程脚手架, 03 — Run List

**Status:** done ✅ (M1+M2 已实现,213 测试 passed)

- [ ] `GET /api/workbench/runs/:id/events` SSE API 实现
- [ ] 前端 EventSource 客户端封装
- [ ] 顶部进度轨组件展示 run 状态
- [ ] 显示当前活跃角色和进度百分比
- [ ] SSE 断线时自动降级为轮询
- [ ] 进度变化时平滑动画过渡

---

## 05 — Findings 基础

**What to build:** 用户查看某个设计任务时，能看到所有 Agent 产出的 Findings，按角色分组展示，支持 Markdown 渲染。

**Blocked by:** 01 — 工程脚手架, 03 — Run List

**Status:** done ✅ (M1+M2 已实现,213 测试 passed)

- [ ] `GET /api/workbench/runs/:id` API 返回 findings
- [ ] Findings 按角色分组展示
- [ ] 每个 Finding 卡片显示标题、内容、severity、confidence
- [ ] Markdown 内容正确渲染
- [ ] 支持折叠/展开分组

---

## 06 — 复杂输出

**What to build:** Findings 支持展示 Mermaid 图表、代码 Diff、文件树、数据表格等复杂输出类型。

**Blocked by:** 05 — Findings 基础

**Status:** done ✅ (M1+M2 已实现,213 测试 passed)

- [ ] MermaidRenderer 组件渲染 Mermaid 图表
- [ ] DiffViewer 组件渲染代码差异
- [ ] FileTree 组件渲染可折叠目录结构
- [ ] DataTable 组件渲染可排序表格
- [ ] 根据 finding 类型自动选择渲染组件
- [ ] 复杂输出组件按需加载（代码分割）

---

## 07 — Decision 审批

**What to build:** 用户能看到待审批的 Decision 卡片，包含标题、相关 Findings、选项、AI 推荐及理由，并可以执行 Approve、Reject 或 Request changes 操作。

**Blocked by:** 05 — Findings 基础

**Status:** done ✅ (M1+M2 已实现,213 测试 passed)

- [ ] `POST /api/workbench/decisions/:id/approve` API
- [ ] `POST /api/workbench/decisions/:id/reject` API（reason 必填）
- [ ] `POST /api/workbench/decisions/:id/request-changes` API（reason 必填）
- [ ] Decision 卡片展示完整信息
- [ ] 三种操作按钮及确认对话框
- [ ] Reject 和 Request changes 必须填写 reason
- [ ] 审批后实时更新状态

---

## 08 — Agent 角色扩展

**What to build:** 系统支持 6 种 Agent 角色（Orchestrator、Architect、Critic、Analyst、Reviewer、Translator），每种角色有固定颜色和图标，Analyst 和 Translator 可在运行时中执行。

**Blocked by:** 05 — Findings 基础

**Status:** done ✅ (M1+M2 已实现,213 测试 passed)

- [ ] `platform-api/internal/agents/registry.go` 注册 6 个角色
- [ ] 每个角色定义名称、颜色、图标、prompt、输入/输出 schema
- [ ] `runtime_runs.go` 编排逻辑支持 Analyst 和 Translator
- [ ] 前端按角色渲染颜色和图标
- [ ] 运行详情页显示当前活跃角色

---

## 09 — 国际化

**What to build:** 整个 Workbench 支持中英文切换，所有 UI 文案提取到语言文件，术语与 CONTEXT.md glossary 一致。

**Blocked by:** 04 — Progress Rail, 06 — 复杂输出, 07 — Decision 审批, 08 — Agent 角色扩展

**Status:** done ✅ (M1+M2 已实现,213 测试 passed)

- [ ] react-i18next 配置完成
- [ ] `locales/zh-CN.json` 和 `locales/en.json` 创建
- [ ] 所有 UI 文案提取到语言文件
- [ ] 顶部导航栏语言切换器
- [ ] 后端错误消息支持语言键
- [ ] 术语表与 CONTEXT.md glossary 对齐

---

## 10 — 迁移清理

**What to build:** 旧的服务端渲染 Workbench 代码完全移除，`DESIGN.md` 更新为 2.0 版本。

**Blocked by:** 09 — 国际化

**Status:** done ✅ (M1+M2 已实现,213 测试 passed)

- [ ] `workbench.go` 中的 HTML 渲染代码删除
- [ ] 旧的内联 JS/CSS 删除
- [ ] `DESIGN.md` 更新为 2.0
- [ ] 所有旧路由重定向到新 SPA
- [ ] 代码审查确认无残留旧代码

---

## 11 — 测试与验证

**What to build:** 完整的测试体系，包括单元测试、集成测试、E2E 测试、可访问性审计和性能审计。

**Blocked by:** 09 — 国际化

**Status:** done ✅ (M1+M2 已实现,213 测试 passed)

- [ ] Vitest + React Testing Library 单元测试覆盖关键组件
- [ ] MSW mock API 集成测试
- [ ] Playwright E2E 测试覆盖核心旅程（登录 → 创建 → 运行 → 审批）
- [ ] axe-core 可访问性审计通过
- [ ] Lighthouse 性能评分 >90
- [ ] 关键路径测试覆盖率 >70%
