import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	createCrashInjector,
	createFixtureClock,
	createFixtureIdGenerator,
	createFixtureOperator,
	createHashProvider,
	createModelUsageRecorder,
	createOutboxTransport,
	createRepositorySnapshotFixture,
} from "./deterministic-fixtures.ts";

test("fixed test dependencies are deterministic and injectable", async () => {
	const firstClock = createFixtureClock("2026-08-12T00:00:00.000Z", 1_000);
	const secondClock = createFixtureClock("2026-08-12T00:00:00.000Z", 1_000);
	assert.deepEqual(
		[firstClock.now().toISOString(), firstClock.now().toISOString()],
		[secondClock.now().toISOString(), secondClock.now().toISOString()],
	);

	const firstIds = createFixtureIdGenerator("workflow-seed");
	const secondIds = createFixtureIdGenerator("workflow-seed");
	assert.deepEqual(
		[firstIds.next("workflow"), firstIds.next("task")],
		[secondIds.next("workflow"), secondIds.next("task")],
	);

	const hash = createHashProvider();
	assert.equal(
		hash.digest({ beta: 2, alpha: 1 }),
		hash.digest({ alpha: 1, beta: 2 }),
	);
	assert.equal(hash.canonicalize({ beta: 2, alpha: 1 }), '{"alpha":1,"beta":2}');
	assert.match(hash.digest({ alpha: 1 }), /^sha256:[a-f0-9]{64}$/);
	for (const nonJson of [
		new Date("2026-08-12T00:00:00.000Z"),
		new Map(),
		Number.NaN,
		Array(1),
	]) {
		assert.throws(() => hash.digest(nonJson), /fixture digest accepts JSON values only/);
	}
	assert.notEqual(hash.digest([null]), hash.digest([]));
	assert.deepEqual(createFixtureOperator("local-approver"), {
		actorRef: "operator:local-approver",
		capabilities: ["workflow:approve", "workflow:operate"],
	});

	const usage = createModelUsageRecorder();
	usage.record({ inputTokens: 11, outputTokens: 4 });
	usage.record({ inputTokens: 3, outputTokens: 2 });
	assert.deepEqual(usage.snapshot(), {
		inputTokens: 14,
		outputTokens: 6,
	});

	const outbox = createOutboxTransport();
	await outbox.deliver({ id: "job-1", type: "dispatch", payload: { runId: 7 } });
	assert.deepEqual(outbox.deliveries(), [
		{ id: "job-1", type: "dispatch", payload: { runId: 7 } },
	]);
});

test("repository snapshots are byte-stable and crash points fail exactly once", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-repository-snapshot-"));
	try {
		await mkdir(path.join(directory, "src"));
		await writeFile(path.join(directory, "src", "b.ts"), "export const b = 2;\n");
		await writeFile(path.join(directory, "a.txt"), "alpha\n");
		const hash = createHashProvider();
		const first = await createRepositorySnapshotFixture(directory, hash);
		const second = await createRepositorySnapshotFixture(directory, hash);
		assert.deepEqual(first, second);
		assert.deepEqual(first.files.map((file) => file.path), ["a.txt", "src/b.ts"]);

		const crashes = createCrashInjector(["after-model-result"]);
		assert.throws(
			() => crashes.reach("after-model-result"),
			/crash point reached: after-model-result/,
		);
		assert.doesNotThrow(() => crashes.reach("after-model-result"));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
