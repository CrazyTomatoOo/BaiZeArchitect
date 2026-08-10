# Manual Google Chrome canvas release checklist

This is the remaining release gate. A human operator must complete it in **Google Chrome**; automated axe, Playwright Chromium, and visual-regression coverage do not substitute for this exploration.

## Test record

- Date / operator:
- Environment URL:
- Repository / immutable snapshot ID:
- Google Chrome version:
- Operating system:
- Result: Pass / Fail
- Findings / follow-up issue links:

## Preconditions

1. Use a repository with a resolved immutable C4 snapshot and a visible Context root.
2. Begin at the architecture browser with no cached selection, filter, or neighbor-focus state.
3. Use Google Chrome at the supported 1280×800-or-larger desktop viewport.
4. Record the exact snapshot ID, Chrome version, and operating system above.

## Complete exploration

- [ ] Reach the Architecture browser main landmark and verify repository, C4 layer/root, node count, and relationship count are understandable without relying on the drawn graph.
- [ ] Tab through refresh, layer navigation, search/filter, focus, canvas toolbar, semantic list, and evidence inspector; each control has visible focus and a clear name/state.
- [ ] Traverse the semantic companion list with ArrowUp/ArrowDown. Verify the focused node becomes selected and that its definition, kind, ID, relationships, lineage, confidence, and evidence are visible in the inspector.
- [ ] Select a node and activate **View internal**. Verify the next C4 layer/root loads, is usable, and the browser navigation state updates.
- [ ] Apply a filter and neighbor focus. Verify result count, selection/focus state, and reset/exit behavior.
- [ ] Use Fit view and pan/zoom; verify the canvas remains responsive and node positions remain stable during selection and inspection.
- [ ] Export SVG and a permitted PNG. Verify the downloads include the expected provenance filename. If testing an oversized view, verify PNG refusal directs the user to SVG or narrower filtering.
- [ ] Trigger an available load/error fixture and verify the alert gives actionable recovery information.

## Sign-off

- Google Chrome exploration: Pass / Fail — operator/date:
- Release approver/date:

A failed check blocks the Mermaid cutover until a fix, an automated regression test where applicable, and this manual Chrome check are repeated successfully.
