# Run the G6 and ELK 500-node evaluation spike

Type: task
Status: resolved
Blocked by: 10

## Question

In a disposable Lit/Vite spike, load a representative 500-node compound C4 fixture through `projectionToElk` / `elkResultToG6`. Record reproducible measurements for worker-hosted ELK layout, G6 grouping and read-only interaction, semantic companion navigation, the BaiZe-owned standalone SVG document, 2× PNG rasterization subject to the 8192px refusal policy, bundle impact, memory, and responsiveness. State whether the hard gate passes; on failure, reopen free-stack selection without weakening SVG ownership.

## Answer

**Pass.** The disposable Lit/Vite spike is captured on branch `spike/g6-elk-500-node-evaluation` at commit `ec6c303`; its reproducible report and screenshot are in `.scratch/interactive-architecture-canvas/evaluation/` on that branch.

It rendered 500 nodes, 490 relationships, and 10 G6 combos after a 179 ms ELK Layered layout in an explicit browser Worker. The semantic companion navigation focused a graph node without browser console errors. BaiZe-owned SVG download contained 500 node rectangles, 490 relationship paths, inline styles, and no scripts, images, or external CSS. The 7,644 × 1,122 px full view correctly refused 2× PNG because its 15,288 px longest side exceeds the 8,192 px export limit. Observed heap was 98 MB; the conservative static-spike build added a 451.90 kB gzip entry and a 1,595.33 kB ELK worker, so production must lazy-load this boundary.

The hard gate therefore passes. G6 plus ELK.js Layered remains the accepted production candidate; no fallback selection is reopened.
