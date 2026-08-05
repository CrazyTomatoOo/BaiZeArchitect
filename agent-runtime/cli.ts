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
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
	createAgentSession,
	defineTool,
	DefaultResourceLoader,
	getAgentDir,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
	createProvider,
	envApiKeyAuth,
	lazyApi,
	type Api,
	type Model,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { getEvolverClient } from "./evolver-client.js";
import { getStageMethodology, getStageShape } from "./stage-prompts.js";

// ponytail: PROJECT_ROOT 指向项目根(.pi/skills 所在),不是 agent-runtime 目录。
// resourceLoader.cwd 用它发现 skills;createAgentSession.cwd 用目标仓库——两者分离。
const PROJECT_ROOT =
	process.env.BAIZE_PROJECT_ROOT ?? path.resolve(import.meta.dirname, "..");
const PROVIDER =
	process.env.RUNTIME_MODEL_PROVIDER ??
	process.env.PI_PROVIDER ??
	"bailian";
const MODEL_ID =
	process.env.RUNTIME_MODEL_ID ?? process.env.PI_MODEL ?? "glm-5.2";
const STAGE_MODEL_ID = process.env.BAIZE_STAGE_MODEL ?? "qwen-max";
const OUT_DIR = process.env.BAIZE_OUT_DIR ?? path.join(PROJECT_ROOT, "out");
const EVIDENCE_DIR = process.env.BAIZE_EVIDENCE_DIR ?? "/evidence";

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

function fallbackPlan(
	repoId: string,
	sha: string,
	requirement: string,
	reason: string,
): Plan {
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
		restApiContent: {
			changeRequest: requirement,
			repository: repoId,
			endpoints: [],
		},
		dataDesignContent: { changeRequest: requirement, database: "", tables: [] },
		decisionTitle: `Use evidence-backed design for ${requirement.slice(0, 40)}`,
		findingTitle: `Traceability for ${repoId}`,
	};
}
// #5: 宿主 evidence.sh 用 codebase-memory-mcp 产 evidence/<repoId>.json(架构/hotspots/
// boundaries/clusters + 历史 ADR),容器挂 /evidence 读取。architect 用结构化证据定位真实符号,
// read/grep 仍负责行号精度——mcp 给结构,read/grep 给行。
// ponytail: 容器内 evolver-mcp stdio(agent mid-design gene-search)非沉淀路径,speculative,
// 按需再加;宿主 evolve.sh + manage_adr 已闭环 #9 经验沉淀→复用。
interface EvidenceDoc {
	repositoryId: string;
	project?: string;
	architecture?: {
		total_nodes?: number;
		total_edges?: number;
		languages?: Array<{ language: string; file_count: number }>;
		entry_points?: Array<{ name: string; qualified_name: string; file: string }>;
		hotspots?: Array<{ name: string; qualified_name: string; fan_in: number }>;
		boundaries?: Array<{ from: string; to: string; call_count: number }>;
		layers?: Array<{ name: string; layer: string; reason: string }>;
		clusters?: Array<{ id: number; label: string; members: number; cohesion: number; top_nodes: string[] }>;
	};
	priorAdr?: { content?: string; status?: string };
}

function loadEvidence(repoId: string): EvidenceDoc | null {
	const dir = process.env.BAIZE_EVIDENCE_DIR ?? "/evidence";
	const file = path.join(dir, `${repoId}.json`);
	try {
		return JSON.parse(readFileSync(file, "utf8")) as EvidenceDoc;
	} catch {
		return null;
	}
}

function stripProj(qn: string, proj?: string): string {
	if (proj && qn.startsWith(proj + ".")) return qn.slice(proj.length + 1);
	return qn;
}

function evidenceToPromptBlock(ev: EvidenceDoc): string {
	const a = ev.architecture;
	const lines: string[] = ["## 仓库架构证据 (codebase-memory-mcp 结构化 — 定位真实符号与影响面)"];
	if (a) {
		const langs = (a.languages ?? []).map((l) => `${l.language}(${l.file_count})`).join(", ");
		lines.push(`- 规模: ${a.total_nodes ?? "?"} 节点 / ${a.total_edges ?? "?"} 边;语言: ${langs || "?"}`);
		const eps = (a.entry_points ?? []).map((e) => `${e.name} (${e.file})`).join(", ");
		if (eps) lines.push(`- 入口: ${eps}`);
		const hs = (a.hotspots ?? []).slice(0, 8).map((h) => `${stripProj(h.qualified_name, ev.project)}(${h.fan_in})`).join(", ");
		if (hs) lines.push(`- 高影响热点(fan_in): ${hs}`);
		const bd = (a.boundaries ?? []).slice(0, 6).map((b) => `${b.from}→${b.to}(${b.call_count})`).join(", ");
		if (bd) lines.push(`- 跨包边界: ${bd}`);
		const core = (a.layers ?? []).filter((l) => l.layer === "core").map((l) => l.name).join(", ");
		const internal = (a.layers ?? []).filter((l) => l.layer === "internal").map((l) => l.name).join(", ");
		if (core || internal) lines.push(`- 分层: core=[${core}]; internal=[${internal}]`);
		const cl = (a.clusters ?? []).slice(0, 6).map((c) => `${(c.top_nodes ?? []).slice(0, 3).join("/")}(cohesion ${c.cohesion?.toFixed(2)})`).join(", ");
		if (cl) lines.push(`- 真实模块(Leiden 社区): ${cl}`);
		lines.push("- 基于以上结构,用 read/grep 精确定位热点符号真实行号;evidenceCandidates 必须是真实路径+行号(禁止编造).");
	}
	const adr = ev.priorAdr?.content?.trim();
	lines.push("## 历史决策 (复用 — 上次设计沉淀,避免重复决策)");
	lines.push(adr && adr.length > 0 ? adr.slice(0, 2000) : "(无历史 ADR,首次设计)");
	return lines.join("\n");
}
// #9b: evolver_recall 自定义工具 — BAIZE_EVOLVER=1 时 architect mid-design 查本机已审核 gene。
const evolverRecallTool = defineTool({
	name: "evolver_recall",
	label: "Recall Reusable Genes",
	description:
		"查本机已审核通过的可复用经验 gene(设计模式/坑/决策)。设计前调用一次。",
	parameters: Type.Object({
		limit: Type.Optional(Type.Number({ description: "返回数量,默认 5" })),
	}),
	execute: async (_id, params) => {
		const c = await getEvolverClient();
		if (!c) {
			return {
				content: [{ type: "text", text: "(evolver-mcp 未启用或启动失败)" }],
				details: {},
			};
		}
		try {
			const limit = (params as { limit?: number }).limit ?? 5;
			const res = (await c.call("evolver_recall", { limit })) as {
				content?: Array<{ text?: string }>;
			} | undefined;
			const text = (res?.content ?? [])
				.map((b) => b.text ?? "")
				.join("; ")
				.trim();
			return {
				content: [
					{ type: "text", text: text || "(无可用 gene — 本地 store 空)" },
				],
				details: {},
			};
		} catch (e) {
			return {
				content: [
					{
						type: "text",
						text: `(evolver_recall 失败: ${e instanceof Error ? e.message : e})`,
					},
				],
				details: {},
			};
		}
	},
});

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
		id: "glm-5.2",
		name: "GLM-5.2",
		api: "openai-completions",
		baseUrl: BAILIAN_BASE,
		provider: "bailian",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1048576,
		maxTokens: 16384,
		thinkingLevelMap: {
			low: "high",
			medium: "high",
			high: "high",
			xhigh: "max",
			max: "max",
		},
		compat: { supportsDeveloperRole: false, supportsReasoningEffort: true },
	},
	{
		id: "qwen-max",
		name: "Qwen-Max",
		api: "openai-completions",
		baseUrl: BAILIAN_BASE,
		provider: "bailian",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 131072,
		maxTokens: 8192,
		compat: { supportsDeveloperRole: false },
	},
];
const bailianProvider = createProvider({
	id: "bailian",
	name: "阿里云百炼 (DashScope)",
	baseUrl: BAILIAN_BASE,
	auth: { apiKey: envApiKeyAuth("阿里云百炼 API key", ["DASHSCOPE_API_KEY"]) },
	models: bailianModels,
	api: lazyApi(() =>
		import(
			"./node_modules/@earendil-works/pi-ai/dist/api/openai-completions.lazy.js"
		).then((m) => m.openAICompletionsApi()),
	),
});
(
	modelRuntime as { registerNativeProvider(p: unknown): void }
).registerNativeProvider(bailianProvider);

// 模型配置入口:设置页可改 provider/modelId/apiKey,写 .baize/model-config.json 并运行时生效。
export interface ModelConfig {
	provider?: string;
	modelId?: string;
	apiKey?: string;
}
let activeProvider = PROVIDER;
let activeModelId = MODEL_ID;

export function applyModelConfig(cfg: ModelConfig): void {
	if (cfg.provider) activeProvider = cfg.provider;
	if (cfg.modelId) activeModelId = cfg.modelId;
	if (cfg.apiKey) process.env.DASHSCOPE_API_KEY = cfg.apiKey;
	// 以 activeProvider 的 id 重新注册原生 provider(envApiKeyAuth 读 DASHSCOPE_API_KEY,运行时生效)
	const p = createProvider({
		id: activeProvider,
		name: activeProvider,
		baseUrl: BAILIAN_BASE,
		auth: { apiKey: envApiKeyAuth("API key", ["DASHSCOPE_API_KEY"]) },
		models: bailianModels,
		api: lazyApi(() =>
			import(
				"./node_modules/@earendil-works/pi-ai/dist/api/openai-completions.lazy.js"
			).then((m) => m.openAICompletionsApi()),
		),
	});
	(modelRuntime as { registerNativeProvider(p: unknown): void }).registerNativeProvider(p);
}

function resolveModel() {
	return (
		modelRuntime.getModel(activeProvider, activeModelId) ??
		modelRuntime.getModel("bailian", activeModelId) ??
		modelRuntime.getModel("bailian", MODEL_ID)
	);
}

const MODEL_CONFIG_PATH = path.join(PROJECT_ROOT, ".baize", "model-config.json");

export function readModelConfig(): ModelConfig | null {
	try {
		return JSON.parse(readFileSync(MODEL_CONFIG_PATH, "utf8")) as ModelConfig;
	} catch {
		return null;
	}
}

export function writeModelConfig(cfg: ModelConfig): void {
	mkdirSync(path.dirname(MODEL_CONFIG_PATH), { recursive: true });
	writeFileSync(MODEL_CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

export function currentModelConfig(): ModelConfig {
	return { provider: activeProvider, modelId: activeModelId, apiKey: process.env.DASHSCOPE_API_KEY ?? "" };
}

// 模块加载时应用已存配置
{
	const saved = readModelConfig();
	if (saved) applyModelConfig(saved);
}
interface RunInput {
	requirement: string;
	repoPath: string; // 绝对路径
	repoId: string;
	commitSha?: string;
}

export type RunEvent =
	| { type: "phase"; phase: "architect" | "critic" }
	| { type: "plan"; plan: Plan }
	| { type: "critique"; critique: unknown }
	| { type: "done"; file: string }
	| { type: "error"; error: string }

export async function runDesign(
	input: RunInput,
	onEvent?: (e: RunEvent) => void,
): Promise<{ plan: Plan; critique: unknown }> {
	const model = resolveModel();
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
			return {
				content: [{ type: "text", text: "Plan submitted." }],
				details: {},
			};
		},
	});

	const sha = input.commitSha ?? "HEAD";
	onEvent?.({ type: "phase", phase: "architect" });
	const evolverEnabled = process.env.BAIZE_EVOLVER === "1";
	const archTools = ["read", "bash", "grep", "find", "ls", "submit_plan"];
	if (evolverEnabled) archTools.push("evolver_recall");
	const archCustom = evolverEnabled
		? [submitPlanTool, evolverRecallTool]
		: [submitPlanTool];
	const { session } = await createAgentSession({
		cwd: input.repoPath,
		model,
		modelRuntime,
		resourceLoader,
		tools: archTools,
		customTools: archCustom,
		sessionManager: SessionManager.inMemory(input.repoPath),
	});
	try {
	const ev = loadEvidence(input.repoId);
	const prompt = [
		...(ev ? [evidenceToPromptBlock(ev), ""] : []),
		`仓库: ${input.repoId} (commit ${sha})`,
		`需求: ${input.requirement}`,
		"请用 read/grep/find 分析仓库代码,参考 .pi/skills 各角色职责,然后调用 submit_plan 提交完整 plan.",
		...(evolverEnabled ? ["可调用 evolver_recall 查可复用 gene(若有则参考复用)。"] : []),
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
		description:
			"提交对架构方案的独立评审发现(风险/遗漏/矛盾),含严重度与置信度。",
		parameters: Type.Object({
			findings: Type.Array(
				Type.Object({
					issue: Type.String(),
					severity: Type.String({ description: "high|medium|low" }),
					confidence: Type.String({ description: "high|medium|low" }),
					suggestion: Type.String(),
				}),
			),
			overall: Type.String({ description: "总体评审意见" }),
		}),
		execute: async (_id, p) => {
			critique = p;
			return {
				content: [{ type: "text", text: "Critique recorded." }],
				details: {},
			};
		},
	});
	const plan =
		planFromTool ??
		fallbackPlan(
			input.repoId,
			sha,
			input.requirement,
			"LLM 未调用 submit_plan",
		);
	onEvent?.({ type: "plan", plan });
	onEvent?.({ type: "phase", phase: "critic" });
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
		await criticSession.prompt(
			[
				"角色: critic(设计评审)。参考 .pi/skills/critic 职责。",
				`仓库: ${input.repoId} (commit ${sha})`,
				`架构方案(architect 产出):\n${JSON.stringify(plan, null, 2)}`,
				"请独立评审:需求覆盖完整性、证据充分性、风险/遗漏/矛盾。用 read/grep 复核证据真实后,调用 record_critique 提交发现。",
			].join("\n"),
		);
	} finally {
		try {
			await criticSession.dispose?.();
		} catch {
			/* ignore */
		}
	}
	onEvent?.({ type: "critique", critique });
	return { plan, critique };
}

// ponytail: 最简 markdown 归档,不引模板引擎。git 版本由调用方(caller)或后续 archive.ts 接。
function planToMarkdown(
	plan: Plan,
	critique?: unknown,
	status = "accepted",
): string {
	const ev = (plan.evidenceCandidates as Array<Record<string, unknown>>) ?? [];
	const req = plan.requirementContent as Record<string, unknown>;
	const arch = plan.architectureContent as Record<string, unknown>;
	const api = plan.restApiContent as Record<string, unknown>;
	const data = plan.dataDesignContent as Record<string, unknown>;
	const cfinds =
		(
			critique as {
				findings?: Array<{
					issue: string;
					severity: string;
					confidence: string;
					suggestion: string;
				}>;
			}
		)?.findings ?? [];
	const coverall = (critique as { overall?: string })?.overall ?? "";
	const lines: string[] = [
		`# ${String(plan.decisionTitle ?? "Design Decision")}`,
		"",
		`> 审批状态: ${status}`,
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
			? [
					"## 评审发现 (critic 独立 challenge)",
					...cfinds.map(
						(f) =>
							`- [${f.severity}/${f.confidence}] ${f.issue} → ${f.suggestion}`,
					),
					coverall ? `> ${coverall}` : "",
					"",
				]
			: []),
	];
	return lines.join("\n");
}

export async function writeDesignPackage(
	plan: Plan,
	critique: unknown,
	repoId: string,
	status: string,
): Promise<string> {
	await fs.mkdir(OUT_DIR, { recursive: true });
	const ts = new Date().toISOString().replace(/[:.]/g, "-");
	const file = path.join(OUT_DIR, `design-package-${repoId}-${ts}.md`);
	await fs.writeFile(file, planToMarkdown(plan, critique, status), "utf8");
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
	if (reqFile) requirement = requireText(reqFile) ?? requirement;
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

async function main(): Promise<void> {
	const input = parseArgs(process.argv);
	console.log(`[baize] repo=${input.repoId} cwd=${input.repoPath} model=${PROVIDER}/${MODEL_ID}`);
	const { plan, critique } = await runDesign(input);
	const autoApprove = process.env.BAIZE_AUTO_APPROVE !== "0";
	const status = autoApprove ? "accepted" : "pending";
	const file = await writeDesignPackage(plan, critique, input.repoId, status);
	console.log(`[baize] 审批: ${autoApprove ? "auto-approved" : "pending(待外部 approve)"}`);
	console.log(`[baize] Design Package 写入: ${file}`);
	// ponytail: 显式 exit — evolver-mcp 子进程 keep event loop,不退则容器不退。
	process.exit(0);
}

// CLI 入口:被 gateway import 时(BAIZE_GATEWAY=1)跳过;直接跑 cli.ts 时执行。
if (process.env.BAIZE_GATEWAY !== "1") {
	await main();
}

export type StageName =
	| "analysis"
	| "scenario"
	| "usecase"
	| "function"
	| "design";

export interface StageRunInput {
	repoPath: string;
	repoId: string;
	requirementTitle: string;
	requirementDesc: string;
	upstream: string;
	stage: StageName;
	/** 打回意见:重跑时注入 prompt,驱动审核-修改循环 */
	feedback?: string;
}

function extractJson(text: string): unknown {
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const raw = fence ? fence[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
	if (!raw || !raw.trim().startsWith("{")) return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

function lastAssistantText(session: unknown): string {
	const msgs =
		(session as { state?: { messages?: Array<{ role?: string; content?: unknown }> } })
			.state?.messages ?? [];
	for (let i = msgs.length - 1; i >= 0; i--) {
		const m = msgs[i];
		if (m.role !== "assistant") continue;
		if (typeof m.content === "string") return m.content;
		if (Array.isArray(m.content)) {
			return (m.content as Array<{ type?: string; text?: string }>)
				.map((c) => c.text ?? "")
				.join("");
		}
	}
	return "";
}

// T07: 单阶段 agent run。submit_stage_assets 收本阶段资产,返回给调用方落 store。
export async function runStage(
	input: StageRunInput,
	onEvent?: (e: RunEvent) => void,
): Promise<unknown> {
	const model = resolveModel();
	if (!model) throw new Error(`model not found: ${PROVIDER}/${STAGE_MODEL_ID}`);
	let assets: unknown = null;
	const submitTool = defineTool({
		name: "submit_stage_assets",
		label: "Submit Stage Assets",
		description: "提交本阶段资产(结构化 JSON)。",
		parameters: Type.Object({ assets: Type.Any() }),
		execute: async (_id, p) => {
			let a = (p as { assets: unknown }).assets;
			if (typeof a === "string") {
				try {
					a = JSON.parse(a);
				} catch {
					/* keep */
				}
			}
			assets = a;
			return { content: [{ type: "text", text: "Assets submitted." }], details: {} };
		},
	});
	const { session } = await createAgentSession({
		cwd: input.repoPath,
		model,
		modelRuntime,
		resourceLoader,
		tools: ["submit_stage_assets"],
			customTools: [submitTool],
			sessionManager: SessionManager.inMemory(input.repoPath),
		});
	const unsubscribe = (
		session as unknown as {
			subscribe?: (cb: (ev: unknown) => void) => () => void;
		}
	).subscribe?.((ev) => {
		const e = ev as {
			type?: string;
			delta?: string;
			text?: string;
			message?: { content?: Array<{ type?: string; text?: string; delta?: string }> };
		};
		let text = "";
		if (typeof e.delta === "string") text = e.delta;
		else if (typeof e.text === "string") text = e.text;
		else if (Array.isArray(e.message?.content)) {
			for (const part of e.message.content) {
				if (part && (part.type === "text" || part.type === "text_delta"))
					text += part.text ?? part.delta ?? "";
			}
		}
		if (text) onEvent?.({ type: "token", text } as unknown as RunEvent);
	});
	void unsubscribe;
		onEvent?.({ type: "phase", phase: "architect" });
	try {
		await session.prompt(
			[
				`你是需求工程 agent,当前阶段:${input.stage}。`,
				`需求:${input.requirementTitle} — ${input.requirementDesc}`,
				`上游资产:${input.upstream || "(无)"}`,
				`仓库:${input.repoId}。`,
				...(input.feedback
					? [
							`上一版产物被审核打回,修改意见如下,必须逐条落实:`,
							input.feedback,
						]
					: []),
				getStageMethodology(input.stage),
				`产出本阶段资产,形状:${getStageShape(input.stage)}`,
				"优先调用 submit_stage_assets 提交;若无法调用工具,直接输出一个 JSON 代码块(形状同上)。",
			].join("\n"),
		);
		if (assets == null) {
			await session.prompt(
				"你尚未调用 submit_stage_assets。立即调用它,提交本阶段资产 JSON,不要输出其它文本。",
			);
		}
		if (assets == null) {
			await session.prompt(
				`把上面的分析转换为一个 JSON 代码块,形状:${getStageShape(input.stage)}。只输出 JSON,不要其它文本。`,
			);
			const parsed = extractJson(lastAssistantText(session));
			if (parsed) assets = (parsed as { assets?: unknown }).assets ?? parsed;
		}
	} finally {
		await session.dispose?.();
	}
	return assets;
}

/** 需求录入 chat 化(T05):多轮澄清 → 收敛为 {title,description}。无 repo/工具,纯对话。 */
export async function chatIntake(
	history: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<string> {
	const model = resolveModel();
	if (!model) throw new Error(`model not found: ${PROVIDER}/${MODEL_ID}`);
	const cwd = process.cwd();
	const { session } = await createAgentSession({
		cwd,
		model,
		modelRuntime,
		resourceLoader,
		tools: [],
		sessionManager: SessionManager.inMemory(cwd),
	});
	try {
		const sys =
			"你是 BaiZe 的需求澄清助手。和用户对话澄清一个软件需求。每轮二选一:① 问一个聚焦的澄清问题(用户/边界/异常/约束/规模);② 信息足够时输出严格 JSON {\"title\":string,\"description\":string}(description 写完整需求,含边界与约束),且只输出该 JSON。";
		const prompt =
			sys +
			"\n\n" +
			history.map((m) => `${m.role === "user" ? "用户" : "助手"}: ${m.content}`).join("\n") +
			"\n\n助手:";
		await session.prompt(prompt);
		return lastAssistantText(session);
	} finally {
		try {
			await session.dispose?.();
		} catch {
			/* ignore */
		}
	}
}
