#!/usr/bin/env node
/**
 * One-shot container integration test for the Gateway's generic Run and archive flow.
 * All writable data lives in container tmpfs and is removed before exit.
 */
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

if (process.env.BAIZE_CONTAINER_TEST !== "1") {
	throw new Error("smoke-gateway.mjs 只能在一次性容器测试环境中运行");
}

const APP_ROOT = process.cwd();
const PORT = 18899;
const BASE = `http://127.0.0.1:${PORT}`;
const root = mkdtempSync(join(tmpdir(), "baize-smoke-"));
const reposRoot = join(root, "repos");
const repoPath = join(reposRoot, "test-repo");
const evidenceDir = join(root, "evidence");

mkdirSync(reposRoot, { recursive: true });
cpSync(join(APP_ROOT, "fixtures", "test-repo"), repoPath, { recursive: true });
execFileSync("git", ["init", "--quiet"], { cwd: repoPath });
execFileSync("git", ["add", "."], { cwd: repoPath });
execFileSync(
	"git",
	[
		"-c",
		"user.name=BaiZe Container Test",
		"-c",
		"user.email=container-test@localhost",
		"commit",
		"--quiet",
		"-m",
		"fixture",
	],
	{ cwd: repoPath },
);

const require = createRequire(import.meta.url);
const Database = require(
	join(APP_ROOT, "agent-runtime/node_modules/better-sqlite3"),
);
const gatewayEnv = {
	...process.env,
	BAIZE_PROJECT_ROOT: APP_ROOT,
	BAIZE_REPOS_ROOT: reposRoot,
	BAIZE_DB_PATH: join(root, "baize.db"),
	BAIZE_EVIDENCE_DIR: evidenceDir,
	EVOLVER_HOME: join(root, "evolver-home"),
	BAIZE_EVOLVER: "0",
	BAIZE_PORT: String(PORT),
};

const tsx = join(APP_ROOT, "agent-runtime", "node_modules", ".bin", "tsx");
const gateway = spawn(tsx, ["agent-runtime/gateway.ts"], {
	cwd: APP_ROOT,
	env: gatewayEnv,
	stdio: ["ignore", "pipe", "pipe"],
	detached: true,
});
gateway.stdout.on("data", (data) => process.stdout.write(`[gateway] ${data}`));
gateway.stderr.on("data", (data) => process.stderr.write(`[gateway] ${data}`));

let failed = 0;
const check = (name, condition) => {
	process.stdout.write(`${condition ? "PASS" : "FAIL"}  ${name}\n`);
	if (!condition) failed++;
};

async function api(path, method = "GET", body) {
	const response = await fetch(BASE + path, {
		method,
		headers: { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return {
		status: response.status,
		body: await response.json().catch(() => null),
	};
}

async function stopGateway() {
	if (gateway.exitCode !== null) return;
	try {
		process.kill(-gateway.pid, "SIGTERM");
	} catch {
		gateway.kill("SIGTERM");
	}
	await Promise.race([
		once(gateway, "exit"),
		new Promise((resolve) => setTimeout(resolve, 3_000)),
	]);
	if (gateway.exitCode === null) {
		try {
			process.kill(-gateway.pid, "SIGKILL");
		} catch {
			gateway.kill("SIGKILL");
		}
	}
}

try {
	let ready = false;
	for (let i = 0; i < 40; i++) {
		try {
			// nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request -- local HTTP smoke server
			const response = await fetch(BASE + "/api/overview");
			if (response.ok) {
				ready = true;
				break;
			}
		} catch {
			// Gateway 仍在启动。
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	check("Gateway 在容器内部启动", ready);
	if (!ready) throw new Error("Gateway 启动超时");

	// nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request -- local HTTP smoke server
	const web = await fetch(BASE + "/");
	check(
		"Web SPA 从镜像内部提供",
		web.status === 200 &&
			web.headers.get("content-type")?.startsWith("text/html"),
	);

	const workspace = await api("/api/workspaces", "POST", {
		repoPath,
		name: "container-smoke",
	});
	const requirement = await api("/api/requirements", "POST", {
		workspaceId: workspace.body.id,
		title: "容器通用 Run 冒烟",
		description: "验证 SQLite 归档与通用 Agent Run",
	});
	const requirementId = requirement.body.id;
	check(
		"创建 Requirement",
		workspace.status === 200 && requirement.status === 200,
	);

	const overview = await api("/api/overview");
	check(
		"Overview 不再暴露旧产物计数",
		overview.status === 200 &&
			!Object.hasOwn(overview.body, "scenarios") &&
			!Object.hasOwn(overview.body, "use_cases") &&
			!Object.hasOwn(overview.body, "stage_progress"),
	);

	const invalidRole = await api(
		`/api/requirements/${requirementId}/runs`,
		"POST",
		{
			prompt: "invalid role should be rejected",
			role: "stage",
		},
	);
	check("通用 Run 拒绝旧 stage role", invalidRole.status === 400);

	const runResponse = await api(
		`/api/requirements/${requirementId}/runs`,
		"POST",
		{
			prompt: "Inspect the repository and summarize the requirement.",
			role: "orchestrator",
		},
	);
	const runId = runResponse.body?.runId;
	check("通用 Run 入队", runResponse.status === 202 && Number.isInteger(runId));

	let run = null;
	for (let i = 0; i < 120; i++) {
		const result = await api(`/api/runs/${runId}`);
		run = result.body;
		if (["completed", "failed", "cancelled"].includes(run?.status)) break;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	if (run && !["completed", "failed", "cancelled"].includes(run.status)) {
		await api(`/api/runs/${runId}/cancel`, "POST");
		const cancelled = await api(`/api/runs/${runId}`);
		run = cancelled.body;
	}
	check(
		"Run 到达终态",
		["completed", "failed", "cancelled"].includes(run?.status),
	);

	const archive = await api(
		`/api/requirements/${requirementId}/archive`,
		"POST",
	);
	check(
		"SQLite DesignPackage 归档",
		archive.status === 200 && Number.isInteger(archive.body?.packageId),
	);

	const designPackage = await api(
		`/api/requirements/${requirementId}/design-package`,
	);
	const snapshot = designPackage.body?.snapshot
		? JSON.parse(designPackage.body.snapshot)
		: null;
	check(
		"归档快照包含领域实体且不依赖 Markdown 文件",
		designPackage.status === 200 &&
			designPackage.body?.status === "approved" &&
			snapshot?.requirement?.id === requirementId &&
			Array.isArray(snapshot.artifacts) &&
			Array.isArray(snapshot.decisions) &&
			!existsSync(join(root, "out")),
	);

	const legacyStages = await api(`/api/requirements/${requirementId}/stages`);
	const legacyRun = await api(
		`/api/requirements/${requirementId}/stage/scenario/run`,
		"POST",
	);
	check(
		"旧 stages/run 路由已下线",
		legacyStages.status === 404 && legacyRun.status === 404,
	);

	const assets = await api("/api/assets?workspace=" + workspace.body.id);
	check(
		"资产端点从 Artifact 派生",
		assets.status === 200 &&
			Array.isArray(assets.body?.scenarios) &&
			Array.isArray(assets.body?.usecases) &&
			Array.isArray(assets.body?.functions),
	);

	const database = new Database(join(root, "baize.db"));
	const legacyTables = database
		.prepare(
			"select name from sqlite_master where type='table' and name in ('stage_progress','scenarios','use_cases','function_domains','function_items','requirement_scenarios','usecase_functions')",
		)
		.all();
	check("SQLite 不再创建旧产物表", legacyTables.length === 0);
	database.close();
} catch (error) {
	failed++;
	console.error(error);
} finally {
	await stopGateway();
	rmSync(root, { recursive: true, force: true });
	check("退出前清理容器临时数据", !existsSync(root));
}

process.stdout.write(
	failed === 0 ? "\n✓ 容器闭环测试全部通过\n" : `\n✗ ${failed} 项失败\n`,
);
process.exit(failed === 0 ? 0 : 1);
