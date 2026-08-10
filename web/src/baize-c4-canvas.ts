import { Graph } from "@antv/g6";
import ELK from "elkjs/lib/elk-api.js";
import { LitElement, css, html, nothing } from "lit";
import {
	layoutFromElk,
	pngExportSize,
	projectionToElk,
	visibleGraphToSvgDocument,
	type CanvasLayout,
	type VisibleGraph,
	type VisibleGraphNode,
} from "./c4-canvas-model.js";

export type CanvasIntent =
	| { type: "select"; nodeId: string }
	| { type: "fit" }
	| { type: "export"; format: "svg" | "png" }
	| { type: "layout-complete"; layout: CanvasLayout }
	| { type: "drill-down"; nodeId: string };

export class BaiZeC4Canvas extends LitElement {
	static properties = {
		graph: { attribute: false }, selectedNodeId: { type: String }, rootLabel: { type: String }, rootId: { type: String }, status: { type: String }, filters: { attribute: false }, focused: { type: Boolean },
		layout: { state: true }, loading: { state: true }, error: { state: true }, exporting: { state: true },
	};

	declare graph?: VisibleGraph;
	declare selectedNodeId?: string;
	declare rootLabel: string;
	declare rootId: string;
	declare filters: string[];
	declare focused: boolean;
	declare status: string;
	private declare layout?: CanvasLayout;
	private declare loading: boolean;
	private declare error: string;
	private declare exporting: boolean;
	private renderer?: Graph;
	private layoutRun = 0;

	static styles = css`
		:host { display:block; min-height:0; color:#eff4ff; font-family:ui-sans-serif,system-ui,sans-serif; }
		.shell { display:grid; grid-template-columns:minmax(0,1fr) 290px; gap:12px; min-height:650px; }
		.surface,.inspector { background:#111b2c; border:1px solid #324666; border-radius:12px; }
		.surface { position:relative; min-height:650px; overflow:hidden; }
		.toolbar { display:flex; position:absolute; z-index:2; top:12px; left:12px; gap:8px; flex-wrap:wrap; }
		button { border:1px solid #7892c7; background:#202b40; color:#eff4ff; border-radius:6px; padding:7px 9px; cursor:pointer; font:inherit; }
		button:hover { background:#2a3b59; } button:focus-visible { outline:3px solid #f9c74f; outline-offset:2px; }
		.canvas { height:650px; background:#0c1320; }
		.loading { position:absolute; inset:0; display:grid; place-items:center; z-index:1; background:color-mix(in srgb,#0c1320 72%,transparent); color:#d9e5ff; }
		.inspector { padding:12px; overflow:auto; } h2 { font-size:14px; margin:0 0 8px; } p { color:#b9c8e8; font-size:12px; margin:6px 0; }
		.list { max-height:460px; overflow:auto; margin-top:12px; border-top:1px solid #324666; }
		.node { display:block; width:100%; text-align:left; border:0; border-bottom:1px solid #263852; border-radius:0; background:transparent; padding:9px 3px; }
		.node[aria-current="true"] { color:#ffd670; } .kind { display:block; color:#9cb3e4; font-size:11px; margin-top:3px; }
		.error { color:#ffb4b4; } .sr { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
		@media (max-width:800px) { .shell { grid-template-columns:1fr; } .surface,.canvas { min-height:500px; height:500px; } .inspector { max-height:360px; } }
	`;

	constructor() {
		super();
		this.rootLabel = "Architecture root";
		this.rootId = "root";
		this.filters = [];
		this.focused = false;
		this.status = "";
		this.loading = false;
		this.error = "";
		this.exporting = false;
	}

	protected updated(changed: Map<PropertyKey, unknown>): void {
		if (changed.has("graph") && this.graph) void this.layoutGraph();
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		this.renderer?.destroy();
		this.renderer = undefined;
	}

	render() {
		const selected = this.graph?.nodes.find((node) => node.id === this.selectedNodeId);
		const summary = this.graph ? `${this.graph.layer} view of ${this.rootLabel}: ${this.graph.nodes.length} nodes and ${this.graph.edges.length} relationships.` : "No architecture graph is loaded.";
		return html`
			<section class="shell" aria-label="Architecture canvas">
				<div class="surface">
					<div class="toolbar" aria-label="Canvas controls">
						<button @click=${this.fit} ?disabled=${!this.renderer}>Fit view</button>
						<button @click=${() => this.export("svg")} ?disabled=${!this.layout || this.exporting}>${this.exporting ? "Exporting…" : "Export SVG"}</button>
						<button @click=${() => this.export("png")} ?disabled=${!this.layout || this.exporting}>Export PNG</button>
					</div>
					<div class="canvas" aria-hidden="true"></div>
					${this.loading ? html`<div class="loading">Laying out architecture…</div>` : nothing}
				</div>
				<aside class="inspector" aria-label="Architecture evidence inspector">
					<h2>${selected?.name ?? "Architecture explorer"}</h2>
					<p>${selected?.description ?? summary}</p>
					${selected ? html`<p><strong>${selected.kind}</strong> · ${selected.id}</p><button @click=${() => this.intent({ type: "drill-down", nodeId: selected.id })}>View internal</button>` : nothing}
					${this.error ? html`<p class="error" role="alert">${this.error}</p>` : nothing}
					<div class="list" role="list" aria-label="Architecture nodes">
						${this.graph?.nodes.length ? this.graph.nodes.map((node) => this.nodeRow(node)) : html`<p class="empty">No architecture nodes match this view.</p>`}
					</div>
				</aside>
			</section>
			<p class="sr" aria-live="polite">${this.status || this.liveSummary()}</p>
		`;
	}

	private nodeRow(node: VisibleGraphNode) {
		return html`<div role="listitem"><button class="node" data-node-id=${node.id} aria-current=${String(node.id === this.selectedNodeId)} @click=${() => this.select(node.id)} @keydown=${(event: KeyboardEvent) => this.onNodeKeydown(event, node.id)}>
			${node.name}<span class="kind">${node.kind}${node.memberIds ? ` · ${node.memberIds.length} members` : ""}</span>
		</button></div>`;
	}

	private onNodeKeydown(event: KeyboardEvent, nodeId: string): void {
		const nodes = this.graph?.nodes ?? [];
		const index = nodes.findIndex((node) => node.id === nodeId);
		if (index < 0) return;
		const nextIndex = event.key === "ArrowDown" ? Math.min(index + 1, nodes.length - 1) : event.key === "ArrowUp" ? Math.max(index - 1, 0) : -1;
		if (nextIndex < 0) return;
		event.preventDefault();
		const next = nodes[nextIndex];
		if (!next) return;
		this.select(next.id);
		requestAnimationFrame(() => [...this.renderRoot.querySelectorAll<HTMLButtonElement>(".node")].find((button) => button.dataset.nodeId === next.id)?.focus());
	}

	private async layoutGraph(): Promise<void> {
		const graph = this.graph;
		if (!graph) return;
		const run = ++this.layoutRun;
		this.loading = true;
		this.error = "";
		try {
			const workerUrl = new URL("elkjs/lib/elk-worker.min.js", import.meta.url).toString();
			const elk = new ELK({ workerFactory: (url) => new Worker(url ?? workerUrl) });
			const result = await elk.layout(projectionToElk(graph));
			elk.terminateWorker();
			if (run !== this.layoutRun) return;
			this.layout = layoutFromElk(result);
			await this.renderGraph(graph, this.layout);
			this.intent({ type: "layout-complete", layout: this.layout });
		} catch (error) {
			if (run === this.layoutRun) this.error = error instanceof Error ? error.message : String(error);
		} finally {
			if (run === this.layoutRun) this.loading = false;
		}
	}

	private async renderGraph(source: VisibleGraph, layout: CanvasLayout): Promise<void> {
		const container = this.renderRoot.querySelector<HTMLDivElement>(".canvas");
		if (!container) return;
		this.renderer?.destroy();
		const positions = layout.nodes;
		this.renderer = new Graph({
			container,
			width: container.clientWidth || 900,
			height: container.clientHeight || 650,
			data: {
				nodes: source.nodes.map((node) => ({ id: node.id, style: { x: positions.get(node.id)?.x ?? 0, y: positions.get(node.id)?.y ?? 0, size: [150, 42], labelText: node.name, fill: node.kind === "aggregate" ? "#342a53" : "#202b40", stroke: "#92a8d9", labelFill: "#eff4ff", radius: 6 } })),
				edges: source.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, style: { stroke: "#6f86b6", lineWidth: 1.2 } })),
			},
			behaviors: ["drag-canvas", "zoom-canvas", "click-select"],
			animation: false,
		});
		this.renderer.on("node:click", (event: unknown) => {
			const nodeId = (event as { target?: { id?: string } }).target?.id;
			if (nodeId) this.select(nodeId);
		});
		await this.renderer.render();
	}

	private select(nodeId: string): void { this.intent({ type: "select", nodeId }); }
	private fit = (): void => { this.renderer?.fitView(); this.intent({ type: "fit" }); };

	private async export(format: "svg" | "png"): Promise<void> {
		const graph = this.graph;
		const layout = this.layout;
		if (!graph || !layout) return;
		const pngSize = pngExportSize(layout);
		if (format === "png" && !pngSize) {
			this.error = "PNG exceeds the 8192px export limit. Use SVG or narrow the view.";
			return;
		}
		this.exporting = true;
		this.error = "";
		try {
			const generatedAt = new Date().toISOString();
			const content = visibleGraphToSvgDocument(graph, layout, { generatedAt, filters: this.filters, focused: this.focused });
			const root = this.rootId.replace(/[^a-zA-Z0-9_-]/g, "_") || "root";
			const timestamp = generatedAt.replace(/[:.]/g, "-");
			const filename = `${graph.repositoryId}-${graph.headSha.slice(0, 8)}-${graph.layer}-${root}-${timestamp}`;
			if (format === "svg") this.download(new Blob([content], { type: "image/svg+xml" }), `${filename}.svg`);
			else await this.downloadPng(content, pngSize as { width: number; height: number }, `${filename}.png`);
			this.intent({ type: "export", format });
		} catch (error) {
			this.error = error instanceof Error ? error.message : "Export failed. Retry with this snapshot.";
		} finally {
			this.exporting = false;
		}
	}

	private download(blob: Blob, filename: string): void {
		const url = URL.createObjectURL(blob);
		const anchor = Object.assign(document.createElement("a"), { href: url, download: filename });
		anchor.click();
		URL.revokeObjectURL(url);
	}

	private async downloadPng(svg: string, size: { width: number; height: number }, filename: string): Promise<void> {
		const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
		try {
			const image = await new Promise<HTMLImageElement>((resolve, reject) => {
				const result = new Image();
				result.onload = () => resolve(result);
				result.onerror = () => reject(new Error("SVG could not be rasterized"));
				result.src = url;
			});
			const canvas = Object.assign(document.createElement("canvas"), size);
			const context = canvas.getContext("2d");
			if (!context) throw new Error("PNG canvas is unavailable");
			context.drawImage(image, 0, 0, size.width, size.height);
			const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PNG encoding failed")), "image/png"));
			this.download(blob, filename);
		} finally {
			URL.revokeObjectURL(url);
		}
	}

	private intent(detail: CanvasIntent): void { this.dispatchEvent(new CustomEvent<CanvasIntent>("c4-canvas-intent", { detail, bubbles: true, composed: true })); }
	private liveSummary(): string {
		if (!this.graph) return "";
		const selected = this.graph.nodes.find((node) => node.id === this.selectedNodeId);
		return `${selected ? `${selected.name} selected. ` : ""}${this.graph.nodes.length} nodes and ${this.graph.edges.length} relationships available.`;
	}
}

customElements.define("baize-c4-canvas", BaiZeC4Canvas);

declare global { interface HTMLElementTagNameMap { "baize-c4-canvas": BaiZeC4Canvas; } }
