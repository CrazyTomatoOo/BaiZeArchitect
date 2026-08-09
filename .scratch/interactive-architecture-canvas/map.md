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

- [Select the interactive graph engine and layout stack](issues/01-select-graph-engine-and-layout-stack.md) — Research ranks yFiles for HTML 3.x plus Hierarchical Layout first; its commercial-license/evaluation gate is the next explicit decision, while Cytoscape.js plus worker-hosted ELK.js is the OSS fallback with an SVG-export gap.
- [Define the C4 graph projection contract](issues/02-define-c4-graph-projection-contract.md) — An immutable, evidence-backed `repositoryId + headSha + projectionVersion` fact graph underlies all four C4 views; requirements retain a durable snapshot reference and graph facts use semantic lineage, typed evidence-backed edges, and explicit aggregation.
- [Decide the yFiles license and evaluation gate](issues/10-decide-yfiles-license-and-evaluation-gate.md) — yFiles plus Hierarchical Layout is the only first-release engine candidate, pending a hard evaluation gate in the real Lit/Vite route; a failed evaluation reopens selection rather than silently changing export requirements or stack.
- [Prototype the interactive canvas visual language](issues/03-prototype-interactive-canvas-visual-language.md) — Direction A, the canvas-first Command deck with persistent evidence inspector, is the approved visual baseline; the throwaway alternatives remain on their prototype branch.
- [Define the navigation and inspection contract](issues/04-define-navigation-and-inspection-contract.md) — Explicit drill-down plus per-layer session restoration, shareable navigation URLs, semantic keyboard navigation, and a single-selection evidence inspector define the read-only exploration flow.
- [Define the PNG and SVG export contract](issues/06-define-png-and-svg-export-contract.md) — Browser-only downloads capture the full current visible graph with embedded provenance; SVG is standalone and 2× PNG refuses over-limit captures rather than silently degrading.

## Not yet specified

- No additional in-scope fog has been identified; subsequent ticket resolutions may reveal it.

## Out of scope

- Making the directory tree part of the graph canvas.
- Editing architecture nodes or relationships from the canvas.
- A single semantic-zoom canvas containing all four C4 levels simultaneously.
- Automatically turning exported images into `ArtifactRevision` assets.
- Replacing Mermaid in Markdown, design packages, or other static-document rendering.
- Guaranteeing direct rendering of 2,000 or more visible nodes in the first release.
