/** 模型档 e2e 共享 fixture:与 web/src/model-profiles.test.ts 同源数据的路由 mock。 */
export function modelConfigFixture() {
	return {
		defaultRoles: {
			"analysis-analyst": { provider: "qwen-token-plan-cn", modelId: "qwen-plus" },
			"scenario-analyst": { provider: "qwen-token-plan-cn", modelId: "qwen-plus" },
			"usecase-analyst": { provider: "qwen-token-plan-cn", modelId: "qwen-plus" },
			"function-analyst": { provider: "qwen-token-plan-cn", modelId: "qwen-plus" },
			"design-architect": { provider: "glm", modelId: "glm-5.2" },
			"architecture-architect": { provider: "glm", modelId: "glm-5.2" },
			"data-architect": { provider: "glm", modelId: "glm-5.2" },
			"api-architect": { provider: "glm", modelId: "glm-5.2" },
			critic: { provider: "glm", modelId: "glm-4.2" },
		},
		providers: [
			{
				id: "qwen-token-plan-cn",
				name: "通义千问",
				models: [
					{ id: "qwen-max", name: "Qwen Max", contextWindow: 1_048_576, maxTokens: 16_384, reasoning: true },
					{ id: "qwen-plus", name: "Qwen Plus", contextWindow: 1_048_576, maxTokens: 8_192, reasoning: false },
				],
			},
			{
				id: "glm",
				name: "智谱 GLM",
				models: [
					{ id: "glm-5.2", name: "GLM-5.2", contextWindow: 128_000, maxTokens: 8_192, reasoning: false },
					{ id: "glm-4.2", name: "GLM-4.2", contextWindow: 128_000, maxTokens: 4_096, reasoning: false },
				],
			},
		],
	};
}

/** 列表宽度对齐断言用:完整投影 fixture(含需求级自定义 1 个)。 */
export function widthAlignmentProjection() {
	return {
		workflow: {
			id: 7,
			state: "running",
			version: 1,
			lastEventSeq: 1,
			currentFailureCode: null,
			modelRoles: { "analysis-analyst": { provider: "glm", modelId: "glm-5.2" } },
			policyBundle: { documentId: 5, digest: `sha256:${"a".repeat(64)}` },
		},
		requirement: {
			id: 1,
			workspaceId: 2,
			title: "宽度对齐示例",
			version: 1,
			currentRevision: { id: 11, revisionNo: 1, status: "approved", digest: `sha256:${"b".repeat(64)}`, schemaRef: "artifact/requirement/v1" },
		},
		designSession: { id: 4, status: "active", sessionId: "design-session:1" },
		currentPlan: { id: 3, revisionNo: 1, status: "active", proposalDigest: `sha256:${"c".repeat(64)}`, createdAt: "2026-08-12T10:00:00.000Z" },
		tasks: [
			{ id: 1, key: "plan-1", kind: "plan", role: "orchestrator", status: "completed", maxAttempts: 2, latestAttempt: { id: 1, attemptNo: 1, status: "succeeded" } },
			{ id: 2, key: "analyze-1", kind: "analyze", role: "analyst", status: "in_progress", maxAttempts: 3, latestAttempt: { id: 2, attemptNo: 1, status: "running" } },
			{ id: 3, key: "design-1", kind: "design", role: "architect", status: "pending", maxAttempts: 3, latestAttempt: null },
		],
		activeClaim: { id: 8, taskId: 2, attemptId: 2, runId: 12, acquiredAt: "2026-08-12T10:01:00.000Z" },
		activeRun: { id: 12, status: "running", mode: "attempt", role: "analyst", startedAt: "2026-08-12T10:01:00.000Z" },
		openGates: [],
		decisions: [],
		findings: [],
		findingThreads: [],
		readiness: {
			workflowId: 7,
			ready: false,
			checks: [
				{ name: "terminal_current_work", passed: false, detail: "存在未终结 Task" },
				{ name: "complete_required_artifacts", passed: false, detail: "1/3 kinds 已有当前 revision" },
			],
			warnings: [],
		},
		currentPacket: null,
		currentIncident: null,
	};
}