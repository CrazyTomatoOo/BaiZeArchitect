/**
 * 0014-model-roles.ts — Workflow row gains optional per-workflow model role assignment.
 */
export const MODEL_ROLES_MIGRATION = {
	version: 14,
	name: "model-roles",
	sql: `alter table workflows add column model_roles text;`,
	checksum: "model-roles-v1",
} as const;
