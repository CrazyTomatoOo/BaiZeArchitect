import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Artifact View 标签覆盖 contract 测试（ADR-008）。
 * 断言 artifact-content-v1.schema.json 的全部 property key 在
 * web/src/artifact-labels.ts 的 FIELD_TITLES 中有中文映射;
 * schema 新增字段时若漏补映射,本测试即失败。
 */

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(moduleDirectory, "contracts/artifact-content-v1.schema.json");
const labelsPath = path.resolve(moduleDirectory, "../web/src/artifact-labels.ts");

/** 递归收集 JSON Schema 中所有 "properties" 下的 key 名。 */
function collectPropertyKeys(node: unknown, acc = new Set<string>()): Set<string> {
	if (typeof node !== "object" || node === null) return acc;
	const record = node as Record<string, unknown>;
	if (record.properties && typeof record.properties === "object") {
		for (const key of Object.keys(record.properties as Record<string, unknown>)) {
			acc.add(key);
		}
		for (const child of Object.values(record.properties as Record<string, unknown>)) {
			collectPropertyKeys(child, acc);
		}
	}
	// allOf / oneOf / anyOf / $defs 递归
	for (const combiner of ["allOf", "oneOf", "anyOf"] as const) {
		if (Array.isArray(record[combiner])) {
			for (const child of record[combiner] as unknown[]) collectPropertyKeys(child, acc);
		}
	}
	if (record.$defs && typeof record.$defs === "object") {
		for (const child of Object.values(record.$defs as Record<string, unknown>)) {
			collectPropertyKeys(child, acc);
		}
	}
	// items（数组元素 schema）
	if (record.items && typeof record.items === "object") {
		collectPropertyKeys(record.items, acc);
	}
	return acc;
}

/** 从 artifact-labels.ts 源码文本提取 FIELD_TITLES 对象的 key 名。 */
function extractFieldTitlesKeys(source: string): Set<string> {
	const match = /export const FIELD_TITLES[^{]*\{([\s\S]*?)\n\};/.exec(source);
	assert.ok(match, "FIELD_TITLES not found in artifact-labels.ts source");
	const body = match[1];
	const keys = new Set<string>();
	for (const line of body.split("\n")) {
		// 匹配 "key: value," 形式（key 是合法 JS 标识符或引号字符串）
		const keyMatch = /^\s*(?:[A-Za-z_$][\w$]*|"[^"]+")\s*:/.exec(line);
		if (keyMatch) {
			const raw = line.trim().split(":")[0].trim().replace(/^"|"$/g, "");
			if (raw && !raw.startsWith("//")) keys.add(raw);
		}
	}
	return keys;
}

test("FIELD_TITLES 覆盖 artifact-content-v1.schema.json 的全部 property key", async () => {
	const schemaRaw = await readFile(schemaPath, "utf8");
	const schema = JSON.parse(schemaRaw);
	const schemaKeys = collectPropertyKeys(schema);

	const labelsRaw = await readFile(labelsPath, "utf8");
	const fieldTitleKeys = extractFieldTitlesKeys(labelsRaw);

	const missing = [...schemaKeys].filter((key) => !fieldTitleKeys.has(key));
	assert.deepEqual(
		missing.sort(),
		[],
		`schema property key 未在 FIELD_TITLES 中映射(补映射到 web/src/artifact-labels.ts): ${missing.join(", ")}`,
	);
});

test("FIELD_TITLES 不含 schema 之外的死映射 key", async () => {
	const schemaRaw = await readFile(schemaPath, "utf8");
	const schema = JSON.parse(schemaRaw);
	const schemaKeys = collectPropertyKeys(schema);

	const labelsRaw = await readFile(labelsPath, "utf8");
	const fieldTitleKeys = extractFieldTitlesKeys(labelsRaw);

	const dead = [...fieldTitleKeys].filter((key) => !schemaKeys.has(key));
	assert.deepEqual(
		dead.sort(),
		[],
		`FIELD_TITLES 含 schema 中不存在的 key(删除死映射): ${dead.join(", ")}`,
	);
});
