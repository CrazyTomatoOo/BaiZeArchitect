import { expect, test } from "@playwright/test";
import { benchmarkFixtureApi } from "./architecture-canvas-benchmark-fixture";

test("meets the 500-node interaction budget on the benchmark machine", async ({ page }) => {
	await page.addInitScript(() => {
		window.addEventListener("c4-canvas-intent", (event) => {
			const detail = (event as CustomEvent<{ type?: string }>).detail;
			if (detail?.type === "layout-complete") (window as Window & { __lastCanvasLayout?: number }).__lastCanvasLayout = performance.now();
		});
	});
	await benchmarkFixtureApi(page);
	const started = Date.now();
	await page.goto("/e2e/architecture-canvas.html");
	const canvas = page.locator("baize-c4-canvas");
	await expect(canvas.getByRole("button", { name: "Fit view" })).toBeEnabled();
	const initialInteractiveMs = Date.now() - started;
	expect(initialInteractiveMs).toBeLessThanOrEqual(1_500);

	await page.evaluate(() => { (window as Window & { __lastCanvasLayout?: number; __layoutStart?: number }).__layoutStart = performance.now(); });
	const filterLayout = page.evaluate(() => new Promise<number>((resolve) => {
		const timer = window.setInterval(() => {
			const state = window as Window & { __lastCanvasLayout?: number; __layoutStart?: number };
			if (state.__lastCanvasLayout && state.__layoutStart && state.__lastCanvasLayout >= state.__layoutStart) {
				window.clearInterval(timer);
				resolve(state.__lastCanvasLayout - state.__layoutStart);
			}
		}, 5);
	}));
	const filterStarted = Date.now();
	await page.getByLabel("Search architecture nodes").fill("Fixture node 42");
	await page.getByRole("button", { name: "筛选" }).click();
	await expect(page).toHaveURL(/c4Query=Fixture\+node\+42/);
	const filterSubmitMs = Date.now() - filterStarted;
	const topologyLayoutMs = await filterLayout;
	expect(filterSubmitMs).toBeLessThanOrEqual(250);
	expect(topologyLayoutMs).toBeLessThanOrEqual(1_000);

	const selectionStarted = Date.now();
	await canvas.locator('[data-node-id="context:fixture-42"]').click();
	await expect(canvas.getByRole("heading", { name: "Fixture node 42" })).toBeVisible();
	const selectionMs = Date.now() - selectionStarted;
	expect(selectionMs).toBeLessThanOrEqual(100);

	console.log(JSON.stringify({ initialInteractiveMs, filterSubmitMs, topologyLayoutMs, selectionMs, nodes: 500, edges: 499 }));
});
