/**
 * diagram-render.ts — 产物图渲染纯函数。
 *
 * 决策来源：wayfinder #11 原型 prototype/artifact-diagram-render（变体 C 结构化图 JSON）。
 * 产物内容 `diagrams: [{type:"graph", nodes:[{id,label}], edges:[[from,to,label?]]}]`
 * 一条数据源双消费端：本模块转 mermaid 预览；交互画布阶段（ADR-004 G6+ELK）直喂同一份 nodes/edges。
 */

export interface DiagramNode {
	id: string;
	label: string;
}

export type DiagramEdge = [string, string, string?];

export interface GraphDiagram {
	type: "graph";
	nodes: readonly DiagramNode[];
	edges: readonly DiagramEdge[];
}

export type ArtifactKind =
	| "requirement"
	| "analysis"
	| "scenario"
	| "usecase"
	| "function"
	| "design"
	| "architecture"
	| "data"
	| "api";

export function isGraphDiagram(value: unknown): value is GraphDiagram {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	if (record.type !== "graph") return false;
	if (!Array.isArray(record.nodes) || !Array.isArray(record.edges) || record.nodes.length === 0) return false;
	for (const node of record.nodes) {
		if (typeof node !== "object" || node === null) return false;
		const nodeRecord = node as { id?: unknown; label?: unknown };
		if (typeof nodeRecord.id !== "string" || nodeRecord.id.length === 0) return false;
		if (typeof nodeRecord.label !== "string" || nodeRecord.label.length === 0) return false;
	}
	for (const edge of record.edges) {
		if (!Array.isArray(edge) || edge.length < 2 || edge.length > 3) return false;
		for (const part of edge) {
			if (typeof part !== "string" || part.length === 0) return false;
		}
	}
	return true;
}

/**
 * mermaid 实体/节点名净化（原型实证 ER 实体名括号/「可选」会解析失败）。
 * 只删括号类字符与括号紧随的「可选」修饰词——绝不动正文里的独立「可」「选」字（如可用资源、选择器）。
 */
export function sanitizeMermaidName(value: string): string {
	return value
		.replace(/[()（）「」【】]/g, "")
		.replace(/\s*可选(?=\s|$)/g, "")
		.replace(/\s+/g, "_");
}

/**
 * mermaid 文本节点净化：引号/竖线/换行会破坏解析或注入 SVG；HTML 元字符（<>&）在 loose 模式下
 * 会被 mermaid 当 HTML 渲染，实体化后成为字面文本，杜绝 operator SPA 注入面（Spec review #18）。
 */
export function sanitizeMermaidText(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/\|/g, "｜")
		.replace(/[\r\n]+/g, " ");
}

function edgeLabel(edge: readonly [string, string, string?]): string {
	return edge[2] === undefined ? "" : `|${sanitizeMermaidText(edge[2])}|`;
}

/** scenario/architecture 等 → flowchart（方向与图型由产物 kind 决定）。 */
function graphToFlowchart(diagram: GraphDiagram, direction: "TD" | "LR"): string {
	const nodes = diagram.nodes
		.map((node) => `  ${sanitizeMermaidText(node.id)}["${sanitizeMermaidText(node.label)}"]`)
		.join("\n");
	const edges = diagram.edges.map((edge) => `  ${sanitizeMermaidText(edge[0])} -->${edgeLabel(edge)} ${sanitizeMermaidText(edge[1])}`).join("\n");
	return `flowchart ${direction}\n${nodes}\n${edges}`;
}

/** data 产物 → erDiagram（原型实证：实体名须净化，关系取 from/to + 标注）。 */
function graphToEr(diagram: GraphDiagram): string {
	const entities = diagram.nodes
		.map((node) => `  ${sanitizeMermaidName(node.id)} {\n    string ${sanitizeMermaidText(sanitizeMermaidName(node.label))}\n  }`)
		.join("\n");
	const relationships = diagram.edges
		.map((edge) => `  ${sanitizeMermaidName(edge[0])} ||--o{ ${sanitizeMermaidName(edge[1])} : "${sanitizeMermaidText(edge[2] ?? "")}"`)
		.join("\n");
	return `erDiagram\n${entities}\n${relationships}`;
}

export type DiagramKind = "flowchart" | "erDiagram";

/**
 * 图型映射（#11 原型已验证）：scenario/usecase/function→流程 flowchart(TD)，
 * architecture→组件流 flowchart(LR)，data→ER，其余 kind 无默认图型。
 */
export function diagramKindFor(artifactKind: ArtifactKind): DiagramKind | null {
	if (artifactKind === "data") return "erDiagram";
	if (
		artifactKind === "scenario" ||
		artifactKind === "usecase" ||
		artifactKind === "function" ||
		artifactKind === "architecture"
	) {
		return "flowchart";
	}
	return null;
}

/**
 * graph → mermaid 源文本。无图型映射的 kind 返回 null（调用方不渲染）。
 * 非法 shapes（isGraphDiagram false）返回 null。
 */
export function graphToMermaid(
	artifactKind: ArtifactKind,
	diagram: GraphDiagram,
): string | null {
	if (!isGraphDiagram(diagram)) return null;
	const kind = diagramKindFor(artifactKind);
	if (kind === null) return null;
	if (kind === "erDiagram") return graphToEr(diagram);
	return graphToFlowchart(diagram, artifactKind === "architecture" ? "LR" : "TD");
}