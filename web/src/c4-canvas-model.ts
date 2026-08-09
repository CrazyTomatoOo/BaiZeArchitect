export type C4Layer = "context" | "container" | "component" | "code";
export type C4NodeKind = "system" | "externalSystem" | "container" | "component" | "code" | "aggregate";

export interface VisibleGraphNode {
	id: string;
	kind: C4NodeKind;
	name: string;
	description: string;
	technology?: string;
	parentId?: string;
	memberIds?: string[];
	evidence: string[];
}

export interface VisibleGraphEdge {
	id: string;
	source: string;
	target: string;
	kind: string;
	confidence: number;
	evidence: string[];
	count?: number;
}

export interface VisibleGraph {
	snapshotId: string;
	repositoryId: string;
	headSha: string;
	layer: C4Layer;
	root?: string;
	visibleGraphHash: string;
	nodes: VisibleGraphNode[];
	edges: VisibleGraphEdge[];
	cap: { maxNodes: number; atomicNodeCount: number; applied: boolean };
}

export interface ElkNodeInput {
	id: string;
	width: number;
	height: number;
}

export interface ElkEdgeInput {
	id: string;
	sources: string[];
	targets: string[];
}

export interface ElkGraphInput {
	id: string;
	layoutOptions: Record<string, string>;
	children: ElkNodeInput[];
	edges: ElkEdgeInput[];
}

export interface LayoutPosition {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface CanvasLayout {
	width: number;
	height: number;
	nodes: Map<string, LayoutPosition>;
	edges: Map<string, string>;
}

export interface ExportContext {
	filters: string[];
	focused: boolean;
	generatedAt: string;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 56;
const HEADER_HEIGHT = 52;
const FOOTER_HEIGHT = 54;

function xml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function displayLayer(layer: C4Layer): string {
	return layer[0].toUpperCase() + layer.slice(1);
}

function label(node: VisibleGraphNode): string {
	return node.name.length > 24 ? `${node.name.slice(0, 23)}…` : node.name;
}

export function projectionToElk(graph: VisibleGraph): ElkGraphInput {
	return {
		id: graph.visibleGraphHash,
		layoutOptions: {
			"elk.algorithm": "layered",
			"elk.direction": "RIGHT",
			"elk.edgeRouting": "ORTHOGONAL",
			"elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
			"elk.spacing.nodeNode": "32",
			"elk.layered.spacing.nodeNodeBetweenLayers": "56",
		},
		children: [...graph.nodes]
			.sort((left, right) => left.id.localeCompare(right.id))
			.map((node) => ({ id: node.id, width: NODE_WIDTH, height: NODE_HEIGHT })),
		edges: graph.edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
	};
}

export function layoutFromElk(result: { width?: number; height?: number; children?: Array<{ id: string; x?: number; y?: number; width?: number; height?: number }>; edges?: Array<{ id: string; sections?: Array<{ startPoint?: { x: number; y: number }; endPoint?: { x: number; y: number }; bendPoints?: Array<{ x: number; y: number }> }> }> }): CanvasLayout {
	const nodes = new Map<string, LayoutPosition>();
	for (const node of result.children ?? []) {
		nodes.set(node.id, { x: node.x ?? 0, y: node.y ?? 0, width: node.width ?? NODE_WIDTH, height: node.height ?? NODE_HEIGHT });
	}
	const edges = new Map<string, string>();
	for (const edge of result.edges ?? []) {
		const section = edge.sections?.[0];
		if (!section?.startPoint || !section.endPoint) continue;
		const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
		edges.set(edge.id, `M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")}`);
	}
	return { width: result.width ?? 0, height: result.height ?? 0, nodes, edges };
}

export function pngExportSize(bounds: { width: number; height: number }): { width: number; height: number } | null {
	const width = Math.ceil(bounds.width * 2);
	const height = Math.ceil(bounds.height * 2);
	return Math.max(width, height) <= 8192 ? { width, height } : null;
}

export function visibleGraphToSvgDocument(graph: VisibleGraph, layout: CanvasLayout, context: ExportContext): string {
	const width = Math.max(1, Math.ceil(layout.width));
	const height = Math.max(1, Math.ceil(layout.height)) + HEADER_HEIGHT + FOOTER_HEIGHT;
	const edgeMarks = graph.edges.map((edge) => {
		const path = layout.edges.get(edge.id);
		return path ? `<path class="edge" d="${xml(path)}"/>` : "";
	}).join("");
	const nodeMarks = graph.nodes.map((node) => {
		const position = layout.nodes.get(node.id);
		if (!position) return "";
		const y = position.y;
		const aggregate = node.kind === "aggregate" ? " aggregate" : "";
		return `<g class="node${aggregate}"><rect x="${position.x}" y="${y}" width="${position.width}" height="${position.height}" rx="8"/><text x="${position.x + 12}" y="${y + 24}">${xml(label(node))}</text><text class="kind" x="${position.x + 12}" y="${y + 43}">${xml(node.kind)}</text></g>`;
	}).join("");
	const condition = [context.filters.join(", "), context.focused ? "neighbor focus" : ""].filter(Boolean).join(" · ") || "no filters";
	const title = `${graph.repositoryId} · ${graph.headSha.slice(0, 8)} · ${displayLayer(graph.layer)}`;
	return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(title)}"><style>svg{background:#101827;font-family:ui-sans-serif,system-ui,sans-serif}.header,.footer{fill:#101827}.title{fill:#eff4ff;font-size:18px;font-weight:700}.meta{fill:#b9c8e8;font-size:11px}.node rect{fill:#202b40;stroke:#92a8d9;stroke-width:1.25}.node.aggregate rect{fill:#342a53;stroke:#c4a5ff}.node text{fill:#eff4ff;font-size:13px;font-weight:650}.node .kind{fill:#b9c8e8;font-size:10px;font-weight:400}.edge{fill:none;stroke:#6f86b6;stroke-width:1.4}</style><rect class="header" width="100%" height="${HEADER_HEIGHT}"/><text class="title" x="18" y="31">${xml(title)}</text><g transform="translate(0 ${HEADER_HEIGHT})">${edgeMarks}${nodeMarks}</g><rect class="footer" y="${height - FOOTER_HEIGHT}" width="100%" height="${FOOTER_HEIGHT}"/><text class="meta" x="18" y="${height - 30}">${graph.nodes.length} nodes · ${graph.edges.length} relationships · ${xml(condition)}</text><text class="meta" x="18" y="${height - 14}">UTC ${xml(context.generatedAt)}</text></svg>`;
}
