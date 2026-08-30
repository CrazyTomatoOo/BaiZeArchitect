import { LitElement, html, nothing, type PropertyValues } from "lit";
import {
	createAsset,
	updateAsset,
	getAsset,
	AssetMutationError,
	type AssetDetail,
	type AssetKind,
} from "./workflow-client.js";
import { assetKindLabel } from "./workflow-client.js";
import {
	arrayItemLabel,
	createDraft,
	FORM_FIELDS,
	type FormField,
	type Renderable,
} from "./baize-asset-library-constants.js";
import "./baize-asset-relation-picker.js";

interface RelationSelection {
	toAssetId: number;
	type: "contains" | "involves";
}

export class BaizeAssetForm extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		mode: { type: String },
		kind: { type: String },
		assetId: { type: Number, attribute: "asset-id" },
		actualKind: { state: true },
		actualAssetId: { state: true },
		expectedRevisionId: { state: true },
		title: { state: true },
		draft: { state: true },
		relations: { state: true },
		error: { state: true },
		fieldErrors: { state: true },
		submitting: { state: true },
		loadingDetail: { state: true },
		hideSourceRefs: { state: true },
	};

	declare apiBase: string;
	declare workspaceId: number;
	declare mode: "create" | "edit" | null;
	declare kind: AssetKind | null;
	declare assetId: number | null;

	declare actualKind: AssetKind | null;
	declare actualAssetId: number | null;
	declare expectedRevisionId: number | null;
	declare title: string;
	declare draft: Record<string, unknown> | null;
	declare relations: readonly RelationSelection[];
	declare error: string | null;
	declare fieldErrors: Record<string, string>;
	declare submitting: boolean;
	declare loadingDetail: boolean;
	declare hideSourceRefs: boolean;
	private currentRequest = 0;

	createRenderRoot(): HTMLElement {
		return this;
	}

	constructor() {
		super();
		this.apiBase = "";
		this.workspaceId = 0;
		this.mode = null;
		this.kind = null;
		this.assetId = null;
		this.actualKind = null;
		this.actualAssetId = null;
		this.expectedRevisionId = null;
		this.title = "";
		this.draft = null;
		this.relations = [];
		this.error = null;
		this.fieldErrors = {};
		this.submitting = false;
		this.loadingDetail = false;
		this.hideSourceRefs = false;
	}

	protected willUpdate(changed: PropertyValues<this>): void {
		if (changed.has("mode") || changed.has("kind") || changed.has("assetId")) {
			if (this.mode === "create" && this.kind) {
				this.resetForCreate(this.kind);
			} else if (this.mode === "edit" && this.assetId) {
				void this.resetForEdit(this.assetId);
			} else {
				this.resetForCreate("design");
			}
		}
	}

	private resetForCreate(kind: AssetKind): void {
		this.actualKind = kind;
		this.actualAssetId = null;
		this.expectedRevisionId = null;
		this.title = "";
		this.draft = createDraft(kind);
		this.relations = [];
		this.error = null;
		this.fieldErrors = {};
		this.submitting = false;
		this.loadingDetail = false;
		this.hideSourceRefs = false;
	}


	private async resetForEdit(assetId: number): Promise<void> {
		const requestNo = ++this.currentRequest;
		this.loadingDetail = true;
		this.error = null;
		this.fieldErrors = {};
		this.submitting = false;
		try {
			const detail: AssetDetail = await getAsset(this.apiBase, assetId);
			if (requestNo !== this.currentRequest) return;
			const current = detail.revisions.find((revision) => revision.id === detail.currentRevisionId) ?? detail.revisions.at(-1);
			const content = typeof current?.content === "object" && current.content !== null && !Array.isArray(current.content)
				? (JSON.parse(JSON.stringify(current.content)) as Record<string, unknown>)
				: {};
			this.actualKind = detail.kind;
			this.actualAssetId = detail.id;
			this.expectedRevisionId = current?.id ?? null;
			this.title = detail.title;
			this.draft = content;
		this.relations = detail.resolvedGraph.outgoing.map((relation) => ({ toAssetId: relation.assetId, type: relation.type }));
		this.hideSourceRefs = typeof detail.originArtifactId === "number";
		} catch (error) {
			if (requestNo !== this.currentRequest) return;
			this.error = error instanceof Error ? error.message : String(error);
			this.draft = null;
		} finally {
			if (requestNo === this.currentRequest) this.loadingDetail = false;
		}
	}

	private draftValue(path: readonly string[]): unknown {
		let value: unknown = this.draft;
		for (const key of path) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
			value = (value as Record<string, unknown>)[key];
		}
		return value;
	}

	private setDraftValue(path: readonly string[], value: unknown): void {
		if (!this.draft || path.length === 0) return;
		let target = this.draft;
		for (const key of path.slice(0, -1)) {
			const current = target[key];
			if (typeof current !== "object" || current === null) target[key] = {};
			target = target[key] as Record<string, unknown>;
		}
		target[path[path.length - 1] as string] = value;
		this.draft = { ...this.draft };
	}

	private updateArrayItem(path: readonly string[], index: number, value: unknown): void {
		const current = this.draftValue(path);
		if (!Array.isArray(current)) return;
		const next = [...current];
		next[index] = value;
		this.setDraftValue(path, next);
	}

	private addArrayItem(field: FormField, path: readonly string[]): void {
		const current = this.draftValue(path);
		if (!Array.isArray(current)) return;
		let value: unknown =
			field.type === "object-list"
				? Object.fromEntries((field.itemFields ?? []).map((item) => [item.key, item.type === "list" || item.type === "number-list" || item.type === "object-list" ? [] : ""]))
				: "";
		if (field.key === "changeUnits" && typeof value === "object" && value !== null && !Array.isArray(value)) {
			(value as Record<string, unknown>).sourceRefs = [{ type: "requirement_revision", revisionId: 1 }];
		}
		this.setDraftValue(path, [...current, value]);
	}

	private removeArrayItem(path: readonly string[], index: number): void {
		const current = this.draftValue(path);
		if (!Array.isArray(current)) return;
		this.setDraftValue(path, current.filter((_, currentIndex) => currentIndex !== index));
	}

	private moveArrayItem(path: readonly string[], index: number, direction: -1 | 1): void {
		const current = this.draftValue(path);
		if (!Array.isArray(current)) return;
		const nextIndex = index + direction;
		if (nextIndex < 0 || nextIndex >= current.length) return;
		const next = [...current];
		[next[index], next[nextIndex]] = [next[nextIndex], next[index]];
		this.setDraftValue(path, next);
	}

	private renderFormField(field: FormField, path: readonly string[]): Renderable {
		if (this.mode === "edit" && this.hideSourceRefs && field.key === "sourceRefs") return nothing;
		const value = this.draftValue(path);
		if (field.type === "list" || field.type === "number-list") {
			const values = Array.isArray(value) ? value : [];
			return html`<fieldset class="form-field">
				<legend>${field.label}</legend>
				<div class="array-editor">
					${values.map((item, index) => html`<div class="array-row">
						<input
							type=${field.type === "number-list" ? "number" : "text"}
							.value=${String(item)}
							@input=${(event: Event) => this.updateArrayItem(path, index, field.type === "number-list" ? Number((event.target as HTMLInputElement).value) : (event.target as HTMLInputElement).value)}
						/>
						<span class="array-actions">
							<button type="button" @click=${() => this.moveArrayItem(path, index, -1)} aria-label="上移">↑</button>
							<button type="button" @click=${() => this.moveArrayItem(path, index, 1)} aria-label="下移">↓</button>
							<button type="button" @click=${() => this.removeArrayItem(path, index)} aria-label="删除">删除</button>
						</span>
					</div>`)}
					<button type="button" @click=${() => this.addArrayItem(field, path)}>添加${field.label}</button>
				</div>
			</fieldset>`;
		}
		if (field.type === "object-list") {
			const values = Array.isArray(value) ? value : [];
			return html`<fieldset class="form-field">
				<legend>${field.label}</legend>
				<div class="array-editor">
					${values.map((item, index) => html`<details class="array-item" open>
						<summary>${arrayItemLabel(item, index)}</summary>
						${typeof item === "object" && item !== null && !Array.isArray(item)
							? html`${(field.itemFields ?? []).map((child) => this.renderFormField(child, [...path, String(index), child.key]))}`
							: html`<p class="form-error">该条目格式无效。</p>`}
						<div class="array-actions">
							<button type="button" @click=${() => this.moveArrayItem(path, index, -1)}>上移</button>
							<button type="button" @click=${() => this.moveArrayItem(path, index, 1)}>下移</button>
							<button type="button" @click=${() => this.removeArrayItem(path, index)}>删除</button>
						</div>
					</details>`)}
					<button type="button" @click=${() => this.addArrayItem(field, path)}>添加${field.label}</button>
				</div>
			</fieldset>`;
		}
		const valueText = typeof value === "number" || typeof value === "string" ? String(value) : "";
		return html`<div class="form-field">
			<label
				>${field.label}
				${field.type === "textarea"
					? html`<textarea rows="3" .value=${valueText} @input=${(event: Event) => this.setDraftValue(path, (event.target as HTMLTextAreaElement).value)}></textarea>`
					: html`<input
							type=${field.type === "number" ? "number" : "text"}
							.value=${valueText}
							@input=${(event: Event) => this.setDraftValue(path, field.type === "number" ? Number((event.target as HTMLInputElement).value) : (event.target as HTMLInputElement).value)}
					  />`}
			</label>
			${this.fieldErrors[field.key] ? html`<p class="form-error form-field-error">${this.fieldErrors[field.key]}</p>` : nothing}
		</div>`;
	}

	private setTitle(value: string): void {
		this.title = value;
		if (this.actualKind === "stakeholder") this.setDraftValue(["name"], value);
	}

	private async submitForm(event: Event): Promise<void> {
		event.preventDefault();
		if (this.mode === null || this.actualKind === null || this.draft === null || this.workspaceId <= 0) return;
		const title = this.title.trim();
		if (title.length === 0) {
			this.error = "标题不能为空。";
			return;
		}
		const content = this.actualKind === "stakeholder" ? { ...this.draft, name: title } : this.draft;
		this.submitting = true;
		this.error = null;
		this.fieldErrors = {};
		try {
			const result =
				this.mode === "create"
					? await createAsset(this.apiBase, this.workspaceId, { kind: this.actualKind, title, content, relations: this.relations })
					: this.actualAssetId !== null && this.expectedRevisionId !== null
						? await updateAsset(this.apiBase, this.actualAssetId, { expectedRevisionId: this.expectedRevisionId, title, content, relations: this.relations })
						: undefined;
			if (!result) throw new Error("无法确定待更新的资产版本。");
			this.dispatchEvent(
				new CustomEvent("baize-asset-saved", {
					detail: { assetId: result.assetId, kind: this.actualKind },
					bubbles: true,
					composed: true,
				}),
			);
		} catch (error) {
			if (error instanceof AssetMutationError) {
				this.error = error.message;
				this.fieldErrors = {};
				for (const ve of error.validationErrors) {
					const key = ve.path.split("/").filter(Boolean).pop() ?? "";
					if (key) this.fieldErrors[key] = ve.message;
				}
			} else {
				this.error = error instanceof Error ? error.message : String(error);
				this.fieldErrors = {};
			}
		} finally {
			this.submitting = false;
		}
	}

	private cancel(): void {
		this.dispatchEvent(
			new CustomEvent("baize-form-cancel", {
				bubbles: true,
				composed: true,
			}),
		);
	}

	render(): Renderable {
		if (this.mode === null || this.actualKind === null) return nothing;
		const kind = this.actualKind;
		const fields = FORM_FIELDS[kind] ?? [];
		if (this.loadingDetail) return html`<div class="empty">正在加载资产详情…</div>`;
		return html`<form class="form" @submit=${(event: Event) => void this.submitForm(event)}>
			<header>
				<h2>${this.mode === "create" ? "新建" : "编辑"}${assetKindLabel(kind)}资产</h2>
				<p class="detail-sub">严格遵循当前类型 v1 业务字段。</p>
			</header>
			<div class="form-field">
				<label
					>资产标题<input
						required
						.value=${this.title}
						@input=${(event: Event) => this.setTitle((event.target as HTMLInputElement).value)}
				/></label>
			</div>
			${fields.map((field) => this.renderFormField(field, [field.key]))}
			<baize-asset-relation-picker
				.apiBase=${this.apiBase}
				.workspaceId=${this.workspaceId}
				.kind=${kind}
				.relations=${this.relations}
				@baize-relations-change=${(event: CustomEvent<RelationSelection[]>) => {
					this.relations = event.detail;
				}}
			></baize-asset-relation-picker>
			${this.error ? html`<p class="form-error" role="alert">${this.error}</p>` : ""}
			<div class="form-actions">
				<button class="primary" type="submit" ?disabled=${this.submitting}>${this.submitting ? "保存中…" : "保存资产"}</button>
				<button type="button" @click=${() => this.cancel()}>取消</button>
			</div>
		</form>`;
	}
}

customElements.define("baize-asset-form", BaizeAssetForm);
