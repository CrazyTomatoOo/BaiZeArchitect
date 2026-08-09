import { createHash } from "node:crypto";

export const C4_LAYERS = ["context", "container", "component", "code"] as const;
export type C4Layer = (typeof C4_LAYERS)[number];
export type C4NodeKind = "system" | "externalSystem" | "container" | "component" | "code" | "aggregate";
export type C4EdgeKind = "contains" | "dependsOn" | "calls" | "readsWrites" | "externalDependency" | "derivedFrom";

export interface C4InputNode {
	id: string;
	name: string;
	description: string;
	technology?: string;
	parentId?: string;
	members?: string[];
	sourcePath?: string;
}

export interface C4InputRelationship {
	source: string;
	target: string;
	kind: C4EdgeKind;
	evidence: string[];
	confidence?: number;
}

export interface C4ProjectionInput {
	repositoryId: string;
	headSha: string;
	projectionVersion: string;
	system: { name: string; description: string };
	externalDependencies: Array<{ name: string; description: string; evidence?: string[] }>;
	containers: C4InputNode[];
	components: C4InputNode[];
	code: C4InputNode[];
	relationships: C4InputRelationship[];
}

export interface C4Node {
	id: string;
	lineageId: string;
	kind: C4NodeKind;
	name: string;
	description: string;
	technology?: string;
	parentId?: string;
	memberIds?: string[];
	evidence: string[];
}

export interface C4Edge {
	id: string;
	source: string;
	target: string;
	kind: C4EdgeKind;
	confidence: number;
	evidence: string[];
	count?: number;
}

export interface C4ProjectionSnapshot {
	id: string;
	repositoryId: string;
	headSha: string;
	projectionVersion: string;
	contentHash: string;
	generatedAt: string;
	nodes: C4Node[];
	edges: C4Edge[];
	roots: Record<C4Layer, string[]>;
}

export interface VisibleGraphRequest {
	layer: C4Layer;
	root?: string;
	query?: string;
	kinds?: C4NodeKind[];
	focus?: string;
	maxNodes?: number;
}

export interface VisibleGraph {
	snapshotId: string;
	repositoryId: string;
	headSha: string;
	layer: C4Layer;
	root?: string;
	visibleGraphHash: string;
	nodes: C4Node[];
	edges: C4Edge[];
	cap: { maxNodes: number; atomicNodeCount: number; applied: boolean };
}

const layerForKind: Record<Exclude<C4NodeKind, "aggregate">, C4Layer> = {
	system: "context",
	externalSystem: "context",
	container: "container",
	component: "component",
	code: "code",
};

function hash(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function slug(value: string): string {
	const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
	return normalized || "unknown";
}

function semanticId(kind: C4NodeKind, id: string): string {
	return `${kind}:${slug(id)}`;
}

function evidence(values: string[] | undefined, fallback: string): string[] {
	const unique = [...new Set((values ?? []).map(String).filter(Boolean))];
	return unique.length ? unique : [fallback];
}

function makeNode(kind: Exclude<C4NodeKind, "aggregate">, input: C4InputNode, fallbackEvidence: string): C4Node {
	return {
		id: semanticId(kind, input.id),
		lineageId: `${kind}:${slug(input.id)}`,
		kind,
		name: input.name,
		description: input.description,
		technology: input.technology,
		parentId: input.parentId ? resolveReference(input.parentId) : undefined,
		memberIds: input.members?.map(String),
		evidence: evidence(input.members ?? (input.sourcePath ? [input.sourcePath] : undefined), fallbackEvidence),
	};
}

function resolveReference(id: string): string {
	if (/^(system|externalSystem|container|component|code|aggregate):/.test(id)) return id;
	return id;
}

function resolveInputReference(reference: string, nodes: C4Node[]): string {
	if (nodes.some((node) => node.id === reference)) return reference;
	const matched = nodes.find((node) => node.id.endsWith(`:${slug(reference)}`));
	return matched?.id ?? reference;
}

function isWithinRoot(node: C4Node, root: string, nodesById: Map<string, C4Node>): boolean {
	let current: C4Node | undefined = node;
	while (current) {
		if (current.id === root) return true;
		current = current.parentId ? nodesById.get(current.parentId) : undefined;
	}
	return false;
}

function edgesForContext(snapshot: C4ProjectionSnapshot, visibleIds: Set<string>): C4Edge[] {
	const system = snapshot.nodes.find((node) => node.kind === "system");
	if (!system) return [];
	const externalIds = new Set(snapshot.nodes.flatMap((node) => node.kind === "externalSystem" ? [node.id] : []));
	const result = new Map<string, C4Edge>();
	for (const edge of snapshot.edges) {
		if (!externalIds.has(edge.target) && !externalIds.has(edge.source)) continue;
		const externalId = externalIds.has(edge.target) ? edge.target : edge.source;
		if (!visibleIds.has(externalId)) continue;
		const key = `${system.id}:${externalId}:${edge.kind}`;
		const current = result.get(key);
		if (current) {
			current.count = (current.count ?? 1) + 1;
			current.evidence = evidence([...current.evidence, ...edge.evidence], system.evidence[0] ?? "snapshot");
			continue;
		}
		result.set(key, { ...edge, id: `edge:${key}`, source: system.id, target: externalId, count: 1 });
	}
	return [...result.values()];
}

function summariseEdges(edges: C4Edge[], visibleIds: Set<string>): C4Edge[] {
	const summaries = new Map<string, C4Edge>();
	for (const edge of edges) {
		if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) continue;
		const key = `${edge.source}:${edge.target}:${edge.kind}`;
		const current = summaries.get(key);
		if (current) {
			current.count = (current.count ?? 1) + 1;
			current.evidence = evidence([...current.evidence, ...edge.evidence], "snapshot");
			continue;
		}
		summaries.set(key, { ...edge, count: edge.count ?? 1 });
	}
	return [...summaries.values()];
}

function aggregate(layer: C4Layer, nodes: C4Node[]): C4Node {
	const memberIds = nodes.map((node) => node.id).sort((left, right) => left.localeCompare(right));
	return {
		id: `aggregate:${layer}:${hash(memberIds).slice(0, 12)}`,
		lineageId: `aggregate:${layer}:${hash(memberIds).slice(0, 12)}`,
		kind: "aggregate",
		name: `${nodes.length} ${layer} elements`,
		description: "Semantic aggregate; expand or filter to reveal evidence-backed members.",
		memberIds,
		evidence: evidence(nodes.flatMap((node) => node.evidence), "snapshot"),
	};
}

export function createC4ProjectionSnapshot(input: C4ProjectionInput): C4ProjectionSnapshot {
	const systemId = semanticId("system", input.repositoryId);
	const nodes: C4Node[] = [
		{
			id: systemId,
			lineageId: systemId,
			kind: "system",
			name: input.system.name,
			description: input.system.description,
			evidence: [input.repositoryId],
		},
		...input.externalDependencies.map((dependency) => ({
			id: semanticId("externalSystem", dependency.name).replace("externalSystem:", "external:"),
			lineageId: `external:${slug(dependency.name)}`,
			kind: "externalSystem" as const,
			name: dependency.name,
			description: dependency.description,
			evidence: evidence(dependency.evidence, "package.json"),
		})),
		...input.containers.map((node) => makeNode("container", node, "package.json")),
		...input.components.map((node) => makeNode("component", node, "architecture evidence")),
		...input.code.map((node) => makeNode("code", node, "architecture evidence")),
	];
	const known = new Set(nodes.map((node) => node.id));
	for (const node of nodes) {
		if (!node.parentId) continue;
		node.parentId = resolveInputReference(node.parentId, nodes);
	}
	const edges = input.relationships
		.map((relationship, index): C4Edge | null => {
			const source = resolveInputReference(relationship.source, nodes);
			const target = resolveInputReference(relationship.target, nodes);
			if (!known.has(source) || !known.has(target)) return null;
			return {
				id: `edge:${index}:${source}:${target}:${relationship.kind}`,
				source,
				target,
				kind: relationship.kind,
				confidence: relationship.confidence ?? 1,
				evidence: evidence(relationship.evidence, "architecture evidence"),
			};
		})
		.filter((edge): edge is C4Edge => edge !== null);
	const stable = { repositoryId: input.repositoryId, headSha: input.headSha, projectionVersion: input.projectionVersion, nodes, edges };
	const contentHash = hash(stable);
	return {
		id: `c4-${contentHash.slice(0, 16)}`,
		repositoryId: input.repositoryId,
		headSha: input.headSha,
		projectionVersion: input.projectionVersion,
		contentHash,
		generatedAt: new Date().toISOString(),
		nodes,
		edges,
		roots: {
			context: [systemId],
			container: nodes.flatMap((node) => node.kind === "container" ? [node.id] : []),
			component: nodes.flatMap((node) => node.kind === "component" ? [node.id] : []),
			code: nodes.flatMap((node) => node.kind === "code" ? [node.id] : []),
		},
	};
}

function layerNodes(snapshot: C4ProjectionSnapshot, layer: C4Layer): C4Node[] {
	return snapshot.nodes.filter((node) => node.kind !== "aggregate" && layerForKind[node.kind] === layer);
}

function rootedNodes(nodes: C4Node[], rootId: string | undefined, nodesById: Map<string, C4Node>, layer: C4Layer): C4Node[] {
	if (!rootId) return nodes;
	const root = nodesById.get(rootId);
	if (!root) throw new Error(`Unknown C4 root: ${rootId}`);
	const scoped = nodes.filter((node) => isWithinRoot(node, root.id, nodesById));
	if (!scoped.length) throw new Error(`Root ${rootId} does not belong to ${layer}`);
	return scoped;
}

function filteredNodes(nodes: C4Node[], request: VisibleGraphRequest): C4Node[] {
	const query = request.query?.trim().toLowerCase();
	return nodes.filter((node) => {
		if (query && !`${node.name} ${node.description}`.toLowerCase().includes(query)) return false;
		return !request.kinds?.length || request.kinds.includes(node.kind);
	});
}

function focusedNodes(nodes: C4Node[], snapshot: C4ProjectionSnapshot, focus: string | undefined): C4Node[] {
	if (!focus || !snapshot.nodes.some((node) => node.id === focus)) return nodes;
	const neighborIds = new Set([focus]);
	for (const edge of snapshot.edges) {
		if (edge.source === focus) neighborIds.add(edge.target);
		if (edge.target === focus) neighborIds.add(edge.source);
	}
	return nodes.filter((node) => neighborIds.has(node.id));
}

function graphEdges(snapshot: C4ProjectionSnapshot, layer: C4Layer, nodes: C4Node[], capApplied: boolean): C4Edge[] {
	if (capApplied) return [];
	const visibleIds = new Set(nodes.map((node) => node.id));
	return layer === "context"
		? edgesForContext(snapshot, visibleIds)
		: summariseEdges(snapshot.edges, visibleIds);
}

function hashVisibleGraph(snapshot: C4ProjectionSnapshot, request: VisibleGraphRequest, nodes: C4Node[], edges: C4Edge[]): string {
	return hash({
		snapshotId: snapshot.id,
		layer: request.layer,
		root: request.root,
		query: request.query,
		kinds: request.kinds,
		focus: request.focus,
		nodes: nodes.map((node) => node.id),
		edges: edges.map((edge) => edge.id),
	});
}

export function deriveVisibleGraph(snapshot: C4ProjectionSnapshot, request: VisibleGraphRequest): VisibleGraph {
	const maxNodes = Math.min(Math.max(request.maxNodes ?? 500, 1), 500);
	const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]));
	const atomicNodes = focusedNodes(
		filteredNodes(rootedNodes(layerNodes(snapshot, request.layer), request.root, nodesById, request.layer), request),
		snapshot,
		request.focus,
	).sort((left, right) => left.id.localeCompare(right.id));
	const capApplied = atomicNodes.length > maxNodes;
	const nodes = capApplied ? [aggregate(request.layer, atomicNodes)] : atomicNodes;
	const edges = graphEdges(snapshot, request.layer, nodes, capApplied);
	return {
		snapshotId: snapshot.id,
		repositoryId: snapshot.repositoryId,
		headSha: snapshot.headSha,
		layer: request.layer,
		root: request.root,
		visibleGraphHash: hashVisibleGraph(snapshot, request, nodes, edges),
		nodes,
		edges,
		cap: { maxNodes, atomicNodeCount: atomicNodes.length, applied: capApplied },
	};
}
