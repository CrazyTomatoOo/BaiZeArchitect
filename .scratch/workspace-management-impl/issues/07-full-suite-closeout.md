# 07 — 全量门禁收口与负向扫描

**What to build:** 全仓门禁与手工冒烟全部通过，无残留旧面，图为验收后的最终状态。

**Source:** spec Testing Decisions；决议 09 第 7 条（负向扫描）、10（用后语义）。

**Blocked by:** 01, 02, 03, 04, 05, 06——终验票，全链就绪后跑。

**Status:** done

- [x] backend：`npm run test` 273/273（含 operator-workspaces 与级联删除集成用例）+ `npm run typecheck` + `npm run test:contracts` 32/32 全绿
- [x] web：`npm run typecheck` + vitest 52/52 + `npm run build` + `npm run test:e2e` 54/54（三视口）全绿
- [x] 手工冒烟（真实 main.ts）：HTTP 层——登录/空列表/创建 201/重复 repo_path 409/删后 workspace-gated 读 404/二次删除 404；浏览器层——登录首屏管理页（零态）→ 创建直达写键 → 刷新直达 → 顶栏回管理 → 两步删除（锁定文案）→ 零态 + 清键
- [x] 负向扫描复核：negative-scan 9/9（baize-workspaces.ts 等旧件保持已删、reviewer 角色无回归、审计视图无残留）