/**
 * distill-gene.ts — 从 Design Package 蒸馏可复用 Gene 到本地 store(#9c gene 流入)。
 *
 * 宿主跑(EVOLVER_HOME=<repo>/evolver-home,与容器挂载的 /evolver-home 同 store)。
 * spawn evolver-mcp(local-only)→ evolver_distill_conversation → gene 落
 * ./evolver-home/assets → 下次容器 evolver_recall 命中。
 *
 * usage: npx tsx distill-gene.ts <design-package.md>
 */
import { readFileSync } from "node:fs";
import { EvolverMcpClient } from "./evolver-client.js";

const pkgPath = process.argv[2];
if (!pkgPath) {
	console.error("usage: distill-gene.ts <design-package.md>");
	process.exit(1);
}
const md = readFileSync(pkgPath, "utf8");

// 解析 design-package(planToMarkdown 格式)→ distill 字段
const title = (md.match(/^# (.+)$/m) || [, "Untitled design"])[1].trim();
const artifacts = [...md.matchAll(/^- `([^`]+)` L(\d+)-(\d+) \(([^)]+)\)/gm)]
	.map((m) => `${m[1]}:${m[2]}-${m[3]} (${m[4]})`)
	.slice(0, 8);
const validation = [...md.matchAll(/^- \[(\w+)\/(\w+)\] (.+?) → (.+)$/gm)]
	.map((m) => `[${m[1]}/${m[2]}] ${m[3].slice(0, 140)}`)
	.slice(0, 6);
const compLine = md.match(/^- 组件: (.+)$/m);
const strategy = compLine ? compLine[1].split(/,\s*/).slice(0, 6) : [];
const ctxMatch = md.match(/## 上下文\n([\s\S]*?)(\n##|\n$)/);
const ctx = ctxMatch ? ctxMatch[1].trim().slice(0, 600) : title;

if (artifacts.length < 2) {
	console.error("[distill] 弱信号: evidence < 2,quality gate 大概率拒,跳过");
	process.exit(0);
}

const input = {
	title,
	summary: `${title}\n${ctx}`,
	platform: "baize",
	strategy,
	artifacts,
	validation,
	signals: ["design", "architecture", "baize"],
	persist: true,
	publish: false,
	min_score: 5,
};

const c = new EvolverMcpClient();
await c.start();
try {
	const res = (await c.call("evolver_distill_conversation", input)) as
		| {
				content?: Array<{ text?: string }>;
		  }
		| undefined;
	const text = res?.content?.[0]?.text ?? JSON.stringify(res).slice(0, 500);
	console.log(`[distill] ${title.slice(0, 60)}`);
	console.log(`[distill] result: ${text.slice(0, 400)}`);
} catch (e) {
	console.error(`[distill] failed: ${e instanceof Error ? e.message : e}`);
	c.dispose();
	process.exit(1);
}
c.dispose();
process.exit(0);
