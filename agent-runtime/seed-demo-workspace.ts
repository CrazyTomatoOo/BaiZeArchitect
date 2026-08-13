/**
 * seed-demo-workspace.ts — one-shot workspace seeder for the demo container.
 *
 * Creates workspace 1 (repoPath=/tmp/baize/repos/test-repo, name=demo) if the
 * governance DB has no workspaces yet. Idempotent: safe to run on every
 * container restart. Exits immediately after seeding.
 */
import { createHashProvider } from "./testing/deterministic-fixtures.js";
import { openHeadlessWorkflowRuntime } from "./workflow/headless-runtime.js";

const runtime = await openHeadlessWorkflowRuntime({
	databasePath: process.env.BAIZE_DB_PATH!,
	hashProvider: createHashProvider(),
	clock: { now: () => new Date(), advance() {} },
	crashInjector: { reach() {} },
	outboxTransport: { deliver() {}, deliveries: () => [] },
});

if (!runtime.workspaceExists(1)) {
	runtime.createWorkspace({
		repoPath: "/tmp/baize/repos/test-repo",
		name: "demo",
	});
	console.log("[baize] seeded demo workspace 1");
} else {
	console.log("[baize] demo workspace 1 already exists");
}

process.exit(0);
