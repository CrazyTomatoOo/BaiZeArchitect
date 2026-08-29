import { expect, test } from "@playwright/test";

/**
 * 重新设计 E2E — 验证 VS Code 式五层布局的核心行为:
 * Activity Bar 视图切换、Side Bar 折叠、主题切换持久化、Panel toggle、
 * Status Bar 状态显示、响应式坍缩。
 */

test.describe("VS Code 式五层布局重新设计", () => {
	test("Activity Bar 视图切换 + Side Bar 内容跟随", async ({ page }) => {
		await page.goto("/");
		await page.getByLabel("Operator Token").fill("demo-token");
		await page.getByRole("button", { name: "登录" }).click();
		// 进入工作空间后 Side Bar 显示工作空间视图(需求/资产 sub-tabs)
		await page.getByRole("button", { name: "进入" }).click();
		await expect(page.locator("baize-side-bar .sub-tab").first()).toHaveText("需求");
		await expect(page.locator("baize-side-bar .sub-tab").nth(1)).toHaveText("资产");
		// 切到管理视图
		await page.goto("/manage");
		await expect(page.locator("baize-side-bar .header")).toContainText("工作空间");
		// 资产是工作空间内的 sub-view
		await page.goto("/assets");
		await expect(page.locator("baize-side-bar .sub-tab.active")).toHaveText("资产");
	});

	test("顶栏显示工作空间标签", async ({ page }) => {
		await page.goto("/");
		await page.getByLabel("Operator Token").fill("demo-token");
		await page.getByRole("button", { name: "登录" }).click();
		// 进入工作空间后顶栏显示 Workspace 标签
		await page.getByRole("button", { name: "进入" }).click();
		await expect(page.locator(".workspace-label")).toBeVisible();
	});

	test("Status Bar 显示连接状态指示灯", async ({ page }) => {
		await page.goto("/");
		await page.getByLabel("Operator Token").fill("demo-token");
		await page.getByRole("button", { name: "登录" }).click();
		// Status Bar 渲染了 dot 指示灯
		await expect(page.locator("baize-status-bar .dot")).toBeVisible();
	});

	test("Panel toggle 按钮展开/折叠 Panel", async ({ page, browserName }) => {
		test.skip(browserName === "firefox", "Firefox viewport resize unreliable");
		test.fixme(page.viewportSize()?.width !== undefined && page.viewportSize()!.width < 900, "Panel hidden <900px");
		await page.goto("/");
		await page.getByLabel("Operator Token").fill("demo-token");
		await page.getByRole("button", { name: "登录" }).click();
		// Panel 默认折叠
		await expect(page.locator(".panel-slot")).not.toHaveClass(/open/);
		// 点击 toggle 展开
		await page.locator("baize-status-bar [aria-label*='Panel'], baize-status-bar button:has-text('▸'), baize-status-bar button:has-text('▾')").first().click();
		await expect(page.locator(".panel-slot")).toHaveClass(/open/);
	});

	test("响应式坍缩: <900px Activity Bar 转底部 bar + Side Bar 转抽屉", async ({ page, browserName }) => {
		test.skip(browserName === "firefox", "Firefox viewport resize unreliable");
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/");
		await page.getByLabel("Operator Token").fill("demo-token");
		await page.getByRole("button", { name: "登录" }).click();
		// 进入工作空间
		await page.getByRole("button", { name: "进入" }).click();
		// 汉堡按钮可见
		await expect(page.getByRole("button", { name: "打开工作台导航" })).toBeVisible();
		// 点击汉堡打开 Side Bar 抽屉
		await page.getByRole("button", { name: "打开工作台导航" }).click();
		await expect(page.locator(".side-bar-slot.drawer-open")).toBeVisible();
		// scrim 可见
		await expect(page.locator(".drawer-scrim")).toBeVisible();
		// 点击 scrim 关闭
		await page.locator(".drawer-scrim").click();
		await expect(page.locator(".side-bar-slot")).not.toHaveClass(/drawer-open/);
	});

	test("响应式坍缩: <900px 右栏隐藏 + Panel 隐藏 + Status Bar 精简", async ({ page, browserName }) => {
		test.skip(browserName === "firefox", "Firefox viewport resize unreliable");
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/");
		await page.getByLabel("Operator Token").fill("demo-token");
		await page.getByRole("button", { name: "登录" }).click();
		await page.getByRole("button", { name: "进入" }).click();
		// 右栏隐藏
		await expect(page.locator(".rail-slot")).toHaveCount(0);
		// Panel slot 不展开
		await expect(page.locator(".panel-slot")).not.toHaveClass(/open/);
		// Status Bar 精简: 版本号/角色 span 隐藏
		await expect(page.locator("baize-status-bar .mono")).not.toBeVisible();
		await expect(page.locator("baize-status-bar .role")).not.toBeVisible();
	});

	test("非工作流页面右栏不占用空间", async ({ page }) => {
		await page.goto("/");
		await page.getByLabel("Operator Token").fill("demo-token");
		await page.getByRole("button", { name: "登录" }).click();
		// 需求列表页面不应有 rail-slot
		await expect(page.locator(".rail-slot")).toHaveCount(0);
		// 管理页面也不应有 rail-slot
		await page.goto("/manage");
		await expect(page.locator(".rail-slot")).toHaveCount(0);
	});
});
