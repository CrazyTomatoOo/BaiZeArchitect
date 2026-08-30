import { LitElement, html, type PropertyValues } from "lit";
import { getAssetGraph, assetKindLabel, type AssetKind, type AssetGraph } from "./workflow-client.js";
import { relationTypeLabel, RELATION_TARGETS, type Renderable } from "./baize-asset-library-constants.js";

export interface RelationSelection {
	toAssetId: number;
	type: "contains" | "involves";
}

export class BaizeAssetRelationPicker extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		kind: { type: String },
		relations: { type: Array },
		candidates: { state: true },
		error: { state: true },
	};

	declare apiBase: string;
	declare workspaceId: number;
	declare kind: AssetKind;
	declare relations: readonly RelationSelection[];

	declare candidates: readonly { assetId: number; kind: AssetKind; title: string }[];
	declare error: string | null;
	private currentRequest = 0;

	createRenderRoot(): HTMLElement {
		return this;
	}

	constructor() {
		super();
		this.apiBase = "";
		this.workspaceId = 0;
		this.kind = "design";
		this.relations = [];
		this.candidates = [];
		this.error = null;
	}

	protected updated(changed: PropertyValues<this>): void {
		if (changed.has("kind") || changed.has("apiBase") || changed.has("workspaceId")) {
			if (this.workspaceId > 0) void this.loadCandidates();
		}
	}

	private async loadCandidates(): Promise<void> {
		const targetKinds = new Set(RELATION_TARGETS[this.kind].map((target) => target.kind));
		if (targetKinds.size === 0) {
			this.candidates = [];
			this.error = null;
			return;
		}
		const requestNo = ++this.currentRequest;
		this.error = null;
		try {
			const graph: AssetGraph = await getAssetGraph(this.apiBase, this.workspaceId);
			if (requestNo !== this.currentRequest) return;
			this.candidates = graph.nodes
				.filter((node) => targetKinds.has(node.kind))
				.map((node) => ({ assetId: node.assetId, kind: node.kind, title: node.title }));
		} catch (error) {
			if (requestNo !== this.currentRequest) return;
			this.candidates = [];
			this.error = error instanceof Error ? error.message : "关联资产加载失败。";
		}
	}

	private toggleRelation(assetId: number, type: "contains" | "involves", checked: boolean): void {
		const next = this.relations.filter((relation) => !(relation.toAssetId === assetId && relation.type === type));
		if (checked) next.push({ toAssetId: assetId, type });
		this.dispatchEvent(
			new CustomEvent("baize-relations-change", {
				detail: next,
				bubbles: true,
				composed: true,
			}),
		);
	}

	render(): Renderable {
		const validTargets = RELATION_TARGETS[this.kind];
		if (this.error) return html`<p class="form-error" role="alert">关联资产加载失败：${this.error}</p>`;
		if (this.candidates.length === 0) return html`<p class="detail-sub">当前类型没有可选的直接关系目标。</p>`;
		return html`<fieldset class="form-field">
			<legend>关联资产</legend>
			<div class="relations">
				${this.candidates.map((asset) => validTargets.filter((target) => target.kind === asset.kind).map((target) => {
					const checked = this.relations.some((relation) => relation.toAssetId === asset.assetId && relation.type === target.type);
					return html`<label
						><input
							type="checkbox"
							.checked=${checked}
							@change=${(event: Event) => this.toggleRelation(asset.assetId, target.type, (event.target as HTMLInputElement).checked)}
						/> ${relationTypeLabel(target.type)} · ${assetKindLabel(asset.kind)} · ${asset.title}</label
					>`;
				}))}
			</div>
		</fieldset>`;
	}
}

customElements.define("baize-asset-relation-picker", BaizeAssetRelationPicker);
