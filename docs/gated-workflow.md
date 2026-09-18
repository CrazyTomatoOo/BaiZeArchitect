# Gated analysis workflow

The CLI uses the same Confirmation Gate state model for interactive and durable
review. Every stage persists its lifecycle status and Current Stage while it
waits for confirmation, then advances only after that stage is settled.

Use `--gated` when a human may review each proposal set in a separate CLI
invocation:

```bash
BAIZE_DB_PATH=<sqlite-file-path> npm start -- --gated "Add dashboard sharing"
```

The initial invocation writes the scenario proposals, records
`scenario_confirmation_requested`, persists the run as
`awaiting_confirmation` with `current_stage = scenario`, and exits
successfully. Its stdout is one stage-aware Run Snapshot, while stderr carries
the human-readable gate summary.

Read the current Run Snapshot without changing the run:

```bash
BAIZE_DB_PATH=<sqlite-file-path> npm start -- status <runId>
BAIZE_DB_PATH=<sqlite-file-path> npm start -- resume <runId>
```

Both commands are read-only, wait for no stdin, print exactly one JSON Run
Snapshot to stdout, and print the human-readable summary to stderr. Unknown
run IDs and usage errors exit with code `2` and write no stdout JSON. Actions
against a running or terminal run also exit with code `2` without mutating the
run. A running run reports `run_is_running`; a terminal run reports
`run_is_terminal` and provides no approve, reject, or revise commands.
Runtime, database, model, and MCP failures exit with code `1`. Failures during
analysis actions record failure state when the database is available; read-only
commands never change run state, including when a read fails.

Successful status and no-action resume commands, approvals, and revisions exit
with code `0`. Rejections, usage errors, unknown run IDs, and actions attempted
outside an open gate exit with code `2`. SIGINT exits with `130` and SIGTERM
exits with `143`.

Each Run Snapshot includes the run ID, lifecycle status, Current Stage, stage
label, requirement, gate state, blocked reason, current proposals, confirmed
asset counts, next stage, revision stage, next command, and the complete status,
approve, reject, and revise commands. JSON is written only to stdout; the
human-readable requirement, stage, progress, and available commands are written
to stderr.

Approve or reject the current gate with:

```bash
BAIZE_DB_PATH=<sqlite-file-path> npm start -- resume <runId> y
BAIZE_DB_PATH=<sqlite-file-path> npm start -- resume <runId> n
```

When the current proposal set is close but needs changes, request a revision
instead of rejecting the run:

```bash
BAIZE_DB_PATH=<sqlite-file-path> npm start -- resume <runId> revise -- \
  "Focus on sharing one dashboard with one teammate"
```

A revision records the feedback and previous proposals in the trace, marks the
previous proposals rejected, reruns only the current analysis stage, and returns
the run to the same confirmation gate. The next approval or rejection applies
to the revised proposal set.

An approval settles the current proposals, runs only the next analysis stage,
and exits at its confirmation gate. A rejection settles the current proposals
as rejected, completes the run as `rejected`, and never starts the next stage.
