import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

function typeScriptFiles(directory: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (["node_modules", "dist", "testing"].includes(entry.name)) continue;
			files.push(...typeScriptFiles(absolute));
		} else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			files.push(absolute);
		}
	}
	return files;
}

test("production sources cannot import or select ScriptedModelDriver", () => {
	const offenders = typeScriptFiles(process.cwd())
		.filter((file) =>
			/ScriptedModelDriver|testing\/scripted-model-driver/.test(readFileSync(file, "utf8")),
		)
		.map((file) => path.relative(process.cwd(), file));
	assert.deepEqual(offenders, []);
});
