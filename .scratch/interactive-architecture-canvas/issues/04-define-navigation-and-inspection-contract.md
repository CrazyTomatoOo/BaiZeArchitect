# Define the navigation and inspection contract

Type: grilling
Status: resolved
Blocked by: 03

## Question

Which exact user actions and state transitions govern search, selection, pan/zoom, fit-to-view, filtering, neighbor focus, node expansion, cross-level drill-down, breadcrumbs, browser history/deep links, keyboard navigation, refresh, and evidence inspection? Decide which state is ephemeral, URL-addressable, or preserved when switching C4 layers.

## Answer

The canvas is a read-only explorer with a single selected node and a persistent evidence inspector. Direct canvas selection never moves the camera; search or semantic-list selection centers an off-screen result. The inspector shows definition, typed relationships, lineage, confidence, and raw evidence references; filtering out the selected node clears selection and returns the inspector to its guide state.

- **Layer navigation:** “View internal” is the only action that drills from a node to its next C4 layer and sets that node as the destination root. Direct layer tabs open the layer root. Each `snapshot + layer + root` restores its last session state independently.
- **Search and view controls:** search spans every layer in the current immutable snapshot, labels results with their layer, and navigates to the result’s layer/root. Layer filters establish the visible set. Neighbor focus is a reversible lens applied after filters: it keeps the selected node, N-hop neighbors, and required containers, then exits back to the filtered view. Aggregate expansion is another reversible, per-layer session state; it never automatically expands all members.
- **Camera and commands:** pointer/touch pan and zoom are local viewport actions. Fit-to-view frames the current root and filtered/expanded visible set. Filter, focus, export, refresh, and fit controls are in the Command-deck toolbar.
- **Keyboard:** a synchronized, filterable semantic companion list provides node traversal; Tab reaches toolbar, list, and inspector; arrow keys move the list; Enter selects. Search, focus, fit, and Escape are command shortcuts, while spatial arrow-key navigation is excluded.
- **Sharing and history:** URL state contains immutable snapshot, C4 layer, root, selection, focus configuration, and serializable filters. Viewport transform and aggregate expansion remain per-layer session state. Drill-down, breadcrumb returns, direct layer switches, and explicit snapshot advances call `pushState`; selection, filtering, focus, and search results call `replaceState`.
- **Refresh:** a link remains pinned to its snapshot. “Update to latest commit” is explicit; it switches to a newer projection and uses `lineageId` to retain compatible root, selection, and filters, otherwise clears them with a notice. It never silently changes the shared snapshot.

This establishes the navigation contract for the implementation and yFiles evaluation; no canvas interaction persists or mutates architecture semantics.
