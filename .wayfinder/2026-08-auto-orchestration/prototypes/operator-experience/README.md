# PROTOTYPE — 自动工作流与人工接管交互

> 三种需求详情页变体，通过 `?variant=A|B|C` 切换；只用于回答交互设计问题，不是生产实现。

## 要回答的问题

哪种信息层次能让普通用户顺畅跟随自动需求设计流程，同时让高级接管、审批、冲突和恢复仍然可见但不喧宾夺主？

## 运行

```bash
python3 -m http.server 4178 --directory .wayfinder/2026-08-auto-orchestration/prototypes/operator-experience
```

打开：

- `http://localhost:4178/?variant=A`
- `http://localhost:4178/?variant=B`
- `http://localhost:4178/?variant=C`

页面顶部的场景选择器可切换 `running`、`waiting`、`rework`、`failed`、`ready` 与 `paused/stale`；底部浮动栏或键盘左右箭头切换变体。

## 变体

- **A — 运行控制台**：左侧需求，中央任务时间线，右侧当前动作与接管。
- **B — 引导式焦点**：把当前状态和唯一推荐动作放在首屏，其余内容渐进展开。
- **C — 审计驾驶舱**：任务表、治理事实、事件流与命令状态高密度并列。

## 用户评审已确认

- B 作为默认需求页；A 的计划、Run、Artifact 和治理事实在同页“工作流详情”展开，C 作为独立审计视图。
- 每个 Workflow 状态只显示一个主动作；pause、cancel-run 和高级接管按危险度渐进展开。
- 正在填写的 subject 因 SSE 变化时冻结旧底稿、保留输入并要求显式重载，不自动换到最新版。
- 命令先展示持久 Command Receipt，再由 SSE/Projection 确认实际状态变化。
- ApprovalPacket 使用同页专注审批模式；多 Blocking Gate 按严重度与 openedEventSeq 一次处理一个。

可直接查看选定路径：

- 默认概览：`http://localhost:4178/?variant=B&scenario=running&panel=summary`
- 同页详情：`http://localhost:4178/?variant=B&scenario=running&panel=workflow`
- 门禁队列：`http://localhost:4178/?variant=B&scenario=waiting`
- 专注审批：`http://localhost:4178/?variant=B&scenario=ready&panel=approval`

## 原型限制

- 使用固定 mock projection，不请求真实 Gateway。
- 命令只显示确认层、模拟持久 Receipt 与 SSE 等待，不调用 API 或修改真实状态。
- 不验证视觉细节、响应式边界、API 接线或正式组件结构。
