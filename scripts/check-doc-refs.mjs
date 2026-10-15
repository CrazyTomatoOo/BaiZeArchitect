#!/usr/bin/env node
// 文档引用与 ADR 待办口吻检查（#189）。
//
// 防的是一个真实事故：CONTEXT.md 曾有一句「尚未定（见「未定」）」，而全文根本没有
// 「未定」这一节——悬空引用躺了几个月没人发现。两条规矩各配一条机械检查：
//
// 1. **显式引用**：扫 CONTEXT.md、docs/adr/*.md、README.md、skills/**/SKILL.md，
//    三种引用形态——「见「X」」「见 §X」「见 `X`」——目标不存在即失败。
//    - 「见「X」」「见 §X」在本文件内解析：目标可以是 `## 小节标题`，也可以是
//      行首 `**词条名**`（词条带「（英文）」后缀时，去后缀的短名也算命中——
//      「见「确认」」能找到 `**确认（Confirmation）**`）。
//    - 「见 `X`」跨文件解析：X 是 skills/ 下的目录名，或仓库里真实存在的文件；
//      后面若跟「Y」（形如「见 `CONTEXT.md`「确认」」），Y 再到那个文件里按上一条解析。
// 2. **待办口吻**：扫 docs/adr/，命中「尚未定」「待…工单」「取决于…工单」即失败。
//    但 #174 定了 ADR 是历史记录——过时陈述**原文不改**、在原处加行内注（` → …`），
//    所以同一行里已有 ` → ` 注的放行：那不是待办，是已处置的历史。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const failures = [];

const rel = (file) => path.relative(root, file).split(path.sep).join("/");

// —— 目标索引：一个 markdown 文件里可被引用的东西 ——————————————

/** `## 小节标题` 与 `# 标题`（去掉行内 markdown 记号后原文匹配）。 */
function headingsOf(text) {
  const names = new Set();
  for (const match of text.matchAll(/^#{1,6}[ \t]+(.+?)\s*$/gm)) {
    names.add(match[1].replace(/[`*]/g, "").trim());
  }
  return names;
}

/** 行首 `**词条名**`；带「（…）」后缀的词条同时登记去后缀的短名。 */
function entriesOf(text) {
  const names = new Set();
  for (const match of text.matchAll(/^\*\*(.+?)\*\*/gm)) {
    const name = match[1].trim();
    names.add(name);
    const short = name.replace(/（[^（）]*）$/, "").trim();
    if (short !== name) names.add(short);
  }
  return names;
}

function targetsOf(text) {
  return { headings: headingsOf(text), entries: entriesOf(text) };
}

// —— 被扫的文件 ————————————————————————————————————————
const files = [
  path.join(root, "CONTEXT.md"),
  path.join(root, "README.md"),
  ...readdirSync(path.join(root, "docs/adr"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => path.join(root, "docs/adr", name)),
  ...readdirSync(path.join(root, "skills"))
    .filter((name) => statSync(path.join(root, "skills", name)).isDirectory())
    .map((name) => path.join(root, "skills", name, "SKILL.md")),
];

const cache = new Map();
const loadTargets = (file) => {
  if (!cache.has(file)) {
    cache.set(file, existsSync(file) ? targetsOf(readFileSync(file, "utf8")) : null);
  }
  return cache.get(file);
};

// —— 检查一：显式引用 ———————————————————————————————————
let refCount = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const here = targetsOf(text);
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const where = `${rel(file)}:${index + 1}`;

    // 见「X」——在本文件的小节标题与词条名里找
    for (const match of line.matchAll(/见\s*「([^」]+)」/g)) {
      refCount += 1;
      const name = match[1].trim();
      if (!here.headings.has(name) && !here.entries.has(name)) {
        failures.push(`${where} → 「${name}」在本文件没有对应的小节标题或词条`);
      }
    }

    // 见 §X——只认小节标题（§ 指节，不指词条）
    for (const match of line.matchAll(/见\s*§\s*(?:「([^」]+)」|([^\s，。；）、:：]+))/g)) {
      refCount += 1;
      const name = (match[1] ?? match[2]).trim();
      if (!here.headings.has(name)) {
        failures.push(`${where} → §${name} 在本文件没有对应的小节标题`);
      }
    }

    // 见 `X`——skill 目录或仓库内文件；带「Y」后缀时再到目标文件里解析 Y
    for (const match of line.matchAll(/见\s*`([^`]+)`(?:「([^」]+)」)?/g)) {
      refCount += 1;
      const target = match[1];
      const inner = match[2];
      let targetFile = null;
      if (statSync(path.join(root, "skills", target), { throwIfNoEntry: false })?.isDirectory()) {
        targetFile = path.join(root, "skills", target, "SKILL.md");
      } else if (existsSync(path.join(root, target))) {
        targetFile = path.join(root, target);
      } else {
        failures.push(`${where} → \`${target}\` 既不是 skill 目录，也不是仓库里的文件`);
        continue;
      }
      if (inner === undefined) continue;
      const there = loadTargets(targetFile);
      if (there === null) {
        failures.push(`${where} → \`${target}\` 指到的文件读不出目标`);
      } else if (!there.headings.has(inner) && !there.entries.has(inner)) {
        failures.push(`${where} → \`${target}\` 里没有「${inner}」这个小节或词条`);
      }
    }
  });
}

// —— 检查二：ADR 待办口吻（带 ` → ` 行内注的行放行，见文件头说明）———————
const PENDING = [/尚未定/, /待[^。\n]*工单/, /取决于[^。\n]*工单/];
let annotated = 0;
for (const file of files) {
  if (!rel(file).startsWith("docs/adr/")) continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes(" → ")) {
      if (PENDING.some((re) => re.test(line))) annotated += 1;
      return;
    }
    for (const re of PENDING) {
      const match = re.exec(line);
      if (match) {
        failures.push(`${rel(file)}:${index + 1} → 待办口吻「${match[0]}」且无行内注`);
        break;
      }
    }
  });
}

if (failures.length > 0) {
  console.error(`✗ 文档引用检查未过（${failures.length} 条）：`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `✓ 文档引用检查通过：${refCount} 处显式引用全部命中；` +
    `docs/adr 无未注记的待办口吻（${annotated} 行带行内注放行）`,
);
