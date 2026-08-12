import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ModelUsage } from "../workflow/model-driver.js";

export interface FixtureClock {
	now(): Date;
}

export function createFixtureClock(
	start: string,
	stepMilliseconds = 0,
): FixtureClock {
	const startMilliseconds = new Date(start).getTime();
	if (!Number.isFinite(startMilliseconds)) throw new Error(`invalid fixture time: ${start}`);
	let tick = 0;
	return {
		now() {
			const value = new Date(startMilliseconds + tick * stepMilliseconds);
			tick += 1;
			return value;
		},
	};
}

export interface FixtureIdGenerator {
	next(scope: string): string;
}

export function createFixtureIdGenerator(seed: string): FixtureIdGenerator {
	let sequence = 0;
	return {
		next(scope) {
			sequence += 1;
			const digest = createHash("sha256")
				.update(`${seed}\0${scope}\0${sequence}`)
				.digest("hex")
				.slice(0, 20);
			return `${scope}_${digest}`;
		},
	};
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value === "boolean" || typeof value === "string") {
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("fixture digest accepts JSON values only");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		for (let index = 0; index < value.length; index += 1) {
			if (!Object.hasOwn(value, index)) {
				throw new Error("fixture digest accepts JSON values only");
			}
		}
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	}
	if (typeof value === "object") {
		if (Object.getPrototypeOf(value) !== Object.prototype) {
			throw new Error("fixture digest accepts JSON values only");
		}
		const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => {
			if (left < right) return -1;
			if (left > right) return 1;
			return 0;
		});
		return `{${entries
			.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
			.join(",")}}`;
	}
	throw new Error("fixture digest accepts JSON values only");
}

export interface HashProvider {
	digest(value: unknown): string;
}

export function createHashProvider(): HashProvider {
	return {
		digest(value) {
			return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
		},
	};
}

export interface FixtureOperator {
	actorRef: string;
	capabilities: readonly ["workflow:approve", "workflow:operate"];
}

export function createFixtureOperator(name: string): FixtureOperator {
	return {
		actorRef: `operator:${name}`,
		capabilities: ["workflow:approve", "workflow:operate"],
	};
}

export interface ModelUsageRecorder {
	record(usage: ModelUsage): void;
	snapshot(): ModelUsage;
}

export function createModelUsageRecorder(): ModelUsageRecorder {
	let inputTokens = 0;
	let outputTokens = 0;
	return {
		record(usage) {
			inputTokens += usage.inputTokens;
			outputTokens += usage.outputTokens;
		},
		snapshot() {
			return { inputTokens, outputTokens };
		},
	};
}

export interface OutboxDelivery {
	id: string;
	type: string;
	payload: unknown;
}

export interface FixtureOutboxTransport {
	deliver(delivery: OutboxDelivery): Promise<void>;
	deliveries(): readonly OutboxDelivery[];
}

export function createOutboxTransport(): FixtureOutboxTransport {
	const delivered: OutboxDelivery[] = [];
	return {
		async deliver(delivery) {
			delivered.push(structuredClone(delivery));
		},
		deliveries() {
			return structuredClone(delivered);
		},
	};
}

export interface RepositorySnapshotFile {
	path: string;
	digest: string;
	size: number;
}

export interface RepositorySnapshotFixture {
	digest: string;
	files: readonly RepositorySnapshotFile[];
}

async function collectFiles(
	root: string,
	directory: string,
	files: RepositorySnapshotFile[],
): Promise<void> {
	const entries = await readdir(directory, { withFileTypes: true });
	entries.sort((left, right) => left.name.localeCompare(right.name));
	for (const entry of entries) {
		if (entry.name === ".git") continue;
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			await collectFiles(root, absolute, files);
			continue;
		}
		if (!entry.isFile()) continue;
		const content = await readFile(absolute);
		files.push({
			path: path.relative(root, absolute).split(path.sep).join("/"),
			digest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
			size: content.byteLength,
		});
	}
}

export async function createRepositorySnapshotFixture(
	repositoryPath: string,
	hashProvider: HashProvider,
): Promise<RepositorySnapshotFixture> {
	const files: RepositorySnapshotFile[] = [];
	await collectFiles(repositoryPath, repositoryPath, files);
	return { digest: hashProvider.digest(files), files };
}

export interface CrashInjector {
	reach(point: string): void;
}

export function createCrashInjector(points: readonly string[] = []): CrashInjector {
	const pending = new Set(points);
	return {
		reach(point) {
			if (!pending.delete(point)) return;
			throw new Error(`crash point reached: ${point}`);
		},
	};
}
