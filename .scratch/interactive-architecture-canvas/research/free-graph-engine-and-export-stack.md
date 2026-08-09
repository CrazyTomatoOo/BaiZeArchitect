# Free graph engine and export-stack research

## Decision context

The C4 canvas is a Lit/Vite, read-only explorer with approximately 500 visible nodes per layer, nested/aggregate structures, hierarchical layout, standalone SVG, and 2× PNG export. yFiles is excluded because it is commercial.

## Candidates

| Stack | License | C4 grouping and layout | Rendering and interaction | Export fit | Result |
| --- | --- | --- | --- | --- | --- |
| **AntV G6 + ELK.js** | MIT | G6 Combos model groups and expand/collapse; ELK Layered supports compound graphs, cross-hierarchy edges, orthogonal routing, and clusters | Framework-neutral TypeScript graph engine; Canvas, SVG, and WebGL renderers; built-in interaction behaviors and worker-backed layouts | Native SVG renderer reduces visual-model mismatch; BaiZe-owned SVG document builder and SVG-to-canvas rasterizer satisfy standalone SVG and controlled 2× PNG | **Rank 1 — evaluate** |
| **Cytoscape.js + ELK.js** | MIT | First-class compound nodes; existing ELK adapter | Mature interaction and graph-query API; built-in full-graph PNG export | Core offers PNG but no first-party standalone SVG path. A third-party SVG extension is not a sufficient ownership or maintenance guarantee | **Rank 2 — fallback** |
| **JointJS + ELK.js** | MPL-2.0 | Embedded hierarchical elements and automatic layouts | SVG-native diagram toolkit with interaction and nested elements | SVG is natural, but MPL-2.0 is less permissive and no evidence yet supports the 500-node C4 target | **Rank 3 — reject unless the first two fail** |

## Recommendation

Evaluate **AntV G6 for interaction/rendering plus ELK.js Layered for layout**. G6 is MIT-licensed, provides node/edge/Combo elements, multiple interaction behaviors, Canvas/SVG/WebGL renderers, and worker execution for built-in layouts. ELK Layered contributes the missing C4-specific compound, cluster, cross-hierarchy, and orthogonal-routing guarantees.

BaiZeArchitect must own two narrow integration surfaces:

1. `projectionToElk` / `elkResultToG6`: map the canonical C4 projection to ELK and transfer returned bounds and edge routes into G6. This must run in a worker when layout cost warrants it.
2. `visibleGraphToSvgDocument`: generate the required opaque graphite-indigo standalone SVG directly from the canonical visible graph, ELK geometry, export header/footer, and embedded styles. Rasterize that owned SVG to a 2× PNG. Do not depend on a renderer DOM snapshot or an unmaintained SVG plugin.

This makes export deterministic and satisfies the existing contract even when the interactive renderer uses Canvas or WebGL.

## Required evaluation gate

Before selecting the stack, a disposable Lit/Vite spike must load a representative 500-node compound C4 fixture and demonstrate: ELK worker layout, G6 grouping/selection/pan/zoom, semantic companion navigation, a generated standalone SVG, 2× PNG rasterization within the existing 8192px refusal policy, and bundle/runtime measurements. Failure reopens stack selection; it does not weaken SVG ownership.

## Sources

- [G6 repository and license](https://github.com/antvis/G6) — MIT; Combo elements, interaction behaviors, layouts, and Canvas/SVG/WebGL renderers.
- [G6 Combo documentation](https://g6.antv.antgroup.com/en/manual/element/combo/overview) — collapse/expand behavior for grouped nodes.
- [G6 layout documentation](https://g6.antv.antgroup.com/en/manual/layout/overview) — worker execution for built-in layout algorithms.
- [ELK Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html) — compound, clusters, cross-hierarchy edges, and orthogonal/spline routing.
- [Cytoscape.js documentation](https://js.cytoscape.org/) — MIT compound graph model and full-graph PNG export; lack of first-party SVG export remains the gap.
- [Cytoscape ELK adapter](https://github.com/cytoscape/cytoscape.js-elk) — existing adapter capability.
- [JointJS repository](https://github.com/clientIO/joint) — MPL-2.0, SVG-native embedded elements and automatic layouts.
