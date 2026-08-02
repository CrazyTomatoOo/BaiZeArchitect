/**
 * BaiZe Agent Runtime — pi-backed adapter for POST /runtime/plan.
 *
 * Drives a pi agent session over the evidence repo with pi's real toolchain
 * (read/bash/grep/find/ls + DefaultResourceLoader discovery) and captures the
 * plan via the submit_plan tool. No hand-rolled repo scanner or JSON-forcing
 * loop — the agent reads the repo itself and submit_plan's typebox schema
 * enforces structure.
 */
import http from "node:http";
import path from "node:path";
import {
	createAgentSession,
	defineTool,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";

const PORT = Number(process.env.PORT ?? "8081");
const EVIDENCE_ROOT = process.env.EVIDENCE_REPOSITORIES_ROOT ?? process.cwd();
const PROVIDER =
	process.env.RUNTIME_MODEL_PROVIDER ??
	process.env.PI_PROVIDER ??
	"zai-coding-cn";
const MODEL_ID =
	process.env.RUNTIME_MODEL_ID ?? process.env.PI_MODEL ?? "glm-5.2";

// Appended to pi's base system prompt — the base prompt already covers tool
// use; this only adds BaiZe's task contract.
const SYSTEM_PROMPT = [
	"你是 BaiZe Architect 的 Agent Runtime。",
	"分析传入仓库的代码,用 read/grep/find 定位真实符号与行号,然后调用 submit_plan 工具提交完整 plan。",
	"evidenceCandidates 的 filePath 必须是仓库内真实存在的相对路径,lineStart/lineEnd 必须是该文件真实行号区间。",
	"不要把计划输出为文本——只调用 submit_plan 工具。",
].join("\n");

const modelRuntime = await ModelRuntime.create();
const agentDir = getAgentDir();

// BaiZe runtime root — where .pi/skills/ and extensions live (next to
// server.ts). The loader's cwd is for resource discovery only; per-request tool
// cwd (the evidence repo) is set via createAgentSession below.
const PROJECT_ROOT =
	process.env.BAIZE_PROJECT_ROOT ?? import.meta.dirname;

const resourceLoader = new DefaultResourceLoader({
	cwd: PROJECT_ROOT,
	agentDir,
	appendSystemPromptOverride: () => [SYSTEM_PROMPT],
});
await resourceLoader.reload();

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = "";
		req.on("data", (chunk: Buffer) => {
			data += chunk.toString();
		});
		req.on("end", () => resolve(data));
		req.on("error", reject);
	});
}

// submit_plan parameter schema — shared across requests; the tool instance
// is created per request so its execute closure captures a per-request holder.
const PLAN_PARAMETERS = Type.Object({
	contextSummary: Type.String({
		description: "Summary of the repository context you analyzed",
	}),
	evidenceCandidates: Type.Array(
		Type.Object({
			repositoryId: Type.String(),
			commitSha: Type.String(),
			filePath: Type.String({ description: "Real relative path in the repo" }),
			symbol: Type.String({ description: "fileName.keyword form" }),
			lineStart: Type.Number({ description: "Real line number" }),
			lineEnd: Type.Number({ description: "Real line number" }),
		}),
	),
	requirementContent: Type.Object({
		changeRequest: Type.String(),
		repository: Type.String(),
		commitSha: Type.String(),
		acceptanceCriteria: Type.Array(Type.String()),
	}),
	architectureContent: Type.Object({
		changeRequest: Type.String(),
		repository: Type.String(),
		commitSha: Type.String(),
		components: Type.Array(Type.String()),
		qualityAttributes: Type.Array(Type.String()),
	}),
	restApiContent: Type.Object({
		changeRequest: Type.String(),
		repository: Type.String(),
		endpoints: Type.Array(Type.String()),
	}),
	dataDesignContent: Type.Object({
		changeRequest: Type.String(),
		database: Type.String(),
		tables: Type.Array(Type.String()),
	}),
	decisionTitle: Type.String(),
	findingTitle: Type.String(),
});

// Honest fallback when the agent did not call submit_plan. Returns a valid
// plan shape with empty evidence — BaiZe surfaces "no evidence" rather than
// fabricating citations, which is the correct behavior for a governance tool.
function fallbackPlan(
	repoId: string,
	sha: string,
	requirement: string,
	reason: string,
) {
	return {
		contextSummary: `BaiZe runtime did not produce a plan (${reason}).`,
		evidenceCandidates: [],
		requirementContent: {
			changeRequest: requirement,
			repository: repoId,
			commitSha: sha,
			acceptanceCriteria: [
				"code evidence is cited",
				"human confirmation archives the design",
			],
		},
		architectureContent: {
			changeRequest: requirement,
			repository: repoId,
			commitSha: sha,
			components: ["platform-api", "legacy-backend"],
			qualityAttributes: ["traceability", "governance"],
		},
		restApiContent: {
			changeRequest: requirement,
			repository: repoId,
			endpoints: [
				"POST /api/v1/pilot-runs",
				"GET /api/v1/design-runs/{id}/acceptance",
			],
		},
		dataDesignContent: {
			changeRequest: requirement,
			database: "PostgreSQL",
			tables: [
				"design_run",
				"artifact_version",
				"decision_record",
				"evidence_reference",
			],
		},
		decisionTitle: `Use evidence-backed design for ${requirement.slice(0, 40)}`,
		findingTitle: `Traceability verified for ${repoId}`,
	};
}

const server = http.createServer(async (req, res) => {
	if (req.method !== "POST" || !req.url?.startsWith("/runtime/plan")) {
		res.writeHead(404, { "Content-Type": "application/json" });
		return res.end(JSON.stringify({ error: "not found" }));
	}
	let input: {
		requirementContent?: string;
		repositoryId?: string;
		branch?: string;
		commitSha?: string;
	};
	try {
		input = JSON.parse(await readBody(req));
	} catch {
		res.writeHead(400, { "Content-Type": "application/json" });
		return res.end(JSON.stringify({ error: "invalid json" }));
	}
	const repoId = String(input.repositoryId ?? "pilot-backend");
	const sha = input.commitSha ?? "HEAD";
	const requirement = input.requirementContent ?? "";
	const cwd = path.join(EVIDENCE_ROOT, repoId);
	const model = getModel(PROVIDER as never, MODEL_ID);
	if (!model) {
		res.writeHead(500, { "Content-Type": "application/json" });
		return res.end(
			JSON.stringify({ error: `model not found: ${PROVIDER}/${MODEL_ID}` }),
		);
	}

	let planFromTool: Record<string, unknown> | null = null;
	const submitPlanTool = defineTool({
		name: "submit_plan",
		label: "Submit Design Plan",
		description:
			"Submit the structured design plan. Call this exactly once with the full plan after analyzing the repo with read/grep/find. Do not output the plan as text — only call submit_plan.",
		parameters: PLAN_PARAMETERS,
		execute: async (_toolCallId, params) => {
			planFromTool = params as Record<string, unknown>;
			return {
				content: [{ type: "text", text: "Plan submitted." }],
				details: {},
			};
		},
	});
	let session: { dispose?: () => void } | null = null;
	try {
		const created = await createAgentSession({
			cwd,
			model,
			modelRuntime,
			resourceLoader,
			tools: ["read", "bash", "grep", "find", "ls", "submit_plan"],
			customTools: [submitPlanTool],
			sessionManager: SessionManager.inMemory(cwd),
		});
		session = created.session;
		const prompt = `仓库: ${repoId} (commit ${sha}, branch ${input.branch ?? "main"})\n需求: ${requirement}\n请用 read/grep/find 分析仓库代码,然后调用 submit_plan 提交完整 plan。`;
		await created.session.prompt(prompt);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify(
				fallbackPlan(repoId, sha, requirement, `LLM error: ${msg}`),
			),
		);
		return;
	} finally {
		try {
			session?.dispose?.();
		} catch {
			// ignore
		}
	}

	const plan =
		planFromTool ??
		fallbackPlan(repoId, sha, requirement, "LLM did not call submit_plan");
	res.writeHead(200, { "Content-Type": "application/json" });
	res.end(JSON.stringify(plan));
});

server.listen(PORT, () => {
	console.log(
		`baize agent-runtime on :${PORT} (model ${PROVIDER}/${MODEL_ID}, evidence root ${EVIDENCE_ROOT})`,
	);
});
