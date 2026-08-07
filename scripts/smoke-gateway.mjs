#!/usr/bin/env node
/**
 * 一次性容器集成测试：固定仓库、Gateway、GitNexus、阶段门禁与归档。
 * 所有可写数据都位于容器 tmpfs，退出前主动清理。
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
const outDir = join(root, "out");

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
	BAIZE_OUT_DIR: outDir,
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

	const web = await fetch(BASE + "/");
	check(
		"Web SPA 从镜像内部提供",
		web.status === 200 &&
			web.headers.get("content-type")?.startsWith("text/html"),
	);

	const system = await api("/api/system/status");
	check(
		"GitNexus 随镜像提供",
		system.status === 200 && system.body?.gitnexus?.available === true,
	);

	const generate = await api("/api/evidence/generate", "POST", {
		repoPath,
		repoId: "test-repo",
	});
	check("内置仓库开始生成证据", generate.status === 202);

	let evidence = null;
	for (let i = 0; i < 240; i++) {
		const result = await api("/api/evidence/test-repo");
		if (result.body?.repositoryId === "test-repo") {
			evidence = result.body;
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	check(
		"GitNexus 证据仅写入容器 tmpfs",
		evidence?.generatedBy === "gitnexus" &&
			existsSync(join(evidenceDir, "test-repo.json")) &&
			evidence.repoPath === repoPath,
	);

	const workspace = await api("/api/workspaces", "POST", {
		repoPath,
		name: "container-smoke",
	});
	const requirement = await api("/api/requirements", "POST", {
		workspaceId: workspace.body.id,
		title: "容器闭环冒烟",
		description: "验证测试数据不会离开容器",
	});
	const requirementId = requirement.body.id;

	const stagesResponse = await api(`/api/requirements/${requirementId}/stages`);
	const stages = stagesResponse.body;
	check(
		"新需求初始化七个阶段",
		stages.length === 7 &&
			stages.find((stage) => stage.stage === "录入").status === "完成" &&
			stages.find((stage) => stage.stage === "归档").status === "未开始",
	);

	const gated = await api(
		`/api/requirements/${requirementId}/stage/scenario/run`,
		"POST",
	);
	check("分析未完成时阻止场景阶段", gated.status === 409);

	const database = new Database(join(root, "baize.db"));
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
		database
			.prepare(
				"update stage_progress set status='完成', artifact_refs=? where requirement_id=? and stage=?",
			)
			.run(refs, requirementId, stage);
	}
	database.close();

	const archive = await api(
		`/api/requirements/${requirementId}/stage/archive/run`,
		"POST",
	);
	const archiveFile = archive.body?.refs?.[0]?.file ?? "";
	check(
		"归档只生成在容器 tmpfs",
		archive.status === 200 &&
			existsSync(archiveFile) &&
			archiveFile.startsWith(root),
	);

	const again = await api(
		`/api/requirements/${requirementId}/stage/archive/run`,
		"POST",
	);
	check("重复归档被拒绝", again.status === 409);
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
