#!/usr/bin/env node
// fixture 严格校验：拿 `test/fixtures/chain-sample` 当「被校验的仓库」，跑 `validate --strict`。
//
// 规格 #147 的 Testing Decisions 要求「`validate --strict` 进 pre-commit / CI」，而本仓库是
// 工具、自己没有 `baize/` 数据——所以需要一个 fixture 当靶子。跑的是**构建出来的**
// `dist/bin/baize.js`（`npm run check` 里 build 在前），验的是「真命令 + 真数据」这条路径。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "dist/bin/baize.js");
const fixture = path.join(root, "test/fixtures/chain-sample");

if (!existsSync(cli)) {
  console.error(`✗ 找不到 ${cli}——先 npm run build`);
  process.exit(1);
}

const run = (args) =>
  execFileSync("node", [cli, ...args], { cwd: fixture, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const fail = (message, detail) => {
  console.error(`✗ fixture 严格校验未过：${message}`);
  if (detail) console.error(detail.trim().split("\n").slice(0, 20).join("\n"));
  process.exit(1);
};

// 1. 严格模式必须零问题（ERROR 与 WARNING 都不许有）
let stdout;
try {
  stdout = run(["validate", "--strict", "--json"]);
} catch (error) {
  fail("`validate --strict` 非零退出", String(error.stdout ?? error.stderr ?? error.message));
}
let issues;
try {
  issues = JSON.parse(stdout).issues;
} catch {
  fail("`validate --strict --json` 的输出不是 JSON", stdout);
}
if (issues.length > 0) {
  fail(
    `严格模式下有 ${issues.length} 个问题`,
    issues.map((issue) => `${issue.level} ${issue.rule} ${issue.path} — ${issue.message}`).join("\n"),
  );
}

// 2. fixture 得真的覆盖七层——否则哪天被删瘦了，这条检查会静默变成「校验一个空仓」
const EXPECTED_LAYERS = ["ir", "sr", "ar", "scenarios", "usecases", "function-items", "function-points"];
let chain;
try {
  chain = JSON.parse(run(["status", "--chain", "IR-001", "--json"])).chain;
} catch (error) {
  fail("`status --chain IR-001` 跑不起来", String(error.stdout ?? error.stderr ?? error.message));
}
const layers = new Set(chain.items.map((item) => item.layer));
const missing = EXPECTED_LAYERS.filter((layer) => !layers.has(layer));
if (missing.length > 0) fail(`fixture 的链里缺这几层：${missing.join(", ")}`);
if (chain.items.length !== EXPECTED_LAYERS.length) {
  fail(`fixture 的链里有 ${chain.items.length} 个条目（应为每层一条、共 ${EXPECTED_LAYERS.length} 条）`);
}

console.log(`✓ fixture 严格校验通过：chain-sample 七层各一条，validate --strict 零问题`);
