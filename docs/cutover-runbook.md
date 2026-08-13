# BaiZe Production Cutover Runbook

## Overview

This runbook describes the atomic production cutover from the legacy
manual-orchestration system to the automatic Workflow governance kernel.
The cutover is a write-paused `check → apply` operation bound to paired
database and Session-tree fingerprints.

## Pre-Cutover Checklist

1. **Stop writes** — announce a maintenance window; ensure no new
   Requirements are created and no legacy Runs are started.
2. **Active Run check** — verify no legacy Runs are in `running` status.
   Active Runs block cutover (`active_run` anomaly, non-overridable).
3. **Paired snapshot** — take a backup of the legacy SQLite database and
   Session directory. This is the rollback point.

## Cutover Procedure

### Step 1: Cutover Preflight (check)

```bash
cd agent-runtime
npx tsx -e "
  import { runCutoverCheck } from './cutover/cutover-checker.ts';
  const report = runCutoverCheck('<legacy-db-path>', '<session-dir>');
  console.log(JSON.stringify(report, null, 2));
"
```

The report must show:
- `applyEligible: true`
- `blockingReasons: []`
- No `active_run` anomalies
- Input fingerprints (DB schema, DB content, Session tree) recorded

### Step 2: Cutover Apply (apply)

```bash
cd agent-runtime
npx tsx -e "
  import { CutoverApplier } from './cutover/cutover-applier.ts';
  import { runCutoverCheck } from './cutover/cutover-checker.ts';
  const report = runCutoverCheck('<legacy-db-path>', '<session-dir>');
  const applier = new CutoverApplier();
  const result = await applier.apply('<legacy-db-path>', '<session-dir>', report);
  console.log(result);
"
```

Apply is idempotent — repeated calls return the existing attestation
without re-importing. The migration transaction is atomic: if any row
fails, the entire governance database rolls back to its pre-apply state.

### Step 3: Production Startup

```bash
cd agent-runtime
BAIZE_DB_PATH=<governance-db> \
BAIZE_SESSION_DIR=<session-dir> \
BAIZE_PORT=18789 \
BAIZE_OPERATORS="<token>=<actorRef>:<capability1>,<capability2>" \
npx tsx main.ts
```

Startup reconciliation completes before HTTP accepts traffic:
- `quick_check` and `foreign_key_check` must pass
- Outbox is drained (pending deliveries retried)

### Step 4: Post-Migration Gates

- **Workflow Doctor** — run `runtime.diagnose()` and verify all
  invariants pass (FK integrity, event sequence contiguity, no orphan
  claims, outbox clean for archived workflows).
- **Compose Smoke** — `docker compose run --rm test` must pass,
  exercising the production HTTP/Web contract.
- **Negative Scan** — `npx tsx --test negative-scan.test.ts` must prove
  all old routes, symbols, UI components, and tables are unreachable.

### Step 5: First New Business Write

The first new Requirement creation after cutover is the point of no
return.

- **Before first write**: rollback to the paired snapshot + old binary
  is permitted if any gate fails.
- **After first write**: rollback is **prohibited**. Failures stop new
  writes and are fixed forward.

## 24-Hour Guard Period

After the first new business write, the team actively monitors for
24 hours. Zero-tolerance invariants — if any triggers, stop new writes
immediately and fix forward:

- Incorrect archive state
- Subject/digest mismatch
- Event sequence gaps
- Receipt inconsistency
- Orphan claim
- Invalid effect publication
- Consistency error
- Missing current transcript
- Exhausted Outbox
- Migration discrepancy
- Reachable legacy write surface

## Rollback

Rollback is only available **before** the first new business write:

1. Stop the production main process.
2. Restore the paired snapshot (legacy DB + Session directory).
3. Restart with the old binary (if needed).

After the first new business write, rollback creates a mixed-history
system and is prohibited.
