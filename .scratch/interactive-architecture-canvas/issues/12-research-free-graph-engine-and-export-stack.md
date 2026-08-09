# Research a free graph engine and export stack

Type: research
Status: resolved
Blocked by:

## Question

With yFiles excluded, compare zero-cost, production-usable graph stacks for BaiZeArchitect’s Lit/Vite C4 canvas. Evaluate compound/nested graph support, hierarchical layout quality at 500 visible nodes, direct custom-element integration, interaction primitives, accessibility integration, standalone SVG export, 2× PNG export, license, bundle/runtime risks, and maintenance health. Produce a ranked recommendation and identify any capability that must be owned by BaiZeArchitect rather than supplied by the library.

## Answer

Research is captured in [Free graph engine and export-stack research](../research/free-graph-engine-and-export-stack.md).

**AntV G6 + ELK.js Layered** ranks first: G6 is MIT-licensed and provides Combo grouping, interaction primitives, and Canvas/SVG/WebGL rendering; ELK Layered supplies compound-aware hierarchical layout and routing. Cytoscape.js + ELK.js remains a mature MIT fallback but has no first-party standalone-SVG export. JointJS is SVG-native but MPL-2.0 and has no adequate 500-node evidence.

The selected stack must own `projectionToElk` / `elkResultToG6` mapping and a deterministic `visibleGraphToSvgDocument` plus SVG-to-PNG rasterizer. A 500-node Lit/Vite evaluation spike remains required before production implementation.
