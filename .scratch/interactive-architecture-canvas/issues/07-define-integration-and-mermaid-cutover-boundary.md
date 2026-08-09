# Define the frontend integration and Mermaid cutover boundary

Type: grilling
Status: open
Blocked by: 02, 03, 13

## Question

What component boundary, dependency boundary, API adaptation, state ownership, lazy-loading strategy, and migration cutover should replace Mermaid inside `baize-architecture-browser` while leaving `baize-markdown` and static Mermaid documents intact? Decide whether layout data is client-only, cached, or persisted and how stale `head_sha` data is invalidated.
