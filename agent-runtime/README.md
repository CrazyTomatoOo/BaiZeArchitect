# BaiZe Agent Runtime (pi-backed)

A thin HTTP adapter that implements BaiZe's `POST /runtime/plan` contract using
[pi](https://github.com/earendil-works/pi-coding-agent)'s SDK as the agent engine.
BaiZe's `httpRuntimeAdapter` calls `{AGENT_RUNTIME_URL}/runtime/plan`; this service
drives a real LLM agent (via Pi Core) over the evidence repo and returns the
structured plan JSON BaiZe expects — replacing `deterministicRuntimeAdapter`.

## Run

```bash
cd agent-runtime
npm install
# uses ~/.pi/agent/auth.json for LLM keys (or ANTHROPIC_API_KEY)
EVIDENCE_REPOSITORIES_ROOT=/Volumes/work/Project/BaiZeArchitect \
npm run dev   # tsx watch server.ts, listens on :8081
```

Point BaiZe at it:

```bash
cd platform-api
AGENT_RUNTIME_URL=http://127.0.0.1:8081 \
DATABASE_URL=... TEAM_TOKENS=... \
go run ./cmd/platform-api
```

Now `POST /api/v1/design-runs/:id/runtime-runs` calls this service instead of the
deterministic adapter.

## Env

| Var | Default | Purpose |
| ----- | --------- | --------- |
| `PORT` | `8081` | HTTP listen port |
| `EVIDENCE_REPOSITORIES_ROOT` | `cwd` | Root dir; repo checkout at `${ROOT}/${repositoryId}` |
| `RUNTIME_MODEL_PROVIDER` | `anthropic` | LLM provider |
| `RUNTIME_MODEL_ID` | `claude-sonnet-4-5` | LLM model id |

## Contract

Request (from BaiZe `httpRuntimeAdapter`):

```json
{"runId":"...","projectId":"...","requirementVersionId":"...","requirementContent":"...","repositoryId":"pilot-backend","branch":"main","commitSha":"3dc359fceb1f"}
```

Response must contain all of (or BaiZe errors `runtime adapter returned incomplete plan`):
`contextSummary`, `evidenceCandidates[]`, `requirementContent`, `architectureContent`,
`restApiContent`, `dataDesignContent`, `decisionTitle`, `findingTitle`.

## Design

- `createAgentSession({cwd: evidence repo, tools:["read","bash","grep"], systemPrompt, modelRuntime})`
- `session.prompt(structured prompt)` — LLM analyzes repo, emits JSON
- `extractJSON()` tolerates markdown fences + extracts `{...}`
- `session.dispose()` in `finally`

Note: BaiZe's `httpRuntimeAdapter` has a 10s client timeout (too short for real LLM);
the platform-api side needs that raised (see M2 plan 3.1).
