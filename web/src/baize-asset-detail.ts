import { LitElement, html, nothing, type PropertyValues } from "lit";
import {
	assetKindLabel,
	deleteAsset,
	getAsset,
	updateAsset,
	AssetMutationError,
	type AssetDetail,
	type AssetKind,
	type AssetResolvedRelation,
} from "./workflow-client.js";
import { fieldTitle } from "./artifact-labels.js";
import { BaizeApiSwagger } from "./baize-api-swagger.js";
import { BaizeDataCatalog } from "./baize-data-catalog.js";
import { BaizeArchitectureDiagram } from "./baize-architecture-diagram.js";
import {
	arrayItemLabel,
	assetContentWarning,
	KIND_TO_TAB,
	relationTypeLabel,
	type Renderable,
	type WorkbenchTab,
} from "./baize-asset-library-constants.js";

export class BaizeAssetDetail extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		assetId: { type: Number, attribute: "asset-id" },
		refresh: { type: Number },
		detail: { state: true },
		detailLoading: { state: true },
		detailError: { state: true },
		deleteConfirm: { state: true },
		deleteError: { state: true },
	};

	declare apiBase: string;
	declare assetId: number;
	declare refresh: number;

	declare detail: AssetDetail | null;
	declare detailLoading: boolean;
	declare detailError: string | null;
	declare deleteConfirm: boolean;
	declare deleteError: string | null;
	private currentRequest = 0;

	createRenderRoot(): HTMLElement {
		return this;
	}

	constructor() {
		super();
		this.apiBase = "";
		this.assetId = 0;
		this.refresh = 0;
		this.detail = null;
		this.detailLoading = false;
		this.detailError = null;
		this.deleteConfirm = false;
		this.deleteError = null;
	}

	protected updated(changed: PropertyValues<this>): void {
		if (changed.has("assetId") || changed.has("apiBase") || changed.has("refresh")) {
			if (this.assetId > 0) void this.loadDetail(this.assetId);
			else {
				this.detail = null;
				this.detailError = null;
				this.detailLoading = false;
			}
		}
	}

	private async loadDetail(assetId: number): Promise<void> {
		const requestNo = ++this.currentRequest;
		this.detailLoading = true;
		this.detailError = null;
		try {
			const detail = await getAsset(this.apiBase, assetId);
			if (requestNo !== this.currentRequest) return;
			this.detail = detail;
		} catch (error) {
			if (requestNo !== this.currentRequest) return;
			this.detail = null;
			this.detailError = error instanceof Error ? error.message : String(error);
		} finally {
			if (requestNo === this.currentRequest) this.detailLoading = false;
		}
	}

	private openEdit(): void {
		this.dispatchEvent(
			new CustomEvent("baize-edit-asset", {
				bubbles: true,
				composed: true,
			}),
		);
	}

	private requestDelete(): void {
		this.deleteConfirm = true;
		this.deleteError = null;
	}

	private cancelDelete(): void {
		this.deleteConfirm = false;
		this.deleteError = null;
	}

	private async confirmDelete(): Promise<void> {
		const detail = this.detail;
		if (!detail) return;
		const references = [...detail.resolvedGraph.incoming, ...detail.resolvedGraph.outgoing];
		if (references.length > 0) {
			const referenceDetails = references
				.map((reference) => `${assetKindLabel(reference.kind)}「${reference.title}」·${relationTypeLabel(reference.type)}`)
				.join("、");
			this.deleteError = `该资产仍被以下 ${references.length} 个资产引用，无法删除：${referenceDetails}`;
			return;
		}
		try {
			await deleteAsset(this.apiBase, detail.id);
			this.dispatchEvent(
				new CustomEvent("baize-asset-deleted", {
					bubbles: true,
					composed: true,
				}),
			);
		} catch (error) {
			this.deleteError = error instanceof Error ? error.message : String(error);
		}
	}

	private openRelated(relation: AssetResolvedRelation): void {
		const tab = KIND_TO_TAB[relation.kind];
		this.dispatchEvent(
			new CustomEvent("baize-navigate-asset", {
				detail: { tab, assetId: relation.assetId },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private renderRelationGroup(title: string, relations: readonly AssetResolvedRelation[]): Renderable {
		return html`<div class="relation-group">
			<h3>${title} (${relations.length})</h3>
			${relations.length === 0
				? html`<p class="detail-sub">暂无直接关系。</p>`
				: html`<div class="relations">${relations.map((relation) => html`
						<button class="relation" @click=${() => this.openRelated(relation)}>
							${relationTypeLabel(relation.type)} · ${assetKindLabel(relation.kind)} · ${relation.title}
						</button>
					`)}</div>`}
		</div>`;
	}

	private renderValue(value: unknown): Renderable {
		if (Array.isArray(value)) {
			return html`<div class="value-list">
				${value.map((item, index) => html`<details class="array-item">
					<summary>${arrayItemLabel(item, index)}</summary>
					${this.renderValue(item)}
				</details>`)}
			</div>`;
		}
		if (typeof value === "object" && value !== null) {
			const record = value as Record<string, unknown>;
			return html`<dl class="field-list">
				${Object.entries(record).map(([key, child]) => html`<div class="field">
					<dt>${fieldTitle(key)}</dt>
					<dd>${this.renderValue(child)}</dd>
				</div>`)}
			</dl>`;
		}
		if (value === null || value === undefined || value === "") return html`<span class="value">—</span>`;
		return html`<span class="value">${String(value)}</span>`;
	}

	private async handleSpecializedSave(event: CustomEvent<{ content: unknown; title: string }>, detail: AssetDetail): Promise<void> {
		event.stopPropagation();
		try {
			const result = await updateAsset(this.apiBase, detail.id, {
				expectedRevisionId: detail.currentRevisionId ?? detail.revisions.at(-1)?.id ?? 0,
				title: event.detail.title,
				content: event.detail.content,
				relations: detail.resolvedGraph.outgoing.map((r) => ({ toAssetId: r.assetId, type: r.type })),
			});
			await this.loadDetail(result.assetId);
			this.dispatchEvent(
				new CustomEvent("baize-asset-saved", {
					detail: { assetId: result.assetId },
					bubbles: true,
					composed: true,
				}),
			);
		} catch (error) {
			if (error instanceof AssetMutationError) {
				window.dispatchEvent(
					new CustomEvent("baize-asset-save-error", { detail: { errors: error.validationErrors } }),
				);
			} else {
				window.dispatchEvent(
					new CustomEvent("baize-asset-save-error", {
						detail: { errors: [], message: error instanceof Error ? error.message : String(error) },
					}),
				);
			}
		}
	}

	private renderSpecializedDetail(kind: AssetKind, content: unknown, detail: AssetDetail): Renderable {
		if (kind === "api") {
			return html`<baize-api-swagger
				.apiBase=${this.apiBase}
				.assetId=${detail.id}
				.expectedRevisionId=${detail.currentRevisionId ?? detail.revisions.at(-1)?.id ?? 0}
				.content=${content}
				.title=${detail.title}
				@save=${(event: CustomEvent<{ content: unknown; title: string }>) => void this.handleSpecializedSave(event, detail)}
			></baize-api-swagger>`;
		}
		if (kind === "data") {
			return html`<baize-data-catalog
				.apiBase=${this.apiBase}
				.assetId=${detail.id}
				.expectedRevisionId=${detail.currentRevisionId ?? detail.revisions.at(-1)?.id ?? 0}
				.content=${content}
				.title=${detail.title}
				@save=${(event: CustomEvent<{ content: unknown; title: string }>) => void this.handleSpecializedSave(event, detail)}
			></baize-data-catalog>`;
		}
		if (kind === "architecture") {
			return html`<baize-architecture-diagram
				.apiBase=${this.apiBase}
				.assetId=${detail.id}
				.expectedRevisionId=${detail.currentRevisionId ?? detail.revisions.at(-1)?.id ?? 0}
				.content=${content}
				.title=${detail.title}
				@save=${(event: CustomEvent<{ content: unknown; title: string }>) => void this.handleSpecializedSave(event, detail)}
			></baize-architecture-diagram>`;
		}
		return nothing;
	}

	render(): Renderable {
		if (this.detailLoading) return html`<div class="empty">正在加载资产详情…</div>`;
		if (this.detailError) return html`<div class="empty error">资产详情加载失败：${this.detailError}</div>`;
		if (!this.detail) return html`<div class="detail-placeholder">选择资产查看详情</div>`;
		const detail = this.detail;
		const current = detail.revisions.find((revision) => revision.id === detail.currentRevisionId) ?? detail.revisions.at(-1);
		const warning = current ? assetContentWarning(detail.kind, current.content) : null;
		const isSpecialized = detail.kind === "api" || detail.kind === "data" || detail.kind === "architecture";
		return html`<article class="detail">
			<header class="detail-head">
				<div>
					<h2 class="detail-title">${detail.title}</h2>
					<p class="detail-sub">${assetKindLabel(detail.kind)} · Asset #${detail.id}</p>
				</div>
				<button @click=${() => this.openEdit()}>编辑</button>
				${this.deleteConfirm
					? html`<div class="danger-zone">
							<span class="detail-sub">确认删除？资产及其历史 revision 将无法恢复。</span>
							<button class="danger" @click=${() => void this.confirmDelete()}>确认删除</button>
							<button @click=${() => this.cancelDelete()}>取消</button>
						</div>`
					: html`<button class="danger" @click=${() => this.requestDelete()}>删除</button>`}
				${this.deleteError ? html`<span class="form-error" role="alert">${this.deleteError}</span>` : ""}
			</header>
			<section class="detail-block">
				<h2>资产概览</h2>
				<dl class="facts">
					<div class="fact"><dt>创建时间</dt><dd>${new Date(detail.createdAt).toLocaleDateString("zh-CN")}</dd></div>
					<div class="fact"><dt>版本数量</dt><dd>${detail.revisions.length}</dd></div>
					<div class="fact"><dt>来源需求</dt><dd>${detail.originRequirementId ?? "—"}</dd></div>
					<div class="fact"><dt>来源产物</dt><dd>${detail.originArtifactId ?? "—"}</dd></div>
					<div class="fact"><dt>来源批准</dt><dd>${detail.originApprovalId ?? "—"}</dd></div>
					<div class="fact"><dt>当前 Revision</dt><dd>${current ? `Revision ${current.revisionNo}` : "暂无"}</dd></div>
				</dl>
			</section>
			<section class="detail-block">
				<h2>当前版本</h2>
				${current
					? html`<dl class="facts">
							<div class="fact"><dt>来源</dt><dd>${current.source}</dd></div>
							<div class="fact"><dt>Digest</dt><dd class="mono">${current.digest}</dd></div>
							<div class="fact"><dt>生成时间</dt><dd>${new Date(current.createdAt).toLocaleDateString("zh-CN")}</dd></div>
					  </dl>`
					: html`<p class="detail-sub">暂无当前版本。</p>`}
			</section>
			<section class="detail-block">
				<h2>结构化内容</h2>
				${warning ? html`<p class="form-error" role="status">校验警告：${warning}</p>` : ""}
				${isSpecialized && current ? this.renderSpecializedDetail(detail.kind, current.content, detail) : current ? this.renderValue(current.content) : html`<p class="detail-sub">暂无可展示内容。</p>`}
			</section>
			<section class="detail-block">
				<h2>关联信息</h2>
				${this.renderRelationGroup("被引用资产", detail.resolvedGraph.incoming)}
				${this.renderRelationGroup("关联资产", detail.resolvedGraph.outgoing)}
			</section>
			<details class="detail-block">
				<summary>Revision 历史（${detail.revisions.length}）</summary>
				<div class="relations">${detail.revisions.map((revision) => html`<div class="array-item">
					<strong>Revision ${revision.revisionNo}</strong> · ${revision.source} · ${revision.digest}
				</div>`)}</div>
			</details>
		</article>`;
	}
}

customElements.define("baize-asset-detail", BaizeAssetDetail);
