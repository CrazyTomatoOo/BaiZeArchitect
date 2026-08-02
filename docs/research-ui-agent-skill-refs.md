# BaiZeArchitect research: UI / agent / skill references

## 1) OpenClaw

**What it is.** OpenClaw is a self-hosted personal AI assistant with a Gateway control plane, channel integrations, companion apps, and a browser Control UI for operating sessions, nodes, skills, and config ([repo](https://github.com/openclaw/openclaw), [site](https://openclaw.ai), [docs](https://docs.openclaw.ai)).

**Primary sources.**
- [Repository README](https://github.com/openclaw/openclaw/blob/c5bc6c3d2dd22acb3f982c7849207bb5851d9226/README.md)
- [Control UI docs](https://docs.openclaw.ai/web/control-ui)
- [Gateway architecture docs](https://docs.openclaw.ai/concepts/architecture)

**What BaiZeArchitect can borrow.**
- A **control-plane-first** architecture: one long-lived gateway owns the runtime, while browser/CLI/mobile clients are just views into it ([Gateway architecture](https://docs.openclaw.ai/concepts/architecture)).
- A **sidebar-centered operator UI** with agent identity, pages, sessions, tasks, plugins, skills, and settings all scoped to the active agent ([Control UI docs](https://docs.openclaw.ai/web/control-ui)).
- **Browser-local UI state** for preferences like theme/language, while auth-sensitive data stays on the gateway ([Control UI docs](https://docs.openclaw.ai/web/control-ui)).
- A **live agent operations dashboard** that mixes chat, sessions, cron, approvals, logs, and config in one surface ([Control UI docs](https://docs.openclaw.ai/web/control-ui)).

**Concrete evidence.**
- Visual proof: the README embeds the product banner as an image (`docs/assets/openclaw-banner-*.png`) and shows a top-level assistant identity right away ([README](https://github.com/openclaw/openclaw/blob/c5bc6c3d2dd22acb3f982c7849207bb5851d9226/README.md)).
- Setup / operator commands: `openclaw onboard --install-daemon`, `openclaw gateway --port 18789 --verbose`, `openclaw agent --message "Ship checklist" --thinking high` ([README](https://github.com/openclaw/openclaw/blob/c5bc6c3d2dd22acb3f982c7849207bb5851d9226/README.md)).
- UI implementation: the Control UI is a “small Vite + Lit single-page app” served by the Gateway and speaking directly to the Gateway WebSocket on the same port ([Control UI docs](https://docs.openclaw.ai/web/control-ui)).
- Architecture: the Gateway owns channels, nodes, sessions, and the canvas host; WebChat is a static UI over the Gateway WS API ([Gateway architecture](https://docs.openclaw.ai/concepts/architecture)).

## 2) HermesAgent

**What it is.** Hermes Agent is a self-improving AI agent with a CLI, messaging gateway, web dashboard, skills, memory, cron, and a multi-profile control surface ([repo](https://github.com/NousResearch/hermes-agent), [docs](https://hermes-agent.nousresearch.com/docs/)).

**Primary sources.**
- [Repository README](https://github.com/NousResearch/hermes-agent/blob/b61c033c0bbed79e7f5ae2f44cdbff30ade6ee87/README.md)
- [Web Dashboard docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard)
- [Architecture docs](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture)

**What BaiZeArchitect can borrow.**
- A **machine-level admin dashboard** with a profile switcher, so the UI clearly distinguishes “machine control” from “current profile” ([Web Dashboard docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard)).
- A **browser TUI bridge** (PTY + xterm.js) so a web UI can expose the exact same terminal experience rather than a separate imitation ([Web Dashboard docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard)).
- A **schema-driven config editor** and REST API for sessions, skills, MCP, cron, env, and system ops ([Web Dashboard docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard)).
- A clean split between **CLI, gateway, dashboard, and backend internals** ([Architecture docs](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture)).

**Concrete evidence.**
- CLI surface: `hermes`, `hermes model`, `hermes tools`, `hermes gateway`, `hermes setup`, `hermes update`, `hermes doctor` ([README](https://github.com/NousResearch/hermes-agent/blob/b61c033c0bbed79e7f5ae2f44cdbff30ade6ee87/README.md)).
- Dashboard start command: `hermes dashboard` opens `http://127.0.0.1:9119` and runs locally by default ([Web Dashboard docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard)).
- Remote/auth example: the dashboard uses `dashboard.oauth.client_id: agent:...` / `HERMES_DASHBOARD_OAUTH_CLIENT_ID` and fails closed on non-loopback binds without a provider ([Web Dashboard docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard)).
- Config schema: the dashboard exposes `/api/config/schema` to render every config field with type/category/options ([Web Dashboard docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard)).
- Architecture: `AIAgent` is the core loop; session storage is SQLite + FTS5; tool registry is import-time self-registration; gateway handles 20 platform adapters ([Architecture docs](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture)).

## 3) agency-agents

**What it is.** agency-agents is a large curated catalog of specialist agent personas, each shipped as a markdown file and installable into multiple coding tools ([repo](https://github.com/msitarzewski/agency-agents), [app](https://agencyagents.app)).

**Primary sources.**
- [Repository README](https://github.com/msitarzewski/agency-agents/blob/459dce837db3bdfdc4763d3fefd1fd854e73c8f1/README.md)
- [Agents Orchestrator skill](https://github.com/msitarzewski/agency-agents/blob/459dce837db3bdfdc4763d3fefd1fd854e73c8f1/engineering/engineering-multi-agent-systems-architect.md)

**What BaiZeArchitect can borrow.**
- A **role catalog** organized by domain and specialty, not one giant agent prompt blob ([README](https://github.com/msitarzewski/agency-agents/blob/459dce837db3bdfdc4763d3fefd1fd854e73c8f1/README.md)).
- **Conversion/install scripts** so the same role definitions can be installed into different agent runtimes ([README](https://github.com/msitarzewski/agency-agents/blob/459dce837db3bdfdc4763d3fefd1fd854e73c8f1/README.md)).
- A dedicated **orchestrator role** separate from specialist roles ([Agents Orchestrator](https://github.com/msitarzewski/agency-agents/blob/459dce837db3bdfdc4763d3fefd1fd854e73c8f1/engineering/engineering-multi-agent-systems-architect.md)).
- Per-agent **metadata frontmatter** (`name`, `description`, `color`, `emoji`, `vibe`) that makes skills machine-readable and human-scannable ([Agents Orchestrator](https://github.com/msitarzewski/agency-agents/blob/459dce837db3bdfdc4763d3fefd1fd854e73c8f1/engineering/engineering-multi-agent-systems-architect.md)).

**Concrete evidence.**
- Install/conversion commands: `./scripts/convert.sh`, `./scripts/install.sh --tool opencode`, `./scripts/install.sh --tool openclaw`, `./scripts/install.sh --tool codex` ([README](https://github.com/msitarzewski/agency-agents/blob/459dce837db3bdfdc4763d3fefd1fd854e73c8f1/README.md)).
- Multi-tool targeting: the README explicitly supports Claude Code, Cursor, OpenCode, OpenClaw, Codex, etc. ([README](https://github.com/msitarzewski/agency-agents/blob/459dce837db3bdfdc4763d3fefd1fd854e73c8f1/README.md)).
- Orchestrator identity block: `name: Agents Orchestrator`, `description: Autonomous pipeline manager...`, `emoji: 🎛️`, `color: cyan`, `vibe: The conductor...` ([skill file](https://github.com/msitarzewski/agency-agents/blob/459dce837db3bdfdc4763d3fefd1fd854e73c8f1/engineering/engineering-multi-agent-systems-architect.md)).
- Orchestrator workflow: Phase 1 planning, Phase 2 technical architecture, Phase 3 Dev-QA loop, Phase 4 final integration ([skill file](https://github.com/msitarzewski/agency-agents/blob/459dce837db3bdfdc4763d3fefd1fd854e73c8f1/engineering/engineering-multi-agent-systems-architect.md)).

## 4) Matt Pocock skills

**What it is.** mattpocock/skills is a repo of small, composable engineering skills with a strict setup skill, a split between user-invoked and model-invoked skills, and a repo-level doc scaffold ([repo](https://github.com/mattpocock/skills), [site](https://skills.sh/mattpocock/skills)).

**Primary sources.**
- [README](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/README.md)
- [setup-matt-pocock-skills](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/setup-matt-pocock-skills/SKILL.md)
- [grill-me](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/productivity/grill-me/SKILL.md)

**What BaiZeArchitect can borrow.**
- A **tiny skill-per-job structure** instead of mega-prompts ([README](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/README.md)).
- A **setup skill** that configures issue tracker, triage labels, and domain docs before the rest of the skills are used ([setup skill](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/setup-matt-pocock-skills/SKILL.md)).
- A **user-invoked / model-invoked split** so orchestration skills and reusable discipline skills don’t blur together ([README](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/README.md)).
- Clear repo-local conventions for **where docs live** and which files skills should read/write ([setup skill](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/setup-matt-pocock-skills/SKILL.md)).

**Concrete evidence.**
- Quickstart command: `npx skills@latest add mattpocock/skills` followed by `/setup-matt-pocock-skills` ([README](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/README.md)).
- `setup-matt-pocock-skills` asks for issue tracker, triage labels, and docs location, then writes `docs/agents/issue-tracker.md`, `docs/agents/domain.md`, and optionally `docs/agents/triage-labels.md` ([setup skill](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/setup-matt-pocock-skills/SKILL.md)).
- `grill-me` is intentionally minimal and just dispatches to `/grilling` ([grill-me](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/productivity/grill-me/SKILL.md)).
- README taxonomy: engineering / productivity, with user-invoked skills like `to-spec`, `implement`, `wayfinder`, and model-invoked skills like `tdd`, `domain-modeling`, `code-review` ([README](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/README.md)).

## 5) superpowers

**What it is.** Superpowers is an agentic software-development methodology plus skill set that pushes a deliberate workflow: understand the task, draft design, plan, use worktrees, TDD, subagent execution, review, and finish the branch ([repo](https://github.com/obra/superpowers)).

**Primary sources.**
- [README](https://github.com/obra/superpowers/blob/d884ae04edebef577e82ff7c4e143debd0bbec99/README.md)
- [using-superpowers skill](https://github.com/obra/superpowers/blob/d884ae04edebef577e82ff7c4e143debd0bbec99/skills/using-superpowers/SKILL.md)

**What BaiZeArchitect can borrow.**
- A **process stack**: brainstorming → worktrees → plans → subagent-driven development → TDD → code review → finish branch ([README](https://github.com/obra/superpowers/blob/d884ae04edebef577e82ff7c4e143debd0bbec99/README.md)).
- A **mandatory skill bootstrap**: the agent should invoke relevant skills before responding ([using-superpowers](https://github.com/obra/superpowers/blob/d884ae04edebef577e82ff7c4e143debd0bbec99/skills/using-superpowers/SKILL.md)).
- An explicit emphasis on **evidence over claims** and **small, deliberate steps** ([README](https://github.com/obra/superpowers/blob/d884ae04edebef577e82ff7c4e143debd0bbec99/README.md)).
- A skill library grouped by function: testing, debugging, collaboration, meta ([README](https://github.com/obra/superpowers/blob/d884ae04edebef577e82ff7c4e143debd0bbec99/README.md)).

**Concrete evidence.**
- Install paths: Claude Code plugin marketplace, Codex plugin marketplace, Cursor, OpenCode, Pi, etc. ([README](https://github.com/obra/superpowers/blob/d884ae04edebef577e82ff7c4e143debd0bbec99/README.md)).
- Basic workflow list: `brainstorming`, `using-git-worktrees`, `writing-plans`, `subagent-driven-development`, `test-driven-development`, `requesting-code-review`, `finishing-a-development-branch` ([README](https://github.com/obra/superpowers/blob/d884ae04edebef577e82ff7c4e143debd0bbec99/README.md)).
- `using-superpowers` frontmatter: `description: Use when starting any conversation - establishes how to find and use skills, requiring skill invocation before ANY response` ([skill](https://github.com/obra/superpowers/blob/d884ae04edebef577e82ff7c4e143debd0bbec99/skills/using-superpowers/SKILL.md)).
- `using-superpowers` insists: invoke relevant skills **before** any response or action ([skill](https://github.com/obra/superpowers/blob/d884ae04edebef577e82ff7c4e143debd0bbec99/skills/using-superpowers/SKILL.md)).

## 6) OpenSpec

**What it is.** OpenSpec is a lightweight spec-driven workflow system: terminal CLI plus AI-chat slash commands, with change folders, delta specs, and artifact-driven planning ([repo](https://github.com/Fission-AI/OpenSpec), [site](https://openspec.dev)).

**Primary sources.**
- [README](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/README.md)
- [How Commands Work](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/docs/how-commands-work.md)
- [OPSX workflow](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/docs/opsx.md)
- [Core concepts](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/docs/overview.md)
- [Workflows](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/docs/workflows.md)

**What BaiZeArchitect can borrow.**
- A **change folder** model: proposal, specs, design, tasks, and archive all live together ([README](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/README.md), [core concepts](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/docs/overview.md)).
- **Delta specs** instead of rewriting the world: ADDED / MODIFIED / REMOVED requirements ([core concepts](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/docs/overview.md)).
- A split between **terminal commands** (`openspec ...`) and **chat commands** (`/opsx:...`) ([How Commands Work](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/docs/how-commands-work.md)).
- A **fluid workflow** where actions are enablers, not gates ([OPSX workflow](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/docs/opsx.md)).
- Schema-driven customization for alternate artifact DAGs ([OPSX workflow](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/docs/opsx.md)).

**Concrete evidence.**
- README example: `/opsx:explore` → `/opsx:propose` → `proposal.md / specs / design.md / tasks.md` → `/opsx:apply` → `/opsx:archive` ([README](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/README.md)).
- Terminal/chat split: `openspec init` runs in terminal; `/opsx:propose` runs in chat ([How Commands Work](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/docs/how-commands-work.md)).
- Core config example: `openspec/config.yaml` with `schema: spec-driven`, `context`, and per-artifact `rules` ([OPSX workflow](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/docs/opsx.md)).
- Direct artifact DAG: `proposal ──► specs ──► design ──► tasks ──► implement` ([core concepts](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/docs/overview.md)).
- Expanded commands: `/opsx:new`, `/opsx:continue`, `/opsx:ff`, `/opsx:verify`, `/opsx:bulk-archive`, `/opsx:onboard` ([workflows](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/docs/workflows.md)).

## Synthesis for BaiZeArchitect

1. **Make the control plane explicit.** OpenClaw and Hermes both separate a long-lived backend from browser/CLI clients; BaiZeArchitect should make the “authority” layer obvious and keep the UI as a live view over it ([OpenClaw architecture](https://docs.openclaw.ai/concepts/architecture), [Hermes architecture](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture)).
2. **Use agent-scoped UI state.** Hermes’ profile switcher and OpenClaw’s active-agent sidebar both show that the dashboard should always reveal which agent/context is active ([Hermes dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard), [OpenClaw Control UI](https://docs.openclaw.ai/web/control-ui)).
3. **Adopt artifact-driven work.** OpenSpec’s change folders + delta specs are the cleanest pattern for evidence-backed architecture design runs; don’t bury decisions only in chat ([OpenSpec overview](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/docs/overview.md)).
4. **Keep skills small and typed by role.** Matt Pocock’s skills and agency-agents both argue for short, composable, role-specific files with explicit metadata and install paths ([Matt skills README](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/README.md), [agency-agents README](https://github.com/msitarzewski/agency-agents/blob/459dce837db3bdfdc4763d3fefd1fd854e73c8f1/README.md)).
5. **Build a strong workflow ladder, but keep the gates light.** Superpowers likes explicit process stages; OpenSpec explicitly rejects rigid phases. BaiZeArchitect should keep the checklist discipline, but make it easy to go back and revise artifacts ([Superpowers README](https://github.com/obra/superpowers/blob/d884ae04edebef577e82ff7c4e143debd0bbec99/README.md), [OpenSpec OPSX](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/docs/opsx.md)).

**Contradictions / tensions.**
- **Rigid stages vs fluid actions.** Superpowers encourages a staged pipeline; OpenSpec says workflow should be fluid and non-phase-locked. For BaiZeArchitect, prefer OpenSpec’s flexibility but borrow Superpowers’ quality gates ([Superpowers README](https://github.com/obra/superpowers/blob/d884ae04edebef577e82ff7c4e143debd0bbec99/README.md), [OpenSpec OPSX](https://github.com/Fission-AI/OpenSpec/blob/596d6ba7f41160da9ab99cf4b891353baeb7eeb0/docs/opsx.md)).
- **Local-first vs gated remote admin.** OpenClaw’s Control UI defaults to localhost; Hermes fails closed on remote binds unless auth is configured. For BaiZeArchitect, remote dashboards should default to auth-gated, local dashboards should stay frictionless ([OpenClaw Control UI](https://docs.openclaw.ai/web/control-ui), [Hermes web dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard)).
- **Catalog vs methodology.** agency-agents is a role catalog; Superpowers is a workflow system. BaiZeArchitect should keep role definitions separate from the operating methodology so they can evolve independently ([agency-agents README](https://github.com/msitarzewski/agency-agents/blob/459dce837db3bdfdc4763d3fefd1fd854e73c8f1/README.md), [Superpowers README](https://github.com/obra/superpowers/blob/d884ae04edebef577e82ff7c4e143debd0bbec99/README.md)).
