# Decide the web host for workspace management

Label: wayfinder:grilling
Assignee: pi-agent
Status: closed

## Question

[Decide the selected-workspace state carrier](03-decide-selected-workspace-state-carrier.md) established that no shell/router exists in production — only `baize-workflow` is mounted, and `baize-requirements` / `baize-review-center` are unmounted orphans. `baize-workflow`'s `render()` dispatches a `baize-goto` event expecting an external shell that does not exist.

Where does the workspace management surface — the selector plus the create/rename/archive panel — live?

The fork:
- **Extend `baize-workflow`** — add a workspace selector in `baize-workflow`'s hero and a management view (list/create/rename/archive forms) as another internal view of `baize-workflow`, reachable via its existing navigation. No shell/router is built.
- **Build a minimal shell/router first** — a new shell component that hosts `baize-workflow` (detail), `baize-requirements` (list), `baize-review-center`, and the workspace selector + management panel, handling the `baize-goto` routing. Larger, but it unmounts the orphans and delivers the destination's "review center follows workspace" claim directly.

Scope tension to resolve while grilling: the destination says "assets, requirements, workflows, and the review center all follow the selected workspace." Since `baize-review-center` and the requirements-list are unmounted, making them "follow" is really "mount them via a shell" — which may be general app infrastructure beyond this effort's destination. If the grilling concludes a shell is beyond scope, rule "make the unmounted components follow" out of scope (append to the map's Out of scope), keep the management surface inside `baize-workflow`, and let a shell/router be a separate future effort.

The answer locks whether [03]'s shell-prop stays the whole web story or a shell ticket opens, and whether the destination's review-center/requirements-list-follow claim is in scope or out.

## Resolution

Grilled the human; shared understanding reached. Established by codebase inspection (fact, not asked): `baize-workflow`'s `renderWorkflowView()` renders only the workflow detail (hero/receipt/gate-queue/recovery/audit/details/approval/audit-view/package) — no inline requirements list. Its "← 返回需求列表" back button dispatches `baize-goto {tab:"requirements"}` expecting a shell to route to the requirements list (`baize-requirements`), but no shell exists; `baize-requirements` and `baize-review-center` are unmounted orphans. So the destination's literal "requirements/review-center follow the selected workspace" requires building a shell/router to mount them — general app navigation infrastructure.

**Extend `baize-workflow`; redraw the destination; rule shell/unmounted-views out of scope.** The workspace selector and the create/rename/archive management panel live as internal views of `baize-workflow`, reachable via its existing navigation; no shell/router is built. The destination is redrawn to "workspace lifecycle management + Web selection/switching, with the mounted surface (`baize-workflow`'s workflow detail) following the selected workspace" — dropping the literal "unmounted requirements-list/review-center follow." Building the shell/router and mounting `baize-requirements` / `baize-review-center` is appended to the map's Out of scope as a separate future effort (general app nav infrastructure, not workspace management).

Key distinction surfaced during grilling: the user's original pain ("资产需求缺少关联的项目") is a DATA-association gap, and `workspace_id` foreign keys already exist on `requirements` / `reusable_assets` / `design_packages`; the actual gap was management entry points (everything hardcoded to workspace 1). Extending `baize-workflow` with selector + management panel + workflow-detail-follows-selection fully resolves that pain. The unmounted views' mounting is a separate navigation concern, not the core pain.

[03]'s shell-prop stays the whole web story for this effort; no shell ticket opens here. Fog graduated: the management-panel IA prototype is now specifiable (all constraints fixed) → [Prototype the workspace management panel interaction](06-prototype-workspace-management-panel.md).
