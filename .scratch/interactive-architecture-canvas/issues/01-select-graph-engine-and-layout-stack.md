# Select the interactive graph engine and layout stack

Type: research
Status: resolved
Blocked by:

## Question

Which maintained browser graph-rendering and layout stack best fits BaiZeArchitect's Lit application for read-only C4 compound graphs, node-driven drill-down, dark-theme product styling, approximately 500 visible nodes, and PNG/SVG export? Compare the strongest candidates against official documentation and first-party examples, including integration complexity, compound-node support, layout quality, rendering technology, accessibility constraints, export support, bundle/runtime cost, and maintenance health.

## Answer

Select **yFiles for HTML 3.x with Hierarchical Layout**, gated on commercial-license approval and a representative 500-node Lit/Vite evaluation spike. It is the only reviewed maintained stack with first-party evidence for group-aware hierarchical layout, Web Component integration, SVG styling, PNG/SVG export, and ARIA support; Cytoscape.js + worker-hosted ELK.js is the open-source fallback but has a high-severity maintained-SVG-export gap. See [Interactive graph engine and layout stack research](../research/graph-engine-selection.md).
