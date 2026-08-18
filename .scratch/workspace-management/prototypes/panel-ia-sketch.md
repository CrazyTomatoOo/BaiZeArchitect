# Workspace management panel — IA sketch

Throwaway prototype (wayfinder `wayfinder:prototype`, ticket [06](../issues/06-prototype-workspace-management-panel.md)). Cheap ASCII IA to react to; not production code. Honors decisions [01](../issues/01-decide-workspace-archive-semantics.md) / [02](../issues/02-decide-repo-path-creation-policy.md) / [03](../issues/03-decide-selected-workspace-state-carrier.md) / [05](../issues/05-decide-web-host-for-workspace-management.md). Reuses `baize-workflow`'s existing `section.hero`, `.page`, `<form>`+`<input required>`+`<button class="primary"|"danger">`, `.login-form` narrow-form styling, and the design tokens.

## Placement: an internal view of baize-workflow (no shell)

```
┌─ baize-workflow (logged in) ───────────────────────────────────┐
│ ◇ BaiZe Architect        [工作空间: demo ▾]  [管理工作空间]      │  ← 顶栏:选择器(localStorage)+ 管理 入口
├────────────────────────────────────────────────────────────────-┤
│  主内容区 — 在内部视图间切换 (baize-workflow 自有 view state)     │
│                                                                │
│  默认视图: 工作流详情 (现有 renderWorkflowView)                  │
│  管理视图: 工作空间管理面板 ↓                                    │
└────────────────────────────────────────────────────────────────-┘
```

- 顶栏选择器:列出活跃 workspace;选中 → 写 `localStorage["baize.workspaceId"]` + 按该 workspace 重载主内容;无已存选择默认首个活跃(03);零 workspace 走空态。
- "管理工作空间"入口把主内容切到管理面板视图(复用 baize-workflow 现有 view 切换,无 shell)。

## 管理面板视图

```
┌────────────────────────────────────────────────────────────────┐
│ ← 返回                       工作空间管理                         │
├────────────────────────────────────────────────────────────────-┤
│ 活跃工作空间                              [＋ 新建工作空间]        │
│ ┌──────────────────────────────────────────────────────────────┐│
│ │ demo    /tmp/baize/repos/test-repo        [重命名] [归档]      ││
│ │ svc-x   /repos/svc-x                      [重命名] [归档]      ││
│ └──────────────────────────────────────────────────────────────┘│
│                                                                │
│ ▸ 已归档 (2)                              折叠/展开               │
│   ┌────────────────────────────────────────────────────────────┐│
│   │ old-proj  /repos/old       (只读)                    [恢复] ││
│   │ poc       /repos/poc       (只读)                    [恢复] ││
│   └────────────────────────────────────────────────────────────┘│
└────────────────────────────────────────────────────────────────┘
```

- 活跃列表默认排除归档(01);已归档为独立折叠区,只读可见,带"恢复"动作。
- 行内展示 `name` + `repo_path`(02:纯标签,不校验)。

## 新建工作空间表单(同 `.login-form` 窄表单风格)

```
┌──────────────────────────────┐
│ 新建工作空间                   │
│ 名称      [________________]   │   ← required
│ repo_path [________________]   │   ← required,任意非空字符串,不校验真实路径
│                [取消] [创建]    │
└──────────────────────────────┘
```

## 重命名(行内/弹层)

```
┌──────────────────────────────┐
│ 重命名工作空间: demo           │
│ 新名称    [________________]   │
│                [取消] [保存]    │
└──────────────────────────────┘
```
`repo_path` 创建后锁定,不可改(02)。

## 零工作空间空态

```
┌──────────────────────────────┐
│ 还没有工作空间                 │
│ 创建第一个工作空间来组织需求与资产│
│             [＋ 新建工作空间]   │
└──────────────────────────────┘
```

## 归档 workspace 的只读浏览

点已归档项 → 进入该 workspace 的工作流详情/资产视图(只读):写操作按钮(建需求 / 改资产 / 工作流命令)置灰或隐藏;提交写操作时被服务端拒(01:归档=对写冻结,非不可见)。

## 结论(待人 react)

这是跟随 `baize-workflow` 既有 `section.hero` / 窄表单 / `primary`·`danger` 按钮 / design tokens 的**常规 CRUD 视图**:顶栏选择器 + 管理 入口切内部视图 + 活跃/已归档分区 + 建/改/归档/恢复表单 + 零态 + 归档只读。无新颖 IA,无需 bespoke 视觉设计。实现时按此布局复用既有样式即可。
