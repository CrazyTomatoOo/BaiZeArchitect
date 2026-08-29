import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
import {
	journeySteps,
	stateHero,
	stateLabel,
	type RequirementDetail,
	type WorkflowProjection,
} from "./workflow-client.js";

/**
 * baize-workflow-hero — 工作流状态 hero:状态标签 + 需求标题 + 设计旅程
 * 步骤条 + 状态描述 + 主动作按钮。纯展示组件:动作不上抛逻辑,只上抛事件——
 * baize-open-package(查看设计包)或 baize-primary-action(其余主动作),
 * 由宿主 baize-workflow 决定执行路径。票 #81:从 baize-workflow.renderHero()
 * 抽取,data-testid 契约(hero/primary-action/stages/stage-*)原样保留。
 */
class BaizeWorkflowHero extends LitElement {
	static properties = {
		projection: { type: Object },
		requirement: { type: Object },
		busy: { type: Boolean },
		connected: { type: Boolean },
	};
	declare projection: WorkflowProjection | null;
	declare requirement: RequirementDetail | null;
	declare busy: boolean;
	declare connected: boolean;

	constructor() {
		super();
		this.projection = null;
		this.requirement = null;
		this.busy = false;
		this.connected = false;
	}

	static styles = [sharedStyles, css`
		:host { display: block; }

		/* — 状态卡 — */
		.hero {
			border: 1px solid var(--border);
			border-left: 3px solid var(--accent);
			border-radius: var(--radius);
			padding: calc(var(--pad) + 6px);
			background: var(--surface);
			margin-top: var(--gap);
		}
		.hero .state {
			display: inline-block;
			font-size: var(--text-xs);
			letter-spacing: 0.08em;
			color: var(--accent);
			margin-bottom: 6px;
			font-family: var(--font-mono);
		}
		.hero h2 { margin: 0 0 4px; font-size: var(--text-xl); font-family: var(--font-display); font-weight: 600; overflow-wrap: anywhere; min-width: 0; }
		.hero p { margin: 4px 0 12px; color: var(--text-muted); }
		.hero .journey { margin-bottom: 14px; }
	`];

	/** 主动作:package 态上抛 baize-open-package,其余上抛 baize-primary-action。 */
	private onPrimaryAction(): void {
		const projection = this.projection;
		if (!projection) return;
		const hero = stateHero(projection.workflow.state);
		if (hero.action.kind === "package") {
			this.dispatchEvent(new CustomEvent("baize-open-package", { bubbles: true, composed: true }));
			return;
		}
		this.dispatchEvent(new CustomEvent("baize-primary-action", { bubbles: true, composed: true }));
	}

	render() {
		const projection = this.projection;
		if (!projection) return nothing;
		const hero = stateHero(projection.workflow.state);
		const steps = journeySteps(projection);
		return html`
			<section class="hero" data-testid="hero" data-state=${projection.workflow.state}>
				<span class="state">${stateLabel(projection.workflow.state)}</span>
				<h2>${this.requirement?.title ?? ""}</h2>
				<div class="journey" data-testid="stages" aria-label="设计旅程">
					${steps.map(
						(step, i) => html`${i > 0 ? html`<span class="step-link ${steps[i - 1]!.status === "done" ? "done" : ""}"></span>` : nothing}
						<span class="step" data-testid="stage-${step.key}" data-status=${step.status}>
							<span class="dot">${step.status === "done" ? "✓" : i + 1}</span>
							<span class="name">${step.label}</span>
						</span>`,
					)}
				</div>
				<p>${hero.description}</p>
				<button class="primary" data-testid="primary-action" ?disabled=${this.busy || !this.connected} @click=${() => this.onPrimaryAction()}>
					${hero.action.label}
				</button>
			</section>
		`;
	}
}

customElements.define("baize-workflow-hero", BaizeWorkflowHero);
