# Prototype the interactive canvas visual language

Type: prototype
Status: resolved
Blocked by: 02, 10

## Question

What should the interactive C4 canvas look and feel like in BaiZeArchitect's graphite-indigo visual system? Produce a cheap, reviewable prototype covering the four layer selectors, breadcrumb drill-down, graph viewport, node and edge grammar, selected/hover/focus states, toolbar, minimap or overview affordance, evidence inspector, loading/empty/error states, and the narrow-screen fallback.

## Answer

Adopt **Direction A — Command deck** as the visual baseline: a canvas-first work area with horizontal C4 layer navigation, breadcrumb drill-down, compact filter/focus/export toolbar, minimap, and a persistent right-hand evidence inspector. Nodes use C4-aware treatments, relationships distinguish active evidence paths, and selected/hover/focus treatments make inspection immediate.

On narrow screens the inspector moves below the viewport, controls wrap, and the minimap hides rather than covering graph content. Loading, empty, and error states are reviewable from the prototype toolbar.

The throwaway prototype is captured on branch `prototype/interactive-canvas-visual-language` at commit `0b27443`, including Directions A/B/C and the desktop/narrow screenshots under `.scratch/interactive-architecture-canvas/prototype/`. Directions B (navigator rail) and C (evidence dossier) were considered and rejected as the baseline because they reduce immediate graph area or make evidence precede exploration. Production implementation must be rewritten from this decision; do not merge prototype code into `main`.
