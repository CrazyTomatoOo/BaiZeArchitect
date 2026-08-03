#!/usr/bin/env node
/**
 * smoke-gateway — 旅程状态机冒烟:门禁/打回校验/归档(不跑 LLM)。
 * 用法:node scripts/smoke-gateway.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require(
	join(process.cwd(), "agent-runtime/node_modules/better-sqlite3"),
);

const PORT = 18899;
const BASE = `http://127.0.0.1:${PORT}`;
const root = mkdtempSync(join(tmpdir(), "baize-smoke-"));

const gw = spawn("npx", ["tsx", "agent-runtime/gateway.ts"], {
	env: { ...process.env, BAIZE_PROJECT_ROOT: root, BAIZE_PORT: String(PORT) },
	stdio: ["ignore", "pipe", "pipe"],
});
gw.stderr.on("data", (d) => process.stderr.write(`[gw] ${d}`));

let failed = 0;
const check = (name, cond) => {
	console.log(`${cond ? "PASS" : "FAIL"}  ${name}`);
	if (!cond) failed++;
};

async function api(path, method = "GET", body) {
	const r = await fetch(BASE + path, {
		method,
		headers: { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return { status: r.status, body: await r.json().catch(() => ({})) };
}

// 等 gateway 起来
for (let i = 0; i < 40; i++) {
	try {
		await fetch(BASE + "/api/overview");
		break;
	} catch {
		await new Promise((r) => setTimeout(r, 500));
	}
}

try {
	const ws = await api("/api/workspaces", "POST", {
		repoPath: "/tmp/repo-x",
		name: "smoke",
	});
	const req = await api("/api/requirements", "POST", {
		workspaceId: ws.body.id,
		title: "冒烟需求",
		description: "测试旅程",
	});
	const rid = req.body.id;

	const stages = (await api(`/api/requirements/${rid}/stages`)).body;
	check(
		"新需求初始化 7 个阶段(录入完成 + 6 未开始)",
		stages.length === 7 &&
			stages.find((s) => s.stage === "录入").status === "完成" &&
			stages.find((s) => s.stage === "归档").status === "未开始" &&
			stages.find((s) => s.stage === "功能设计").status === "未开始",
	);

	const g = await api(`/api/requirements/${rid}/stage/scenario/run`, "POST");
	check("门禁:分析未完成不能 run 场景(409)", g.status === 409);

	const a = await api(
		`/api/requirements/${rid}/stage/analysis/approve`,
		"POST",
	);
	check("非待审不能 approve(409)", a.status === 409);

	const rj = await api(
		`/api/requirements/${rid}/stage/analysis/reject`,
		"POST",
		{
			feedback: "x",
		},
	);
	check("非待审不能 reject(409)", rj.status === 409);

	// 模拟全部 LLM 阶段已通过,验证归档
	const db = new Database(join(root, ".baize", "baize.db"));
	const seed = [
		["分析", '[{"type":"analysis","content":{"scope":["冒烟"]}}]'],
		["场景", '[{"type":"scenario","id":1,"title":"s1","description":"d1"}]'],
		["用例", '[{"type":"usecase","id":1,"title":"u1","mainFlow":"m"}]'],
		[
			"功能分解",
			'[{"type":"domain","id":1,"name":"域A","items":[{"id":1,"title":"项1"}]}]',
		],
		[
			"功能设计",
			'[{"type":"design","content":{"designs":[{"functionItem":"项1","flow":"f"}]}}]',
		],
	];
	for (const [stage, refs] of seed) {
		db.prepare(
			"update stage_progress set status='完成', artifact_refs=? where requirement_id=? and stage=?",
		).run(refs, rid, stage);
	}
	db.close();

	const early = await api(
		`/api/requirements/${rid}/stage/analysis/run`,
		"POST",
	);
	check("已完成阶段不能重跑(409)", early.status === 409);

	const arch = await api(`/api/requirements/${rid}/stage/archive/run`, "POST");
	check("归档成功(200)", arch.status === 200);
	const archFile = arch.body.refs?.[0]?.file ?? "";
	check("归档文件已写入", existsSync(archFile));
	check("归档文件名含 design-archive", archFile.includes("design-archive"));

	const list = (await api(`/api/requirements?workspace=${ws.body.id}`)).body;
	check("需求列表标记已完成", list[0].done === true && list[0].current === "");

	const again = await api(`/api/requirements/${rid}/stage/archive/run`, "POST");
	check("重复归档被拒(409)", again.status === 409);
} finally {
	gw.kill();
}

console.log(failed === 0 ? "\n✓ smoke 全部通过" : `\n✗ ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
