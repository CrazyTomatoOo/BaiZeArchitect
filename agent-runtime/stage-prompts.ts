import type { StageName } from "./cli.js";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * stage-prompts — 业界需求工程方法论 → 各阶段模型提示词(T08 后续)。
 * 来源:用例驱动(Jacobson/Cockburn)、INVEST、Scenario-Based Design(Carroll/Rosson)、
 * Cockburn 用例粒度、MECE/高内聚/DDD 限界上下文(功能分解)。
 */
export const STAGE_METHODOLOGY: Record<StageName, string> = {
	analysis: [
		"方法论(需求分析):",
		"- 用例驱动(Jacobson/Cockburn):明确系统边界、主参与者(primary actor)及其目标与价值。",
		"- 用户故事 INVEST:Independent/Negotiable/Valuable/Estimable/Small/Testable。",
		"- 区分功能需求与非功能需求(FURPS+:功能/易用/可靠/性能/可支持)。",
		"- 产出范围(scope)、约束(constraints)、风险(risks),并可附验收标准。",
	].join("\n"),
	scenario: [
		"方法论(场景拆分,Scenario-Based Design / Carroll & Rosson):",
		"- 场景=某参与者在某上下文下达成目标的叙事;按 不同参与者目标/不同触发条件 拆。",
		"- 每个场景含:参与者、目标、触发、前置、关键步骤、结果。",
		"- 覆盖主成功场景(happy path)+ 备选/异常/边界场景。",
	].join("\n"),
	usecase: [
		"方法论(用例拆分,Cockburn《Writing Effective Use Cases》):",
		"- 用例=actor+goal+主成功场景+扩展(异常);扩展是价值所在(错误处理)。",
		"- 粒度取 user-goal 级(sea level):不过粗(系统级)、不过细(子功能)。",
		"- 拆分维度:按 actor 目标 / 业务事件 / CRUD 生命周期。",
		"- 每用例:title(actor+goal)、precondition、mainFlow、exceptions、postcondition。",
	].join("\n"),
	function: [
		"方法论(功能分解):",
		"- MECE:功能域互斥、合起来穷尽;高内聚、低耦合、单一职责。",
		"- DDD 限界上下文→功能域(capability area);域内再拆功能项(cohesive 行为单元)。",
		"- 用功能树/WBS 组织;避免跨域重复职责。",
	].join("\n"),
};

export const STAGE_OUTPUT_SHAPE: Record<StageName, string> = {
	analysis: `{"scope":["..."],"constraints":["..."],"risks":["..."]}`,
	scenario: `{"scenarios":[{"title":"...","description":"参与者/目标/触发/步骤/结果"}]}`,
	usecase: `{"useCases":[{"title":"actor+goal","scenarioTitle":"...","precondition":"...","mainFlow":"...","exceptions":"...","postcondition":"..."}]}`,
	function: `{"domains":[{"name":"功能域","description":"...","items":[{"title":"功能项","description":"..."}]}]}`,
};

export interface StagePromptConfig {
	methodology?: string;
	shape?: string;
}

// 配置化:config/stage-prompts.json(或 BAIZE_STAGE_PROMPTS 路径)按阶段替换,缺省回退内置方法论。
function loadConfig(): Record<string, StagePromptConfig> {
	const file =
		process.env.BAIZE_STAGE_PROMPTS ??
		join(
			process.env.BAIZE_PROJECT_ROOT ?? resolve(process.cwd(), ".."),
			"config",
			"stage-prompts.json",
		);
	try {
		return JSON.parse(readFileSync(file, "utf8")) as Record<string, StagePromptConfig>;
	} catch {
		return {};
	}
}

export function getStageMethodology(s: StageName): string {
	return loadConfig()[s]?.methodology ?? STAGE_METHODOLOGY[s];
}

export function getStageShape(s: StageName): string {
	return loadConfig()[s]?.shape ?? STAGE_OUTPUT_SHAPE[s];
}
