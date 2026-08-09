# Define the accessibility, testing, and acceptance bar

Type: grilling
Status: resolved
Blocked by: 04, 05, 06, 07

## Question

What accessibility fallback, keyboard and screen-reader behavior, deterministic test fixtures, unit/component/browser tests, visual-regression checks, performance measurements, supported viewport sizes, and end-to-end acceptance scenarios are required before the interactive canvas can replace the current Mermaid architecture views?

## Answer

The release gate is **WCAG 2.2 AA** for the Command-deck canvas, controls, semantic companion list, and evidence inspector. The graphical canvas is never the only representation: the synchronized companion list is the screen-reader traversal surface; the canvas exposes layer/root/count summary; and a live region announces loading, result counts, selection, focus, export completion/refusal, snapshot changes, and errors. Existing keyboard rules remain binding: Tab reaches controls/list/inspector, list arrows move, Enter selects, and search/focus/fit/Escape are commands with visible focus treatment.

- **Fixtures:** versioned synthetic Context, Container, Component, and Code fixtures cover nested groups, cross-boundary relationships, evidence confidence, aggregation, empty/error/loading states, 500-node density, oversized export refusal, and stale snapshot transitions. One repository fixture is pinned to an immutable real SHA for Gateway/API smoke coverage.
- **Automated tests:** all four layers are mandatory. Pure-unit tests cover Visible Graph derivation, aggregation, URL/history state, stale layout handling, SVG serialization, and PNG cap/filename behavior. Lit component tests cover controls, selection, focus, companion list, inspector, live announcements, and narrow fallback. Browser E2E covers the full exploration loop: states; drill-down/history; search/filter/focus/expansion; keyboard/inspector; atomic update cancellation; SVG plus normal/refused PNG export. Visual regression snapshots cover ready/selected/focused/empty/error states at 1440×900, 1024×768, and 390×844.
- **Performance:** on the documented benchmark machine, stable Chrome, and 1280×800, enforce the existing Visible Graph budgets: initial interactive ≤1.5 s, visible-topology re-layout ≤1.0 s, filter/focus transition ≤250 ms, selection/inspector ≤100 ms, ELK in a Worker, and pan/zoom ≥30 FPS. Reports record hardware, browser, fixture cardinality, medians, and p95; CI detects regressions but does not substitute for benchmark hardware.
- **Human verification:** each release candidate passes axe checks, a complete keyboard-only exploration, VoiceOver/Safari, and NVDA/Firefox exploration of the same core flow.

Mermaid replacement may ship only when every listed automated and manual gate passes against the accepted G6/ELK, snapshot/Visible Graph, export, and cutover contracts; no fallback mode or partial accessibility exemption is allowed.
