# T09 — node SQLite 选型(node:sqlite vs better-sqlite3)`wayfinder:research`

status: open
assignee: (unclaimed)
blocked-by: —

## Question

gateway(node 22)用哪个 SQLite:

- node:sqlite(内置,Node 22 需 --experimental-sqlite?23 稳定?)— 零依赖但 API/稳定性?
- better-sqlite3(成熟,同步 API)— 多一个 native dep(容器构建需编译?)。
- 容器(node:22-slim)里两者的可用性/构建成本对比。
- 结论供 T02(store.ts)采用。

产出:选型结论 + 理由 + 容器验证。/research。
