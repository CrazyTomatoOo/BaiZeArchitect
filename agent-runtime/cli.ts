/**
 * BaiZe Architect — 单进程本地 agent 入口。
 *
 * 收敛自原 server.ts(http)。砍掉 Go platform-api 那层 rpcRuntimeAdapter,
 * 直接 createAgentSession + submit_plan holder + .md 归档。
 * pi harness + .pi/skills(6 角色) + codebase-memory-mcp(后接证据层)。
 *
 * ponytail: 单 phase 先跑通管线。多 phase(analyst/architect/critic 分 session
 * + 状态传递)等最小闭环在 docker 验证后再拆——现在拆是 speculative structure。
 */
import path from "node:path";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import {
	createAgentSession,
	defineTool,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createProvider, envApiKeyAuth, lazyApi, type Api, type Model } from "@earendil-works/pi-ai";
import { Type } from "typebox";

// ponytail: PROJECT_ROOT 指向项目根(.pi/skills 所在),不是 agent-runtime 目录。
// resourceLoader.cwd 用它发现 skills;createAgentSession.cwd 用目标仓库——两者分离。
const PROJECT_ROOT =
	process.env.BAIZE_PROJECT_ROOT ?? path.resolve(import.meta.dirname, "..");
const PROVIDER =
	process.env.RUNTIME_MODEL_PROVIDER ??
	process.env.PI_PROVIDER ??
	"zai-coding-cn";
const MODEL_ID = process.env.RUNTIME_MODEL_ID ?? process.env.PI_MODEL ?? "glm-5.2";
const OUT_DIR = process.env.BAIZE_OUT_DIR ?? path.join(PROJECT_ROOT, "out");

const SYSTEM_PROMPT = [
	"你是 BaiZe Architect 的设计 agent。",
	"参考 .pi/skills 下各角色(orchestrator/analyst/architect/critic/reviewer)的职责契约。",
	"用 read/grep/find 定位仓库真实符号与行号,然后调用 submit_plan 提交完整设计 plan。",
	"evidenceCandidates 的 filePath 必须是仓库内真实存在的相对路径,lineStart/lineEnd 必须是该文件真实行号区间——禁止编造证据。",
	"不要把 plan 输出为文本,只调用 submit_plan 工具。",
].join("\n");

// submit_plan schema — 与 .pi/extensions/baize-plan.ts 保持一致,收敛后由单进程
// 的 customTools 持有,不再走 pi --mode rpc 的 extension 注册路径。
const evidenceCandidate = Type.Object({
	repositoryId: Type.String(),
	commitSha: Type.String(),
	filePath: Type.String({ description: "仓库内真实相对路径" }),
	symbol: Type.String({ description: "fileName.keyword 形式" }),
	lineStart: Type.Number({ description: "真实行号" }),
	lineEnd: Type.Number({ description: "真实行号" }),
});

const PLAN_PARAMETERS = Type.Object({
	contextSummary: Type.String({ description: "仓库上下文摘要" }),
	evidenceCandidates: Type.Array(evidenceCandidate, {
		description: "真实代码证据(真实路径+行号)",
	}),
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

type Plan = Record<string, unknown>;

function fallbackPlan(repoId: string, sha: string, requirement: string, reason: string): Plan {
	return {
		contextSummary: `BaiZe runtime 未产出 plan(${reason})。`,
		evidenceCandidates: [],
		requirementContent: {
			changeRequest: requirement,
			repository: repoId,
			commitSha: sha,
			acceptanceCriteria: ["代码证据被引用", "人工确认归档设计"],
		},
		architectureContent: {
			changeRequest: requirement,
			repository: repoId,
			commitSha: sha,
			components: [],
			qualityAttributes: ["traceability", "governance"],
		},
		restApiContent: { changeRequest: requirement, repository: repoId, endpoints: [] },
		dataDesignContent: { changeRequest: requirement, database: "", tables: [] },
		decisionTitle: `Use evidence-backed design for ${requirement.slice(0, 40)}`,
		findingTitle: `Traceability for ${repoId}`,
	};
}

const modelRuntime = await ModelRuntime.create();
const agentDir = getAgentDir();
const resourceLoader = new DefaultResourceLoader({
	cwd: PROJECT_ROOT,
	agentDir,
	appendSystemPromptOverride: () => [SYSTEM_PROMPT],
});
// ponytail: 容器隔离环境自动 trust project,加载 project-local extension(bailian provider)。
// 本地 pi 不用此——本地走交互 trust;容器无交互,强制 trusted。
await resourceLoader.reload({ resolveProjectTrust: async () => true });
// ponytail: 内联 bailian provider(registerNativeProvider)绕过 extension registerProvider
// 写到不可查 catalog 的问题。bailian extension 仍在(无害),provider 由此处直接注册进 modelRuntime。
const BAILIAN_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const bailianModels: readonly Model<Api>[] = [
	{
		id: "glm-5.2", name: "GLM-5.2", api: "openai-completions", baseUrl: BAILIAN_BASE,
		provider: "bailian", reasoning: true, input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1048576, maxTokens: 16384,
		thinkingLevelMap: { low: "high", medium: "high", high: "high", xhigh: "max", max: "max" },
		compat: { supportsDeveloperRole: false, supportsReasoningEffort: true },
	},
];
const bailianProvider = createProvider({
	id: "bailian", name: "阿里云百炼 (DashScope)", baseUrl: BAILIAN_BASE,
	auth: { apiKey: envApiKeyAuth("阿里云百炼 API key", ["DASHSCOPE_API_KEY"]) },
	models: bailianModels,
	api: lazyApi(() =>
		import("./node_modules/@earendil-works/pi-ai/dist/api/openai-completions.lazy.js").then(
			(m) => m.openAICompletionsApi(),
		),
	),
});
(modelRuntime as { registerNativeProvider(p: unknown): void }).registerNativeProvider(bailianProvider);
interface RunInput {
	requirement: string;
	repoPath: string; // 绝对路径
	repoId: string;
	commitSha?: string;
}

async function runDesign(input: RunInput): Promise<{ plan: Plan; critique: unknown }> {
	const model = modelRuntime.getModel(PROVIDER, MODEL_ID);
	if (!model) throw new Error(`model not found: ${PROVIDER}/${MODEL_ID}`);

	let planFromTool: Plan | null = null;
	const submitPlanTool = defineTool({
		name: "submit_plan",
		label: "Submit Design Plan",
		description:
			"提交结构化设计 plan。分析仓库后调用一次,不要把 plan 输出为文本。",
		parameters: PLAN_PARAMETERS,
		execute: async (_id, params) => {
			planFromTool = params as Plan;
			return { content: [{ type: "text", text: "Plan submitted." }], details: {} };
		},
	});

	const sha = input.commitSha ?? "HEAD";
	const { session } = await createAgentSession({
		cwd: input.repoPath,
		model,
		modelRuntime,
		resourceLoader,
		tools: ["read", "bash", "grep", "find", "ls", "submit_plan"],
		customTools: [submitPlanTool],
		sessionManager: SessionManager.inMemory(input.repoPath),
	});
	try {
		const prompt = [
			`仓库: ${input.repoId} (commit ${sha})`,
			`需求: ${input.requirement}`,
			"请用 read/grep/find 分析仓库代码,参考 .pi/skills 各角色职责,然后调用 submit_plan 提交完整 plan。",
		].join("\n");
		await session.prompt(prompt);
	} finally {
		try {
			await session.dispose?.();
		} catch {
			/* ignore */
		}
	}
	// phase 2: critic 独立 challenge architect 的 plan(多 phase 核心价值:
	// critic 不在同一 session 被 architect 输出锈定,独立复核风险/遗漏/矛盾)
	let critique: unknown = null;
	const recordCritiqueTool = defineTool({
		name: "record_critique",
		label: "Record Critique",
		description: "提交对架构方案的独立评审发现(风险/遗漏/矛盾),含严重度与置信度。",
		parameters: Type.Object({
			findings: Type.Array(Type.Object({
				issue: Type.String(),
				severity: Type.String({ description: "high|medium|low" }),
				confidence: Type.String({ description: "high|medium|low" }),
				suggestion: Type.String(),
			})),
			overall: Type.String({ description: "总体评审意见" }),
		}),
		execute: async (_id, p) => {
			critique = p;
			return { content: [{ type: "text", text: "Critique recorded." }], details: {} };
		},
	});
	const plan = planFromTool ?? fallbackPlan(input.repoId, sha, input.requirement, "LLM 未调用 submit_plan");
	const { session: criticSession } = await createAgentSession({
		cwd: input.repoPath,
		model,
		modelRuntime,
		resourceLoader,
		tools: ["read", "bash", "grep", "find", "ls", "record_critique"],
		customTools: [recordCritiqueTool],
		sessionManager: SessionManager.inMemory(input.repoPath),
	});
	try {
		await criticSession.prompt([
			"角色: critic(设计评审)。参考 .pi/skills/critic 职责。",
			`仓库: ${input.repoId} (commit ${sha})`,
			`架构方案(architect 产出):\n${JSON.stringify(plan, null, 2)}`,
			"请独立评审:需求覆盖完整性、证据充分性、风险/遗漏/矛盾。用 read/grep 复核证据真实后,调用 record_critique 提交发现。",
		].join("\n"));
	} finally {
		try {
			await criticSession.dispose?.();
		} catch {
			/* ignore */
		}
	}
	return { plan, critique };
}

// ponytail: 最简 markdown 归档,不引模板引擎。git 版本由调用方(caller)或后续 archive.ts 接。
function planToMarkdown(plan: Plan, critique?: unknown): string {
	const ev = (plan.evidenceCandidates as Array<Record<string, unknown>>) ?? [];
	const req = plan.requirementContent as Record<string, unknown>;
	const arch = plan.architectureContent as Record<string, unknown>;
	const api = plan.restApiContent as Record<string, unknown>;
	const data = plan.dataDesignContent as Record<string, unknown>;
	const cfinds = ((critique as { findings?: Array<{ issue: string; severity: string; confidence: string; suggestion: string }> })?.findings) ?? [];
	const coverall = (critique as { overall?: string })?.overall ?? "";
	const lines: string[] = [
		`# ${String(plan.decisionTitle ?? "Design Decision")}`,
		"",
		`> ${String(plan.findingTitle ?? "")}`,
		"",
		"## 上下文",
		String(plan.contextSummary ?? ""),
		"",
		"## 需求",
		`- 变更请求: ${req.changeRequest ?? ""}`,
		`- 仓库: ${req.repository ?? ""} @ ${req.commitSha ?? ""}`,
		"### 验收条件",
		...((req.acceptanceCriteria as string[]) ?? []).map((c) => `- ${c}`),
		"",
		"## 架构",
		`- 组件: ${((arch.components as string[]) ?? []).join(", ")}`,
		`- 质量属性: ${((arch.qualityAttributes as string[]) ?? []).join(", ")}`,
		"",
		"## REST API",
		...((api.endpoints as string[]) ?? []).map((e) => `- ${e}`),
		"",
		"## 数据设计",
		`- 数据库: ${data.database ?? ""}`,
		`- 表: ${((data.tables as string[]) ?? []).join(", ")}`,
		"",
		"## 证据",
		...ev.map(
			(e) =>
				`- \`${e.filePath as string}\` L${e.lineStart as number}-${e.lineEnd as number} (${e.symbol as string})`,
		),
		"",
		...(cfinds.length
			? ["## 评审发现 (critic 独立 challenge)", ...cfinds.map((f) => `- [${f.severity}/${f.confidence}] ${f.issue} → ${f.suggestion}`), coverall ? `> ${coverall}` : "", ""]
			: []),
	];
	return lines.join("\n");
}

async function writeDesignPackage(plan: Plan, critique: unknown, repoId: string): Promise<string> {
	await fs.mkdir(OUT_DIR, { recursive: true });
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const file = path.join(OUT_DIR, `design-package-${repoId}-${ts}.md`);
	await fs.writeFile(file, planToMarkdown(plan, critique), "utf8");
	return file;
}

function parseArgs(argv: string[]): RunInput {
	const args = argv.slice(2);
	let repoPath = "";
	let repoId = "";
	let requirement = "";
	let reqFile = "";
	let commitSha: string | undefined;
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		const next = args[i + 1];
		if (a === "--repo") repoPath = next ?? "";
		else if (a === "--repo-id") repoId = next ?? "";
		else if (a === "--requirement") requirement = next ?? "";
		else if (a === "--requirement-file") reqFile = next ?? "";
		else if (a === "--commit") commitSha = next;
		else if (a === "--help" || a === "-h") {
			console.log(
				"用法: baize --repo <path> [--repo-id id] --requirement <text|--requirement-file path> [--commit sha]",
			);
			process.exit(0);
		}
	}
	if (reqFile) requirement = (requireText(reqFile)) ?? requirement;
	if (!requirement) {
		console.error("错误: 缺少 --requirement 或 --requirement-file");
		process.exit(2);
	}
	if (!repoPath) {
		console.error("错误: 缺少 --repo");
		process.exit(2);
	}
	repoId = repoId || path.basename(path.resolve(repoPath));
	return {
		requirement,
		repoPath: path.resolve(repoPath),
		repoId,
		commitSha,
	};
}

// ponytail: 同步读不阻塞 event loop 的问题这里忽略——requirement 文件极小。
function requireText(file: string): string | undefined {
	try {
		return readFileSync(file, "utf8").trim();
	} catch {
		return undefined;
	}
}

const input = parseArgs(process.argv);
console.log(`[baize] repo=${input.repoId} cwd=${input.repoPath} model=${PROVIDER}/${MODEL_ID}`);
const { plan, critique } = await runDesign(input);
const file = await writeDesignPackage(plan, critique, input.repoId);
console.log(`[baize] Design Package 写入: ${file}`);
