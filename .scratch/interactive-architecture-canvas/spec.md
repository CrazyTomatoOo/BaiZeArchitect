# Interactive C4 architecture canvas specification

## Status

**Approved for implementation.** This document synthesizes the resolved Wayfinder tickets and is the implementation contract for replacing Mermaid only in the repository architecture browser.

## Scope and non-goals

- Provide read-only C4 Context, Container, Component, and Code exploration, one independently laid-out canvas per layer.
- Retain the existing HTML directory tree; do not turn it into graph data.
- Support selection, inspection, search, filters, neighbor focus, semantic aggregate expansion, drill-down, fit, and browser-only SVG/PNG download.
- Do not edit architecture facts, create `ArtifactRevision` assets from exports, render all C4 levels in one semantic-zoom graph, guarantee 2,000 visible nodes, or change Mermaid in Markdown/design packages.

## Canonical data contract

Implement [ADR-002](../../docs/adr/ADR-002-versioned-c4-projection-snapshots.md): one immutable `C4ProjectionSnapshot` per `repositoryId + headSha + projectionVersion`, with snapshot ID, content hash, generator metadata, and generation time.

- The snapshot is one normalized evidence-backed node, edge, and containment fact graph. Context, Container, Component, and Code are selectors over those shared facts, not separately generated diagrams.
- Nodes have readable semantic IDs, cross-commit lineage IDs, kind, labels/descriptions, containment, source status, and non-empty provenance. Edges have a supported typed relationship plus confidence and evidence references.
- A `VisibleGraph` is the server-derived subset for one immutable snapshot after layer, root, serializable filters/focus, and aggregate expansion. It includes `visibleGraphHash`, exact `headSha`, evidence references, aggregation/cap metadata, nodes, and edges.
- Aggregate nodes must retain their semantic member IDs. Parallel same-type/source/target relationships may be emitted as count-bearing summary edges. No confidence sampling or synthetic renderer-only aggregation is permitted.

## API contract

Replace the old heuristic C4 array and generation API with snapshot-first endpoints under `/api/architecture/:repositoryId/c4`:

1. `POST /snapshots/resolve` resolves or generates the projection for the requested/current repository head and projection version, returning immutable snapshot metadata.
2. `GET /snapshots/:snapshotId` returns immutable snapshot metadata and available C4 roots/layers.
3. `GET /snapshots/:snapshotId/visible?layer=&root=&filters=&focus=&expansion=` returns the bounded `VisibleGraph` described above.

The route shell reads an explicit snapshot ID from a shared URL when present; otherwise it resolves the current snapshot. “Update to latest commit” resolves a new snapshot explicitly. Remove `/api/architecture/:repo/c4` and `.../c4/generate`; do not retain a compatibility adapter.

## Frontend boundaries

`baize-architecture-browser` remains the route-level coordinator. It owns the directory tree, snapshot resolution, Visible Graph requests, URL/history state, per-layer session state, and `AbortController` lifecycle.

A lazily imported `baize-c4-canvas` owns G6/ELK setup and teardown, rendering, pointer/touch viewport mechanics, Command-deck toolbar, persistent evidence inspector, semantic companion list, export rendering, and client-only layout cache. Its public boundary is declarative `visibleGraph` and view state plus typed intents for selection, filter/focus, aggregate expansion, fit, drill-down, export, and layout completion. Only the host changes navigation state.

Dynamically import G6, ELK, and the browser Worker only when the user opens the first C4 layer. The app shell and directory-tree-only use must not download this graph dependency boundary. Use AntV G6 plus ELK.js Layered, with BaiZe-owned `projectionToElk`, `elkResultToG6`, and `visibleGraphToSvgDocument` transformations. ELK executes through an explicit browser Worker factory.

## Interaction and navigation

- The Command deck provides search, layer/root breadcrumbs and tabs, filters, neighbor focus, aggregate expansion, refresh, fit, and export.
- “View internal” is the sole node-driven drill-down action. It opens the next C4 layer rooted at that node. Direct layer tabs open their layer root.
- Each `snapshot + layer + root` restores independent session state. The shared URL captures snapshot, layer, root, selection, and applicable filters/focus; camera and aggregate expansion remain per-layer session state.
- Single selection drives the persistent inspector. It shows definition, typed relationships, lineage, confidence, and raw evidence. If a filter hides selection, clear it and return the inspector to its guide state.
- Canvas selection does not move the camera; search/list selection centers an off-screen result. Neighbor focus is a reversible post-filter lens retaining the selection, N-hop neighbors, and required containers. Aggregate expansion is reversible and never expands every member automatically.

## Scale, layout, and caching

A Visible Graph has a first-release hard cap of 500 rendered nodes. Larger projections start as semantic container/component/aggregate nodes and require explicit filtering, focus, or expansion to reveal atomic members.

- Labels are full/two-line through 200 nodes, one line truncated to about 24 characters from 201–500, and reduced at low zoom to selected/focused/aggregate labels. Hover, list, and inspector retain full names.
- Use deterministic ELK Layered ordering by semantic ID. Entering a layer, advancing a snapshot, committed filtering, aggregate expansion/collapse, and entering/leaving focus trigger layout. Selection, hover, inspector changes, label visibility, and pan/zoom never move nodes.
- Initial load shows a skeleton. During later layout, retain the previous graph under a loading treatment and atomically swap only the latest completed result. Cancel or discard stale requests and Worker responses.
- Cache geometry only in memory/sessionStorage under `snapshotId + visibleGraphHash + layoutVersion + containerSize`. It is presentation state: never send it to Gateway or persist it as architecture evidence.
- Fit-to-view frames the current Visible Graph.

## Export

SVG and PNG export the complete current Visible Graph—not just the viewport—after its active layer/root, filters, aggregate expansion, and focus lens.

- Use opaque graphite-indigo output. Header: repository, short `head_sha`, layer, root. Footer: node/edge legend, active filters/focus, UTC generation time.
- SVG is a standalone inline document with inline styles, legend, and font fallback only: no scripts, network resources, external CSS, or images.
- PNG is browser-rendered at 2× and refuses an estimated longest side above 8192px. Do not crop or silently downscale; direct the user to SVG or narrower filters.
- Download `<repo>-<shortSha>-<layer>-<root>-<UTC timestamp>.<ext>` directly. It creates no asset and calls no server export job.
- Disable concurrent export. On empty/missing, render/projection, or SVG serialization failure, retain the view and provide retry plus snapshot ID.

## Accessibility

Google Chrome is the sole supported release browser. The Command deck, canvas controls, semantic companion list, and inspector retain their accessible keyboard and semantic behavior within Chrome, but the release does not claim cross-browser or cross-screen-reader WCAG conformance. The graphical canvas is never the only representation.

- The synchronized, filterable semantic companion list is the screen-reader traversal surface. The canvas exposes a layer/root/count summary.
- A live region announces loading, result counts, selection, focus, export completion/refusal, snapshot changes, and errors.
- Tab reaches toolbar, list, and inspector; list arrow keys traverse; Enter selects; search, focus, fit, and Escape operate as documented commands. Provide clear visible focus treatment and preserve the existing keyboard-navigation contract.

## Verification and release gate

Use versioned synthetic Context, Container, Component, and Code fixtures covering nested groups, cross-boundary relationships, evidence confidence, aggregation, loading/empty/error states, 500-node density, oversized PNG refusal, and stale snapshots. Add one immutable-SHA real-repository fixture for Gateway/API smoke coverage.

All of the following are release blockers:

1. Pure-unit tests for Visible Graph derivation, aggregation, URL/history, stale layout handling, SVG serialization, and PNG caps/filenames.
2. Lit component tests for controls, selection, focus, companion list, inspector, live announcements, and narrow-layout fallback.
3. Browser E2E tests for loading/error/empty states; drill-down/history restoration; search/filter/focus/expansion; keyboard and inspector behavior; update cancellation; normal SVG/PNG and refused PNG export.
4. Visual-regression tests for ready, selected, focused, empty, and error states at 1440×900, 1024×768, and 390×844.
5. Performance on the documented project benchmark machine, stable Chrome, 1280×800: initial interactive view ≤1.5s; topology re-layout ≤1.0s; submitted filter/focus ≤250ms; selection/inspector ≤100ms; ELK in a Worker; pan/zoom ≥30 FPS. Report hardware, browser, fixture cardinality, median, and p95. CI detects regressions but does not replace this benchmark.
6. Release-candidate manual check in Google Chrome: complete the keyboard-only exploration and confirm controls, state changes, drill-down, filtering/focus, export, and error handling are usable. Safari/VoiceOver and Firefox/NVDA are not release gates.

## Implementation sequence

1. Implement snapshot/Visible Graph Gateway contracts and deterministic fixtures.
2. Add pure transform, state, cache, Worker, and export modules with unit tests.
3. Add `baize-c4-canvas` and integrate it as the lazy C4 surface in `baize-architecture-browser` while preserving the directory tree.
4. Complete accessibility, component/browser/visual tests, and benchmark evidence.
5. Remove Mermaid generation/rendering and heuristic C4 cache handling from `baize-architecture-browser` in the same production change; leave `baize-markdown` and static Mermaid documents untouched.

## Approval

The resolved decisions are coherent: immutable server facts and Visible Graphs are separated from client presentation cache; URL/session behavior is separated from canvas mechanics; the 500-node scale cap aligns with the selected G6/ELK Worker stack; exports and accessibility use the same visible-state semantics; and test/benchmark gates cover the replacement. No in-scope unresolved choice remains. Production implementation may begin only against this specification.
