import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
import {
	packetReviewDrift,
	commandLabel,
	statusLabel,
	type WorkflowProjection,
	type CommandReceipt,
	type ApprovalPacketDetail,
	type PacketReviewContext,
} from "./workflow-client.js";

/**
 * baize-approval-review — 批准包专注审阅(票 #82)。
 * 纯展示组件:由 baize-workflow 持有 approvalPacket / approvalContext /
 * approvalStale / approvalReceipt / busy / connected,通过属性传入。
 * 本地的 rejectOpen 只控制打回表单显隐;批准、打回、关闭、重载动作均上抛事件。
 */
class BaizeApprovalReview extends LitElement {
	static properties = {
		projection: { type: Object },
		approvalPacket: { type: Object, attribute: "approval-packet" },
		approvalContext: { type: Object, attribute: "approval-context" },
		approvalStale: { type: Boolean, attribute: "approval-stale" },
		approvalReceipt: { type: Object, attribute: "approval-receipt" },
		busy: { type: Boolean },
		connected: { type: Boolean },
		rejectOpen: { state: true },
	};

	declare projection: WorkflowProjection | null;
	declare approvalPacket: ApprovalPacketDetail | null;
	declare approvalContext: (PacketReviewContext & { approveCommandId: string; rejectCommandId: string }) | null;
	declare approvalStale: boolean;
	declare approvalReceipt: CommandReceipt | null;
	declare busy: boolean;
	declare connected: boolean;

	declare rejectOpen: boolean;

	constructor() {
		super();
		this.projection = null;
		this.approvalPacket = null;
		this.approvalContext = null;
		this.approvalStale = false;
		this.approvalReceipt = null;
		this.rejectOpen = false;
		this.busy = false;
		this.connected = false;
	}

	static styles = [sharedStyles, css`
		/* — 批准 — */
		.approval { margin-top: 16px; border: 2px solid var(--accent); border-radius: var(--radius); background: var(--surface); }
		.approval .approval-body { padding: var(--pad); max-height: 60vh; overflow-y: auto; }
		.approval h3 { margin: 12px 0 6px; font-size: var(--text-sm); color: var(--text-muted); letter-spacing: 0.06em; }
		.approval h3:first-child { margin-top: 0; }
		.approval-bar { position: sticky; bottom: 0; display: flex; gap: 10px; align-items: center; padding: 12px 16px; background: var(--surface-2); border-top: 1px solid var(--border); border-radius: 0 0 var(--radius-sm) var(--radius-sm); }
		.approval-bar .spacer { flex: 1; }
		.approval .digest-line { font-family: var(--font-mono); font-size: var(--text-xs); word-break: break-all; }
		.reject-form { margin-top: 10px; border: 1px solid var(--danger); border-radius: var(--radius); padding: 10px 12px; background: var(--warn-soft); }
		.reject-form label { display: inline-flex; gap: 4px; align-items: center; margin-right: 10px; font-size: var(--text-sm); }

		.stale-box { margin: 8px 0; border: 1px solid var(--danger); background: var(--warn-soft); border-radius: var(--radius-sm); padding: 8px 10px; font-size: var(--text-sm); color: var(--danger); }
		.context-receipt { margin-top: 8px; font-size: var(--text-sm); border-radius: var(--radius-sm); padding: 8px 10px; }
		.context-receipt[data-outcome="accepted"] { border: 1px solid var(--ok); background: var(--ok-soft); }
		.context-receipt:not([data-outcome="accepted"]) { border: 1px solid var(--danger); background: var(--warn-soft); color: var(--danger); }
	`];

	private handleKeydown(event: KeyboardEvent): void {
		if (event.key === "Escape") this.onClose();
	}

	private onApprove(): void {
		this.dispatchEvent(new CustomEvent("baize-approve", { bubbles: true, composed: true }));
	}

	private onRejectToggle(): void {
		this.rejectOpen = !this.rejectOpen;
	}

	private onRejectSubmit(event: SubmitEvent): void {
		event.preventDefault();
		const formData = new FormData(event.target as HTMLFormElement);
		const reason = String(formData.get("reason") ?? "");
		const targets = formData.getAll("targets").map((value) => String(value));
		this.dispatchEvent(new CustomEvent("baize-reject", { detail: { reason, targets }, bubbles: true, composed: true }));
	}

	private onClose(): void {
		this.dispatchEvent(new CustomEvent("baize-close-approval", { bubbles: true, composed: true }));
	}

	private onReload(): void {
		this.dispatchEvent(new CustomEvent("baize-reload-approval", { bubbles: true, composed: true }));
	}

	render() {
		if (!this.approvalPacket || !this.approvalContext || !this.projection) return nothing;
		const packet = this.approvalPacket;
		const content = packet.content;
		const stale = this.approvalStale;
		const drift = stale ? packetReviewDrift(this.projection, this.approvalContext) : null;
		const approvedProjection = this.projection.workflow.state === "archived";
		return html`
			<section class="approval" data-testid="approval-review" role="dialog" aria-label="批准包审阅"
				@keydown=${this.handleKeydown}>
				<div class="approval-body">
					<h3 data-testid="approval-heading" tabindex="-1">批准包审阅 — Packet #${packet.id}</h3>
					<div class="digest-line" data-testid="packet-digest">digest: ${packet.digest}</div>
					<div class="digest-line">schema: ${content.schemaVersion} · policy: ${content.policyBundleDigest.slice(0, 27)}… · requirement revision: #${content.requirementRevisionId}</div>

					${stale && drift
						? html`<div class="stale-box" data-testid="approval-stale" role="alert">
							批准包已更新:期望 digest ${drift.expectedDigest.slice(0, 27)}… / 当前 ${drift.actualDigest ? `${drift.actualDigest.slice(0, 27)}…` : "已撤回"}
							(版本 ${drift.expectedWorkflowVersion} → ${drift.actualWorkflowVersion})。
							审阅已锁定,批准与打回已禁用;阅读位置已保留,请检查差异后显式重新加载。
							<button data-testid="approval-reload" @click=${this.onReload}>重新加载</button>
						</div>`
						: nothing}

					<h3>必需产物修订</h3>
					<table data-testid="packet-artifacts">
						<thead><tr><th>Kind</th><th>Revision</th><th>状态</th><th>Content Digest</th></tr></thead>
						<tbody>
							${content.artifacts.map(
								(artifact) => html`<tr data-kind=${artifact.kind}>
									<td>${artifact.kind}</td>
									<td>r${artifact.revisionNo} (#${artifact.revisionId})</td>
									<td><span class="badge" data-tone=${artifact.status === "approved" ? "ok" : "warn"}>${artifact.status}</span></td>
									<td class="digest-line">${artifact.contentDigest.slice(0, 27)}…</td>
								</tr>`,
							)}
						</tbody>
					</table>

					<h3>决策处置</h3>
					<div data-testid="packet-decisions">
						${content.decisions.length === 0 ? html`无 Decision` : nothing}
						${content.decisions.map(
							(decision) => html`<div><span class="badge">${decision.severity}</span> ${decision.summary} — ${decision.status}${decision.reason ? html`(${decision.reason})` : nothing}</div>`,
						)}
					</div>

					<h3>发现 / 风险</h3>
					<div data-testid="packet-findings">
						${content.findings.length === 0 ? html`无 Finding(零 Finding 报告含完整 coverage 声明)` : nothing}
						${content.findings.map(
							(finding) => html`<div>
								<span class="badge" data-tone=${finding.severity === "critical" ? "bad" : finding.severity === "major" ? "warn" : ""}>${finding.severity}</span>
								${finding.summary} — ${finding.status}
								${finding.riskAcceptedBy ? html`(风险接受:${finding.riskAcceptedBy} — ${finding.riskAcceptanceReason})` : nothing}
							</div>`,
						)}
						${content.disclosedFindingIds.length > 0 ? html`<div>披露 Finding ids:${content.disclosedFindingIds.join(", ")}</div>` : nothing}
					</div>

					<h3>评审覆盖</h3>
					<div data-testid="packet-coverage">覆盖 revisions:${content.criticCoverage.coveredRevisionIds.join(", ") || "—"}</div>

					<h3>一致性警告</h3>
					<div data-testid="packet-warnings">
						${content.warnings.length === 0 ? html`无警告` : content.warnings.map((warning) => html`<div class="banner" data-tone="warn">${warning}</div>`)}
					</div>

					<h3>就绪检查</h3>
					<div data-testid="packet-readiness">
						${this.projection.readiness.checks.map(
							(check) => html`<div>${check.passed ? "✓" : "✗"} ${check.name} — ${check.detail}</div>`,
						)}
					</div>

					${this.approvalReceipt
						? html`<div class="context-receipt" data-testid="approval-receipt" data-outcome=${this.approvalReceipt.outcome}>
							回执:${commandLabel(this.approvalReceipt.commandType)} → ${statusLabel(this.approvalReceipt.outcome)}(HTTP ${this.approvalReceipt.httpStatus})
							${this.approvalReceipt.outcome === "accepted" && !approvedProjection ? html`— 已接受,等待归档 Projection 确认…` : nothing}
						</div>`
						: nothing}

					${this.rejectOpen
						? html`<form class="reject-form" data-testid="reject-form" @submit=${this.onRejectSubmit}>
							<h3>打回(需要理由与结构化目标)</h3>
							<input name="reason" placeholder="打回理由" required aria-label="打回理由" />
							<fieldset>
								<legend>返工目标</legend>
								${content.requiredArtifactKinds.map(
									(kind) => html`<label><input type="checkbox" name="targets" value=${kind} /> ${kind}</label>`,
								)}
								<label><input type="checkbox" name="targets" value="plan" /> plan</label>
							</fieldset>
							<button type="submit" class="primary" data-testid="reject-submit" ?disabled=${this.busy || !this.connected || stale}>确认打回</button>
						</form>`
						: nothing}
				</div>
				<div class="approval-bar" data-testid="approval-bar">
					<button class="primary" data-testid="approve-submit" ?disabled=${this.busy || !this.connected || stale || !packet.valid}
						@click=${this.onApprove}>批准归档</button>
					<button class="danger" data-testid="reject-toggle" ?disabled=${this.busy || !this.connected || stale}
						@click=${this.onRejectToggle}>打回…</button>
					<span class="spacer"></span>
					<button data-testid="approval-close" @click=${this.onClose}>关闭(Esc)</button>
				</div>
			</section>
		`;
	}

	override firstUpdated(changedProperties: Map<string, unknown>): void {
		super.firstUpdated(changedProperties);
		this.shadowRoot?.querySelector<HTMLElement>("[data-testid='approval-heading']")?.focus();
	}
}

customElements.define("baize-approval-review", BaizeApprovalReview);
