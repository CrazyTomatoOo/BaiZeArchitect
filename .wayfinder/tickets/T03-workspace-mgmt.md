# T03 — 工作区管理页(1 repo = 1 workspace)`wayfinder:prototype`

status: open
assignee: (unclaimed)
blocked-by: T02

## Question

工作区管理页的行为与 UI:

- workspace = 1 git repo(沿用 REPOS_ROOT)。列表展示(repo 名/路径/需求数/资产数)。
- 添加/移除 workspace 的交互(添加=选 REPOS_ROOT 下的 repo;移除是否级联删资产?)。
- 切换 workspace 后其它页面(需求/仪表盘)的 scope 行为。

产出:原型页 + gateway /api/workspaces CRUD。
