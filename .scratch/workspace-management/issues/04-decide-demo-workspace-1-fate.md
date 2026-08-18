# Decide the fate of the existing demo workspace 1

Label: wayfinder:grilling
Assignee: pi-agent
Status: closed

## Question

What happens to the existing demo workspace (id 1, created by `seed-demo-workspace.ts` with `repoPath=/tmp/baize/repos/test-repo`, `name=demo`) once workspace management ships?

The options:
- **Keep as a normal workspace** — it appears in the list alongside any others; the seeder continues to create it if absent; it becomes the default selection only because it is the sole/first workspace.
- **Normalize** — reseed to a non-`/tmp` repo path and a clearer name, with a one-time normalization for existing DBs.
- **Reseed / replace** — drop the demo seeder entirely and require explicit creation; or replace it with a different seed strategy.

Lightly coupled to [Decide workspace retirement semantics](01-decide-workspace-archive-semantics.md): if soft archive is chosen, demo 1 could simply be archived once real workspaces exist; if hard-delete, it persists unless manually emptied. Resolve this ticket after the archive ticket to use its answer, but it is independently decidable now.

The answer determines whether `seed-demo-workspace.ts` changes and whether existing DBs need a normalization step.

## Resolution

Grilled the human; shared understanding reached. Facts established (not asked): `seed-demo-workspace.ts` is the demo-container one-shot seeder (idempotent; creates workspace 1 with `repoPath=/tmp/baize/repos/test-repo`, `name=demo` only if `!workspaceExists(1)`). With [01](01-decide-workspace-archive-semantics.md) soft archive, an archived workspace 1 still has its row, so `workspaceExists(1)` stays true → the seeder will not re-create an archived demo 1; no conflict. With [02](02-decide-repo-path-creation-policy.md), repo_path is an unvalidated label, so the `/tmp` path is functionally harmless. With [03](03-decide-selected-workspace-state-carrier.md), zero-workspace first runs show an empty/create-prompt state, so production deployments (which do not run the demo seeder) start cleanly.

**Keep as-is.** `seed-demo-workspace.ts` is unchanged; no normalization migration for existing DBs. demo workspace 1 is a normal workspace — in demo deployments it is the default first-active selection (per 03), and once the operator creates real workspaces they can archive it via `archiveWorkspace` (per 01). The `/tmp/baize/repos/test-repo` repo_path is left as a cosmetic label (02: unvalidated).

No seeder change, no migration, no new tickets, no fog graduation — 04 was a leaf; nothing was blocked on it.

**重绘注记（2026-08-18）**：01 作废后，本票 Resolution 中「可 archive 它（per 01）」表述失效。**Keep-as-is 决策本体不变**：seeder 不变、无迁移；demo 1 保持普通工作区，在「级联删除」新语义下可从管理页被直接删除（含其内 demo 需求/资产），删除语义见 07/08/10。
