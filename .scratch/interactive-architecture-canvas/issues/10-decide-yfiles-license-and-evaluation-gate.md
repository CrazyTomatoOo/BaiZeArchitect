# Decide the yFiles license and evaluation gate

Type: grilling
Status: resolved
Blocked by: 01

## Question

Will BaiZeArchitect procure and evaluate yFiles for HTML 3.x as the selected graph engine, or must the first release use an open-source stack? If commercial licensing is not viable, decide whether to relax the required standalone SVG export, fund/own a maintained exporter, or select a different engine; record the resulting executable engine decision and the required representative 500-node Lit/Vite evaluation gate.

## Answer

Select **yFiles for HTML 3.x with Hierarchical Layout** as the sole candidate for the first-release engine evaluation; yFiles is not yet a production dependency. The user approved evaluation licensing, and the gate is hard: no production package install or Mermaid replacement may begin before the evaluation passes.

The gate requires the current Lit/Vite route to render a representative 500-node compound C4 fixture with realistic labels and edge density, and to demonstrate layout, read-only interaction, PNG/SVG export, a keyboard/ARIA companion navigation surface, package impact, memory, and responsiveness. [Run the yFiles 500-node evaluation spike](11-run-yfiles-500-node-evaluation-spike.md) records that prerequisite. If it fails, engine selection reopens; do not silently fall back to Cytoscape.js plus ELK.js or weaken SVG export.

The decision is recorded in [ADR-003](../../../docs/adr/ADR-003-gate-canvas-on-yfiles-evaluation.md).
