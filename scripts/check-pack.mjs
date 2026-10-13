#!/usr/bin/env node
// 装包冒烟：`npm pack` 出来的包，装到干净项目里**真的能跑**。
//
// 这条是补一个真实事故：`bin` 曾指向 `.ts`，开发期（tsx）一切正常，
// 而装出来的包 `npx baize` 直接报 ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING。
// 88 个测试没碰它——测试跑的是源码，不是包。
//
// 只依赖 node 内置 + npm（本仓库唯一运行时依赖 `yaml` 由 npm 拉取）。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const fail = (message, detail) => {
  console.error(`✗ 装包冒烟未过：${message}`);
  if (detail) console.error(detail.trim().split("\n").slice(0, 12).join("\n"));
  process.exit(1);
};

let workdir;
try {
  // 1. 打包（prepack 会先 build，这是 dist/bin/baize.js 的来源）
  let packed;
  try {
    packed = JSON.parse(run("npm", ["pack", "--json"], root));
  } catch (error) {
    fail("`npm pack` 失败", String(error.stdout ?? error.message));
  }
  const tarball = path.join(root, packed[0].filename);
  if (!existsSync(tarball)) fail(`找不到打出来的包：${tarball}`);

  // 2. 包里该带的东西（清单与 skill 都在，缺一个就是「装上了但没带上」）
  const shipped = new Set(packed[0].files.map((f) => f.path));
  const required = [
    "dist/bin/baize.js",
    "package.json",
    ".claude-plugin/plugin.json",
    "hooks/hooks.json",
    "extensions/baize-context.ts",
    "scripts/baize-bootstrap.mjs",
  ];
  for (const name of required) {
    if (!shipped.has(name)) fail(`包里缺 ${name}`);
  }
  const skillCount = [...shipped].filter((p) => /^skills\/[^/]+\/SKILL\.md$/.test(p)).length;
  if (skillCount !== 10) fail(`包里带了 ${skillCount} 个 skill（应为 10）`);

  // 3. 装到干净项目里，跑真命令
  workdir = mkdtempSync(path.join(tmpdir(), "baize-pack-"));
  run("npm", ["init", "-y"], workdir);
  try {
    run("npm", ["install", tarball], workdir);
  } catch (error) {
    fail("装包失败", String(error.stdout ?? error.message));
  }

  let out;
  try {
    out = run("node", [path.join(workdir, "node_modules", ".bin", "baize"), "new", "ir", "--json"], workdir);
  } catch (error) {
    fail("装出来的 baize 跑不起来", String(error.stdout ?? error.stderr ?? error.message));
  }
  const parsed = JSON.parse(out);
  const created = parsed?.created?.path;
  if (created !== "baize/ir/IR-001.md") fail(`输出契约不对：${out.trim()}`);
  if (!existsSync(path.join(workdir, created))) fail(`说建了 ${created}，但文件不在`);

  console.log(`✓ 装包冒烟通过：${packed[0].filename} 装进干净项目后 \`baize new ir\` 真建出 ${created}`);
} finally {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
  for (const name of ["baize-0.0.0.tgz"]) {
    const stale = path.join(root, name);
    if (existsSync(stale)) rmSync(stale);
  }
}
