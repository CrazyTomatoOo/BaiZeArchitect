# Define scale, aggregation, and layout behavior

Type: grilling
Status: resolved
Blocked by: 02, 03, 13

## Question

How should the canvas remain legible and responsive up to approximately 500 visible nodes per layer? Fix the layout rules, density thresholds, clustering/aggregation semantics, progressive disclosure, label truncation, edge reduction, loading strategy, re-layout triggers, layout stability requirements, and measurable performance budgets.

## Answer

The **Visible Graph** is the sole render/export unit. It never contains more than 500 nodes in the first release; a larger projection begins with evidence-backed container, component, or aggregate nodes and users explicitly replace visible aggregates through filtering, focus, or expansion. Aggregation is semantic and traceable to member IDs, never a renderer heuristic or arbitrary sample.

- **Density:** all visible edges must connect visible nodes. At high density, parallel same-type/source/target relationships become count-bearing summary edges; retain cross-boundary, selected, and focused-neighbor relationships by default. Hidden relations remain inspectable and return in neighbor focus. Labels are two-line/full up to 200 nodes, one line/approximately 24 characters from 201–500, and at low zoom only selected, focused, or aggregate labels remain; semantic navigation and inspection always show full names.
- **Layout and stability:** use deterministic ELK Layered ordering by semantic ID. Only entering a layer, advancing snapshots, committed filters, aggregate expansion/collapse, or entering/leaving neighbor focus triggers a Worker layout. Selection, hover, inspector state, pan/zoom, and label visibility never reposition nodes. Fit-to-view frames the current Visible Graph.
- **Loading:** initial entry uses a skeleton. On every later re-layout keep the prior graph with a light loading treatment, atomically replace it with the latest completed layout, and cancel or ignore stale Worker responses.
- **Performance:** on the documented project benchmark machine, current stable Chrome, and 1280×800 viewport: initial interactive view ≤1.5 s; visible-topology re-layout ≤1.0 s; submitted filter/focus transition ≤250 ms; selection/inspector update ≤100 ms; ELK runs in a Worker; pan/zoom sustains ≥30 FPS. Each benchmark report records machine, browser, data cardinality, and medians/p95; CI detects regressions but is not the acceptance hardware.

The existing 500-node G6/ELK spike satisfies engine viability only; future production tests verify these concrete Visible Graph budgets.
