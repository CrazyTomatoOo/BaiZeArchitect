# Define the frontend integration and Mermaid cutover boundary

Type: grilling
Status: resolved
Blocked by: 02, 03, 13

## Question

What component boundary, dependency boundary, API adaptation, state ownership, lazy-loading strategy, and migration cutover should replace Mermaid inside `baize-architecture-browser` while leaving `baize-markdown` and static Mermaid documents intact? Decide whether layout data is client-only, cached, or persisted and how stale `head_sha` data is invalidated.

## Answer

`baize-architecture-browser` remains the route-level coordinator: it keeps the directory tree, repository/snapshot resolution, URL and per-layer session state, Visible Graph requests, and request cancellation. A lazily imported `baize-c4-canvas` owns only G6/ELK lifecycle, rendering, viewport mechanics, the Command-deck inspector and semantic companion list. It receives `visibleGraph`, declarative view state, and an abort signal; it emits typed intents for selection, filter/focus, expansion, fit, drill-down, export, and layout completion. The host alone changes navigational state.

- **API:** replace heuristic C4 arrays with immutable snapshot endpoints: resolve the current snapshot, read snapshot metadata by ID, and read a server-derived Visible Graph by `snapshotId + layer + root + serializable filter/focus`. The view response includes `visibleGraphHash`, cap/aggregation metadata, evidence references, and the exact `head_sha`. The old `/api/architecture/:repo/c4` and `.../c4/generate` representations are deleted rather than adapted.
- **State and cache:** the host owns URL-addressable navigation and per-layer session state. The canvas owns client-only ELK geometry cached in memory/sessionStorage under `snapshotId + visibleGraphHash + layoutVersion + containerSize`; geometry is never sent to Gateway or stored as architecture evidence.
- **Load and stale safety:** G6, ELK, and the worker are dynamically imported only when a C4 layer first opens; the host shows the approved layout skeleton until the atomically rendered Visible Graph arrives. Every response, layout result, and session cache is snapshot-keyed. Explicit “update to latest commit” resolves a new snapshot, aborts old requests, and atomically swaps state; stale responses or layouts are discarded.
- **Cutover:** once this API and canvas ship, remove Mermaid diagram generation, `baize-markdown` use, and heuristic C4 cache handling from `baize-architecture-browser` in the same change. Do not retain a feature flag or alternate architecture page. `baize-markdown` and Mermaid in Markdown/design packages remain unchanged.

This boundary keeps repository facts server-derived, viewing state coordinated by the existing page, and expensive visual dependencies isolated from the initial application bundle.
