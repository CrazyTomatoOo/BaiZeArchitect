#!/usr/bin/env node
// 十个 skill 的**结构**检查（#157 的验收里能机械化的那一半）。
//
// 只查形状，不查措辞好坏：目录齐全、frontmatter 有 name/description、
// description 以 `Use when` 开头、正文非空且是中文。
// 「正文里不得出现具体 rule id」「不得复述 CLI 输出字段名」不在这里——
// 那两条贴源文本、且规则表会变，靠评审看，不靠正则。
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const EXPECTED = [
  "using-baize",
  "baize-ir",
  "baize-sr",
  "baize-ar",
  "baize-scenario",
  "baize-usecase",
  "baize-function",
  "baize-validate",
  "baize-review",
  "baize-revise",
];

const root = path.resolve(import.meta.dirname, "..");
const skillsDir = path.join(root, "skills");
const failures = [];

let present;
try {
  present = readdirSync(skillsDir).filter((name) =>
    statSync(path.join(skillsDir, name)).isDirectory(),
  );
} catch {
  console.error(`✗ skills/ 不存在：${skillsDir}`);
  process.exit(1);
}

for (const name of EXPECTED) {
  if (!present.includes(name)) failures.push(`缺 skill 目录：skills/${name}/`);
}
for (const name of present) {
  if (!EXPECTED.includes(name)) failures.push(`多出来的 skill 目录：skills/${name}/`);
}

for (const name of EXPECTED) {
  if (!present.includes(name)) continue;
  const file = path.join(skillsDir, name, "SKILL.md");
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    failures.push(`缺文件：skills/${name}/SKILL.md`);
    continue;
  }

  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n([\s\S]*)$/.exec(text);
  if (!match) {
    failures.push(`skills/${name}/SKILL.md 没有 frontmatter 块`);
    continue;
  }

  const [, frontmatter, body] = match;
  const field = (key) => {
    const line = frontmatter.split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
    return line === undefined ? undefined : line.slice(key.length + 1).trim();
  };

  const declared = field("name");
  if (declared === undefined) failures.push(`skills/${name}/SKILL.md 的 frontmatter 缺 name`);
  else if (declared !== name) {
    failures.push(`skills/${name}/SKILL.md 的 name（${declared}）与目录名不一致`);
  }

  const description = field("description");
  if (description === undefined) {
    failures.push(`skills/${name}/SKILL.md 的 frontmatter 缺 description`);
  } else if (!description.startsWith("Use when")) {
    failures.push(`skills/${name}/SKILL.md 的 description 不以「Use when」开头：${description.slice(0, 40)}…`);
  }

  const trimmedBody = body.trim();
  if (trimmedBody === "") failures.push(`skills/${name}/SKILL.md 的正文是空的`);
  else if (!/[\u4e00-\u9fff]/.test(trimmedBody)) {
    failures.push(`skills/${name}/SKILL.md 的正文不是中文（没有一个汉字）`);
  }
}

if (failures.length > 0) {
  console.error(`✗ skill 结构检查未过（${failures.length} 条）：`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(`✓ skill 结构检查通过：${EXPECTED.length} 个 skill，name/description/正文口径一致`);
