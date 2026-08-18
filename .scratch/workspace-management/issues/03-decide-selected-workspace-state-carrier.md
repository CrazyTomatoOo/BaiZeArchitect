# Decide the selected-workspace state carrier in the web shell

Label: wayfinder:grilling
Assignee: pi-agent
Status: closed

## Question

What carries the currently-selected workspace across the `baize-workflow` shell and its child components (`baize-requirements`, `baize-review-center`), all of which currently hardcode `this.workspaceId = 1`?

The fork:
- **Shell-prop** — `baize-workflow` holds the selected `workspaceId`, persists it to `localStorage["baize.workspaceId"]`, and passes it down to children as an attribute/property; children react to changes via Lit `updated`/`willUpdate`.
- **Standalone client store** — a `workspace-context.ts` singleton (value + change event); all three components read from it and subscribe. The shell only hosts the selector.

Constraints to weigh:
- `baize-workflow` already owns the children's lifecycle and renders them, so a shell-prop is the smaller blast radius (no new module, no new subscription wiring).
- A standalone store decouples selection from the shell and is easier to test, but adds a module and per-component subscription for a 3-component surface.
- Persistence is browser-side only (operator sessions are in-memory server-side; all operators share workspaces), so `localStorage` suffices in both options — it is not a differentiator.

The answer locks the Web wiring shape and which files change to de-hardcode `workspaceId = 1`.

## Resolution

Grilled the human across two sub-decisions; shared understanding reached. Established by codebase inspection (fact, not asked) — and this **corrects** the ticket's and the map's prior framing: in production only `baize-workflow` is mounted (`index.html` renders `<baize-workflow>`; `main.ts` imports only it). The `baize-requirements` and `baize-review-center` custom elements are defined but their tags appear nowhere in `web/src` or the HTML — they are unmounted orphans. `baize-workflow`'s `render()` dispatches a `baize-goto {tab:"requirements"}` event expecting an external shell to handle navigation, but no such shell exists. `baize-workflow` already declares `workspaceId` as a Lit reactive property with a `workspace-id` attribute (lines 59/101).

1. **Shell-prop.** `baize-workflow` holds the selected `workspaceId`; its `connectedCallback` reads `localStorage["baize.workspaceId"]` instead of hardcoding 1; no new module, no standalone store, no subscription wiring. The "pass down to children" part of the original shell-prop framing is moot — no children are mounted. A standalone `workspace-context.ts` store is over-engineering for a one-component surface.
2. **Default when no saved selection: auto-select first active workspace.** If `localStorage` has no `baize.workspaceId`, default to the first active (non-archived) workspace; show an empty/create-prompt state only when zero workspaces exist. Lowest friction; matches current workspaceId=1 behavior; aligns with the destination's "prompt to create when none".

Locked surface: `baize-workflow` `connectedCallback` changes (read localStorage, default first-active); no new modules. De-hardcoding `workspaceId = 1` in `baize-requirements` / `baize-review-center` is moot for production (unmounted) — left as-is unless those components are mounted by a future effort.

**Fog graduated / scope tension surfaced:** the resolution revealed no shell/router exists and the review-center/requirements-list are unmounted. This makes a new question specifiable — where the workspace management panel (create/rename/archive forms) lives, and whether making the unmounted review-center/requirements-list "follow the selected workspace" is in scope at all — graduated to [Decide the web host for workspace management](issues/05-decide-web-host-for-workspace-management.md). The prototype fog now depends on that ticket, not this one.
