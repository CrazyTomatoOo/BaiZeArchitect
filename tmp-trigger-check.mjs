import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openHeadlessWorkflowRuntime } from "./workflow/headless-runtime.ts";
import {
	createFixtureClock,
	createHashProvider,
	createFixtureOperator,
} from "./testing/deterministic-fixtures.ts";

const dir = mkdtempSync(path.join(tmpdir(), "baize-trigger-check-"));
const dbPath = path.join(dir, "test.sqlite");
const runtime = await openHeadlessWorkflowRuntime({
	databasePath: dbPath,
	clock: createFixtureClock("2026-08-22T00:00:00.000Z"),
	hashProvider: createHashProvider(),
	operators: [createFixtureOperator("reviewer")],
});
// runtime 无原生 db 句柄暴露；复制一份测试用 DB 后独立打开
const checkPath = path.join(dir, "check.sqlite");
const fs = await import("node:fs");
fs.copyFileSync(dbPath, checkPath);
const ro = new Database(checkPath, { readonly: true });
const triggers = ro
	.prepare("select name from sqlite_master where type='trigger' and tbl_name in ('tasks','runs') order by name")
	.all()
	.map((t) => t.name);
console.log("RESULT triggers on tasks/runs:", triggers.join(", ") || "(none)");
ro.close();
await runtime.close?.();