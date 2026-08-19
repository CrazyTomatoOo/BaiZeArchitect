/**
 * Single authoritative registry of the 19 Workflow command types.
 *
 * Consumers import from here instead of maintaining parallel literal lists:
 * the transport envelope guard (operator-server), the runtime envelope guard
 * (headless-runtime), the store state machine, and the contract catalog
 * drift test. COMMAND_TRANSITIONS / COMMAND_CAPABILITIES in the store stay
 * typed against this union, so a rename here is a compile error there.
 *
 * The command_receipts CHECK constraints in migrations 0002 (historical,
 * pre-rename names) and 0010 (current names) are intentionally NOT registry
 * consumers: migrations are append-only facts; the CHECK is rebuilt only
 * when a new command type forces a table rebuild.
 */
export const WORKFLOW_COMMAND_TYPES = [
	"start",
	"pause",
	"resume",
	"retry-recovery",
	"cancel-run",
	"dispose-decision",
	"steer",
	"retry-task",
	"retry-planning",
	"replace-plan",
	"diagnostic-run",
	"provide-human-input",
	"revise-requirement",
	"approve-artifact",
	"reject-artifact",
	"accept-finding-risk",
	"revoke-approval",
	"approve-packet",
	"reject-packet",
] as const;

export type WorkflowCommandType = (typeof WORKFLOW_COMMAND_TYPES)[number];