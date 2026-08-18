# Decide repo_path policy at workspace creation

Label: wayfinder:grilling
Assignee: pi-agent
Status: closed

## Question

When an operator creates a workspace from the Web (or via HTTP), must `repo_path` remain a required, user-supplied unique string, or may it be optional / auto-generated?

`workspaces.repo_path` is `not null unique`. The stakes of this decision depend on whether `repo_path` is operationally load-bearing or merely a unique key. While resolving, first establish — by inspecting the codebase — whether `repo_path` is used for any git/file operation or external system lookup, or whether it only serves as a uniqueness key and human label.

Then grill the human on the policy:
- **Keep required + user-supplied** — workspace is semantically bound to a real repo; the Web form collects the path.
- **Allow optional / auto-generated** — `repo_path` becomes an internal unique key the system fills when the operator leaves it blank; workspace is a logical container, not necessarily a repo binding.

The answer determines the HTTP `POST /api/workspaces` body shape and the Web create form's required fields. If `repo_path` proves operationally load-bearing, that biases toward required; if purely a key, the semantic-binding argument weakens.

## Resolution

Grilled the human across two sub-decisions; shared understanding reached. Established by codebase inspection (fact, not asked): `repo_path` is purely a uniqueness key + human label — used only in `createWorkspace` insert and the cutover `repo_path`+`name` lookup; no git/file operations, no external system lookup.

1. **repo_path stays required + user-supplied.** `workspaces.repo_path` remains `not null unique`; the operator supplies any unique string (a real path or a placeholder like `/repos/svc-x`). No nullable migration, no auto-generator. Workspace ≡ declares a repo (declarative binding). The simplicity cost of requiring a string is minimal; the generator/nullability complexity of making it optional is not justified by the unused, declarative nature of the field.
2. **No real-path/git validation.** Accept any non-empty unique string. `repo_path` is not used operationally, so validating it as a real filesystem path or git repo would be speculative enforcement of a declarative binding.

Locked surface: `POST /api/workspaces` body requires `{repoPath, name}` (repoPath non-empty, unique); Web create form has a required repo_path field with no format/path validation. `getWorkspace`/`renameWorkspace` remain separate concerns, not decided here.
