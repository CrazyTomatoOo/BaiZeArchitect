/**
 * artifact-content — 产物内容结构化渲染。
 * 把 artifact JSON 按 schema 字段渲染成人类可读的卡片+列表+表格,
 * 而非平铺 JSON dump。通用渲染 + kind 修饰(impactProfile 表格化等)。
 */
import { html, nothing, type TemplateResult } from "lit";
type _MaybeRender = TemplateResult | typeof nothing;
import type { ClientArtifactKind } from "./workflow-client.js";
import { fieldTitle, IMPACT_STATUS_LABELS } from "./artifact-labels.js";

/** 跳过这些 key(已渲染为元信息行/引言或在其他字段内嵌)。 */
const SKIP_KEYS: Record<string, true> = { schemaVersion: true, artifactKind: true, summary: true, diagrams: true, sourceRefs: true };

/** 判断值是否为「空」(空数组/空字符串/null/undefined)。 */
function isEmpty(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === "string") return value.trim() === "";
	return false;
}

/** impactProfile → 2 列状态表格。 */
function renderImpactProfile(profile: Record<string, unknown>): TemplateResult {
	const dimensions = ["process", "actors", "behavior", "architecture", "data", "api"];
	return html`
		<table class="impact-table" data-testid="impact-profile-table">
			<thead><tr><th>维度</th><th>状态</th><th>理由</th></tr></thead>
			<tbody>
				${dimensions.map((dim) => {
					const d = (profile[dim] ?? {}) as { status?: string; rationale?: string };
					const status = d.status ?? "—";
					const tone = status === "yes" ? "ok" : status === "no" ? "bad" : "";
					const label = IMPACT_STATUS_LABELS[status] ?? status;
					return html`<tr>
						<td>${fieldTitle(dim)}</td>
						<td><span class="badge" data-tone=${tone}>${label}</span></td>
						<td>${d.rationale ?? "—"}</td>
					</tr>`;
				})}
			</tbody>
		</table>
	`;
}

/** 字符串数组 → 有序号列表。 */
function renderStringList(items: readonly string[], testId: string): TemplateResult {
	return html`<ol class="field-list" data-testid=${testId}>
		${items.map((item) => html`<li>${item}</li>`)}
	</ol>`;
}

/** 嵌套对象数组 → 每个对象一小卡片,卡内键值递归渲染。 */
function renderObjectArray(items: readonly unknown[], testId: string): TemplateResult {
	return html`<div class="field-cards" data-testid=${testId}>
		${items.map((item, index) => html`<div class="field-card">
			${renderFields(item, `${testId}-${index}`)}
		</div>`)}
	</div>`;
}

/** 递归渲染任意值:数组→列表/卡片,对象→键值,字符串→段落。 */
function renderValue(value: unknown, testId: string): _MaybeRender {
	if (Array.isArray(value)) {
		if (value.length === 0) return nothing;
		if (typeof value[0] === "string") return renderStringList(value as readonly string[], testId);
		if (typeof value[0] === "object" && value[0] !== null) return renderObjectArray(value as readonly unknown[], testId);
		return html`<div class="field-inline">${value.join(", ")}</div>`;
	}
	if (typeof value === "object" && value !== null) {
		const record = value as Record<string, unknown>;
		if (testId.startsWith("impact")) return renderImpactProfile(record);
		return html`<div class="field-sub-object">${renderFields(value, testId)}</div>`;
	}
	return html`<div class="field-inline">${String(value)}</div>`;
}

function renderFields(content: unknown, testIdPrefix: string): _MaybeRender {
	if (typeof content !== "object" || content === null) return nothing;
	const entries = Object.entries(content as Record<string, unknown>);
	const visible = entries.filter(([key, value]) => !SKIP_KEYS[key] && !isEmpty(value));
	if (visible.length === 0) return nothing;
	return html`${visible.map(([key, value]) => {
		const testId = `${testIdPrefix}-${key}`;
		return html`<div class="field-row" data-testid=${testId}>
			<div class="field-label">${fieldTitle(key)}</div>
			${renderValue(value, testId)}
		</div>`;
	})}`;
}

/** 主入口:渲染产物内容为结构化卡片。 */
export function renderArtifactFields(content: unknown, kind: ClientArtifactKind): TemplateResult {
	const summary = typeof content === "object" && content !== null
		? (content as Record<string, unknown>).summary
		: undefined;
	return html`
		${typeof summary === "string" && summary.trim()
			? html`<div class="artifact-summary" data-testid="artifact-summary-text">${summary}</div>`
			: nothing}
		<div class="artifact-fields" data-testid="artifact-fields">
			${renderFields(content, `artifact-${kind}`)}
		</div>
	`;
}