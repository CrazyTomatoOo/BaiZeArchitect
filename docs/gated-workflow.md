# Gated analysis workflow

The default CLI invocation remains the original one-process workflow:

```bash
BAIZE_DB_PATH=<sqlite-file-path> npm start -- "Add dashboard sharing"
```

It prints each proposal set and waits for `y` or `n` at every library-update
boundary. All three answers must be provided to the same process.

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
