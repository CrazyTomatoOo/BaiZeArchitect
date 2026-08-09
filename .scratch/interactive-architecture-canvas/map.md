# Upgrade the architecture browser to an interactive graph canvas

Label: wayfinder:map

## Destination

Produce an implementation-ready specification for replacing the architecture browser's Mermaid-rendered C4 views with a polished interactive graph canvas, with sufficient product, domain, technical, performance, export, and acceptance decisions for implementation to begin without unresolved design questions.

## Notes

- Domain: BaiZeArchitect's repository architecture browser, implemented with Lit/Vite and backed by Gateway-generated repository/C4 evidence.
- This effort plans the change; it does not implement the production canvas.
- Consult `grilling`, `domain-modeling`, `prototype`, and `research` while resolving tickets.
- Scope the canvas to the C4 Context, Container, Component, and Code layers. Keep the directory tree as its existing tree control.
- Use one independently laid-out canvas per C4 layer, with node-driven drill-down and breadcrumb/layer navigation rather than one semantic-zoom mega-graph.
- The canvas is a read-only exploration surface: selection, inspection, filtering, focus, expansion, and drill-down may change the view but must not mutate architecture semantics.
- Design and verify for approximately 500 visible nodes per layer; larger graphs must aggregate, filter, or progressively reveal data.
- First release exports PNG and SVG, but exported files are not automatically promoted to assets.
- Mermaid remains available for Markdown/design-package rendering; this effort replaces it only as the architecture browser's primary visualization.

## Decisions so far

- [Select the interactive graph engine and layout stack](issues/01-select-graph-engine-and-layout-stack.md) — Initial research identified yFiles as the lowest-risk technical fit, but its commercial restriction now excludes it; Cytoscape.js plus ELK.js is a candidate in the renewed free-stack selection and has an SVG-export gap.
- [Define the C4 graph projection contract](issues/02-define-c4-graph-projection-contract.md) — An immutable, evidence-backed `repositoryId + headSha + projectionVersion` fact graph underlies all four C4 views; requirements retain a durable snapshot reference and graph facts use semantic lineage, typed evidence-backed edges, and explicit aggregation.
- [Prototype the interactive canvas visual language](issues/03-prototype-interactive-canvas-visual-language.md) — Direction A, the canvas-first Command deck with persistent evidence inspector, is the approved visual baseline; the throwaway alternatives remain on their prototype branch.
- [Define the navigation and inspection contract](issues/04-define-navigation-and-inspection-contract.md) — Explicit drill-down plus per-layer session restoration, shareable navigation URLs, semantic keyboard navigation, and a single-selection evidence inspector define the read-only exploration flow.
- [Define the PNG and SVG export contract](issues/06-define-png-and-svg-export-contract.md) — Browser-only downloads capture the full current visible graph with embedded provenance; SVG is standalone and 2× PNG refuses over-limit captures rather than silently degrading.
- [Research a free graph engine and export stack](issues/12-research-free-graph-engine-and-export-stack.md) — AntV G6 plus ELK.js Layered ranks first; BaiZe must own projection-to-layout mapping and deterministic SVG/PNG generation, with Cytoscape.js plus ELK.js retained only as a fallback.
- [Decide the free graph engine and layout stack](issues/10-decide-yfiles-license-and-evaluation-gate.md) — AntV G6 plus ELK.js Layered is the accepted free production stack; BaiZe owns layout mapping and standalone SVG/PNG export.
- [Run the G6 and ELK 500-node evaluation spike](issues/13-run-g6-elk-500-node-evaluation-spike.md) — The free stack passed its worker-layout, compound-rendering, semantic-navigation, standalone-SVG, and bounded-PNG gate; production must lazy-load the measured dependency boundary.
- [Define scale, aggregation, and layout behavior](issues/05-define-scale-aggregation-and-layout-behavior.md) — The evidence-backed Visible Graph is capped at 500 nodes, with deterministic Worker layouts, density merging, adaptive labels, stale-result protection, and explicit interaction-first budgets.
- [Define the frontend integration and Mermaid cutover boundary](issues/07-define-integration-and-mermaid-cutover-boundary.md) — The browser coordinates immutable snapshot/view state while a lazily imported G6/ELK canvas renders it; old C4 Mermaid arrays are removed atomically without affecting Markdown Mermaid.
- [Define the accessibility, testing, and acceptance bar](issues/08-define-accessibility-testing-and-acceptance-bar.md) — WCAG 2.2 AA, a semantic list/live-region graph alternative, four automated test layers, performance budgets, three viewports, and dual-screen-reader human verification are mandatory before cutover.

## Not yet specified

- No additional in-scope fog has been identified; subsequent ticket resolutions may reveal it.

## Out of scope

- Making the directory tree part of the graph canvas.
- Editing architecture nodes or relationships from the canvas.
- A single semantic-zoom canvas containing all four C4 levels simultaneously.
- Automatically turning exported images into `ArtifactRevision` assets.
- Replacing Mermaid in Markdown, design packages, or other static-document rendering.
- Guaranteeing direct rendering of 2,000 or more visible nodes in the first release.
- [Run the yFiles 500-node evaluation spike](issues/11-run-yfiles-500-node-evaluation-spike.md) — yFiles is excluded because the project requires a free stack; this commercial-license task is superseded by free-stack research.
