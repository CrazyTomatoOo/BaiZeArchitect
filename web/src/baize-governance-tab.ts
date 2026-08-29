import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
import {
	severityLabel,
	statusLabel,
	type WorkflowProjection,
} from "./workflow-client.js";

/**
 * baize-governance-tab — 治理 Tab:决策/发现/打开的门禁/事故/当前批准包摘要 +
 * 打开批准审阅按钮。纯展示组件,按钮通过 baize-open-approval 事件上抛,
 * 由宿主 baize-workflow 执行。
 */
class BaizeGovernanceTab extends LitElement {
	static properties = {
		projection: { type: Object },
		busy: { type: Boolean },
		connected: { type: Boolean },
	};

	declare projection: WorkflowProjection | null;
	declare busy: boolean;
	declare connected: boolean;

	constructor() {
		super();
		this.projection = null;
		this.busy = false;
		this.connected = false;
	}

	static styles = [sharedStyles, css`
		:host { display: block; }

		.details { margin-top: var(--gap); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--pad); background: var(--surface); }
		.details h3 { margin: 12px 0 6px; font-size: var(--text-sm); color: var(--text-muted); letter-spacing: 0.06em; }
		.details h3:first-child { margin-top: 0; }
		.command-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
	`];

	private dispatchOpenApproval(): void {
		this.dispatchEvent(new CustomEvent("baize-open-approval", {
			bubbles: true,
			composed: true,
		}));
	}

	render() {
		const projection = this.projection;
		if (!projection) return nothing;
		return html`<section class="details" data-testid="details">
			<h3>决策与发现</h3>
			<div data-testid="governance-facts">
				${projection.decisions.length === 0 && projection.findings.length === 0 ? html`暂无决策与发现` : nothing}
				${projection.decisions.map(
					(decision) => html`<div><span class="badge">${severityLabel(decision.severity)}</span> ${decision.summary} — ${statusLabel(decision.status)}</div>`,
				)}
				${projection.findings.map(
					(finding) => html`<div><span class="badge" data-tone=${finding.severity === "critical" ? "bad" : finding.severity === "major" ? "warn" : ""}>${severityLabel(finding.severity)}</span> ${finding.summary} — ${statusLabel(finding.status)}</div>`,
				)}
			</div>

			${projection.openGates.length > 0
				? html`<h3>打开的门禁</h3>
					<div data-testid="open-gates">
						${projection.openGates.map((gate) => html`<div><span class="badge" data-tone="warn">${gate.gateType}</span> ${gate.subjectType} #${gate.subjectId}</div>`)}
					</div>`
				: nothing}

			${projection.currentIncident
				? html`<h3>事故</h3>
					<div data-testid="incident">${projection.currentIncident.incidentType} / ${projection.currentIncident.failureCode} — ${statusLabel(projection.currentIncident.status)}</div>`
				: nothing}

			${projection.currentPacket
				? html`<h3>批准包</h3>
					<div data-testid="packet">摘要 ${projection.currentPacket.digest.slice(0, 27)}… — ${statusLabel(projection.currentPacket.status)}</div>
					${projection.workflow.state === "ready_to_archive"
						? html`<div class="command-row">
							<button data-testid="open-approval" ?disabled=${this.busy || !this.connected} @click=${() => this.dispatchOpenApproval()}>打开批准审阅</button>
						</div>`
						: nothing}`
				: nothing}
		</section>`;
	}
}

customElements.define("baize-governance-tab", BaizeGovernanceTab);
