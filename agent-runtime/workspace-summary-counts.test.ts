import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createCrashInjector,
	createFixtureClock,
	createHashProvider,
	createOutboxTransport,
} from "./testing/deterministic-fixtures.ts";
import {
	openHeadlessWorkflowRuntime,
	type HeadlessWorkflowRuntime,
} from "./workflow/headless-runtime.ts";
import type { RequirementBaseline } from "./workflow/requirement.ts";

const TIMESTAMP = "2026-08-30T10:00:00.000Z";

const BASELINE: RequirementBaseline = {
	schemaVersion: "artifact/requirement/v1",
	artifactKind: "requirement",
	summary: "Workspace summary count fixture",
	sourceRefs: [],
	title: "Workspace summary count fixture",
	description: "Populated for listWorkspaces count aggregation verification.",
};

interface CountContext {
	runtime: HeadlessWorkflowRuntime;
}

async function withCountRuntime(run: (context: CountContext) => Promise<void>): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), "workspace-count-"));
	const databasePath = join(directory, "test.db");
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath,
		clock: createFixtureClock(TIMESTAMP),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector(),
		outboxTransport: createOutboxTransport(),
	});
	try {
		await run({ runtime });
	} finally {
		runtime.close();
		rmSync(directory, { recursive: true, force: true });
	}
}

test("listWorkspaces returns requirementCount and assetCount per workspace", async () => {
	await withCountRuntime(async ({ runtime }) => {
		const wsA = runtime.createWorkspace({ repoPath: "/repo/a", name: "Alpha" });
		const wsB = runtime.createWorkspace({ repoPath: "/repo/b", name: "Beta" });

		// Alpha: 2 requirements + 3 assets
		runtime.createRequirement({ workspaceId: wsA, baseline: { ...BASELINE, title: "A1" } });
		runtime.createRequirement({ workspaceId: wsA, baseline: { ...BASELINE, title: "A2" } });
		runtime.createReusableAsset({ workspaceId: wsA, kind: "scenario", title: "场景一", content: { nodeId: "s1", title: "场景一" } });
		runtime.createReusableAsset({ workspaceId: wsA, kind: "scenario", title: "场景二", content: { nodeId: "s2", title: "场景二" } });
		runtime.createReusableAsset({ workspaceId: wsA, kind: "stakeholder", title: "客户", content: { name: "客户", description: "购买者" } });

		// Beta: 0 requirements + 1 asset
		runtime.createReusableAsset({ workspaceId: wsB, kind: "scenario", title: "B场景", content: { nodeId: "s1", title: "B场景" } });

		const workspaces = runtime.listWorkspaces();
		assert.equal(workspaces.length, 2, "two workspaces");

		const alpha = workspaces.find((w) => w.id === wsA);
		const beta = workspaces.find((w) => w.id === wsB);

		assert.ok(alpha, "Alpha workspace found");
		assert.equal(alpha!.requirementCount, 2, "Alpha has 2 requirements");
		assert.equal(alpha!.assetCount, 3, "Alpha has 3 reusable assets");

		assert.ok(beta, "Beta workspace found");
		assert.equal(beta!.requirementCount, 0, "Beta has 0 requirements");
		assert.equal(beta!.assetCount, 1, "Beta has 1 reusable asset");
	});
});

test("listWorkspaces returns 0 counts for empty workspace", async () => {
	await withCountRuntime(async ({ runtime }) => {
		const ws = runtime.createWorkspace({ repoPath: "/empty", name: "Empty" });
		const workspaces = runtime.listWorkspaces();
		const empty = workspaces.find((w) => w.id === ws);
		assert.ok(empty, "workspace found");
		assert.equal(empty!.requirementCount, 0, "no requirements");
		assert.equal(empty!.assetCount, 0, "no assets");
	});
});

test("listWorkspaces counts update after adding requirements and assets", async () => {
	await withCountRuntime(async ({ runtime }) => {
		const ws = runtime.createWorkspace({ repoPath: "/grow", name: "Grow" });

		const before = runtime.listWorkspaces().find((w) => w.id === ws);
		assert.equal(before!.requirementCount, 0);
		assert.equal(before!.assetCount, 0);

		runtime.createRequirement({ workspaceId: ws, baseline: { ...BASELINE, title: "G1" } });
		runtime.createReusableAsset({ workspaceId: ws, kind: "scenario", title: "G场景", content: { nodeId: "s1", title: "G场景" } });

		const after = runtime.listWorkspaces().find((w) => w.id === ws);
		assert.equal(after!.requirementCount, 1, "count reflects new requirement");
		assert.equal(after!.assetCount, 1, "count reflects new asset");
	});
});

test("listWorkspaces counts do not leak across workspaces", async () => {
	await withCountRuntime(async ({ runtime }) => {
		const wsA = runtime.createWorkspace({ repoPath: "/iso-a", name: "IsoA" });
		const wsB = runtime.createWorkspace({ repoPath: "/iso-b", name: "IsoB" });

		runtime.createRequirement({ workspaceId: wsA, baseline: { ...BASELINE, title: "IA" } });
		runtime.createReusableAsset({ workspaceId: wsA, kind: "stakeholder", title: "用户", content: { name: "用户", description: "描述" } });

		const b = runtime.listWorkspaces().find((w) => w.id === wsB);
		assert.equal(b!.requirementCount, 0, "B has no requirements despite A having one");
		assert.equal(b!.assetCount, 0, "B has no assets despite A having one");
	});
});
