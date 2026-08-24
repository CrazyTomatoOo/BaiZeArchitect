import { expect, test, type Page, type Request, type Route } from "@playwright/test";

/**
 * 票7 需求创建模型档选择 e2e — 验证默认 omit、自定义完整 materialize、invalid_model_roles 错误展示。
 */

async function fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
	await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
}

function parseBody(raw: string | null): Record<string, unknown> {
	try {
		return JSON.parse(raw ?? "{}") as Record<string, unknown>;
	} catch {
		return {};
	}
}

function modelConfigFixture() {
	return {
		defaultRoles: {
			orchestrator: { provider: "qwen-token-plan-cn", modelId: "qwen-max" },
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

async function openFixture(page: Page): Promise<void> {
	await page.goto("/e2e/requirement-create.html");
	await expect(page.getByTestId("model-picker")).toBeVisible();
}

test.describe("requirement creation model profile", () => {
	test("默认: 不自定义任何角色时 payload 省略 modelRoles", async ({ page }) => {
		const requests: Request[] = [];
		await page.route("**/api/model-config", (route) => fulfillJson(route, modelConfigFixture()));
		await page.route("**/api/requirements?workspaceId=1", (route) => fulfillJson(route, { requirements: [] }));
		await page.route("**/api/workspaces/1/requirements", async (route) => {
			requests.push(route.request());
			await fulfillJson(route, { requirementId: 42, workflowId: 742, workflowState: "pending" }, 201);
		});
		await openFixture(page);

		await expect(page.getByTestId("model-custom-count")).toHaveText("有效模型档 · 0/10 自定义");

		await page.getByPlaceholder("标题").fill("新建需求");
		await page.getByPlaceholder("一句话摘要").fill("一句话摘要");
		await page.getByPlaceholder("详细描述:目标、边界、约束").fill("详细描述");
		await page.getByRole("button", { name: "创建需求并开始设计" }).click();

		expect(requests).toHaveLength(1);
		const body = parseBody(requests[0]!.postData());
		expect(body).toHaveProperty("baseline");
		expect(body.baseline).toMatchObject({
			title: "新建需求",
			summary: "一句话摘要",
			description: "详细描述",
		});
		expect(body).not.toHaveProperty("modelRoles");
	});

	test("自定义: 任一角色改动即 materialize 完整 10 角色 map", async ({ page }) => {
		const requests: Request[] = [];
		await page.route("**/api/model-config", (route) => fulfillJson(route, modelConfigFixture()));
		await page.route("**/api/requirements?workspaceId=1", (route) => fulfillJson(route, { requirements: [] }));
		await page.route("**/api/workspaces/1/requirements", async (route) => {
			requests.push(route.request());
			await fulfillJson(route, { requirementId: 42, workflowId: 742, workflowState: "pending" }, 201);
		});
		await openFixture(page);

		await page.getByPlaceholder("标题").fill("自定义模型档");
		await page.getByPlaceholder("一句话摘要").fill("摘要");
		await page.getByPlaceholder("详细描述:目标、边界、约束").fill("描述");

		const analystRow = page.getByTestId("model-row-analysis-analyst");
		await analystRow.getByTestId("model-provider-analysis-analyst").selectOption("glm");
		await analystRow.getByTestId("model-select-analysis-analyst").selectOption("glm-5.2");

		await expect(page.getByTestId("model-custom-count")).toHaveText("有效模型档 · 1/10 自定义");
		await expect(page.getByTestId("model-row-analysis-analyst")).toHaveAttribute("data-custom", "true");

		await page.getByRole("button", { name: "创建需求并开始设计" }).click();

		expect(requests).toHaveLength(1);
		const body = parseBody(requests[0]!.postData());
		expect(body).toHaveProperty("modelRoles");
		const modelRoles = body.modelRoles as Record<string, { provider: string; modelId: string }>;
		expect(modelRoles.orchestrator).toEqual({ provider: "qwen-token-plan-cn", modelId: "qwen-max" });
		expect(modelRoles["analysis-analyst"]).toEqual({ provider: "glm", modelId: "glm-5.2" });
		expect(modelRoles["scenario-analyst"]).toEqual({ provider: "qwen-token-plan-cn", modelId: "qwen-plus" });
		expect(modelRoles["usecase-analyst"]).toEqual({ provider: "qwen-token-plan-cn", modelId: "qwen-plus" });
		expect(modelRoles["function-analyst"]).toEqual({ provider: "qwen-token-plan-cn", modelId: "qwen-plus" });
		expect(modelRoles["design-architect"]).toEqual({ provider: "glm", modelId: "glm-5.2" });
		expect(modelRoles["architecture-architect"]).toEqual({ provider: "glm", modelId: "glm-5.2" });
		expect(modelRoles["data-architect"]).toEqual({ provider: "glm", modelId: "glm-5.2" });
		expect(modelRoles["api-architect"]).toEqual({ provider: "glm", modelId: "glm-5.2" });
		expect(modelRoles.critic).toEqual({ provider: "glm", modelId: "glm-4.2" });
	});

	test("恢复默认档: 清除自定义并恢复继承状态", async ({ page }) => {
		await page.route("**/api/model-config", (route) => fulfillJson(route, modelConfigFixture()));
		await page.route("**/api/requirements?workspaceId=1", (route) => fulfillJson(route, { requirements: [] }));
		await page.route("**/api/workspaces/1/requirements", async (route) =>
			fulfillJson(route, { requirementId: 42, workflowId: 742, state: "pending" }, 201),
		);
		await openFixture(page);

		const analystRow = page.getByTestId("model-row-analysis-analyst");
		await analystRow.getByTestId("model-provider-analysis-analyst").selectOption("glm");
		await analystRow.getByTestId("model-select-analysis-analyst").selectOption("glm-5.2");
		await expect(page.getByTestId("model-custom-count")).toHaveText("有效模型档 · 1/10 自定义");

		await page.getByRole("button", { name: "恢复默认档" }).click();
		await expect(page.getByTestId("model-custom-count")).toHaveText("有效模型档 · 0/10 自定义");
		await expect(page.getByTestId("model-row-analysis-analyst")).toHaveAttribute("data-custom", "false");
	});

	test("invalid_model_roles 400 错误展示在创建表单内", async ({ page }) => {
		await page.route("**/api/model-config", (route) => fulfillJson(route, modelConfigFixture()));
		await page.route("**/api/requirements?workspaceId=1", (route) => fulfillJson(route, { requirements: [] }));
		await page.route("**/api/workspaces/1/requirements", async (route) => {
			await fulfillJson(
				route,
				{
					error: "invalid_model_roles",
					detail: [{ role: "analyst", provider: "glm", modelId: "glm-5.2", reason: "model_not_in_catalog" }],
				},
				400,
			);
		});
		await openFixture(page);

		await page.getByPlaceholder("标题").fill("错误场景");
		await page.getByPlaceholder("一句话摘要").fill("摘要");
		await page.getByPlaceholder("详细描述:目标、边界、约束").fill("描述");
		const analystRow = page.getByTestId("model-row-analysis-analyst");
		await analystRow.getByTestId("model-provider-analysis-analyst").selectOption("glm");
		await analystRow.getByTestId("model-select-analysis-analyst").selectOption("glm-5.2");
		await page.getByRole("button", { name: "创建需求并开始设计" }).click();

		await expect(page.getByTestId("create-error")).toContainText("模型角色配置无效");
		await expect(page.getByTestId("create-error")).toContainText("model_not_in_catalog");
	});
});
