import {
	gateQueue,
	getWorkflowProjection,
	journeySteps,
	listRequirements,
	pendingCounts,
	type GateQueueItem,
	type JourneyStep,
	type PendingCounts,
	type WorkflowProjection,
	type WorkflowState,
} from "./workflow-client.js";

/** 单个需求在列表/总览/审核中心的聚合视图。 */
export interface RequirementView {
	id: number;
	workflowId: number;
	title: string;
	projection: WorkflowProjection;
	state: WorkflowState;
	stages: readonly JourneyStep[];
	counts: PendingCounts;
	gates: readonly GateQueueItem[];
}

/** 拉取工作区全部需求的聚合视图(列表 + Projection),供总览/需求/审核中心复用。 */
export async function loadRequirementViews(apiBase: string, workspaceId: number): Promise<RequirementView[]> {
	const summaries = await listRequirements(apiBase, workspaceId);
	const views = await Promise.all(
		summaries.map(async (summary) => {
			const projection = await getWorkflowProjection(apiBase, summary.workflow.id);
			return {
				id: summary.requirementId,
				workflowId: summary.workflow.id,
				title: summary.title,
				projection,
				state: projection.workflow.state,
				stages: journeySteps(projection),
				counts: pendingCounts(projection),
				gates: gateQueue(projection),
			} satisfies RequirementView;
		}),
	);
	return views;
}

/** 待我处理总数:门禁 + 待批准。 */
export function attentionCount(view: RequirementView): number {
	return view.gates.length + (view.state === "ready_to_archive" ? 1 : 0) + (view.state === "failed" ? 1 : 0);
}
