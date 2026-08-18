# Decide workspace retirement semantics

Label: wayfinder:grilling
Assignee: pi-agent
Status: closed

## Question

How does a workspace retire when an operator no longer wants it active?

The fork: **soft archive** (add `archived_at`; keep all rows, list excludes archived by default, restorable) versus **hard delete when empty** (delete only when it has zero requirements/assets/packages; reject otherwise).

Constraints to weigh while grilling:
- `requirements` / `reusable_assets` / `design_packages` all reference `workspaces(id) on delete restrict`, so hard delete is blocked while any dependent row exists.
- BaiZe's versioned-archive philosophy treats design history as immutable and retained; deleting a workspace strands its assets or forces a cascade the schema forbids.
- The demo workspace (id 1) already holds real demo assets — its retirement path is shaped by this decision.

Resolve by grilling the human one question at a time. The answer locks the migration shape (whether 0014 adds `archived_at`, or none) and which store/runtime methods exist (archive/restore vs delete).

## Resolution

Grilled the human across three sub-decisions; shared understanding reached.

1. **Retirement is a real need, shape = hide + keep history → soft archive.** Workspaces accumulate (demo 1 exists, more will follow); the operator wants stale ones out of the active list without losing their design history. Hard-delete-when-empty strands assets and conflicts with `on delete restrict`; the versioned-archive philosophy points to retention. → migration **0014 adds `archived_at text`** to `workspaces` (nullable; non-null = archived).
2. **Archive is reversible.** `archiveWorkspace(id)` sets `archived_at`; `restoreWorkspace(id)` clears it. Reversibility is zero-cost at the data layer (rows untouched) and preserves the link to history a terminal archive would sever.
3. **Archived workspaces are read-visible, writes rejected.** The active list excludes archived by default; a separate "archived" view lists them; selecting one browses its assets/requirements **read-only**. Write operations (create/update requirement, asset mutations, workflow commands) against an archived workspace are rejected — archive means frozen-for-writes, not invisible. This folds the previously-planned "archived workspace route returns 404 vs 409" question: routes return data read-only, not 404; writes return a rejection (operator-server shape to be locked at implementation, not here).

Store/runtime surface locked: `listWorkspaces(includeArchived?)`, `archiveWorkspace(id)`, `restoreWorkspace(id)` (in addition to existing `createWorkspace` / `workspaceExists`). `getWorkspace`/`renameWorkspace` are separate concerns, not decided by this ticket.

**Fog graduated:** the Web management-panel IA prototype now has fixed constraints (active list + archived section + restore action + write-rejection-on-archived), but remains fog until [Decide the selected-workspace state carrier](03-decide-selected-workspace-state-carrier.md) resolves — the prototype's wiring depends on it.
