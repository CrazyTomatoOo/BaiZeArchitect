# Confirmation Gate output samples

This is a throwaway prototype for the CLI output contract. It shows the exact
stdout JSON and stderr summary for each Confirmation Gate stage and resume
action. It is not a UI design.

## Shared fixture

All samples use:

```text
runId: run-prototype-001
requirement: Add dashboard sharing
```

## Scenario gate

### `status run-prototype-001`

Exit code: `0`

#### stdout

```json
{
  "runId": "run-prototype-001",
  "status": "awaiting_confirmation",
  "currentStage": "scenario",
  "stageLabel": "Scenario",
  "requirement": "Add dashboard sharing",
  "gateOpen": true,
  "resumeBlockedReason": null,
  "proposals": [
    {
      "kind": "related",
      "title": "View dashboard",
      "description": "Show an existing dashboard to its owner."
    },
    {
      "kind": "new",
      "title": "Share dashboard",
      "description": "Share a dashboard with a teammate."
    }
  ],
  "scenarioAssetCount": 0,
  "useCaseAssetCount": 0,
  "featureAssetCount": 0,
  "nextStageOnApprove": "use_case",
  "revisionStage": "scenario",
  "nextCommand": "npm start -- resume run-prototype-001 y",
  "commands": {
    "status": "npm start -- status run-prototype-001",
    "approve": "npm start -- resume run-prototype-001 y",
    "reject": "npm start -- resume run-prototype-001 n",
    "revise": "npm start -- resume run-prototype-001 revise -- \"<revision-feedback>\""
  }
}
```

#### stderr

```text
Requirement: Add dashboard sharing
Lifecycle status: awaiting_confirmation
Current stage: Scenario
Gate open: yes
Resume blocked: no
Progress: 0 scenarios, 0 use cases, 0 features confirmed

Proposals:
- [related] View dashboard: Show an existing dashboard to its owner.
- [new] Share dashboard: Share a dashboard with a teammate.

Approve will continue to: use_case
Revise will rerun: scenario

Commands:
  status:  npm start -- status run-prototype-001
  approve: npm start -- resume run-prototype-001 y
  reject:  npm start -- resume run-prototype-001 n
  revise:  npm start -- resume run-prototype-001 revise -- "<revision-feedback>"
```

### `resume run-prototype-001`

No-action resume returns exactly the same stdout JSON and stderr summary as
`status`, with exit code `0`. It does not mutate the run.

### `resume run-prototype-001 y`

Exit code: `0`

The scenario proposals are confirmed, the run advances to the use case gate,
and stdout becomes the use case Run Snapshot shown below.

## Use case gate

### `status run-prototype-001`

Exit code: `0`

#### stdout

```json
{
  "runId": "run-prototype-001",
  "status": "awaiting_confirmation",
  "currentStage": "use_case",
  "stageLabel": "Use case",
  "requirement": "Add dashboard sharing",
  "gateOpen": true,
  "resumeBlockedReason": null,
  "proposals": [
    {
      "kind": "related",
      "title": "View shared dashboard",
      "description": "Open a dashboard that a teammate shared.",
      "scenarioTitle": "View dashboard"
    },
    {
      "kind": "new",
      "title": "Share dashboard with teammate",
      "description": "Choose a teammate and share a dashboard with them.",
      "scenarioTitle": "Share dashboard"
    }
  ],
  "scenarioAssetCount": 2,
  "useCaseAssetCount": 0,
  "featureAssetCount": 0,
  "nextStageOnApprove": "feature",
  "revisionStage": "use_case",
  "nextCommand": "npm start -- resume run-prototype-001 y",
  "commands": {
    "status": "npm start -- status run-prototype-001",
    "approve": "npm start -- resume run-prototype-001 y",
    "reject": "npm start -- resume run-prototype-001 n",
    "revise": "npm start -- resume run-prototype-001 revise -- \"<revision-feedback>\""
  }
}
```

#### stderr

```text
Requirement: Add dashboard sharing
Lifecycle status: awaiting_confirmation
Current stage: Use case
Gate open: yes
Resume blocked: no
Progress: 2 scenarios, 0 use cases, 0 features confirmed

Proposals:
- [related] View shared dashboard: Open a dashboard that a teammate shared.
- [new] Share dashboard with teammate: Choose a teammate and share a dashboard with them.

Approve will continue to: feature
Revise will rerun: use_case

Commands:
  status:  npm start -- status run-prototype-001
  approve: npm start -- resume run-prototype-001 y
  reject:  npm start -- resume run-prototype-001 n
  revise:  npm start -- resume run-prototype-001 revise -- "<revision-feedback>"
```

### `resume run-prototype-001 revise -- "Focus on one teammate."`

Exit code: `0`

The current use case proposals are rejected, the use case stage reruns with
the feedback, and the run returns to the same use case gate. The revised
Run Snapshot keeps:

```json
{
  "status": "awaiting_confirmation",
  "currentStage": "use_case",
  "revisionStage": "use_case",
  "nextStageOnApprove": "feature"
}
```

The revised proposal descriptions reflect the requested feedback.

## Feature gate

### `status run-prototype-001`

Exit code: `0`

#### stdout

```json
{
  "runId": "run-prototype-001",
  "status": "awaiting_confirmation",
  "currentStage": "feature",
  "stageLabel": "Feature",
  "requirement": "Add dashboard sharing",
  "gateOpen": true,
  "resumeBlockedReason": null,
  "proposals": [
    {
      "kind": "affected",
      "title": "Sharing permissions",
      "description": "Update permission checks for shared dashboards.",
      "useCaseTitle": "Share dashboard with teammate"
    },
    {
      "kind": "new",
      "title": "Share dashboard action",
      "description": "Add the share action to the dashboard toolbar.",
      "useCaseTitle": "Share dashboard with teammate"
    }
  ],
  "scenarioAssetCount": 2,
  "useCaseAssetCount": 2,
  "featureAssetCount": 0,
  "nextStageOnApprove": null,
  "revisionStage": "feature",
  "nextCommand": "npm start -- resume run-prototype-001 y",
  "commands": {
    "status": "npm start -- status run-prototype-001",
    "approve": "npm start -- resume run-prototype-001 y",
    "reject": "npm start -- resume run-prototype-001 n",
    "revise": "npm start -- resume run-prototype-001 revise -- \"<revision-feedback>\""
  }
}
```

#### stderr

```text
Requirement: Add dashboard sharing
Lifecycle status: awaiting_confirmation
Current stage: Feature
Gate open: yes
Resume blocked: no
Progress: 2 scenarios, 2 use cases, 0 features confirmed

Proposals:
- [affected] Sharing permissions: Update permission checks for shared dashboards.
- [new] Share dashboard action: Add the share action to the dashboard toolbar.

Approve will continue to: complete the run
Revise will rerun: feature

Commands:
  status:  npm start -- status run-prototype-001
  approve: npm start -- resume run-prototype-001 y
  reject:  npm start -- resume run-prototype-001 n
  revise:  npm start -- resume run-prototype-001 revise -- "<revision-feedback>"
```

## Terminal run

### `status run-prototype-001` after feature rejection

Exit code: `0`

#### stdout

```json
{
  "runId": "run-prototype-001",
  "status": "rejected",
  "currentStage": "feature",
  "stageLabel": "Feature",
  "requirement": "Add dashboard sharing",
  "gateOpen": false,
  "resumeBlockedReason": "run_is_terminal",
  "proposals": [],
  "scenarioAssetCount": 2,
  "useCaseAssetCount": 2,
  "featureAssetCount": 0,
  "nextStageOnApprove": null,
  "revisionStage": null,
  "nextCommand": null,
  "commands": {
    "status": "npm start -- status run-prototype-001",
    "approve": null,
    "reject": null,
    "revise": null
  }
}
```

#### stderr

```text
Requirement: Add dashboard sharing
Lifecycle status: rejected
Current stage: Feature
Gate open: no
Resume blocked: run_is_terminal
Progress: 2 scenarios, 2 use cases, 0 features confirmed

No Confirmation Gate is open.
Status command: npm start -- status run-prototype-001
```

### `resume run-prototype-001 y` after feature rejection

Exit code: `2`

No stdout JSON is emitted. stderr contains:

```text
Analysis run is not awaiting confirmation (status: rejected)
```

## Running run

### `status run-prototype-001`

Exit code: `0`

The Run Snapshot uses:

```json
{
  "status": "running",
  "gateOpen": false,
  "resumeBlockedReason": "run_is_running",
  "proposals": [],
  "commands": {
    "status": "npm start -- status run-prototype-001",
    "approve": null,
    "reject": null,
    "revise": null
  }
}
```
