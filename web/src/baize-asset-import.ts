import { LitElement, html, nothing, type PropertyValues } from "lit";
import {
	previewImportBundle,
	commitImportBundle,
	exportAssets,
	ASSET_KINDS,
	assetKindLabel,
	AssetMutationError,
	type AssetKind,
	type AssetRelationExport,
	type ImportPreviewResult,
} from "./workflow-client.js";
import { type Renderable } from "./baize-asset-library-constants.js";

interface ImportDraft {
	preview: ImportPreviewResult;
	assets: readonly { kind: AssetKind; title: string; content: unknown }[];
	relations: readonly AssetRelationExport[];
}

export class BaizeAssetImport extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		importDraft: { state: true },
		importError: { state: true },
		importSubmitting: { state: true },
	};

	declare apiBase: string;
	declare workspaceId: number;

	declare importDraft: ImportDraft | null;
	declare importError: string | null;
	declare importSubmitting: boolean;

	createRenderRoot(): HTMLElement {
		return this;
	}

	constructor() {
		super();
		this.apiBase = "";
		this.workspaceId = 0;
		this.importDraft = null;
		this.importError = null;
		this.importSubmitting = false;
	}

	protected updated(changed: PropertyValues<this>): void {
		if (changed.has("apiBase") || changed.has("workspaceId")) {
			this.importDraft = null;
			this.importError = null;
		}
	}

	private async handleImportFile(event: Event): Promise<void> {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		input.value = "";
		if (!file) return;
		try {
			const parsed: unknown = JSON.parse(await file.text());
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("导入文件必须是 JSON 对象。");
			const record = parsed as Record<string, unknown>;
			if (!Array.isArray(record.assets)) throw new Error("导入文件缺少 assets 数组。");
			const assets: Array<{ kind: AssetKind; title: string; content: unknown }> = [];
			for (const item of record.assets) {
				if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("资产条目格式无效。");
				const value = item as Record<string, unknown>;
				const kind = value.kind;
				const title = value.title;
				let content = value.content;
				if (content === undefined && Array.isArray(value.revisions)) {
					const current = value.revisions.at(-1);
					if (typeof current === "object" && current !== null && !Array.isArray(current)) content = (current as Record<string, unknown>).content;
				}
				if (typeof kind !== "string" || !ASSET_KINDS.includes(kind as AssetKind) || typeof title !== "string" || content === undefined) {
					throw new Error("资产条目必须包含有效 kind、title 和 content。");
				}
				if (kind === "api" && typeof content === "object" && content !== null && !Array.isArray(content) && !("schemaVersion" in content)) {
					const apiContent = content as Record<string, unknown>;
					const info = apiContent.info as Record<string, unknown> | undefined;
					apiContent.schemaVersion = "asset/api/v1";
					apiContent.artifactKind = "api";
					apiContent.summary = typeof info?.title === "string" ? info.title : "Imported API";
					apiContent.sourceRefs = [];
					content = apiContent;
				}
				assets.push({ kind: kind as AssetKind, title, content });
			}
			let relations: AssetRelationExport[] = [];
			if (record.relations !== undefined) {
				if (!Array.isArray(record.relations)) throw new Error("relations 必须是数组。");
				for (const item of record.relations) {
					if (typeof item !== "object" || item === null || Array.isArray(item)) throw new Error("关系条目格式无效。");
					const value = item as Record<string, unknown>;
					if (
						typeof value.fromTitle !== "string" ||
						typeof value.toTitle !== "string" ||
						typeof value.fromKind !== "string" ||
						typeof value.toKind !== "string" ||
						(value.type !== "contains" && value.type !== "involves")
					) {
						throw new Error("关系条目字段无效。");
					}
					if (!ASSET_KINDS.includes(value.fromKind as AssetKind) || !ASSET_KINDS.includes(value.toKind as AssetKind)) {
						throw new Error("关系条目 kind 无效。");
					}
					relations.push({
						fromTitle: value.fromTitle,
						fromKind: value.fromKind as AssetKind,
						toTitle: value.toTitle,
						toKind: value.toKind as AssetKind,
						type: value.type,
					});
				}
			}
			const preview = await previewImportBundle(this.apiBase, this.workspaceId, assets, relations);
			this.importDraft = { preview, assets, relations };
			this.importError = null;
		} catch (error) {
			this.importDraft = null;
			this.importError = error instanceof Error ? error.message : String(error);
		}
	}

	private async confirmImport(): Promise<void> {
		if (!this.importDraft || this.workspaceId <= 0) return;
		this.importSubmitting = true;
		this.importError = null;
		try {
			const ids = await commitImportBundle(this.apiBase, this.workspaceId, this.importDraft.assets, this.importDraft.relations, this.importDraft.preview.previewDigest);
			this.importDraft = null;
			this.dispatchEvent(
				new CustomEvent("baize-import-complete", {
					detail: { assetId: ids[0] ?? null },
					bubbles: true,
					composed: true,
				}),
			);
		} catch (error) {
			if (error instanceof AssetMutationError) {
				this.importError = error.message;
			} else {
				this.importError = error instanceof Error ? error.message : String(error);
			}
		} finally {
			this.importSubmitting = false;
		}
	}

	private async exportWorkspace(): Promise<void> {
		try {
			const bundle = await exportAssets(this.apiBase, this.workspaceId);
			const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" }));
			const a = document.createElement("a");
			a.href = url;
			a.download = `assets-${this.workspaceId}.json`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (error) {
			this.importError = error instanceof Error ? error.message : String(error);
		}
	}

	private cancelImport(): void {
		this.importDraft = null;
		this.importError = null;
	}

	render(): Renderable {
		return html`
			<button @click=${() => void this.exportWorkspace()}>导出</button>
			<label class="file-button"
				>导入<input class="file-input" type="file" accept="application/json" @change=${(event: Event) => void this.handleImportFile(event)} /></label
			>
			${this.importError && !this.importDraft ? html`<p class="form-error" role="alert">${this.importError}</p>` : ""}
			${this.importDraft ? this.renderPreview() : ""}
		`;
	}

	private renderPreview(): Renderable {
		if (!this.importDraft) return nothing;
		const s = this.importDraft.preview.summary;
		return html`<section class="card import-preview" aria-label="导入预览" style="width: 100%;">
			<h2>导入预览</h2>
			<p class="detail-sub">${this.importDraft.assets.length} 个资产 · ${this.importDraft.relations.length} 条关系</p>
			<p class="detail-sub">
				新建 ${s.createCount} · 复用 ${s.reuseCount} · 关系变更 ${s.relationChanges} · 路径冲突 ${s.pathConflicts} · 校验错误 ${s.validationErrors}
			</p>
			<p class="detail-sub">
				类型分布：${ASSET_KINDS.map((kind) => `${assetKindLabel(kind)} ${s.kindBreakdown[kind] ?? 0}`).join(" · ")}
			</p>
			${this.importError ? html`<p class="form-error" role="alert">${this.importError}</p>` : ""}
			<div class="form-actions">
				<button class="primary" ?disabled=${this.importSubmitting} @click=${() => void this.confirmImport()}>${this.importSubmitting ? "导入中…" : "确认导入"}</button>
				<button @click=${() => this.cancelImport()}>取消</button>
			</div>
		</section>`;
	}
}

customElements.define("baize-asset-import", BaizeAssetImport);
