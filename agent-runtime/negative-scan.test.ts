import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Negative scan: proves that all old manual-orchestration routes, symbols,
 * UI components, tables, and compatibility surfaces are unreachable or
 * nonexistent in the production codebase.
 *
 * This test runs in CI alongside contract, unit, and compose-smoke gates.
 */

const ROOT = path.resolve(import.meta.dirname, "..");

function typeScriptFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (["node_modules", "dist", ".git", "lws"].includes(entry.name)) continue;
			files.push(...typeScriptFiles(absolute));
		} else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			files.push(absolute);
		}
	}
	return files;
}

const RUNTIME_FILES = typeScriptFiles(path.join(ROOT, "agent-runtime")).map((f) =>
	path.relative(ROOT, f),
);

const WEB_FILES = typeScriptFiles(path.join(ROOT, "web", "src")).map((f) =>
	path.relative(ROOT, f),
);

test("old runtime entry points do not exist", () => {
	const deleted = [
		"agent-runtime/gateway.ts",
		"agent-runtime/store.ts",
		"agent-runtime/agent.ts",
		"agent-runtime/evidence.ts",
		"agent-runtime/c4-projection.ts",
		"agent-runtime/distill-gene.ts",
		"agent-runtime/domain-tools.ts",
		"agent-runtime/evolver-client.ts",
		"agent-runtime/evidence-candidates.ts",
	];
	for (const file of deleted) {
		assert.equal(existsSync(path.join(ROOT, file)), false, `${file} should be deleted`);
	}
});

test("production main is the sole entry point", () => {
	assert.ok(existsSync(path.join(ROOT, "agent-runtime/main.ts")), "main.ts must exist");
	const mainSource = readFileSync(path.join(ROOT, "agent-runtime/main.ts"), "utf8");
	assert.match(mainSource, /startOperatorServer/, "main must start operator-server");
	assert.match(mainSource, /PiModelDriver/, "main must use PiModelDriver");
});

test("old HTTP routes are not registered", () => {
	const oldRoutePatterns = [
		/\/api\/requirements\/\$\{[^}]*\}\/runs/, // old Run create/list
		/\/api\/runs\/\$\{[^}]*\}\/(steer|cancel)/, // old steer/cancel
		/\/api\/runs\/stream/, // old global run stream
		/\/api\/requirements\/\$\{[^}]*\}\/archive/, // old direct archive
		/\/api\/overview/, // old overview
		/\/api\/decisions(\/|\?|$)/, // old decisions endpoint
		/\/api\/sedimentation/, // old sedimentation
		/\/api\/chat\/intake/, // old chat intake
		/\/api\/architecture\//, // old C4 architecture routes
		/\/api\/system\/(status|reindex)/, // old system routes
		/\/api\/genes/, // old genes
		/\/api\/config/, // old model config routes
	];
	const offenderFiles: string[] = [];
	for (const file of [...RUNTIME_FILES, ...WEB_FILES]) {
		if (file.includes("cutover/") || file.includes("cutover-")) continue;
		if (file.includes("negative-scan")) continue;
		const source = readFileSync(path.join(ROOT, file), "utf8");
		for (const pattern of oldRoutePatterns) {
			if (pattern.test(source)) {
				offenderFiles.push(`${file} (matched ${pattern})`);
			}
		}
	}
	assert.deepEqual(offenderFiles, [], `old routes found in: ${offenderFiles.join(", ")}`);
});

test("old symbols are unreachable", () => {
	const oldSymbols = [
		"RunInProgressError",
		"run_locks",
		"openStore",
		"runAgentTurn",
		"chatIntake",
		"openPersistentSession",
		"designPackageSnapshot",
	];
	const offenderFiles: string[] = [];
	for (const file of RUNTIME_FILES) {
		if (file.includes("legacy-schema")) continue; // cutover fixture builder references old schema
		if (file.includes("cutover-")) continue; // cutover tests/tools reference legacy concepts
		if (file.includes("negative-scan")) continue; // this test itself
		const source = readFileSync(path.join(ROOT, file), "utf8");
		for (const symbol of oldSymbols) {
			if (source.includes(symbol)) {
				offenderFiles.push(`${file} (contains ${symbol})`);
			}
		}
	}
	assert.deepEqual(offenderFiles, [], `old symbols found in: ${offenderFiles.join(", ")}`);
});

test("old web components are deleted", () => {
	const deleted = [
		"web/src/baize-run-rail.ts",
		"web/src/baize-decisions.ts",
		"web/src/baize-chat-intake.ts",
		"web/src/baize-architecture-browser.ts",
		"web/src/baize-c4-canvas.ts",
		"web/src/baize-asset-library.ts",
		"web/src/baize-overview.ts",
		"web/src/baize-requirement.ts",
		"web/src/baize-system.ts",
		"web/src/baize-workspaces.ts",
		"web/src/baize-command-palette.ts",
		"web/src/baize-markdown.ts",
		"web/src/c4-canvas-model.ts",
	];
	for (const file of deleted) {
		assert.equal(existsSync(path.join(ROOT, file)), false, `${file} should be deleted`);
	}
});

test("production web entry imports only baize-shell", () => {
	const mainSource = readFileSync(path.join(ROOT, "web/src/main.ts"), "utf8");
	assert.match(mainSource, /baize-shell\.ts/);
	assert.doesNotMatch(mainSource, /baize-workflow\.ts/);
	assert.doesNotMatch(mainSource, /baize-overview\.ts/);
	assert.doesNotMatch(mainSource, /baize-requirement\.ts/);
	assert.doesNotMatch(mainSource, /baize-run-rail\.ts/);
	assert.doesNotMatch(mainSource, /baize-decisions\.ts/);
	assert.doesNotMatch(mainSource, /baize-chat-intake\.ts/);
});

test("Reviewer role does not exist in production code", () => {
	const offenderFiles: string[] = [];
	for (const file of [...RUNTIME_FILES, ...WEB_FILES]) {
		if (file.includes(".test.")) continue;
		if (file.includes("negative-scan")) continue;
		if (file.includes("legacy-schema") || file.includes("cutover-")) continue;
		const source = readFileSync(path.join(ROOT, file), "utf8");
		// Match "reviewer" as a role string, not as a generic word in comments
		if (/["']reviewer["']|AgentRole.*reviewer|role.*=.*reviewer/i.test(source)) {
			offenderFiles.push(file);
		}
	}
	assert.deepEqual(offenderFiles, [], `reviewer role found in: ${offenderFiles.join(", ")}`);
});

test("no compatibility adapters or runtime feature flags", () => {
	const offenderFiles: string[] = [];
	const patterns = [
		/feature[_-]?flag/i,
		/compatibility\s+adapter/i,
		/dual[_-]?write/i,
		/shadow[_-]?write/i,
		/legacy[_-]?fallback/i,
		/tombstone\s+adapter/i,
	];
	for (const file of [...RUNTIME_FILES, ...WEB_FILES]) {
		if (file.includes(".test.")) continue;
		if (file.includes("negative-scan")) continue;
		if (file.includes("cutover/") || file.includes("cutover-")) continue;
		const source = readFileSync(path.join(ROOT, file), "utf8");
		for (const pattern of patterns) {
			if (pattern.test(source)) {
				offenderFiles.push(`${file} (matched ${pattern})`);
			}
		}
	}
	assert.deepEqual(offenderFiles, [], `compatibility surfaces found: ${offenderFiles.join(", ")}`);
});

test("no old Store table creation in production code", () => {
	const oldTables = ["run_locks", "stage_progress", "scenarios", "use_cases"];
	const offenderFiles: string[] = [];
	for (const file of RUNTIME_FILES) {
		if (file.includes("legacy-schema") || file.includes("cutover-")) continue;
		if (file.includes(".test.")) continue;
		if (file.includes("negative-scan")) continue;
		const source = readFileSync(path.join(ROOT, file), "utf8");
		for (const table of oldTables) {
			if (source.includes(`create table`) && source.includes(table)) {
				offenderFiles.push(`${file} (creates ${table})`);
			}
		}
	}
	assert.deepEqual(offenderFiles, [], `old tables created in: ${offenderFiles.join(", ")}`);
});
