import { LitElement, html, nothing, type PropertyValues } from "lit";
import { getAssetGraph, assetKindLabel, ASSET_KINDS, type AssetGraph, type AssetKind } from "./workflow-client.js";
import { KIND_TO_TAB, type Renderable, type WorkbenchTab } from "./baize-asset-library-constants.js";

/**
 * baize-asset-graph — Workspace 资产关系图(T3 自包含)。
 * 状态(kindFilter/zoom/offset)内部管理,不再依赖父级传参;节点点击通过 baize-graph-node-select 抛出。
 */
export class BaizeAssetGraph extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		refresh: { type: Number },
		graph: { state: true },
		loading: { state: true },
		error: { state: true },
		kindFilter: { state: true },
		zoom: { state: true },
		offsetX: { state: true },
		offsetY: { state: true },
	};

	declare apiBase: string;
	declare workspaceId: number;
	declare refresh: number;

	declare graph: AssetGraph | null;
	declare loading: boolean;
	declare error: string | null;
	declare kindFilter: AssetKind | null;
	declare zoom: number;
	declare offsetX: number;
	declare offsetY: number;
	private currentRequest = 0;

	createRenderRoot(): HTMLElement {
		return this;
	}

	constructor() {
		super();
		this.apiBase = "";
		this.workspaceId = 0;
		this.refresh = 0;
		this.graph = null;
		this.loading = false;
		this.error = null;
		this.kindFilter = null;
		this.zoom = 1;
		this.offsetX = 0;
		this.offsetY = 0;
	}

	protected updated(changed: PropertyValues<this>): void {
		if (changed.has("apiBase") || changed.has("workspaceId") || changed.has("refresh")) {
			if (this.workspaceId > 0) void this.loadGraph();
		}
	}

	private async loadGraph(): Promise<void> {
		const requestNo = ++this.currentRequest;
		this.loading = true;
		this.error = null;
		try {
			const graph = await getAssetGraph(this.apiBase, this.workspaceId);
			if (requestNo !== this.currentRequest) return;
			this.graph = graph;
		} catch (error) {
			if (requestNo !== this.currentRequest) return;
			this.error = error instanceof Error ? error.message : String(error);
		} finally {
			if (requestNo === this.currentRequest) this.loading = false;
		}
	}

	private visibleNodes(): readonly AssetGraph["nodes"][number][] {
		if (!this.graph) return [];
		if (!this.kindFilter) return this.graph.nodes;
		const selectedIds = new Set(this.graph.nodes.filter((node) => node.kind === this.kindFilter).map((node) => node.assetId));
		const visibleIds = new Set(selectedIds);
		for (const edge of this.graph.edges) {
			if (selectedIds.has(edge.fromAssetId) || selectedIds.has(edge.toAssetId)) {
				visibleIds.add(edge.fromAssetId);
				visibleIds.add(edge.toAssetId);
			}
		}
		return this.graph.nodes.filter((node) => visibleIds.has(node.assetId));
	}

	private setKindFilter(event: Event): void {
		const value = (event.target as HTMLSelectElement).value;
		this.kindFilter = value === "all" ? null : (value as AssetKind);
	}

	private setZoom(delta: number): void {
		this.zoom = Math.max(0.6, Math.min(2, this.zoom + delta));
	}

	private pan(dx: number, dy: number): void {
		this.offsetX = this.offsetX + dx;
		this.offsetY = this.offsetY + dy;
	}

	private openNode(assetId: number): void {
		const node = this.graph?.nodes.find((candidate) => candidate.assetId === assetId);
		if (!node) return;
		const tab = KIND_TO_TAB[node.kind];
		this.dispatchEvent(
			new CustomEvent("baize-graph-node-select", {
				detail: { tab, assetId: node.assetId },
				bubbles: true,
				composed: true,
			}),
		);
	}

	render(): Renderable {
		if (this.loading) return html`<div class="empty">正在加载 Workspace 关系图…</div>`;
		if (this.error) return html`<div class="empty error">关系图加载失败：${this.error}</div>`;
		if (!this.graph || this.graph.nodes.length === 0) return html`<div class="empty">当前 Workspace 暂无资产关系。</div>`;
		const nodes = this.visibleNodes();
		const columns = Math.max(1, Math.min(4, nodes.length));
		const positions = new Map<number, { x: number; y: number }>();
		nodes.forEach((node, index) => positions.set(node.assetId, { x: 40 + (index % columns) * 180, y: 40 + Math.floor(index / columns) * 90 }));
		const width = Math.max(560, columns * 180 + 80);
		const height = Math.max(300, Math.ceil(nodes.length / columns) * 90 + 80);
		const visibleIds = new Set(nodes.map((node) => node.assetId));
		const edges = this.graph.edges.filter((edge) => visibleIds.has(edge.fromAssetId) && visibleIds.has(edge.toAssetId));
		return html`
			<div class="graph-controls">
				<label
					>类型过滤
					<select @change=${(event: Event) => this.setKindFilter(event)}>
						<option value="all" ?selected=${this.kindFilter === null}>全部相邻节点</option>
						${ASSET_KINDS.map((kind) => html`<option value=${kind} ?selected=${this.kindFilter === kind}>${assetKindLabel(kind)}</option>`)}
					</select>
				</label>
				<button @click=${() => this.setZoom(-0.1)}>缩小</button>
				<button aria-label="向左平移" @click=${() => this.pan(-30, 0)}>←</button>
				<button aria-label="向右平移" @click=${() => this.pan(30, 0)}>→</button>
				<button aria-label="向上平移" @click=${() => this.pan(0, -30)}>↑</button>
				<button aria-label="向下平移" @click=${() => this.pan(0, 30)}>↓</button>
				<span class="detail-sub">实线：包含 · 虚线：涉及</span>
			</div>
			<div class="graph-canvas" role="img" aria-label="Workspace 资产关系图" style="height: ${height}px">
				<div class="graph-layer" style="width: ${width}px; height: ${height}px; transform: translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.zoom})">
					${edges.map((edge) => {
						const from = positions.get(edge.fromAssetId);
						const to = positions.get(edge.toAssetId);
						if (!from || !to) return nothing;
						const dx = to.x - from.x;
						const dy = to.y - from.y;
						const length = Math.sqrt(dx * dx + dy * dy);
						const angle = Math.atan2(dy, dx) * (180 / Math.PI);
						return html`<span
							class="graph-edge"
							aria-hidden="true"
							style="left: ${from.x + 65}px; top: ${from.y + 18}px; width: ${length}px; transform: rotate(${angle}deg); ${edge.type === "involves" ? "border-top-style: dashed;" : ""}"
						></span>`;
					})}
					${nodes.map((node) => {
						const position = positions.get(node.assetId);
						if (!position) return nothing;
						return html`<button
							class="graph-node"
							aria-label=${`${assetKindLabel(node.kind)} ${node.title}`}
							style="left: ${position.x}px; top: ${position.y}px"
							@click=${() => this.openNode(node.assetId)}
						>
							<span>${assetKindLabel(node.kind)}</span>
							<strong>${node.title.slice(0, 16)}</strong>
						</button>`;
					})}
				</div>
			</div>
		`;
	}
}

customElements.define("baize-asset-graph", BaizeAssetGraph);
