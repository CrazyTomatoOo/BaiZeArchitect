import type { Page } from "@playwright/test";

/**
 * 可控的 MockEventSource:替代浏览器 EventSource,实例记录在 window.__esInstances。
 * - 构造后异步触发 onopen(视为已连接)
 * - 测试用 fail() 模拟断线、reopen() 模拟重连、emit("workflow-event") 推送事件
 */
export async function installMockEventSource(page: Page): Promise<void> {
	await page.addInitScript(() => {
		class MockEventSource {
			static instances: MockEventSource[] = [];
			url: string;
			onopen: (() => void) | null = null;
			onerror: ((event: unknown) => void) | null = null;
			onmessage: ((event: { data: string }) => void) | null = null;
			closed = false;
			private listeners = new Map<string, ((event: { data: string }) => void)[]>();

			constructor(url: string) {
				this.url = url;
				MockEventSource.instances.push(this);
				(window as unknown as { __esInstances: MockEventSource[] }).__esInstances = MockEventSource.instances;
				setTimeout(() => {
					if (!this.closed) this.onopen?.();
				}, 0);
			}

			addEventListener(type: string, fn: (event: { data: string }) => void): void {
				const list = this.listeners.get(type) ?? [];
				list.push(fn);
				this.listeners.set(type, list);
			}

			removeEventListener(): void {
				/* no-op */
			}

			emit(type: string, data = "{}"): void {
				for (const fn of this.listeners.get(type) ?? []) fn({ data });
			}

			fail(): void {
				this.onerror?.({});
			}

			reopen(): void {
				this.onopen?.();
			}

			close(): void {
				this.closed = true;
			}
		}
		(window as unknown as { EventSource: unknown }).EventSource = MockEventSource;
	});
}

/** 让所有已建立的 SSE 实例断线。 */
export async function failAllStreams(page: Page): Promise<void> {
	await page.evaluate(() => {
		for (const instance of (window as unknown as { __esInstances: { fail(): void }[] }).__esInstances) instance.fail();
	});
}

/** 让所有 SSE 实例重连(onopen → 组件刷新 Projection)。 */
export async function reopenAllStreams(page: Page): Promise<void> {
	await page.evaluate(() => {
		for (const instance of (window as unknown as { __esInstances: { reopen(): void }[] }).__esInstances) instance.reopen();
	});
}

/** 在 Workflow 流上推送一条事件(触发组件刷新 Projection)。 */
export async function emitWorkflowEvent(page: Page): Promise<void> {
	await page.evaluate(() => {
		const instances = (window as unknown as { __esInstances: { url: string; emit(type: string): void }[] }).__esInstances;
		for (const instance of instances) {
			if (instance.url.includes("/api/workflows/")) instance.emit("workflow-event");
		}
	});
}
