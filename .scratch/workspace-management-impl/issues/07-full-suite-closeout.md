# 07 — 全量门禁收口与负向扫描

**What to build:** 全仓门禁与手工冒烟全部通过，无残留旧面，图为验收后的最终状态。

**Source:** spec Testing Decisions；决议 09 第 7 条（负向扫描）、10（用后语义）。

**Blocked by:** 01, 02, 03, 04, 05, 06——终验票，全链就绪后跑。

**Status:** ready-for-agent

- [ ] backend：`npm run test`（含新 operator-workspaces 测试与 02 集成用例）+ `npm run typecheck` + `npm run test:contracts` 全绿
- [ ] web：`npm run typecheck` + `npm run test`（vitest）+ `npm run build` + `npm run test:e2e`（三视口）全绿
- [ ] 手工冒烟：真实后端起服务——登录 → 管理页列表/创建/进入/删除（含忙拒绝）→ 刷新直达 → 返回入口；删后全站 404 观感正常
- [ ] 负向扫描复核：无旧面残留（`baize-workspaces.ts` 等保持已删）、reviewer 角色无回归、`web/` 无审计视图残留（既有扫描全绿）