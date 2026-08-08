import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type ArtifactRevisionStatus, type Store } from "./store.js";

const MAX_RESULT_CHARS = 12_000;
const MAX_FILES = 200;
const MAX_MATCHES = 100;
const MAX_FILE_BYTES = 256_000;
const IGNORED_NAMES = new Set([
	".git",
	".baize",
	".gitnexus",
	"node_modules",
	"dist",
	"build",
	"coverage",
	"out",
]);

export interface DomainToolContext {
	store: Store;
	requirementId: number;
	runId: number;
	workspaceId: number;
	repoPath: string;
}

function clip(value: unknown): unknown {
	const text = JSON.stringify(value ?? {});
	if (text.length <= MAX_RESULT_CHARS) return value;
	let preview = text.slice(0, MAX_RESULT_CHARS);
	let clipped = { truncated: true, preview };
	while (
		JSON.stringify(clipped).length > MAX_RESULT_CHARS &&
		preview.length > 0
	) {
		preview = preview.slice(0, -256);
		clipped = { truncated: true, preview };
	}
	return clipped;
}

function toolResult(
	value: unknown,
	isError = false,
): {
	content: Array<{ type: "text"; text: string }>;
	details: unknown;
	isError?: boolean;
} {
	const bounded = clip(value);
	return {
		content: [{ type: "text", text: JSON.stringify(bounded) }],
		details: bounded,
		...(isError ? { isError: true } : {}),
	};
}

async function audited<T>(
	context: DomainToolContext,
	name: string,
	input: unknown,
	work: () => Promise<T> | T,
) {
	const callId = context.store.startToolCall(context.runId, name, clip(input));
	try {
		const output = clip(await work());
		context.store.finishToolCall(callId, "completed", output);
		return toolResult(output);
	} catch (error) {
		const message = String((error as Error)?.message ?? error);
		const output = { error: message };
		context.store.finishToolCall(callId, "failed", output, message);
		return toolResult(output, true);
	}
}

function resolveRepoPath(repoPath: string, requested = "."): string {
	const root = resolve(repoPath);
	const target = resolve(root, requested);
	if (target !== root && !target.startsWith(`${root}${sep}`)) {
		throw new Error("path must stay inside the repository");
	}
	return target;
}

async function collectFiles(
	repoPath: string,
	requested = ".",
): Promise<string[]> {
	const root = resolve(repoPath);
	const start = resolveRepoPath(repoPath, requested);
	const files: string[] = [];
	async function visit(directory: string): Promise<void> {
		if (files.length >= MAX_FILES) return;
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((a, b) => a.name.localeCompare(b.name));
		for (const entry of entries) {
			if (files.length >= MAX_FILES || IGNORED_NAMES.has(entry.name)) continue;
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) await visit(absolute);
			else if (entry.isFile()) files.push(relative(root, absolute));
		}
	}

	const startStat = await lstat(start);
	if (startStat.isFile()) return [relative(root, start)];
	if (startStat.isDirectory()) await visit(start);
	return files.slice(0, MAX_FILES);
}

function parseArchitecture(snapshot: unknown): unknown {
	if (!snapshot || typeof snapshot !== "object") return snapshot;
	const row = snapshot as { architecture?: unknown };
	if (typeof row.architecture !== "string") return snapshot;
	try {
		return { ...row, architecture: JSON.parse(row.architecture) };
	} catch {
		return snapshot;
	}
}

function scoreText(query: string, text: string): number {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
	const haystack = text.toLowerCase();
	return terms.filter((term) => haystack.includes(term)).length;
}

function consistencyReport(context: DomainToolContext): {
	ok: boolean;
	issues: unknown[];
} {
	const issues: unknown[] = [];
	for (const artifact of context.store.listArtifacts(context.requirementId)) {
		const revisions = context.store.listArtifactRevisions(artifact.id);
		for (let index = 0; index < revisions.length; index += 1) {
			const revision = revisions[index];
			if (revision.revision_no !== index + 1) {
				issues.push({
					type: "revision_gap",
					artifactId: artifact.id,
					revisionId: revision.id,
				});
			}
			if (revision.fork_from_revision_id !== null) {
				const fork = context.store.getArtifactRevision(
					revision.fork_from_revision_id,
				);
				if (
					!fork ||
					fork.artifact_id !== artifact.id ||
					fork.revision_no >= revision.revision_no
				) {
					issues.push({
						type: "invalid_fork",
						artifactId: artifact.id,
						revisionId: revision.id,
					});
				}
			}
		}
	}
	for (const decision of context.store.listDecisions(context.requirementId)) {
		if (decision.selected_option_id !== null) {
			const option = context.store.getDecisionOption(
				decision.selected_option_id,
			);
			if (!option || option.decision_id !== decision.id) {
				issues.push({
					type: "invalid_decision_option",
					decisionId: decision.id,
				});
			}
		}
	}
	if (!context.store.getEvidenceSnapshot(context.requirementId)) {
		for (const link of context.store.listTraceLinks(context.requirementId)) {
			issues.push({ type: "missing_evidence_snapshot", traceLinkId: link.id });
		}
	}
	return { ok: issues.length === 0, issues };
}

export function createDomainTools(context: DomainToolContext) {
	const inspectRepository = defineTool({
		name: "inspect_repository",
		label: "Inspect Repository",
		description:
			"Inspect repository files through a bounded domain view; never execute shell commands.",
		parameters: Type.Object({
			path: Type.Optional(
				Type.String({ description: "Repository-relative directory" }),
			),
		}),
		execute: async (_id, params) =>
			audited(context, "inspect_repository", params, async () => {
				const files = await collectFiles(context.repoPath, params.path ?? ".");
				return {
					root: params.path ?? ".",
					files,
					truncated: files.length >= MAX_FILES,
				};
			}),
	});

	const searchCode = defineTool({
		name: "search_code",
		label: "Search Code",
		description:
			"Search literal code text inside the repository with bounded results; no raw grep is exposed.",
		parameters: Type.Object({
			query: Type.String({ minLength: 1 }),
			path: Type.Optional(Type.String()),
		}),
		execute: async (_id, params) =>
			audited(context, "search_code", params, async () => {
				const files = await collectFiles(context.repoPath, params.path ?? ".");
				const matches: Array<{ filePath: string; line: number; text: string }> =
					[];
				for (const filePath of files) {
					if (matches.length >= MAX_MATCHES) break;
					const absolute = join(context.repoPath, filePath);
					const fileStat = await lstat(absolute).catch(() => null);
					if (!fileStat || fileStat.size > MAX_FILE_BYTES) continue;
					const text = await readFile(absolute, "utf8").catch(() => "");
					for (const [index, line] of text.split("\n").entries()) {
						if (line.toLowerCase().includes(params.query.toLowerCase())) {
							matches.push({
								filePath,
								line: index + 1,
								text: line.slice(0, 500),
							});
							if (matches.length >= MAX_MATCHES) break;
						}
					}
				}
				return { matches, truncated: matches.length >= MAX_MATCHES };
			}),
	});

	const getArchitecture = defineTool({
		name: "get_architecture",
		label: "Get Architecture",
		description:
			"Read the requirement's persisted evidence snapshot and architecture facts.",
		parameters: Type.Object({}),
		execute: async (_id, params) =>
			audited(context, "get_architecture", params, () => ({
				snapshot: parseArchitecture(
					context.store.getEvidenceSnapshot(context.requirementId),
				),
			})),
	});

	const searchPriorDesigns = defineTool({
		name: "search_prior_designs",
		label: "Search Prior Designs",
		description:
			"Search archived design package snapshots from this workspace.",
		parameters: Type.Object({ query: Type.String({ minLength: 1 }) }),
		execute: async (_id, params) =>
			audited(context, "search_prior_designs", params, () => {
				const packages = context.store.listDesignPackages(
					context.workspaceId,
				) as Array<Record<string, unknown>>;
				return packages
					.map((item) => ({
						item,
						score: scoreText(params.query, JSON.stringify(item)),
					}))
					.filter((entry) => entry.score > 0)
					.sort((a, b) => b.score - a.score)
					.slice(0, 5);
			}),
	});

	const getArtifact = defineTool({
		name: "get_artifact",
		label: "Get Artifact",
		description: "Read immutable artifact revisions for this requirement.",
		parameters: Type.Object({ artifactId: Type.Optional(Type.Number()) }),
		execute: async (_id, params) =>
			audited(context, "get_artifact", params, () => {
				let artifacts;
				if (params.artifactId === undefined) {
					artifacts = context.store.listArtifacts(context.requirementId);
				} else {
					const artifact = context.store.getArtifact(params.artifactId);
					if (artifact && artifact.requirement_id !== context.requirementId) {
						throw new Error("artifact not found");
					}
					artifacts = artifact ? [artifact] : [];
				}
				return artifacts.map((artifact) => ({
					artifact,
					revisions: context.store.listArtifactRevisions(artifact.id),
				}));
			}),
	});

	const patchArtifact = defineTool({
		name: "patch_artifact",
		label: "Patch Artifact",
		description:
			"Create a new immutable artifact revision, optionally forking a specific prior revision.",
		parameters: Type.Object({
			artifactId: Type.Number(),
			content: Type.Any(),
			forkFromRevisionId: Type.Optional(Type.Number()),
			status: Type.Optional(
				Type.Union([
					Type.Literal("draft"),
					Type.Literal("pending"),
					Type.Literal("approved"),
					Type.Literal("rejected"),
				]),
			),
		}),
		execute: async (_id, params) =>
			audited(context, "patch_artifact", params, () => {
				const artifact = context.store.getArtifact(params.artifactId);
				if (!artifact || artifact.requirement_id !== context.requirementId)
					throw new Error("artifact not found");
				const latest = context.store
					.listArtifactRevisions(params.artifactId)
					.at(-1);
				const revision = context.store.createArtifactRevision(
					params.artifactId,
					context.runId,
					params.content,
					(params.status ?? "draft") as ArtifactRevisionStatus,
					params.forkFromRevisionId ?? latest?.id ?? null,
				);
				return { artifactId: params.artifactId, revision };
			}),
	});

	const raiseDecision = defineTool({
		name: "raise_decision",
		label: "Raise Decision",
		description:
			"Record a decision that requires explicit human or reviewer resolution.",
		parameters: Type.Object({
			title: Type.String({ minLength: 1 }),
			question: Type.String({ minLength: 1 }),
			severity: Type.Optional(Type.String()),
			options: Type.Optional(
				Type.Array(
					Type.Object({
						title: Type.String(),
						description: Type.Optional(Type.String()),
					}),
				),
			),
		}),
		execute: async (_id, params) =>
			audited(context, "raise_decision", params, () => {
				const decision = context.store.createDecision(
					context.requirementId,
					context.runId,
					params.title,
					params.question,
					params.severity ?? "major",
				);
				const options = (params.options ?? []).map((option) =>
					context.store.addDecisionOption(
						decision.id,
						option.title,
						option.description ?? "",
					),
				);
				return { decision, options };
			}),
	});

	const recordFinding = defineTool({
		name: "record_finding",
		label: "Record Finding",
		description:
			"Record a traceable design or repository finding for the current requirement.",
		parameters: Type.Object({
			severity: Type.String(),
			title: Type.String({ minLength: 1 }),
			content: Type.Any(),
		}),
		execute: async (_id, params) =>
			audited(context, "record_finding", params, () =>
				context.store.createFinding(
					context.requirementId,
					context.runId,
					params.severity,
					params.title,
					params.content,
				),
			),
	});

	const runConsistencyCheck = defineTool({
		name: "run_consistency_check",
		label: "Run Consistency Check",
		description:
			"Check artifact revision chains, decision selections, and evidence traceability.",
		parameters: Type.Object({}),
		execute: async (_id, params) =>
			audited(context, "run_consistency_check", params, () =>
				consistencyReport(context),
			),
	});

	const requestHumanInput = defineTool({
		name: "request_human_input",
		label: "Request Human Input",
		description:
			"Pause design progress by recording a blocking decision for a human response.",
		parameters: Type.Object({
			question: Type.String({ minLength: 1 }),
			reason: Type.Optional(Type.String()),
		}),
		execute: async (_id, params) =>
			audited(context, "request_human_input", params, () => {
				const decision = context.store.createDecision(
					context.requirementId,
					context.runId,
					"Human input required",
					params.question,
					"blocking",
				);
				return {
					status: "waiting_for_human",
					decisionId: decision.id,
					reason: params.reason ?? "",
				};
			}),
	});

	return [
		inspectRepository,
		searchCode,
		getArchitecture,
		searchPriorDesigns,
		getArtifact,
		patchArtifact,
		raiseDecision,
		recordFinding,
		runConsistencyCheck,
		requestHumanInput,
	];
}
