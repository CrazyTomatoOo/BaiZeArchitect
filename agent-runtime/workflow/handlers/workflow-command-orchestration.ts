import type { HeadlessWorkflowRuntime } from "../headless-runtime.js";
import type { ModelDriver } from "../model-driver.js";

/**
 * 就绪 Task 驱动循环:以生产模型驱动器逐个执行当前就绪任务(beginAttempt 单任务语义),
 * 直到无就绪任务或工作流离开 running。命令接受后驱动,任务完成即返回;后续命令/门禁回答再次驱动。
 */
export async function runReadyTasks(runtime: HeadlessWorkflowRuntime, modelDriver: ModelDriver, workflowId: number): Promise<void> {
	const budget = 100;
	for (let iteration = 0; iteration < budget; iteration += 1) {
		const projection = runtime.getWorkflowProjection(workflowId);
		if (!projection || projection.workflow.state !== "running") return;
		const result = await runtime.executeTask(workflowId, modelDriver);
		// 任务完成后,自动批准已通过 critic review 且无 open major/critical 的 pending 产物,
		// 解锁下游任务的 task_output 输入(模板流水线:review → auto-approve → 下游)。
		approveReviewedArtifacts(runtime, workflowId);
		if (result.outcome === "no_ready_task" || result.outcome === "task_exhausted") {
			// 最后一次:review 完成后可能还有 pending 产物需要批准
			approveReviewedArtifacts(runtime, workflowId);
			// 全部批准后,检查 readiness;通过则构建 approval packet 并转到 ready_to_archive
			const proj = runtime.getWorkflowProjection(workflowId);
			if (proj && proj.workflow.state === "running") {
				const readiness = runtime.checkReadiness(workflowId);
				if (readiness.ready) {
					runtime.buildApprovalPacket(workflowId);
				}
			}
			return;
		}
	}
}

/**
 * 自动批准已通过 critic review 且无 open major/critical 的 pending 产物。
 * 模板流水线:review 完成后产物仍为 pending,下游 task_output 需 approved 才可引用。
 * 生产环境此处由人工 approve-artifact 命令完成;模板自动模式下由 runner 代行。
 */
export function approveReviewedArtifacts(runtime: HeadlessWorkflowRuntime, workflowId: number): void {
	// 查找 pending 产物:有 critic coverage 且无 open major/critical finding
	const pending = runtime.listPendingReviewedArtifacts(workflowId);
	for (const artifact of pending) {
		try {
			// 每次 approve 都重新获取 projection 拿最新 version(approve 会递增 version)
			const proj = runtime.getWorkflowProjection(workflowId);
			if (!proj) break;
			runtime.executeCommand({
				workflowId,
				commandId: `auto-approve-${artifact.revisionId}`,
				expectedWorkflowVersion: proj.workflow.version,
				type: "approve-artifact",
				operator: { actorRef: "engine", capabilities: ["workflow:operate", "workflow:approve"] },
				payload: { artifactId: artifact.artifactId, revisionId: artifact.revisionId },
			});
		} catch {
			// 批准失败不阻塞 runner;后续迭代重试或人工处理
		}
	}
}
