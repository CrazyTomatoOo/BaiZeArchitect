import { LitElement, html, css, nothing } from "lit";
import mermaid from "mermaid";
import { sharedStyles } from "./baize-styles.js";
import {
	getArtifactRevision,
	statusLabel,
	type ArtifactRevisionDetail,
	type ClientArtifactKind,
	type WorkflowProjection,
} from "./workflow-client.js";
import { renderArtifactFields } from "./artifact-content.js";
import { ARTIFACT_KIND_LABELS, ARTIFACT_VIEW_KINDS, schemaRefLabel } from "./artifact-labels.js";
import { readinessCheckLabel, readinessCheckDetail } from "./readiness-labels.js";
import { graphToMermaid, isGraphDiagram, type GraphDiagram } from "./diagram-render.js";

/**
 * baize-artifacts-tab — 产物 Tab:产物进度芯片 + 就绪检查 + 产物种类选择器 +
 * 产物内容查看器(含 mermaid 图异步渲染)。本组件自持 artifactView 与
 * requestSeq 序列号,独立管理产物修订拉取/渲染生命周期。
 */

/** 从产物内容提取可选 diagrams(#11 决议:内容内嵌结构化图 JSON)。 */
function extractDiagrams(content: unknown): readonly unknown[] {
	if (typeof content !== "object" || content === null) return [];
	if (!("diagrams" in content)) return [];
	const diagrams = (content as Record<string, unknown>).diagrams;
	return Array.isArray(diagrams) ? diagrams : [];
}

interface ArtifactViewState {
	kind: ClientArtifactKind;
	detail: ArtifactRevisionDetail | null;
	error: string | null;
	loading: boolean;
}

class BaizeArtifactsTab extends LitElement {
	static properties = {
		projection: { type: Object },
		requirementId: { type: Number, attribute: "requirement-id" },
		apiBase: { type: String, attribute: "api-base" },
		artifactView: { state: true },
	};

	declare projection: WorkflowProjection | null;
	declare requirementId: number;
	declare apiBase: string;
	declare artifactView: ArtifactViewState | null;

	/** 产物内容查看器拉取/渲染序列号:切 kind 即递增,过期响应与渲染作废。 */
	private requestSeq: number | undefined = undefined;

	constructor() {
		super();
		this.projection = null;
		this.requirementId = 0;
		this.apiBase = "";
		this.artifactView = null;
	}

	static styles = [sharedStyles, css`
		:host { display: block; }

		.details { margin-top: var(--gap); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--pad); background: var(--surface); }
		.details h3 { margin: 12px 0 6px; font-size: var(--text-sm); color: var(--text-muted); letter-spacing: 0.06em; }
		.details h3:first-child { margin-top: 0; }
		.fact-block { font-size: var(--text-xs); color: var(--text-muted); line-height: 1.7; word-break: break-all; }
		.error { margin-top: 12px; color: var(--danger); }

		.artifact-progress { display: flex; flex-wrap: wrap; gap: 8px; }
		.artifact-progress .chip { cursor: pointer; }
		.artifact-progress .chip.done { border-color: var(--ok); color: var(--ok); }
		.artifact-progress .chip.missing { border-color: var(--danger); color: var(--danger); }

		.readiness-list { display: flex; flex-direction: column; gap: 4px; }
		.readiness-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--border); font-size: var(--text-sm); }
		.readiness-label { font-weight: 500; min-width: 120px; }
		.readiness-detail { color: var(--text-muted); font-size: var(--text-xs); }

		.artifact-kind-row { display: flex; flex-wrap: wrap; gap: var(--space-2xs); margin-bottom: var(--space-sm); }
		.chip {
			background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-pill);
			color: var(--text-muted); font-size: var(--text-xs); padding: 4px 12px; cursor: pointer;
			font-family: var(--font-mono);
		}
		.chip:hover { border-color: var(--border-strong); color: var(--text); }
		.chip.active { border-color: var(--accent); color: var(--accent); }
		.fact-block-line { margin-bottom: var(--space-2xs); }
		.diagram-host { display: flex; flex-direction: column; gap: var(--space-sm); margin-top: var(--space-2xs); }
		.diagram-holder { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); padding: var(--space-sm); overflow-x: auto; }
		.diagram-holder svg { display: block; margin: 0 auto; max-width: 100%; }
		.artifact-json { font-size: var(--text-xs); overflow-x: auto; max-height: 360px; }

		.artifact-view { display: flex; flex-direction: column; gap: var(--gap); max-width: 72ch; }
		.artifact-summary { font-size: var(--text-sm); color: var(--text-muted); line-height: 1.6; margin-bottom: var(--gap-dense); }
		.artifact-fields { display: flex; flex-direction: column; gap: var(--gap); }
		.field-row { display: flex; flex-direction: column; gap: 4px; }
		.field-label { font-size: var(--text-xs); color: var(--text-subtle); letter-spacing: 0.06em; font-weight: 500; }
		.field-list { margin: 0; padding-left: 20px; }
		.field-list li { font-size: var(--text-sm); line-height: 1.6; margin-bottom: 2px; }
		.field-cards { display: flex; flex-direction: column; gap: 8px; }
		.field-card { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; background: var(--surface-2); }
		.field-card .field-row { margin-bottom: 6px; }
		.field-card .field-row:last-child { margin-bottom: 0; }
		.field-inline { font-size: var(--text-sm); color: var(--text); }
		.field-sub-object { display: flex; flex-direction: column; gap: 6px; }
		.impact-table { width: 100%; font-size: var(--text-sm); border-collapse: collapse; }
		.impact-table th { font-size: var(--text-xs); color: var(--text-subtle); text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); }
		.impact-table td { padding: 4px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
		.impact-table .badge { font-size: var(--text-xs); }
	`];

	private async openArtifactView(kind: ClientArtifactKind): Promise<void> {
		// 快速切换 kind 时作废进行中的拉取与渲染(Spec review #18:过期响应不得覆盖新选择)
		const requestSeq = (this.requestSeq ?? 0) + 1;
		this.requestSeq = requestSeq;
		this.artifactView = { kind, detail: null, error: null, loading: true };
		try {
			const detail = await getArtifactRevision(this.apiBase, this.requirementId, kind);
			if (this.requestSeq !== requestSeq) return;
			this.artifactView = { kind, detail, error: null, loading: false };
			await this.renderArtifactDiagrams();
		} catch (error) {
			if (this.requestSeq !== requestSeq) return;
			this.artifactView = { kind, detail: null, error: error instanceof Error ? error.message : String(error), loading: false };
		}
	}

	/** 内容面板:summary 引言 + 图(diagrams) + 结构化卡片。 */
	private renderArtifactContent() {
		if (!this.artifactView) return nothing;
		const view = this.artifactView;
		if (view.loading) return html`<div class="fact-block" data-testid="artifact-loading">加载中…</div>`;
		if (view.error) return html`<div class="error" data-testid="artifact-error">${view.error}</div>`;
		if (!view.detail) return html`<div class="fact-block" data-testid="artifact-empty">该产物尚无当前版本:对应设计任务产出并完成后,此处可查看内容。</div>`;
		const diagrams = extractDiagrams(view.detail.content);
		return html`
			<div class="artifact-view" data-testid="artifact-content">
				<div class="fact-block-line">r${view.detail.revisionNo} · ${statusLabel(view.detail.status)} · ${schemaRefLabel(view.detail.schemaRef)}</div>
				${diagrams.length > 0
					? html`<div class="diagram-host" data-testid="artifact-diagrams">${diagrams.map((_, index) => html`<div data-diagram-id=${index} class="diagram-holder"></div>`)}</div>`
					: nothing}
				${renderArtifactFields(view.detail.content, view.kind)}
			</div>
		`;
	}

	/** mermaid 异步渲染:图源由 graphToMermaid 生成后渲染进宿主 div。渲染受 requestSeq 保护,切 kind 即作废。 */
	private async renderArtifactDiagrams(): Promise<void> {
		const view = this.artifactView;
		if (!view?.detail || view.loading || view.error) return;
		const diagrams = extractDiagrams(view.detail.content);
		if (diagrams.length === 0) return;
		const requestSeq = this.requestSeq ?? 0;
		await this.updateComplete;
		try {
			for (const [index, diagram] of diagrams.entries()) {
				if (this.requestSeq !== requestSeq) return;
				if (!isGraphDiagram(diagram)) continue;
				const source = graphToMermaid(view.kind, diagram as GraphDiagram);
				if (source === null) continue;
				const holder = this.renderRoot.querySelector(`[data-diagram-id="${index}"]`);
				if (!holder) continue;
				holder.textContent = "渲染中…";
				mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
				const { svg } = await mermaid.render(`mermaid-${view.kind}-${index}-${requestSeq}`, source);
				if (this.requestSeq !== requestSeq) return;
				holder.innerHTML = svg;
			}
		} catch {
			// 渲染失败不阻塞内容查看器——保留宿主内错误占位
		}
	}

	override updated(changed: Map<string, unknown>): void {
		super.updated(changed);
		if (changed.has("artifactView")) {
			void this.renderArtifactDiagrams();
		}
	}

	render() {
		const projection = this.projection;
		if (!projection) return nothing;
		const check = projection.readiness.checks.find((c) => c.name === "complete_required_artifacts");
		const missingKinds = check?.detail?.replace("missing=", "").split(",").filter(Boolean) ?? [];
		return html`<section class="details" data-testid="details">
			<h3>产物进度</h3>
			<div class="artifact-progress" data-testid="artifact-progress">
				${ARTIFACT_VIEW_KINDS.map((kind) => {
					const done = !missingKinds.includes(kind);
					return html`<span class="chip ${done ? "done" : "missing"}" data-testid="progress-${kind}" @click=${() => void this.openArtifactView(kind)}>${ARTIFACT_KIND_LABELS[kind] ?? kind} ${done ? "✓" : "✗"}</span>`;
				})}
			</div>

			<h3>就绪检查</h3>
			<div class="readiness-list" data-testid="readiness-list">
				${projection.readiness.checks.map(
					(check) => html`<div class="readiness-row ${check.passed ? "passed" : "failed"}" data-testid="readiness-${check.name}">
						<span class="badge" data-tone=${check.passed ? "ok" : "bad"}>${check.passed ? "✓" : "✗"}</span>
						<span class="readiness-label">${readinessCheckLabel(check.name)}</span>
						<span class="readiness-detail">${readinessCheckDetail(check.name, check.detail)}</span>
					</div>`,
				)}
			</div>

			<h3>产物内容</h3>
			<div data-testid="artifact-viewer">
				<div class="artifact-kind-row">
					${ARTIFACT_VIEW_KINDS.map(
						(kind) => html`<button class="${kind === this.artifactView?.kind ? "chip active" : "chip"}" @click=${() => void this.openArtifactView(kind)}>${ARTIFACT_KIND_LABELS[kind] ?? kind}</button>`,
					)}
				</div>
				${this.renderArtifactContent()}
			</div>
		</section>`;
	}
}

customElements.define("baize-artifacts-tab", BaizeArtifactsTab);
