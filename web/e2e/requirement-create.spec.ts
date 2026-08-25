import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import { modelConfigFixture, widthAlignmentProjection } from "./model-config-fixture";

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

		await expect(page.getByTestId("model-custom-count")).toHaveText("0/9 需求级自定义");

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

	test("自定义: 任一角色改动即 materialize 完整 9 角色 map", async ({ page }) => {
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

		await expect(page.getByTestId("model-custom-count")).toHaveText("1/9 需求级自定义");
		await expect(page.getByTestId("model-row-analysis-analyst")).toHaveAttribute("data-custom", "true");

		await page.getByRole("button", { name: "创建需求并开始设计" }).click();

		expect(requests).toHaveLength(1);
		const body = parseBody(requests[0]!.postData());
		expect(body).toHaveProperty("modelRoles");
		const modelRoles = body.modelRoles as Record<string, { provider: string; modelId: string }>;
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
		await expect(page.getByTestId("model-custom-count")).toHaveText("1/9 需求级自定义");

		await page.getByRole("button", { name: "恢复部署默认" }).click();
		await expect(page.getByTestId("model-custom-count")).toHaveText("0/9 需求级自定义");
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
	test("分组表头 + option 纯名 + 行内规格行随选择实时更新", async ({ page }) => {
		await page.route("**/api/model-config", (route) => fulfillJson(route, modelConfigFixture()));
		await page.route("**/api/requirements?workspaceId=1", (route) => fulfillJson(route, { requirements: [] }));
		await openFixture(page);

		// 三段分组标题
		await expect(page.getByTestId("picker-group-分析")).toHaveText("分析");
		await expect(page.getByTestId("picker-group-架构")).toHaveText("架构");
		await expect(page.getByTestId("picker-group-评审")).toHaveText("评审");
		await expect(page.getByTestId("picker-group-分析").locator("td")).toHaveAttribute("colspan", "4");

		// option 只含模型名,不带 ctx/tok/thinking 元数据
		const optionTexts = await page.getByTestId("model-select-analysis-analyst").locator("option").allTextContents();
		expect(optionTexts).toEqual(["Qwen Max", "Qwen Plus"]);

		// 行内规格行显示当前选中模型(部署默认 analysis-analyst = Qwen Plus)
		await expect(page.getByTestId("model-meta-analysis-analyst")).toHaveText("Qwen Plus · 1,048,576 ctx · 8,192 tok");

		// 切换模型后规格行实时更新(含 thinking 标记)
		await page.getByTestId("model-select-analysis-analyst").selectOption("qwen-max");
		await expect(page.getByTestId("model-meta-analysis-analyst")).toHaveText("Qwen Max · 1,048,576 ctx · 16,384 tok · thinking");
	});

	test("模型档与需求列表同宽,需求级自定义出徽标", async ({ page }) => {
		await page.route("**/api/model-config", (route) => fulfillJson(route, modelConfigFixture()));
		await page.route("**/api/requirements?workspaceId=1", (route) =>
			fulfillJson(route, {
				requirements: [
					{ requirementId: 1, title: "宽度对齐示例", requirementVersion: 1, workflow: { id: 7, state: "running", version: 1, lastEventSeq: 1 } },
				],
			}),
		);
		await page.route("**/api/workflows/7", (route) => fulfillJson(route, widthAlignmentProjection()));
		await openFixture(page);

		// 需求级自定义 1/9 → 卡片徽标
		await expect(page.getByTestId("model-badge-1")).toHaveText("模型档 1/9");

		// 选择器与列表卡同宽(表单不再被 720px 收窄)
		await expect(page.getByTestId("model-picker")).toBeVisible();
		const pickerBox = await page.getByTestId("model-picker").boundingBox();
		const itemBox = await page.locator(".card.item").first().boundingBox();
		expect(pickerBox).not.toBeNull();
		expect(itemBox).not.toBeNull();
		expect(Math.abs(pickerBox!.width - itemBox!.width)).toBeLessThan(1);
	});
});
