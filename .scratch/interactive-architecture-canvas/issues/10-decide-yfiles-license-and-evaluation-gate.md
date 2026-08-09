# Decide the free graph engine and layout stack

Type: grilling
Status: resolved
Blocked by: 12

## Question

yFiles is excluded because BaiZeArchitect will not procure a commercial license. Based on the free-stack research, choose a zero-cost production graph engine, layout stack, and export ownership boundary that still satisfy the fixed C4, 500-visible-node, Lit/Vite, read-only, standalone-SVG, and 2× PNG requirements. Record the resulting evaluation gate and explicitly reject alternatives that cannot meet those requirements.

## Answer

Select **AntV G6 + ELK.js Layered** as the sole free production candidate, subject to a hard 500-node Lit/Vite evaluation gate. G6 owns interactive rendering, Combo grouping, and view interaction; ELK owns compound hierarchical geometry and edge routes. BaiZeArchitect owns `projectionToElk` / `elkResultToG6` and `visibleGraphToSvgDocument`, then rasterizes that SVG to the contractually required 2× PNG.

[Run the G6 and ELK 500-node evaluation spike](13-run-g6-elk-500-node-evaluation-spike.md) must pass before Mermaid replacement or production dependencies. Cytoscape.js + ELK.js is rejected as the production candidate because standalone SVG would depend on an unowned export path; JointJS + ELK.js is rejected because MPL-2.0 and 500-node viability create unnecessary risk. No alternate stack is an automatic fallback.

This gated choice is recorded in [ADR-004](../../../docs/adr/ADR-004-free-c4-canvas-stack.md).
