# Prototype the workspace management panel interaction

Label: wayfinder:prototype
Assignee: pi-agent
Status: closed（作废）

> **作废（2026-08-18 重绘）**：语义换血——重命名、已归档折叠区、恢复动作全部取消（用户拍板：不改名、删除 = 级联删除）；宿主由「baize-workflow 内部视图」改为「shell 级首屏管理页」。IA 草图 `prototypes/panel-ia-sketch.md` 留作参考资产：创建表单（repo_path + name）、顶栏选择器、零态观念可复用；重命名表单与「已归档」分区不再适用。新版 IA 随 [09-decide-web-shell-navigation-and-state](09-decide-web-shell-navigation-and-state.md) 决议。

## Question

Raise the fidelity of the workspace management panel — the selector plus the create/rename/archive forms living as internal views of `baize-workflow` (decided at [Decide the web host for workspace management](05-decide-web-host-for-workspace-management.md)) — by making a cheap, rough artifact (an IA sketch / outline / stub) to react to, via the `/prototype` skill. Link the prototype as an asset.

Fixed constraints from prior decisions:
- [01](01-decide-workspace-archive-semantics.md) — active list excludes archived by default; a separate "archived" view lists them; restore action available; write operations (create/update requirement, asset mutations, workflow commands) on an archived workspace are rejected; archived workspaces are read-visible.
- [02](02-decide-repo-path-creation-policy.md) — the create form has a required `repo_path` field (any non-empty string, no real-path/git validation) plus `name`.
- [03](03-decide-selected-workspace-state-carrier.md) — the selector reads `localStorage["baize.workspaceId"]`; default first-active workspace when none saved; show an empty/create-prompt state only when zero workspaces exist.
- [05](05-decide-web-host-for-workspace-management.md) — the panel is an internal view of `baize-workflow`, reachable via its existing navigation; no shell/router is built.

The goal is to confirm the panel's look/behavior before implementation. If the prototype/grilling concludes the panel is a standard CRUD view following `baize-workflow`'s existing hero/form patterns with no novel IA, record that as the resolution (no bespoke visual design needed).

## Resolution

Produced a throwaway IA sketch asset: [prototypes/panel-ia-sketch.md](../prototypes/panel-ia-sketch.md). Human reacted: confirmed.

The panel is a **standard CRUD view following `baize-workflow`'s existing patterns** — a top-bar selector writing `localStorage["baize.workspaceId"]` (default first-active); a "管理工作空间" entry that swaps `baize-workflow`'s main content to an internal management view (no shell, reusing baize-workflow's own view-switching); an active list (archived excluded by default) + a collapsible "已归档" section that is read-visible with a restore action; create/rename/archive/restore forms reusing `section.hero`, `.login-form` narrow-form styling, `primary`/`danger` buttons, and the design tokens; a zero-workspace empty state prompting creation; archived workspaces read-only with writes rejected server-side (per 01). `repo_path` is required + unvalidated on create and locked post-create (per 02). No novel IA; no bespoke visual design — implementation reuses the existing styles per the sketch.

All tickets (01–06) are resolved; the route to the destination is clear. Hand off to `/implement`.
