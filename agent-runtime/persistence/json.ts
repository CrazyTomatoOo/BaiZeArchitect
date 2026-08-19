/**
 * json.ts — Store 子域与治理存储共用的持久化 JSON 解析。
 *
 * 单点封装使 corruption 错误语义一致；被 workflow-store 与 asset-store 共用，
 * 独立成文件避免两模块互相 import 产生环。
 */
export function parseJson<T>(value: string): T {
	try {
		return JSON.parse(value) as T;
	} catch (error) {
		throw new Error("Persisted Workflow JSON is invalid", { cause: error });
	}
}