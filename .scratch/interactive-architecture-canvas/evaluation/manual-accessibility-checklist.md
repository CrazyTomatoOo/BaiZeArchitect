# Manual C4 canvas accessibility release checklist

This checklist is the remaining release gate. It must be completed by a human operator; automated axe and Playwright coverage do not substitute for it.

## Test record

- Date / operator:
- Environment URL:
- Repository / immutable snapshot ID:
- Browser and version:
- Assistive technology and version:
- Result: Pass / Fail
- Findings / follow-up issue links:

## Preconditions

1. Use a repository with a resolved immutable C4 snapshot and a visible Context root.
2. Begin at the architecture browser with no cached selection, filter, or neighbor focus state.
3. Use the supported 1280×800-or-larger desktop viewport for the complete exploration flow.
4. Record the exact snapshot ID, browser, operating-system, and assistive-technology versions above.

## VoiceOver / Safari

Complete every item with VoiceOver enabled in Safari.

- [ ] Navigate landmarks and reach the Architecture browser main landmark.
- [ ] Verify the page communicates its repository, C4 layer/root, node count, and relationship count without relying on the drawn graph.
- [ ] Tab through refresh, layer navigation, search/filter, focus, canvas toolbar, semantic list, and evidence inspector with a visible focus indicator.
- [ ] Traverse the semantic companion list with ArrowUp/ArrowDown; verify the focused node is selected and its definition, kind, ID, relationships, lineage, confidence, and evidence are available in the inspector.
- [ ] Select a node, activate **View internal**, and verify the next C4 layer/root is announced and usable.
- [ ] Apply a filter and neighbor focus; verify result-count, selection/focus, and reset/exit state announcements are understandable.
- [ ] Export SVG and a permitted PNG; verify completion announcements. If using an oversized view, verify PNG refusal directs the user to SVG or narrower filtering.
- [ ] Trigger a load or snapshot error fixture where available; verify the alert is announced with actionable recovery information.

## NVDA / Firefox

Repeat the same complete flow with NVDA enabled in Firefox.

- [ ] Landmarks, page summary, and state changes are announced.
- [ ] Controls expose names, states, and disabled conditions.
- [ ] The semantic list is the usable graph traversal path; each list item remains a native button.
- [ ] Arrow-key traversal, Enter selection, Escape, search, fit, filters, focus, drill-down, inspector, export, and error handling are usable and announced.
- [ ] No action traps focus or requires interpreting the visual canvas.

## Sign-off

- VoiceOver / Safari: Pass / Fail — operator/date:
- NVDA / Firefox: Pass / Fail — operator/date:
- Release approver/date:

A failed check blocks the Mermaid cutover until a fix, automated regression test where applicable, and this manual check are all repeated successfully.
