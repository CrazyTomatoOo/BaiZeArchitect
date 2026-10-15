#!/usr/bin/env node
// 十个 skill 的**结构**检查（#157 的验收里能机械化的那一半），
// 加**薄检查**（#189 / 规格 #190「skills 文案」）。
//
// 结构：目录齐全、frontmatter 有 name/description、description 以 `Use when`
// 开头、正文非空且是中文。
//
// 薄检查（只查 skill **正文**，不查 description——触发词是 harness 面的）：
// 1. **模型事实计数**：字段 / 层 / 边 / 门禁 / 域 / 段的数目（「五项」「六段」
//    「三处门禁」）。skills 复述这些数字，模型一改就漂——#188 清掉的那批
//    （五项 / 五件 / 约七条 / 三处门禁 / 六段 / 三段）就是这条挡的形状。
//    放行的边界（与 #188 评审后的文案对齐）：
//    - 「一」不计（「一条边」「一个段 skill」是泛指，不是计数）；
//    - 「类」不计（「两类门禁」＝auto/signed 的分类，不是门禁有几处）；
//    - 「两个层级」不计（局部点名且下文随即展开，只有「X层」直数全局层数才算）；
//    - 外部事实与仓库结构事实不计（探针条数、skill 个数、status 的入口数）——
//      它们不是模型的事实，改模型不会让它们漂。
// 2. **字段名枚举**：把 schema 字段名列成清单（≥2 个非边字段并列）。字段清单
//    以 `baize new` 的骨架与 `baize validate` 的报告为准，skills 不复述。
//    边字段（`parent` / `covers` / …）是词表不是清单，单独或成对出现放行。
//    字段名从 `src/layers.ts` 的 LAYERS、边字段从 `src/fingerprint.ts` 的
//    EDGE_FIELDS **现读**——schema 变了这里跟着变，不另维护一份清单
//    （给检查器再抄一份清单，等于把要防的漂移换了个地方重演）。
//
// 仍然不在这里：「正文里不得出现具体 rule id」「不得复述 CLI 输出字段名」——
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

// —— 字段名清单（现读源码，见文件头说明）———————————————————
function fieldNamesFromSource() {
  let layersSrc;
  let fingerprintSrc;
  try {
    layersSrc = readFileSync(path.join(root, "src/layers.ts"), "utf8");
    fingerprintSrc = readFileSync(path.join(root, "src/fingerprint.ts"), "utf8");
  } catch {
    return { error: "读不到 src/layers.ts 或 src/fingerprint.ts——无法提取字段名清单" };
  }
  const fields = new Set(
    [...layersSrc.matchAll(/name:\s*"([A-Za-z]+)"/g)].map((m) => m[1]),
  );
  const edgeBlock = /const EDGE_FIELDS = \[([\s\S]*?)\]/.exec(fingerprintSrc)?.[1] ?? "";
  const edges = new Set([...edgeBlock.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]));
  if (fields.size === 0 || edges.size === 0) {
    return { error: "src 里提取不出字段名或边字段——LAYERS / EDGE_FIELDS 的形状变了？" };
  }
  return { fields, edges };
}
const source = fieldNamesFromSource();
if (source.error) failures.push(source.error);

// —— 薄检查一：模型事实计数（放行边界见文件头）———————————————
// 数词不含「一」（泛指）与「几」（虚指）；不含「类」（分类计数）。
const NUM = "[两二三四五六七八九十0-9]";
const COUNT_RULES = [
  [new RegExp(`${NUM}段`), "段数"],
  [new RegExp(`${NUM}层(?!级)`), "层数"],
  [new RegExp(`${NUM}(?:处|道|个|重)[^。，；]{0,4}门禁`), "门禁数"],
  [new RegExp(`${NUM}(?:个|项|道|件)[^。，；]{0,4}字段`), "字段数"],
  [new RegExp(`字段[^。，；]{0,6}${NUM}项`), "字段数"],
  [new RegExp(`${NUM}(?:条|个|道)[^。，；]{0,4}边`), "边数"],
  [new RegExp(`${NUM}(?:个|种)[^。，；]{0,2}域`), "域数"],
  [new RegExp(`${NUM}[项件](?!事)`), "字段计数"],
  [new RegExp(`约\\s*${NUM}\\s*条`), "阈值计数"],
];

function countDefects(body) {
  const defects = [];
  body.split(/\r?\n/).forEach((line, index) => {
    for (const [re, what] of COUNT_RULES) {
      const match = re.exec(line);
      if (match) {
        defects.push([index + 1, `模型事实计数「${match[0]}」（${what}）`]);
        break; // 一行只报第一条，报错信息不叠罗汉
      }
    }
  });
  return defects;
}

// —— 薄检查二：字段名枚举 ——————————————————————————————————
// 「`a` / `b` / `c`」这样并列的反引号串里，出现 ≥2 个非边的 schema 字段名即失败。
function enumerationDefects(body) {
  if (!source.fields) return [];
  const flaggable = (token) => source.fields.has(token) && !source.edges.has(token);
  const defects = [];
  body.split(/\r?\n/).forEach((line, index) => {
    for (const run of line.matchAll(/`[^`\n]+`(?:\s*[\/、，,]\s*`[^`\n]+`)+/g)) {
      const tokens = [...run[0].matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
      const named = tokens.filter(flaggable);
      if (named.length >= 2) {
        defects.push([index + 1, `字段名枚举「${run[0]}」——字段以 baize new 的骨架与 baize validate 的报告为准`]);
      }
    }
  });
  return defects;
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

  // 薄检查只看正文；行号换算成整份文件的真实行号（frontmatter 占了前几行）
  const offset = text.slice(0, text.length - body.length).split(/\r?\n/).length - 1;
  for (const [line, message] of [...countDefects(body), ...enumerationDefects(body)]) {
    failures.push(`skills/${name}/SKILL.md:${offset + line} → ${message}`);
  }
}

if (failures.length > 0) {
  console.error(`✗ skill 检查未过（${failures.length} 条）：`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `✓ skill 检查通过：${EXPECTED.length} 个 skill，name/description/正文口径一致；` +
    `正文无模型事实计数、无字段名枚举`,
);
