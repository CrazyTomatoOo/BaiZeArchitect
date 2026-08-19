# 03 — 契约与文档同步（workspaces 段双侧 + README + ADR 定稿）

**What to build:** 公开 API 契约如实反映三个新端点且保持双侧字节一致（contract 测试不红）；README 端点表可查；ADR-005 从 draft 定稿为 accepted。

**Source:** spec「Workspace lifecycle and management」节（执行期同步清单）；决议 08 的契约同步面。

**Blocked by:** 01（注册表面）, 02（级联删除）——端点形状以两票实际落地为准，避免契约文件双写。

**Status:** ready-for-agent

- [ ] `workflow-api-v1.json` 增 `workspaces` 段（list / create / delete 三条目，沿 `reusableAssets` 结构含 method/path/purpose），`agent-runtime/contracts/` 与 `.wayfinder/2026-08-auto-orchestration/assets/` **双侧同内容字节一致**；`workflow-contracts.test.ts` 全绿
- [ ] README 端点表 +3 行：GET / POST / DELETE `/api/workspaces`（含说明列，风格与现表一致）
- [ ] `docs/adr/ADR-005-workspace-cascade-delete.md`：Status draft → accepted；正文与 02 实际落地语义核对一致（33 表级联、事务内触发器、snapshot 跳过、busy 门禁、无能力位）