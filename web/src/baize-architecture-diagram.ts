import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { sharedStyles } from "./baize-styles.js";
import { AssetMutationError, updateAsset, type AssetValidationError } from "./workflow-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ArchComponent {
	componentId: string;
	name: string;
	responsibility?: string;
	description?: string;
	layer?: string;
	boundary?: string;
}

interface ArchRelationship {
	relationshipId: string;
	fromComponentId: string;
	toComponentId: string;
	interaction: string;
	type?: "sync-call" | "async-event" | "data-flow" | "dependency";
	description?: string;
}

interface ComponentLayout {
	componentId: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

interface RelationshipLayout {
	relationshipId: string;
	waypoints?: { x: number; y: number }[];
}

interface BoundaryLayout {
	label: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

interface ArchLayout {
	components?: ComponentLayout[];
	relationships?: RelationshipLayout[];
	boundaries?: BoundaryLayout[];
}

interface ArchContent {
	schemaVersion?: string;
	artifactKind?: string;
	summary?: string;
	sourceRefs?: unknown[];
	architecture: {
		components: ArchComponent[];
		relationships: ArchRelationship[];
		constraints?: string[];
		nonFunctionalRequirements?: string[];
		layout?: ArchLayout;
	};
}

interface Point {
	x: number;
	y: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RELATIONSHIP_TYPES: readonly ("sync-call" | "async-event" | "data-flow" | "dependency")[] = [
	"sync-call",
	"async-event",
	"data-flow",
	"dependency",
];

const TYPE_LABELS: Record<string, string> = {
	"sync-call": "同步调用",
	"async-event": "异步事件",
	"data-flow": "数据流",
	dependency: "依赖",
};

const NODE_WIDTH = 180;
const NODE_HEIGHT = 80;
const LAYER_GAP = 80;
const BOUNDARY_GAP = 40;
const NODE_GAP_X = 60;
const NODE_GAP_Y = 50;
const BOUNDARY_PAD = 24;
const CANVAS_PAD = 60;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;

type Renderable = ReturnType<typeof html> | typeof nothing;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uuid(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeContent(value: unknown): ArchContent {
	const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
	const arch =
		typeof record.architecture === "object" && record.architecture !== null && !Array.isArray(record.architecture)
			? (record.architecture as Record<string, unknown>)
			: {};
	return {
		schemaVersion: typeof record.schemaVersion === "string" ? record.schemaVersion : "asset/architecture/v1",
		artifactKind: typeof record.artifactKind === "string" ? record.artifactKind : "architecture",
		summary: typeof record.summary === "string" ? record.summary : "",
		sourceRefs: Array.isArray(record.sourceRefs) ? record.sourceRefs : [],
		architecture: {
			components: Array.isArray(arch.components) ? (arch.components as ArchComponent[]) : [],
			relationships: Array.isArray(arch.relationships) ? (arch.relationships as ArchRelationship[]) : [],
			constraints: Array.isArray(arch.constraints) ? (arch.constraints as string[]) : [],
			nonFunctionalRequirements: Array.isArray(arch.nonFunctionalRequirements)
				? (arch.nonFunctionalRequirements as string[])
				: [],
			layout:
				typeof arch.layout === "object" && arch.layout !== null && !Array.isArray(arch.layout)
					? (arch.layout as ArchLayout)
					: undefined,
		},
	};
}

function getComponentLayout(layout: ArchLayout | undefined, componentId: string): ComponentLayout | undefined {
	return layout?.components?.find((entry) => entry.componentId === componentId);
}


function getComponentById(content: ArchContent, componentId: string): ArchComponent | undefined {
	return content.architecture.components.find((c) => c.componentId === componentId);
}

function getRelationshipById(content: ArchContent, relationshipId: string): ArchRelationship | undefined {
	return content.architecture.relationships.find((r) => r.relationshipId === relationshipId);
}

function ensureLayout(content: ArchContent): ArchLayout {
	if (!content.architecture.layout) {
		content.architecture.layout = { components: [], relationships: [], boundaries: [] };
	}
	return content.architecture.layout;
}

function setComponentLayout(content: ArchContent, componentId: string, rect: ComponentLayout): void {
	const layout = ensureLayout(content);
	if (!layout.components) layout.components = [];
	const index = layout.components.findIndex((entry) => entry.componentId === componentId);
	if (index >= 0) {
		layout.components[index] = rect;
	} else {
		layout.components.push(rect);
	}
}

function removeComponentLayout(content: ArchContent, componentId: string): void {
	const layout = content.architecture.layout;
	if (!layout?.components) return;
	layout.components = layout.components.filter((entry) => entry.componentId !== componentId);
}

function removeRelationshipLayout(content: ArchContent, relationshipId: string): void {
	const layout = content.architecture.layout;
	if (!layout?.relationships) return;
	layout.relationships = layout.relationships.filter((entry) => entry.relationshipId !== relationshipId);
}

function edgeMidpoint(from: ComponentLayout, to: ComponentLayout): Point {
	return { x: (from.x + from.width / 2 + to.x + to.width / 2) / 2, y: (from.y + from.height / 2 + to.y + to.height / 2) / 2 };
}

function arrowPath(from: ComponentLayout, to: ComponentLayout): string {
	const fx = from.x + from.width / 2;
	const fy = from.y + from.height / 2;
	const tcx = to.x + to.width / 2;
	const tcy = to.y + to.height / 2;
	const dx = tcx - fx;
	const dy = tcy - fy;
	const dist = Math.sqrt(dx * dx + dy * dy) || 1;
	const nx = dx / dist;
	const ny = dy / dist;
	const hw = to.width / 2 + 6;
	const hh = to.height / 2 + 6;
	const txs: number[] = [];
	if (Math.abs(nx) > 0.0001) {
		txs.push((Math.sign(nx) * hw - (fx - tcx)) / nx);
	}
	if (Math.abs(ny) > 0.0001) {
		txs.push((Math.sign(ny) * hh - (fy - tcy)) / ny);
	}
	const valid = txs.filter((t) => t > 0 && t <= dist);
	const t = valid.length > 0 ? Math.min(...valid) - 10 : dist - 10;
	const end = Math.max(0, t);
	const ex = fx + nx * end;
	const ey = fy + ny * end;
	return `M ${fx} ${fy} L ${ex} ${ey}`;
}

function waypointPath(from: ComponentLayout, waypoints: readonly Point[], to: ComponentLayout): string {
	const segments = [`M ${from.x + from.width / 2} ${from.y + from.height / 2}`];
	for (const point of waypoints) {
		segments.push(`L ${point.x} ${point.y}`);
	}
	const last = waypoints[waypoints.length - 1];
	const anchor = { x: last.x, y: last.y, width: 0, height: 0 } as ComponentLayout;
	const dx = to.x + to.width / 2 - last.x;
	const dy = to.y + to.height / 2 - last.y;
	const dist = Math.sqrt(dx * dx + dy * dy) || 1;
	const t = Math.max(0, dist - 10);
	segments.push(`L ${anchor.x + (dx / dist) * t} ${anchor.y + (dy / dist) * t}`);
	return segments.join(" ");
}

// ---------------------------------------------------------------------------
// Auto layout
// ---------------------------------------------------------------------------

function autoLayout(content: ArchContent): ArchLayout {
	const components = content.architecture.components;
	const relationships = content.architecture.relationships;
	if (components.length === 0) {
		return { components: [], relationships: [], boundaries: [] };
	}
	const layout: ArchLayout = { components: [], relationships: [], boundaries: [] };
	const layoutComponents = layout.components!;
	const layoutBoundaries = layout.boundaries!;
	const layoutRelationships = layout.relationships!;

	// Layer ordering with default fallback
	const layerOrder = Array.from(new Set(components.map((c) => c.layer || "default")));
	const boundaryOrder = Array.from(new Set(components.map((c) => (c.boundary || ""))));

	const columnsPerLayer = Math.max(1, Math.ceil(Math.sqrt(components.length / Math.max(1, layerOrder.length))));

	const byBoundary: Record<string, BoundaryLayout> = {};

	for (const boundary of boundaryOrder) {
		byBoundary[boundary] = {
			label: boundary || "未分组",
			x: Infinity,
			y: Infinity,
			width: 0,
			height: 0,
		};
	}

	let currentX = CANVAS_PAD;
	for (const layer of layerOrder) {
		const layerComponents = components.filter((c) => (c.layer || "default") === layer);

		for (const boundary of boundaryOrder) {
			const boundaryComps = layerComponents.filter((c) => (c.boundary || "") === boundary);
			if (boundaryComps.length === 0) continue;
			const bx = currentX + BOUNDARY_PAD;
			const by = CANVAS_PAD + BOUNDARY_PAD;
			let maxH = 0;
			for (let i = 0; i < boundaryComps.length; i++) {
				const comp = boundaryComps[i]!;
				const col = i % columnsPerLayer;
				const row = Math.floor(i / columnsPerLayer);
				const x = bx + col * (NODE_WIDTH + NODE_GAP_X);
				const y = by + row * (NODE_HEIGHT + NODE_GAP_Y);
				layoutComponents.push({ componentId: comp.componentId, x, y, width: NODE_WIDTH, height: NODE_HEIGHT });
				maxH = Math.max(maxH, (row + 1) * (NODE_HEIGHT + NODE_GAP_Y) - NODE_GAP_Y);
			}
			const boundaryBox = byBoundary[boundary]!;
			boundaryBox.x = Math.min(boundaryBox.x, currentX);
			boundaryBox.y = Math.min(boundaryBox.y, CANVAS_PAD);
			boundaryBox.width = Math.max(
				boundaryBox.width,
				bx + columnsPerLayer * (NODE_WIDTH + NODE_GAP_X) - NODE_GAP_X + BOUNDARY_PAD - currentX,
			);
			boundaryBox.height = Math.max(boundaryBox.height, maxH + BOUNDARY_PAD * 2);
		}

		currentX += NODE_WIDTH * columnsPerLayer + NODE_GAP_X * (columnsPerLayer - 1) + LAYER_GAP + BOUNDARY_GAP;
	}

	for (const boundary of boundaryOrder) {
		const box = byBoundary[boundary]!;
		if (box.x !== Infinity) {
			layoutBoundaries.push(box);
		}
	}

	// simple straight edges between centers
	for (const rel of relationships) {
		const from = layoutComponents.find((c) => c.componentId === rel.fromComponentId);
		const to = layoutComponents.find((c) => c.componentId === rel.toComponentId);
		if (from && to) {
			layoutRelationships.push({ relationshipId: rel.relationshipId });
		}
	}

	return layout;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export class BaizeArchitectureDiagram extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		assetId: { type: Number, attribute: "asset-id" },
		expectedRevisionId: { type: Number, attribute: "expected-revision-id" },
		content: { type: Object },
		title: { type: String },
		draft: { state: true },
		panState: { state: true },
		sidebarCollapsed: { state: true },
		fieldErrors: { state: true },
		conflict: { state: true },
		saving: { state: true },
		modified: { state: true },
		selectedComponentId: { state: true },
		selectedRelationshipId: { state: true },
		zoom: { state: true },
		offset: { state: true },
		typeFilter: { state: true },
		collapsedBoundaries: { state: true },
		addingComponentAt: { state: true },
		renamingComponentId: { state: true },
		dragState: { state: true },
		newRelationship: { state: true },
		listFilter: { state: true },
	};

	declare apiBase: string;
	declare assetId: number;
	declare expectedRevisionId: number;
	declare content: unknown;
	declare title: string;
	declare draft: ArchContent;
	declare panState: { startMouse: Point; startOffset: Point } | null;
	declare sidebarCollapsed: boolean;
	declare fieldErrors: Record<string, string>;
	declare conflict: boolean;
	declare saving: boolean;
	declare modified: boolean;
	declare selectedComponentId: string | null;
	declare selectedRelationshipId: string | null;
	declare zoom: number;
	declare offset: Point;
	declare typeFilter: Set<string>;
	declare collapsedBoundaries: Set<string>;
	declare addingComponentAt: Point | null;
	declare renamingComponentId: string | null;
	declare dragState: { componentId: string; startMouse: Point; startLayout: Point } | null;
	declare newRelationship: { fromComponentId: string; mouse: Point } | null;
	declare listFilter: string;

	private svgRef: SVGSVGElement | null = null;

	firstUpdated(): void {
		this.svgRef = this.renderRoot.querySelector("svg");
	}

	constructor() {
		super();
		this.apiBase = "";
		this.assetId = 0;
		this.expectedRevisionId = 0;
		this.content = {};
		this.title = "";
		this.draft = normalizeContent({ architecture: { components: [], relationships: [] } });
		this.panState = null;
		this.sidebarCollapsed = false;
		this.fieldErrors = {};
		this.conflict = false;
		this.saving = false;
		this.selectedComponentId = null;
		this.selectedRelationshipId = null;
		this.zoom = 1;
		this.offset = { x: 0, y: 0 };
		this.typeFilter = new Set(RELATIONSHIP_TYPES);
		this.collapsedBoundaries = new Set();
		this.addingComponentAt = null;
		this.renamingComponentId = null;
		this.dragState = null;
		this.newRelationship = null;
		this.listFilter = "";
		this.panState = null;
	}

	connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener("baize-asset-save-error", this._onSaveError);
		window.addEventListener("keydown", this._onKeyDown);
	}

	disconnectedCallback(): void {
		window.removeEventListener("baize-asset-save-error", this._onSaveError);
		window.removeEventListener("keydown", this._onKeyDown);
		super.disconnectedCallback();
	}

	willUpdate(changed: PropertyValues<this>): void {
		if (changed.has("content")) {
			this.draft = normalizeContent(this.content);
			this._ensureLayout();
			this.modified = false;
			this.fieldErrors = {};
			this.conflict = false;
			this.selectedComponentId = null;
			this.selectedRelationshipId = null;
			this.addingComponentAt = null;
			this.renamingComponentId = null;
			this.dragState = null;
			this.newRelationship = null;
			this.panState = null;
			this.zoom = 1;
			this.offset = { x: 0, y: 0 };
		}
	}

	private _onSaveError = (event: Event): void => {
		const detail = (event as CustomEvent).detail as { errors?: AssetValidationError[]; message?: string } | undefined;
		const errors = Array.isArray(detail?.errors) ? detail.errors : [];
		const message = typeof detail?.message === "string" ? detail.message : "";
		if (errors.some((e) => e.type === "version_conflict") || message.toLowerCase().includes("version_conflict")) {
			this.conflict = true;
			this.saving = false;
			return;
		}
		const map: Record<string, string> = {};
		for (const error of errors) {
			map[error.path] = error.message;
		}
		this.fieldErrors = map;
		this.saving = false;
	};

	private _onKeyDown = (event: KeyboardEvent): void => {
		const target = event.target as HTMLElement | null;
		const inFormField =
			target !== null &&
			(target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
			event.preventDefault();
			void this._save();
			return;
		}
		if (inFormField) return;
		if (event.key === "Delete" || event.key === "Backspace") {
			if (this.selectedComponentId) this._deleteComponent(this.selectedComponentId);
			else if (this.selectedRelationshipId) this._deleteRelationship(this.selectedRelationshipId);
		}
		if (event.key === "Escape") {
			this._deselect();
			this.addingComponentAt = null;
			this.renamingComponentId = null;
			this.newRelationship = null;
			this.dragState = null;
			this.panState = null;
		}
	};

	/** 无 layout 时按 layer/boundary 网格确定性自动布局;layout 变更不计入 modified。 */
	private _ensureLayout(): void {
		const layout = this.draft.architecture.layout;
		const hasPositions = (layout?.components?.length ?? 0) > 0;
		if (!hasPositions && this.draft.architecture.components.length > 0) {
			this.draft.architecture.layout = autoLayout(this.draft);
		}
	}

	private _setModified(): void {
		this.modified = true;
		this.fieldErrors = {};
		this.conflict = false;
	}

	private _markContentModified(path?: string): void {
		this._setModified();
		if (path) {
			// Clear field error for changed path
			const next = { ...this.fieldErrors };
			delete next[path];
			this.fieldErrors = next;
		}
	}

	private _deselect(): void {
		this.selectedComponentId = null;
		this.selectedRelationshipId = null;
	}

	private _svgPoint(clientX: number, clientY: number): Point {
		if (!this.svgRef) return { x: 0, y: 0 };
		const pt = this.svgRef.createSVGPoint();
		pt.x = clientX;
		pt.y = clientY;
		const ctm = this.svgRef.getScreenCTM();
		if (!ctm) return { x: 0, y: 0 };
		const svgP = pt.matrixTransform(ctm.inverse());
		return { x: svgP.x, y: svgP.y };
	}

	private _toWorld(svgX: number, svgY: number): Point {
		return { x: (svgX - this.offset.x) / this.zoom, y: (svgY - this.offset.y) / this.zoom };
	}

	private _zoomTo(factor: number, center?: Point): void {
		const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor));
		if (this.svgRef) {
			const rect = this.svgRef.getBoundingClientRect();
			const point = center ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
			const cx = point.x - rect.left;
			const cy = point.y - rect.top;
			const before = this._toWorld(cx, cy);
			this.offset = {
				x: cx - before.x * next,
				y: cy - before.y * next,
			};
		}
		this.zoom = next;
	}

	private _fit(): void {
		const layout = this.draft.architecture.layout;
		if (!layout || !this.svgRef) return;
		const all = [
			...(layout.components || []),
			...(layout.boundaries || []),
		];
		if (all.length === 0) return;
		const minX = Math.min(...all.map((a) => a.x));
		const minY = Math.min(...all.map((a) => a.y));
		const maxX = Math.max(...all.map((a) => a.x + ("width" in a ? a.width : 0)));
		const maxY = Math.max(...all.map((a) => a.y + ("height" in a ? a.height : 0)));
		const width = Math.max(1, maxX - minX);
		const height = Math.max(1, maxY - minY);
		const rect = this.svgRef.getBoundingClientRect();
		const padding = 40;
		this.zoom = Math.max(MIN_ZOOM, Math.min((rect.width - padding * 2) / width, (rect.height - padding * 2) / height, 1));
		this.offset = {
			x: rect.width / 2 - (minX + width / 2) * this.zoom,
			y: rect.height / 2 - (minY + height / 2) * this.zoom,
		};
	}

	private _addComponent(at: Point, boundary = "", layer = ""): void {
		const component: ArchComponent = {
			componentId: uuid(),
			name: "新组件",
			responsibility: "",
			description: "",
			layer: layer || "default",
			boundary: boundary || "",
		};
		this.draft.architecture.components = [...this.draft.architecture.components, component];
		setComponentLayout(this.draft, component.componentId, {
			componentId: component.componentId,
			x: at.x - NODE_WIDTH / 2,
			y: at.y - NODE_HEIGHT / 2,
			width: NODE_WIDTH,
			height: NODE_HEIGHT,
		});
		this._markContentModified();
		this.selectedComponentId = component.componentId;
		this.renamingComponentId = component.componentId;
		this.addingComponentAt = null;
	}

	private _deleteComponent(componentId: string): void {
		const comp = getComponentById(this.draft, componentId);
		if (!comp) return;
		const removedRelIds = new Set(
			this.draft.architecture.relationships
				.filter((r) => r.fromComponentId === componentId || r.toComponentId === componentId)
				.map((r) => r.relationshipId),
		);
		this.draft.architecture.components = this.draft.architecture.components.filter((c) => c.componentId !== componentId);
		this.draft.architecture.relationships = this.draft.architecture.relationships.filter(
			(r) => !removedRelIds.has(r.relationshipId),
		);
		removeComponentLayout(this.draft, componentId);
		for (const relationshipId of removedRelIds) {
			removeRelationshipLayout(this.draft, relationshipId);
		}
		if (this.selectedComponentId === componentId) this.selectedComponentId = null;
		this._markContentModified();
	}

	private _renameComponent(componentId: string, name: string): void {
		const comp = getComponentById(this.draft, componentId);
		if (!comp) return;
		comp.name = name.trim() || comp.name;
		this._markContentModified(`/architecture/components/${componentId}/name`);
		this.renamingComponentId = null;
	}

	private _updateComponentField(componentId: string, field: keyof ArchComponent, value: string): void {
		const comp = getComponentById(this.draft, componentId);
		if (!comp) return;
	(comp as unknown as Record<string, unknown>)[field] = value;
		this._markContentModified(`/architecture/components/${componentId}/${String(field)}`);
	}

	private _addRelationship(fromComponentId: string, toComponentId: string): void {
		if (fromComponentId === toComponentId) return;
		const exists = this.draft.architecture.relationships.some(
			(r) => r.fromComponentId === fromComponentId && r.toComponentId === toComponentId,
		);
		if (exists) return;
		const rel: ArchRelationship = {
			relationshipId: uuid(),
			fromComponentId,
			toComponentId,
			interaction: "",
			type: "sync-call",
			description: "",
		};
		this.draft.architecture.relationships = [...this.draft.architecture.relationships, rel];
		this._markContentModified();
		this.selectedRelationshipId = rel.relationshipId;
	}

	private _deleteRelationship(relationshipId: string): void {
		this.draft.architecture.relationships = this.draft.architecture.relationships.filter(
			(r) => r.relationshipId !== relationshipId,
		);
		removeRelationshipLayout(this.draft, relationshipId);
		if (this.selectedRelationshipId === relationshipId) this.selectedRelationshipId = null;
		this._markContentModified();
	}

	private _updateRelationshipField(relationshipId: string, field: keyof ArchRelationship, value: unknown): void {
		const rel = getRelationshipById(this.draft, relationshipId);
		if (!rel) return;
	(rel as unknown as Record<string, unknown>)[field] = value;
		this._markContentModified(`/architecture/relationships/${relationshipId}/${String(field)}`);
	}

	private _toggleTypeFilter(type: string): void {
		const next = new Set(this.typeFilter);
		if (next.has(type)) next.delete(type);
		else next.add(type);
		this.typeFilter = next;
	}

	private _toggleBoundary(label: string): void {
		const next = new Set(this.collapsedBoundaries);
		if (next.has(label)) next.delete(label);
		else next.add(label);
		this.collapsedBoundaries = next;
	}

	private _setConstraint(index: number, value: string): void {
		const list = [...(this.draft.architecture.constraints || [])];
		list[index] = value;
		this.draft.architecture.constraints = list;
		this._markContentModified(`/architecture/constraints/${index}`);
	}

	private _addConstraint(): void {
		this.draft.architecture.constraints = [...(this.draft.architecture.constraints || []), ""];
		this._markContentModified();
	}

	private _removeConstraint(index: number): void {
		const list = [...(this.draft.architecture.constraints || [])];
		list.splice(index, 1);
		this.draft.architecture.constraints = list;
		this._markContentModified();
	}

	private _setNfr(index: number, value: string): void {
		const list = [...(this.draft.architecture.nonFunctionalRequirements || [])];
		list[index] = value;
		this.draft.architecture.nonFunctionalRequirements = list;
		this._markContentModified(`/architecture/nonFunctionalRequirements/${index}`);
	}

	private _addNfr(): void {
		this.draft.architecture.nonFunctionalRequirements = [...(this.draft.architecture.nonFunctionalRequirements || []), ""];
		this._markContentModified();
	}

	private _removeNfr(index: number): void {
		const list = [...(this.draft.architecture.nonFunctionalRequirements || [])];
		list.splice(index, 1);
		this.draft.architecture.nonFunctionalRequirements = list;
		this._markContentModified();
	}

	private _onCanvasMouseDown(event: MouseEvent): void {
		if (event.target !== this.svgRef) return;
		this._deselect();
		this.addingComponentAt = null;
		this.renamingComponentId = null;
		this.newRelationship = null;
		this.panState = {
			startMouse: { x: event.clientX, y: event.clientY },
			startOffset: { ...this.offset },
		};
	}

	private _onCanvasClick(event: MouseEvent): void {
		if (event.target === this.svgRef) {
			this._deselect();
			this.addingComponentAt = null;
			this.renamingComponentId = null;
			this.newRelationship = null;
		}
	}

	private _onCanvasDoubleClick(event: MouseEvent): void {
		const svgP = this._svgPoint(event.clientX, event.clientY);
		const worldP = this._toWorld(svgP.x, svgP.y);
		this.addingComponentAt = worldP;
	}

	private _onComponentMouseDown(event: MouseEvent, componentId: string): void {
		event.stopPropagation();
		this.selectedComponentId = componentId;
		this.selectedRelationshipId = null;
		if (event.shiftKey) {
			this.newRelationship = { fromComponentId: componentId, mouse: { x: event.clientX, y: event.clientY } };
		} else {
			const layout = getComponentLayout(this.draft.architecture.layout, componentId);
			if (layout) {
				this.dragState = {
					componentId,
					startMouse: { x: event.clientX, y: event.clientY },
					startLayout: { x: layout.x, y: layout.y },
				};
			}
		}
	}

	private _onComponentDoubleClick(event: MouseEvent, componentId: string): void {
		event.stopPropagation();
		const comp = getComponentById(this.draft, componentId);
		if (!comp) return;
		this.dispatchEvent(
			new CustomEvent("navigate", {
				detail: { componentId, kind: comp.layer === "api" ? "api" : comp.layer === "data" ? "data" : null },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private _onMouseMove(event: MouseEvent): void {
		if (this.dragState && this.svgRef) {
			const dx = (event.clientX - this.dragState.startMouse.x) / this.zoom;
			const dy = (event.clientY - this.dragState.startMouse.y) / this.zoom;
			const x = this.dragState.startLayout.x + dx;
			const y = this.dragState.startLayout.y + dy;
			setComponentLayout(this.draft, this.dragState.componentId, {
				componentId: this.dragState.componentId,
				x,
				y,
				width: NODE_WIDTH,
				height: NODE_HEIGHT,
			});
			this.requestUpdate();
		}
		if (this.panState) {
			this.offset = {
				x: this.panState.startOffset.x + (event.clientX - this.panState.startMouse.x),
				y: this.panState.startOffset.y + (event.clientY - this.panState.startMouse.y),
			};
		}
		if (this.newRelationship) {
			this.newRelationship = { ...this.newRelationship, mouse: { x: event.clientX, y: event.clientY } };
		}
	}

	private _onMouseUp(event: MouseEvent): void {
		if (this.dragState) {
			this.dragState = null;
		}
		if (this.panState) {
			this.panState = null;
		}
		if (this.newRelationship) {
			const target = event.target as Element | null;
			const componentId = target?.closest("[data-component-id]")?.getAttribute("data-component-id");
			if (componentId && componentId !== this.newRelationship.fromComponentId) {
				this._addRelationship(this.newRelationship.fromComponentId, componentId);
			}
			this.newRelationship = null;
		}
	}

	private _onWheel(event: WheelEvent): void {
		event.preventDefault();
		const delta = event.deltaY > 0 ? 0.9 : 1.1;
		this._zoomTo(this.zoom * delta, { x: event.clientX, y: event.clientY });
	}

	private _onRelationshipClick(event: Event, relationshipId: string): void {
		event.stopPropagation();
		this.selectedRelationshipId = relationshipId;
		this.selectedComponentId = null;
	}

	private async _save(): Promise<void> {
		if (!this.modified || this.saving) return;
		this.saving = true;
		this.dispatchEvent(
			new CustomEvent("save", {
				detail: { content: this.draft, title: this.title },
				bubbles: true,
				composed: true,
			}),
		);
		// optimistic: parent will either reload on success or dispatch error window event
		window.setTimeout(() => {
			this.saving = false;
		}, 500);
	}

	private _reload(): void {
		this.draft = normalizeContent(this.content);
		this._ensureLayout();
		this.modified = false;
		this.conflict = false;
		this.fieldErrors = {};
		this.selectedComponentId = null;
		this.selectedRelationshipId = null;
	}

	// ---------------------------------------------------------------------------
	// Render
	// ---------------------------------------------------------------------------

	static styles = [
		sharedStyles,
		css`
			:host {
				display: block;
				min-height: 0;
			}
			.wrap {
				display: grid;
				grid-template-columns: 1fr 320px;
				gap: var(--gap);
				height: 100%;
				min-height: 0;
			}
			.wrap.no-sidebar { grid-template-columns: 1fr; }
			@media (max-width: 1023px) {
				.wrap { grid-template-columns: 1fr; }
			}
			.diagram {
				display: flex;
				flex-direction: column;
				min-width: 0;
				border: 1px solid var(--border);
				border-radius: var(--radius);
				background: var(--surface);
				overflow: hidden;
			}
			.toolbar {
				display: flex;
				align-items: center;
				gap: var(--gap);
				padding: var(--pad);
				border-bottom: 1px solid var(--border);
				flex-wrap: wrap;
			}
			.toolbar .spacer { flex: 1; }
			.canvas-wrap {
				position: relative;
				flex: 1 1 auto;
				min-height: 24rem;
				overflow: hidden;
				cursor: grab;
			}
			.canvas-wrap:active { cursor: grabbing; }
			svg {
				display: block;
				width: 100%;
				height: 100%;
			}
			.layer-band { fill: var(--surface-2); opacity: 0.35; }
			.boundary-box {
				fill: transparent;
				stroke: var(--border-strong);
				stroke-width: 1;
				stroke-dasharray: 6 4;
			}
			.boundary-label {
				fill: var(--text-muted);
				font-size: var(--text-xs);
				font-weight: 600;
				text-transform: uppercase;
				letter-spacing: 0.06em;
			}
			.component-rect {
				fill: var(--surface-2);
				stroke: var(--border-strong);
				stroke-width: 1;
				rx: var(--radius);
				transition: stroke var(--dur-1) var(--ease-out), fill var(--dur-1) var(--ease-out);
			}
			.component-rect.selected {
				stroke: var(--accent);
				stroke-width: 2;
				fill: var(--surface-hover);
			}
			.component-rect:hover { stroke: var(--accent-line); }
			.component-text {
				fill: var(--text);
				font-size: var(--text-sm);
				font-weight: 600;
				cursor: text;
			}
			.component-sub {
				fill: var(--text-muted);
				font-size: var(--text-xs);
				pointer-events: none;
			}
			.edge-path {
				fill: none;
				stroke: var(--text-muted);
				stroke-width: 1.5;
				pointer-events: stroke;
				cursor: pointer;
			}
			.edge-path:hover, .edge-path.selected { stroke: var(--accent); stroke-width: 2.5; }
			.edge-label {
				fill: var(--text-muted);
				font-size: var(--text-xs);
				pointer-events: none;
			}
			.edge-label-bg {
				fill: var(--surface);
				opacity: 0.9;
			}
			.draft-edge {
				fill: none;
				stroke: var(--accent-line);
				stroke-width: 1.5;
				stroke-dasharray: 4 4;
				pointer-events: none;
			}
			.filters {
				display: flex;
				align-items: center;
				gap: 10px;
				flex-wrap: wrap;
			}
			.filter {
				display: inline-flex;
				align-items: center;
				gap: 4px;
				font-size: var(--text-xs);
				color: var(--text-muted);
				cursor: pointer;
			}
			.filter input { width: 14px; height: 14px; accent-color: var(--accent); }
			.sidebar {
				display: flex;
				flex-direction: column;
				gap: var(--gap);
				min-width: 0;
			}
			.panel {
				border: 1px solid var(--border);
				border-radius: var(--radius);
				background: var(--surface);
				padding: var(--pad);
				min-width: 0;
			}
			.panel h3 {
				margin: 0 0 10px;
				font-size: var(--text-sm);
				color: var(--text-muted);
				text-transform: uppercase;
				letter-spacing: 0.06em;
			}
			.field {
				display: flex;
				flex-direction: column;
				gap: 4px;
				margin-bottom: 10px;
			}
			.field label {
				font-size: var(--text-xs);
				color: var(--text-subtle);
			}
			.field input, .field textarea, .field select {
				width: 100%;
				font-size: var(--text-sm);
			}
			.field .error {
				color: var(--danger);
				font-size: var(--text-xs);
			}
			.list {
				max-height: 12rem;
				overflow: auto;
				border: 1px solid var(--border);
				border-radius: var(--radius-sm);
			}
			.list-item {
				display: flex;
				align-items: center;
				justify-content: space-between;
				padding: 6px 8px;
				border-bottom: 1px solid var(--border);
				font-size: var(--text-sm);
				cursor: pointer;
			}
			.list-item:last-child { border-bottom: none; }
			.list-item:hover, .list-item.active { background: var(--surface-hover); }
			.list-item .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.list-item .badge { flex-shrink: 0; }
			.config-list {
				display: flex;
				flex-direction: column;
				gap: 6px;
			}
			.config-row {
				display: grid;
				grid-template-columns: 1fr auto;
				gap: 6px;
				align-items: start;
			}
			.config-row input { min-width: 0; }
			.inline-name {
				font: inherit;
				color: inherit;
				background: transparent;
				border: none;
				border-bottom: 1px dashed var(--accent-line);
				width: 100%;
				text-align: center;
				outline: none;
				padding: 0;
			}
			.add-form {
				position: absolute;
				top: var(--pad);
				left: 50%;
				transform: translateX(-50%);
				z-index: 2;
				width: min(20rem, 80%);
				padding: var(--pad);
				border: 1px solid var(--border-strong);
				border-radius: var(--radius);
				background: var(--surface-2);
				box-shadow: 0 4px 16px var(--shadow-1);
			}
			.empty {
				position: absolute;
				inset: 0;
				display: grid;
				place-items: center;
				padding: var(--pad);
				text-align: center;
				background: var(--surface);
				pointer-events: none;
			}
			.empty .field { pointer-events: auto; }
			.conflict {
				padding: var(--pad);
				background: var(--warn-soft);
				border: 1px solid var(--warn-line);
				border-radius: var(--radius);
				color: var(--warn);
				font-size: var(--text-sm);
			}
			.conflict button { margin-top: 8px; }
			.hint { color: var(--text-subtle); font-size: var(--text-xs); margin-top: 4px; }
		`,
	];

	render() {
		const components = this.draft.architecture.components;
		const empty = components.length === 0;

		return html`
			<div class="wrap ${this.sidebarCollapsed ? "no-sidebar" : ""}">
					${this.conflict
						? html`<div class="conflict">
								版本冲突：其他用户已保存新版本。请点击重载以放弃本地修改。
								<button @click=${this._reload}>重载</button>
							</div>`
						: nothing}
					<div class="toolbar">
						<button @click=${() => this._zoomTo(this.zoom * 1.2)} title="放大">＋</button>
						<button @click=${() => this._zoomTo(this.zoom / 1.2)} title="缩小">－</button>
						<button @click=${this._fit} title="自适应">自适应</button>
						<button @click=${() => (this.sidebarCollapsed = !this.sidebarCollapsed)} title="侧栏">
							${this.sidebarCollapsed ? "▸ 详情" : "▾ 详情"}
						</button>
						<div class="spacer"></div>
						<div class="filters">
							${RELATIONSHIP_TYPES.map(
								(type) => html`
									<label class="filter" title="${TYPE_LABELS[type]}">
										<input
											type="checkbox"
											.checked=${this.typeFilter.has(type)}
											@change=${() => this._toggleTypeFilter(type)}
										/>
										${TYPE_LABELS[type]}
									</label>
								`,
							)}
						</div>
						<div class="spacer"></div>
						<button
							class="primary"
							?disabled=${!this.modified || this.saving}
							@click=${this._save}
						>
							${this.saving ? "保存中…" : "保存"}
						</button>
					</div>
					<div class="canvas-wrap">
						<svg
							@mousedown=${this._onCanvasMouseDown}
							@click=${this._onCanvasClick}
							@dblclick=${this._onCanvasDoubleClick}
							@mousemove=${this._onMouseMove}
							@mouseup=${this._onMouseUp}
							@mouseleave=${this._onMouseUp}
							@wheel=${this._onWheel}
						>
							${this._renderDefs()}
							<g transform="translate(${this.offset.x}, ${this.offset.y}) scale(${this.zoom})">
								${empty
									? nothing
									: html`
										${this._renderLayerBands()}
										${this._renderBoundaries()}
										${this._renderRelationships()}
										${this._renderComponents()}
										${this._renderDraftRelationship()}
									`}
							</g>
						</svg>
						${this._renderCanvasOverlays(empty)}
					</div>
					${this._renderConfigSection()}
				</div>
				${this.sidebarCollapsed ? nothing : this._renderSidebar()}
			</div>
		`;
	}

	private _renderCanvasOverlays(empty: boolean): Renderable {
		if (this.addingComponentAt) {
			const at = this.addingComponentAt;
			return html`
				<div class="add-form">
					<div class="field">
						<label>新组件名称（位置 ${Math.round(at.x)}, ${Math.round(at.y)}）</label>
						<input
							autofocus
							placeholder="组件名称"
							@keydown=${(e: KeyboardEvent) => {
								const input = e.currentTarget as HTMLInputElement;
								if (e.key === "Enter") {
									const name = input.value.trim();
									if (name) {
										this._addComponentAt(at, name);
									}
								}
								if (e.key === "Escape") this.addingComponentAt = null;
							}}
							@blur=${(e: FocusEvent) => {
								const name = (e.currentTarget as HTMLInputElement).value.trim();
								if (name && this.addingComponentAt === at) {
									this._addComponentAt(at, name);
								} else if (this.addingComponentAt === at) {
									this.addingComponentAt = null;
								}
							}}
						/>
						<span class="hint">Enter 确认 · Esc 取消</span>
					</div>
				</div>
			`;
		}
		if (empty) {
			return html`<div class="empty">空架构。双击画布添加组件；Shift+拖拽组件建立关系。</div>`;
		}
		return nothing;
	}

	private _addComponentAt(at: Point, name: string): void {
		this._addComponent(at, "", "");
		const comp = this.draft.architecture.components.at(-1);
		if (comp) comp.name = name;
		this.requestUpdate();
	}

	private _renderDefs() {
		return html`
			<defs>
				<marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
					<path d="M 0 0 L 9 3 L 0 6 z" fill="var(--text-muted)" />
				</marker>
				<marker id="arrow-active" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
					<path d="M 0 0 L 9 3 L 0 6 z" fill="var(--accent)" />
				</marker>
			</defs>
		`;
	}

	private _renderLayerBands() {
		const layout = this.draft.architecture.layout;
		if (!layout?.components?.length) return nothing;
		const layers = Array.from(new Set(this.draft.architecture.components.map((c) => c.layer || "default")));
		return layers.map((layer) => {
			const comps = this.draft.architecture.components.filter((c) => (c.layer || "default") === layer);
			const layouts = comps
				.map((c) => getComponentLayout(layout, c.componentId))
				.filter((l): l is ComponentLayout => !!l);
			if (layouts.length === 0) return nothing;
			const minX = Math.min(...layouts.map((l) => l.x)) - BOUNDARY_PAD;
			const maxX = Math.max(...layouts.map((l) => l.x + l.width)) + BOUNDARY_PAD;
			const minY = Math.min(...layouts.map((l) => l.y)) - BOUNDARY_PAD;
			const maxY = Math.max(...layouts.map((l) => l.y + l.height)) + BOUNDARY_PAD;
			const width = maxX - minX + BOUNDARY_GAP;
			return html`
				<rect class="layer-band" x=${minX - BOUNDARY_GAP / 2} y=${minY} width=${width} height=${maxY - minY + BOUNDARY_GAP} />
				<text class="boundary-label" x=${minX + 8} y=${minY + 16}>${layer}</text>
			`;
		});
	}

	private _renderBoundaries() {
		const layout = this.draft.architecture.layout;
		if (!layout?.boundaries) return nothing;
		return layout.boundaries.map((b) => {
			const collapsed = this.collapsedBoundaries.has(b.label);
			return html`
				<g @click=${(e: Event) => {
					e.stopPropagation();
					this._toggleBoundary(b.label);
				}}>
					<rect
						class="boundary-box"
						x=${b.x}
						y=${b.y}
						width=${b.width}
						height=${b.height}
						rx=${8}
					/>
					<text class="boundary-label" x=${b.x + 8} y=${b.y - 6}>${b.label || "未分组"} ${collapsed ? "▸" : "▾"}</text>
				</g>
			`;
		});
	}

	private _renderComponents() {
		const layout = this.draft.architecture.layout;
		if (!layout?.components) return nothing;
		return this.draft.architecture.components.map((comp) => {
			const rect = getComponentLayout(layout, comp.componentId);
			if (!rect) return nothing;
			const collapsed = this.collapsedBoundaries.has(comp.boundary || "");
			if (collapsed) {
				return html`<circle cx=${rect.x + rect.width / 2} cy=${rect.y + rect.height / 2} r="4" fill="var(--text-muted)" />`;
			}
			const selected = this.selectedComponentId === comp.componentId;
			const renaming = this.renamingComponentId === comp.componentId;
			const error = this.fieldErrors[`/architecture/components/${comp.componentId}/name`];
			return html`
				<g
					data-component-id=${comp.componentId}
					@mousedown=${(e: MouseEvent) => this._onComponentMouseDown(e, comp.componentId)}
					@dblclick=${(e: MouseEvent) => this._onComponentDoubleClick(e, comp.componentId)}
				>
					<rect
						class="component-rect ${selected ? "selected" : ""}"
						x=${rect.x}
						y=${rect.y}
						width=${rect.width}
						height=${rect.height}
					/>
					${renaming
						? html`
								<foreignObject x=${rect.x} y=${rect.y + 8} width=${rect.width} height=${28}>
									<input
										autofocus
										class="inline-name"
										@keydown=${(e: KeyboardEvent) => {
											const input = e.target as HTMLInputElement;
											if (e.key === "Enter") this._renameComponent(comp.componentId, input.value);
											if (e.key === "Escape") this.renamingComponentId = null;
										}}
										@blur=${(e: FocusEvent) => {
											const input = e.target as HTMLInputElement;
											this._renameComponent(comp.componentId, input.value);
										}}
									/>
								</foreignObject>
							`
						: html`
								<text
									class="component-text"
									x=${rect.x + rect.width / 2}
									y=${rect.y + 26}
									text-anchor="middle"
									@dblclick=${(e: MouseEvent) => {
										e.stopPropagation();
										this.renamingComponentId = comp.componentId;
									}}
								>
									${comp.name}
								</text>
								${comp.responsibility
									? html`<text class="component-sub" x=${rect.x + rect.width / 2} y=${rect.y + 48} text-anchor="middle">
											${comp.responsibility.slice(0, 24)}${comp.responsibility.length > 24 ? "…" : ""}
									  </text>`
									: nothing}
							`}
					${error
						? html`<text class="component-sub" x=${rect.x + rect.width / 2} y=${rect.y - 8} text-anchor="middle" fill="var(--danger)">
								${error}
							  </text>`
						: nothing}
				</g>
			`;
		});
	}

	private _renderRelationships(): Renderable {
		const layout = this.draft.architecture.layout;
		if (!layout) return nothing;
		const edges = this.draft.architecture.relationships.filter((rel) => this.typeFilter.has(rel.type || "sync-call")).map((rel) => {
			const from = getComponentLayout(layout, rel.fromComponentId);
			const to = getComponentLayout(layout, rel.toComponentId);
			if (!from || !to) return nothing;
			const waypoints = layout.relationships?.find((entry) => entry.relationshipId === rel.relationshipId)?.waypoints ?? [];
			const selected = this.selectedRelationshipId === rel.relationshipId;
			const mid = waypoints.length > 0 ? waypoints[Math.floor((waypoints.length - 1) / 2)] : edgeMidpoint(from, to);
			const d = waypoints.length > 0 ? waypointPath(from, waypoints, to) : arrowPath(from, to);
			return html`
				<g @click=${(e: Event) => this._onRelationshipClick(e, rel.relationshipId)}>
					<path class="edge-path ${selected ? "selected" : ""}" d=${d} marker-end=${selected ? "url(#arrow-active)" : "url(#arrow)"} />
					<rect class="edge-label-bg" x=${mid.x - 30} y=${mid.y - 10} width="60" height="18" rx="4" />
					<text class="edge-label" x=${mid.x} y=${mid.y + 4} text-anchor="middle">
						${rel.interaction || TYPE_LABELS[rel.type || "sync-call"]}
					</text>
				</g>
			`;
		});
		return html`${edges}`;
	}

	private _renderDraftRelationship() {
		if (!this.newRelationship || !this.svgRef) return nothing;
		const from = getComponentLayout(this.draft.architecture.layout, this.newRelationship.fromComponentId);
		if (!from) return nothing;
		const svgP = this._svgPoint(this.newRelationship.mouse.x, this.newRelationship.mouse.y);
		const worldP = this._toWorld(svgP.x, svgP.y);
		return html`
			<line class="draft-edge" x1=${from.x + from.width / 2} y1=${from.y + from.height / 2} x2=${worldP.x} y2=${worldP.y} />
		`;
	}

	private _renderSidebar() {
		const selectedComponent = this.selectedComponentId ? getComponentById(this.draft, this.selectedComponentId) : null;
		const selectedRelationship = this.selectedRelationshipId ? getRelationshipById(this.draft, this.selectedRelationshipId) : null;
		const filteredComponents = this.draft.architecture.components.filter((c) =>
			c.name.toLowerCase().includes(this.listFilter.toLowerCase()),
		);
		const filteredRelationships = this.draft.architecture.relationships.filter(
			(r) =>
				r.interaction.toLowerCase().includes(this.listFilter.toLowerCase()) ||
				TYPE_LABELS[r.type || "sync-call"].includes(this.listFilter),
		);

		return html`
			<div class="sidebar">
				<div class="panel">
					<h3>组件 / 关系</h3>
					<input
						placeholder="过滤…"
						.value=${this.listFilter}
						@input=${(e: InputEvent) => (this.listFilter = (e.target as HTMLInputElement).value)}
					/>
					<div class="hint">组件</div>
					<div class="list">
						${filteredComponents.length === 0
							? html`<div class="list-item">无组件</div>`
							: filteredComponents.map(
									(c) => html`
										<div
											class="list-item ${this.selectedComponentId === c.componentId ? "active" : ""}"
											@click=${() => {
												this.selectedComponentId = c.componentId;
												this.selectedRelationshipId = null;
											}}
										>
											<span class="name">${c.name}</span>
											${c.layer ? html`<span class="badge">${c.layer}</span>` : nothing}
										</div>
									`,
							  )}
					</div>
					<div class="hint">关系</div>
					<div class="list">
						${filteredRelationships.length === 0
							? html`<div class="list-item">无关系</div>`
							: filteredRelationships.map(
									(r) => html`
										<div
											class="list-item ${this.selectedRelationshipId === r.relationshipId ? "active" : ""}"
											@click=${() => {
												this.selectedRelationshipId = r.relationshipId;
												this.selectedComponentId = null;
											}}
										>
											<span class="name">${r.interaction || TYPE_LABELS[r.type || "sync-call"]}</span>
											<span class="badge">${TYPE_LABELS[r.type || "sync-call"]}</span>
										</div>
									`,
							  )}
					</div>
				</div>

				${selectedComponent
					? html`
							<div class="panel">
								<h3>组件详情</h3>
								<div class="field">
									<label>名称</label>
									<input
										.value=${selectedComponent.name}
										@change=${(e: InputEvent) =>
											this._updateComponentField(selectedComponent.componentId, "name", (e.target as HTMLInputElement).value)}
									/>
									${this.fieldErrors[`/architecture/components/${selectedComponent.componentId}/name`]
										? html`<span class="error">${this.fieldErrors[`/architecture/components/${selectedComponent.componentId}/name`]}</span>`
										: nothing}
								</div>
								<div class="field">
									<label>职责</label>
									<textarea
										rows="3"
										.value=${selectedComponent.responsibility || ""}
										@change=${(e: InputEvent) =>
											this._updateComponentField(
												selectedComponent.componentId,
												"responsibility",
												(e.target as HTMLTextAreaElement).value,
											)}
									></textarea>
								</div>
								<div class="field">
									<label>分层</label>
									<input
										.value=${selectedComponent.layer || ""}
										@change=${(e: InputEvent) =>
											this._updateComponentField(selectedComponent.componentId, "layer", (e.target as HTMLInputElement).value)}
									/>
								</div>
								<div class="field">
									<label>边界</label>
									<input
										.value=${selectedComponent.boundary || ""}
										@change=${(e: InputEvent) =>
											this._updateComponentField(selectedComponent.componentId, "boundary", (e.target as HTMLInputElement).value)}
									/>
								</div>
								<div class="field">
									<label>描述</label>
									<textarea
										rows="2"
										.value=${selectedComponent.description || ""}
										@change=${(e: InputEvent) =>
											this._updateComponentField(
												selectedComponent.componentId,
												"description",
												(e.target as HTMLTextAreaElement).value,
											)}
									></textarea>
								</div>
								<div class="field">
									<button class="danger" @click=${() => this._deleteComponent(selectedComponent.componentId)}>删除组件</button>
								</div>
								${this._constraintsInvolving(selectedComponent.componentId).length > 0
									? html`
											<div class="hint">相关约束</div>
											<ul class="hint">
												${this._constraintsInvolving(selectedComponent.componentId).map((c) => html`<li>${c}</li>`)}
											</ul>
									  `
									: nothing}
							</div>
					  `
					: nothing}

				${selectedRelationship
					? html`
							<div class="panel">
								<h3>关系详情</h3>
								<div class="field">
									<label>交互</label>
									<input
										.value=${selectedRelationship.interaction}
										@change=${(e: InputEvent) =>
											this._updateRelationshipField(selectedRelationship.relationshipId, "interaction", (e.target as HTMLInputElement).value)}
									/>
								</div>
								<div class="field">
									<label>类型</label>
									<select
										.value=${selectedRelationship.type || "sync-call"}
										@change=${(e: InputEvent) =>
											this._updateRelationshipField(
												selectedRelationship.relationshipId,
												"type",
												(e.target as HTMLSelectElement).value,
											)}
									>
										${RELATIONSHIP_TYPES.map(
											(t) => html`<option value=${t} ?selected=${t === (selectedRelationship.type || "sync-call")}>${TYPE_LABELS[t]}</option>`,
										)}
									</select>
								</div>
								<div class="field">
									<label>描述</label>
									<textarea
										rows="2"
										.value=${selectedRelationship.description || ""}
										@change=${(e: InputEvent) =>
											this._updateRelationshipField(
												selectedRelationship.relationshipId,
												"description",
												(e.target as HTMLTextAreaElement).value,
											)}
									></textarea>
								</div>
								<div class="field">
									<button class="danger" @click=${() => this._deleteRelationship(selectedRelationship.relationshipId)}>删除关系</button>
								</div>
							</div>
					  `
					: nothing}
			</div>
		`;
	}

	private _constraintsInvolving(componentId: string): string[] {
		const comp = getComponentById(this.draft, componentId);
		if (!comp) return [];
		return (this.draft.architecture.constraints || []).filter(
			(c) =>
				c.toLowerCase().includes(comp.name.toLowerCase()) ||
				c.toLowerCase().includes((comp.componentId || "").toLowerCase()),
		);
	}

	private _renderConfigSection() {
		const constraints = this.draft.architecture.constraints || [];
		const nfrs = this.draft.architecture.nonFunctionalRequirements || [];
		return html`
			<div class="panel" style="margin: var(--pad); border-radius: var(--radius);">
				<h3>约束与非功能需求</h3>
				<div class="field">
					<label>约束 (${constraints.length})</label>
					<div class="config-list">
						${constraints.map(
							(c, i) => html`
								<div class="config-row">
									<input
										.value=${c}
										@change=${(e: InputEvent) => this._setConstraint(i, (e.target as HTMLInputElement).value)}
									/>
									<button class="danger" @click=${() => this._removeConstraint(i)}>删除</button>
								</div>
							`,
						)}
					</div>
					<button @click=${this._addConstraint}>添加约束</button>
				</div>
				<div class="field">
					<label>非功能需求 (${nfrs.length})</label>
					<div class="config-list">
						${nfrs.map(
							(n, i) => html`
								<div class="config-row">
									<input
										.value=${n}
										@change=${(e: InputEvent) => this._setNfr(i, (e.target as HTMLInputElement).value)}
									/>
									<button class="danger" @click=${() => this._removeNfr(i)}>删除</button>
								</div>
							`,
						)}
					</div>
					<button @click=${this._addNfr}>添加非功能需求</button>
				</div>
			</div>
		`;
	}
}

customElements.define("baize-architecture-diagram", BaizeArchitectureDiagram);
