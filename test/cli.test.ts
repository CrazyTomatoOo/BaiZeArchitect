import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { run } from "../src/cli.ts";

// 缝：CLI 的可观察边界——给定 argv 与初始目录状态，得到确定的 stdout / exit code / 目录变化。
// 不断言内部函数、不 mock 内部模块、不 snapshot 时间与绝对路径。

interface Issue {
  level: string;
  rule: string;
  path: string;
  message: string;
  fix?: string;
}
interface ValidateOutput {
  schemaVersion: number;
  issues: Issue[];
}
interface ErrorOutput {
  schemaVersion: number;
  error: { rule: string; message: string };
}
interface CreatedOutput {
  schemaVersion: number;
  created: { id: string; path: string };
}
interface ConfirmationView {
  state: "unconfirmed" | "confirmed" | "stale";
  by: string | null;
  at: string | null;
}
interface ItemView {
  id: string;
  layer: string;
  title: string;
  path: string;
  parent: string | null;
  confirmation: ConfirmationView;
}
interface StatusItemOutput {
  schemaVersion: number;
  item: ItemView;
}
interface StatusChainsOutput {
  schemaVersion: number;
  chains: unknown[];
}
interface SkipRecordView {
  by: string;
  at: string;
  why: string;
}
interface StageView {
  stage: string;
  skipped: SkipRecordView | null;
  subStages?: { items: SkipRecordView | null; points: SkipRecordView | null };
}
interface ChainOutput {
  schemaVersion: number;
  chain: {
    id: string;
    items: { id: string }[];
    stages: StageView[];
    coverage?: {
      id: string;
      covered: number;
      total: number;
      missing: { clueId: string; text: string }[];
    }[];
  };
}

// 被 JSON.parse 标为已知契约形状（JSON.parse 返回 any；测试里一次性收窄）
function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout) as unknown as T;
}

function write(cwd: string, rel: string, content: string): void {
  const abs = join(cwd, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

const LEGAL_IR = `---
id: IR-001
title: 支持用户数据导出
parent: null
acceptance:
  a1: 能导出 CSV
  a2: 能导出 Excel
---

产品要求用户能把数据带走，不能锁死在系统里。
`;

const EMPTY_ACCEPTANCE_IR = `---
id: IR-001
title: 支持用户数据导出
parent: null
acceptance: {}
---

产品要求用户能把数据带走，不能锁死在系统里。
`;

test("new ir 建出 IR-001 与 IR-002，frontmatter 带 id/title/parent/acceptance", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const first = await run(["new", "ir"], { cwd });
  assert.equal(first.exitCode, 0, first.stdout);
  assert.ok(existsSync(join(cwd, "baize/ir/IR-001.md")), "IR-001.md 应存在");
  const text = readFileSync(join(cwd, "baize/ir/IR-001.md"), "utf8");
  assert.match(text, /^---\n/);
  assert.match(text, /^id: IR-001$/m);
  assert.match(text, /^title:/m);
  assert.match(text, /^parent: null$/m);
  assert.match(text, /^acceptance:/m);

  const second = await run(["new", "ir", "--json"], { cwd });
  assert.equal(second.exitCode, 0, second.stdout);
  const data = parseJson<CreatedOutput>(second.stdout);
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.created.id, "IR-002");
  assert.equal(data.created.path, "baize/ir/IR-002.md");
  assert.ok(existsSync(join(cwd, "baize/ir/IR-002.md")), "IR-002.md 应存在");
});

test("validate：合法条目 exit 0 且 issues 为空", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  // 线索级覆盖率（#150）：合法仓库要求每条验收线索都有 SR 覆盖
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1, IR-001#a2"));

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  const data = parseJson<ValidateOutput>(result.stdout);
  assert.equal(data.schemaVersion, 1);
  assert.deepEqual(data.issues, []);
});

test("validate：id.invalid —— id 格式不合法时 exit 1 并报该 rule", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR.replace("id: IR-001", "id: IR-1"));

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  assert.ok(
    issues.some((i) => i.rule === "id.invalid"),
    result.stdout,
  );
});

test("validate：field.absent —— 缺字段与 field.empty 是两条不同的 rule", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  // 缺 acceptance 整段
  write(
    cwd,
    "baize/ir/IR-001.md",
    `---
id: IR-001
title: 缺验收线索
parent: null
---

正文。
`,
  );

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  const absent = issues.find((i) => i.rule === "field.absent");
  assert.ok(absent, result.stdout);
  assert.equal(absent.level, "ERROR");
  assert.equal(absent.path, "baize/ir/IR-001.md");
  assert.ok(absent.message.length > 0, "issue 必须带 message");
  assert.ok(
    !issues.some((i) => i.rule === "field.empty"),
    "空数组与缺字段必须分得开：" + result.stdout,
  );
});

test("validate：field.empty —— 空数组（acceptance: {}）报 field.empty，且不与 field.absent 混", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", EMPTY_ACCEPTANCE_IR);

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  const empty = issues.find((i) => i.rule === "field.empty");
  assert.ok(empty, result.stdout);
  assert.ok(
    !issues.some((i) => i.rule === "field.absent"),
    "字段在但为空时不应同时报 field.absent：" + result.stdout,
  );

  // 消息口径必须不同：缺字段 vs 空数组
  const otherCwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(otherCwd, { recursive: true, force: true }));
  write(
    otherCwd,
    "baize/ir/IR-001.md",
    `---
id: IR-001
title: 缺验收线索
parent: null
---

正文。
`,
  );
  const absentIssues = parseJson<ValidateOutput>(
    (await run(["validate", "--json"], { cwd: otherCwd })).stdout,
  ).issues;
  const absent = absentIssues.find((i) => i.rule === "field.absent");
  assert.ok(absent);
  assert.notEqual(empty.message, absent.message);
});

test("validate：rule 是点分 id，域限定为 ref/coverage/field/stale/id/stage", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR.replace("id: IR-001", "id: bogus"));
  write(cwd, "baize/ir/IR-002.md", "---\nid: IR-002\n---\n");

  const result = await run(["validate", "--json"], { cwd });
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  assert.ok(issues.length > 0);
  for (const issue of issues) {
    assert.ok(
      /^(ref|coverage|field|stale|id|stage)\.[a-z-]+$/.test(issue.rule),
      `rule 必须点分且域受限：${issue.rule}`,
    );
    assert.ok(["ERROR", "WARNING", "INFO"].includes(issue.level));
    assert.equal(typeof issue.path, "string");
    assert.equal(typeof issue.message, "string");
  }
});

test("--json 顶层带 schemaVersion；人类可读是同一份 JSON 的渲染", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", EMPTY_ACCEPTANCE_IR);

  const machine = await run(["validate", "--json"], { cwd });
  const human = await run(["validate"], { cwd });
  const data = parseJson<ValidateOutput>(machine.stdout);
  assert.equal(data.schemaVersion, 1);
  assert.equal(human.exitCode, machine.exitCode);
  assert.ok(data.issues.length > 0, "本用例应至少有一个问题");
  for (const issue of data.issues) {
    assert.ok(
      human.stdout.includes(issue.rule),
      `人读输出应含 rule ${issue.rule}`,
    );
    assert.ok(
      human.stdout.includes(issue.path),
      `人读输出应含 path ${issue.path}`,
    );
    assert.ok(
      human.stdout.includes(issue.message),
      `人读输出应含 message ${issue.message}`,
    );
  }
});

test("请求不成立 → exit 2 且仍输出 JSON", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const unknown = await run(["frobnicate", "--json"], { cwd });
  assert.equal(unknown.exitCode, 2, unknown.stdout);
  assert.ok(parseJson<ErrorOutput>(unknown.stdout).error.rule);

  const noLayer = await run(["new", "--json"], { cwd });
  assert.equal(noLayer.exitCode, 2, noLayer.stdout);
  assert.ok(parseJson<ErrorOutput>(noLayer.stdout).error.rule);

  const missingItem = await run(["status", "--item", "IR-999", "--json"], {
    cwd,
  });
  assert.equal(missingItem.exitCode, 2, missingItem.stdout);
  assert.ok(parseJson<ErrorOutput>(missingItem.stdout).error.rule);

  const missingChain = await run(["validate", "--chain", "IR-999", "--json"], {
    cwd,
  });
  assert.equal(missingChain.exitCode, 2, missingChain.stdout);
  assert.ok(parseJson<ErrorOutput>(missingChain.stdout).error.rule);
});

test("默认全仓、--chain 限定作用域", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  // IR-001 的线索全覆盖，隔离 coverage.missing-clue（#150），只留 id.invalid 变量
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1, IR-001#a2"));
  // IR-002 的 id 格式不合法
  write(
    cwd,
    "baize/ir/IR-002.md",
    LEGAL_IR.replace("id: IR-001", "id: IR-2"),
  );

  const whole = await run(["validate", "--json"], { cwd });
  assert.equal(whole.exitCode, 1, whole.stdout);

  const scoped = await run(["validate", "--chain", "IR-001", "--json"], { cwd });
  assert.equal(scoped.exitCode, 0, scoped.stdout);
  assert.deepEqual(parseJson<ValidateOutput>(scoped.stdout).issues, []);
});

test("空仓是合法的 { chains: [] }", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const result = await run(["status", "--json"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  const data = parseJson<StatusChainsOutput>(result.stdout);
  assert.equal(data.schemaVersion, 1);
  assert.deepEqual(data.chains, []);
});

test("status --item IR-001 列出该条目（JSON 与人类可读）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);

  const machine = await run(["status", "--item", "IR-001", "--json"], { cwd });
  assert.equal(machine.exitCode, 0, machine.stdout);
  const item = parseJson<StatusItemOutput>(machine.stdout).item;
  assert.equal(item.id, "IR-001");
  assert.equal(item.layer, "ir");
  assert.equal(item.title, "支持用户数据导出");
  assert.equal(item.path, "baize/ir/IR-001.md");
  assert.equal(item.parent, null);

  const human = await run(["status", "--item", "IR-001"], { cwd });
  assert.equal(human.exitCode, 0, human.stdout);
  assert.ok(human.stdout.includes("IR-001"));
  assert.ok(human.stdout.includes("支持用户数据导出"));
});

test("validate：field.empty 也覆盖空数组（acceptance: []）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", EMPTY_ACCEPTANCE_IR.replace("{}", "[]"));

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  assert.ok(
    issues.some((i) => i.rule === "field.empty"),
    result.stdout,
  );
});

test("validate：id 不是字符串（如数字）也报 id.invalid，不静默通过", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR.replace("id: IR-001", "id: 42"));

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  assert.ok(
    issues.some((i) => i.rule === "id.invalid"),
    result.stdout,
  );
});

test("new 拒绝不适用选项（--item 等）→ exit 2，不写文件", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const result = await run(["new", "ir", "--item", "IR-001", "--json"], { cwd });
  assert.equal(result.exitCode, 2, result.stdout);
  assert.ok(parseJson<ErrorOutput>(result.stdout).error.rule);
  assert.ok(!existsSync(join(cwd, "baize/ir/IR-001.md")), "不成立请求不应写文件");
});

const LEGAL_SR = `---
id: SR-001
title: 统一导出服务
parent: IR-001
covers: [IR-001#a1]
---

系统应提供统一的导出能力。
`;

test("new sr --parent IR-001 建出带父边的 SR-001；new ar --parent SR-001 同理", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const sr = await run(["new", "sr", "--parent", "IR-001", "--json"], { cwd });
  assert.equal(sr.exitCode, 0, sr.stdout);
  const created = parseJson<CreatedOutput>(sr.stdout).created;
  assert.equal(created.id, "SR-001");
  assert.equal(created.path, "baize/sr/SR-001.md");
  const srText = readFileSync(join(cwd, "baize/sr/SR-001.md"), "utf8");
  assert.match(srText, /^id: SR-001$/m);
  assert.match(srText, /^parent: IR-001$/m);
  assert.match(srText, /^covers:/m);

  const ar = await run(["new", "ar", "--parent", "SR-001", "--json"], { cwd });
  assert.equal(ar.exitCode, 0, ar.stdout);
  assert.equal(parseJson<CreatedOutput>(ar.stdout).created.id, "AR-001");
  const arText = readFileSync(join(cwd, "baize/ar/AR-001.md"), "utf8");
  assert.match(arText, /^id: AR-001$/m);
  assert.match(arText, /^parent: SR-001$/m);
});

test("new sr / new ar 缺 --parent → exit 2 且不写文件", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  for (const layer of ["sr", "ar"]) {
    const result = await run(["new", layer, "--json"], { cwd });
    assert.equal(result.exitCode, 2, result.stdout);
    assert.ok(parseJson<ErrorOutput>(result.stdout).error.rule);
  }
  assert.ok(!existsSync(join(cwd, "baize")), "不成立请求不应写任何文件");
});

test("new ir 不接受 --parent（IR 是链顶端，parent 恒为 null）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const result = await run(["new", "ir", "--parent", "IR-001", "--json"], {
    cwd,
  });
  assert.equal(result.exitCode, 2, result.stdout);
  assert.ok(parseJson<ErrorOutput>(result.stdout).error.rule);
  assert.ok(!existsSync(join(cwd, "baize/ir/IR-001.md")), "不成立请求不应写文件");
});

test("new 不写反向关系：建完 SR 后父 IR 文件一字未变", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  const before = readFileSync(join(cwd, "baize/ir/IR-001.md"), "utf8");

  const result = await run(["new", "sr", "--parent", "IR-001"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  assert.ok(existsSync(join(cwd, "baize/sr/SR-001.md")), "SR-001.md 应存在");

  const after = readFileSync(join(cwd, "baize/ir/IR-001.md"), "utf8");
  assert.equal(after, before, "父条目文件内容必须一字未变（关系只存单向）");
});

test("new sr --covers IR-001#a1,IR-001#a2 写入 covers 数组", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const result = await run(
    ["new", "sr", "--parent", "IR-001", "--covers", "IR-001#a1,IR-001#a2"],
    { cwd },
  );
  assert.equal(result.exitCode, 0, result.stdout);
  const text = readFileSync(join(cwd, "baize/sr/SR-001.md"), "utf8");
  assert.match(text, /^covers:\s*$/m);
  assert.match(text, /^\s+- IR-001#a1$/m);
  assert.match(text, /^\s+- IR-001#a2$/m);
});

test("validate：ref.orphan —— SR/AR 无 parent 报 ERROR；IR 的 parent: null 合法", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR.replace("parent: IR-001", "parent: null"));
  // parent 整段缺失也算孤儿
  write(
    cwd,
    "baize/ar/AR-001.md",
    `---
id: AR-001
title: 导出由报表服务负责
---

分配说明。
`,
  );

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  const orphans = issues.filter((i) => i.rule === "ref.orphan");
  assert.equal(orphans.length, 2, result.stdout);
  assert.ok(
    orphans.every(
      (i) => i.level === "ERROR" && i.path !== "baize/ir/IR-001.md",
    ),
    "IR 的 parent: null 不得触发 ref.orphan：" + result.stdout,
  );
  assert.ok(
    !issues.some(
      (i) => i.rule === "ref.orphan" && i.path === "baize/ir/IR-001.md",
    ),
    "IR 的 parent: null 不得触发 ref.orphan：" + result.stdout,
  );
});

test("validate：ref.parent-missing —— parent 指向不存在的条目", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR.replace("parent: IR-001", "parent: IR-999"));

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  const missing = issues.find((i) => i.rule === "ref.parent-missing");
  assert.ok(missing, result.stdout);
  assert.equal(missing.level, "ERROR");
  assert.equal(missing.path, "baize/sr/SR-001.md");
  assert.ok(missing.message.includes("IR-999"), "message 应指出是哪个 id");
});

test("validate：ref.unknown-clue —— covers 指向不存在的验收线索", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  // 父条目存在，但 acceptance 里没有 a9
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR.replace("IR-001#a1", "IR-001#a9"));
  // 父条目不存在
  write(
    cwd,
    "baize/sr/SR-002.md",
    LEGAL_SR.replace("id: SR-001", "id: SR-002").replace(
      "covers: [IR-001#a1]",
      "covers: [IR-999#a1]",
    ),
  );

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  const clues = issues.filter((i) => i.rule === "ref.unknown-clue");
  assert.equal(clues.length, 2, result.stdout);
  assert.ok(
    clues.every((i) => i.level === "ERROR"),
    result.stdout,
  );

  // 合法引用不报错：修正 SR-002，SR-001 覆盖 a1（covers: [] 也不触发本 rule）
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR.replace("covers: [IR-001#a1]", "covers: []"));
  // SR-002 补齐 a2 覆盖（#150 起合法仓库要求线索全覆盖）
  write(
    cwd,
    "baize/sr/SR-002.md",
    LEGAL_SR.replace("id: SR-001", "id: SR-002").replace(
      "covers: [IR-001#a1]",
      "covers: [IR-001#a2]",
    ),
  );
  write(cwd, "baize/sr/SR-003.md", LEGAL_SR.replace("id: SR-001", "id: SR-003"));
  const clean = await run(["validate", "--json"], { cwd });
  assert.equal(clean.exitCode, 0, clean.stdout);
  const cleanIssues = parseJson<ValidateOutput>(clean.stdout).issues;
  assert.ok(
    !cleanIssues.some((i) => i.rule === "ref.unknown-clue"),
    clean.stdout,
  );
});

test("status --chain IR-001 给出该链的条目", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(
    cwd,
    "baize/sr/SR-001.md",
    `---
id: SR-001
title: 统一导出服务
parent: IR-001
covers: [IR-001#a1]
---

导出能力。
`,
  );

  const result = await run(["status", "--chain", "IR-001", "--json"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  const chain = parseJson<ChainOutput>(result.stdout).chain;
  assert.equal(chain.id, "IR-001");
  const ids = chain.items.map((i) => i.id);
  assert.deepEqual(ids.sort(), ["IR-001", "SR-001"]);
});

// —— accept：认领与确认失效（#151）——

const SR_WITH_COVERS = `---
id: SR-001
title: 统一导出服务
parent: IR-001
covers: [IR-001#a1]
---

把「数据可带走」落成服务端导出能力。
`;

/** 注入 BAIZE_USER 并在用例结束后还原（accept 的 by 从环境变量取）。 */
function injectUser(t: { after: (fn: () => void) => void }, value: string | undefined): void {
  const original = process.env.BAIZE_USER;
  if (value === undefined) delete process.env.BAIZE_USER;
  else process.env.BAIZE_USER = value;
  t.after(() => {
    if (original === undefined) delete process.env.BAIZE_USER;
    else process.env.BAIZE_USER = original;
  });
}

const FIXED_NOW = "2026-10-12T08:00:00.000Z";

async function acceptAndRead(
  cwd: string,
  id: string,
): Promise<Record<string, unknown>> {
  const accepted = await run(["accept", id, "--json"], { cwd, now: FIXED_NOW });
  assert.equal(accepted.exitCode, 0, accepted.stdout);
  return parseJson<{ schemaVersion: number; confirmed: Record<string, unknown> }>(
    accepted.stdout,
  ).confirmed;
}

// —— 链段跳过视图（#153）——

const COMPLETE_SKIP = `by: crazytomatooo
at: 2026-10-12
why: 本需求由 SR 直接承载，无需独立架构决策
`;

test("accept IR-001 写入 confirmed: {by, at, fingerprint}（by 取 BAIZE_USER，at 用注入时钟）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);

  const confirmed = await acceptAndRead(cwd, "IR-001");
  assert.equal(confirmed["by"], "alice");
  assert.equal(confirmed["at"], FIXED_NOW);
  assert.match(confirmed["fingerprint"] as string, /^[0-9a-f]{64}$/);

  // 落盘：frontmatter 里的 confirmed 与输出一致（是本条目的实质字段指纹）
  const text = readFileSync(join(cwd, "baize/ir/IR-001.md"), "utf8");
  assert.match(text, /^confirmed:/m);
  assert.match(text, /^  by: alice$/m);
  assert.match(text, new RegExp(`^  at: ${FIXED_NOW.replace(/[.]/g, "\\.")}$`, "m"));
  assert.match(text, /^  fingerprint: [0-9a-f]{64}$/m);

  // status --item 读回同一份确认状态：已确认且未失效
  const status = await run(["status", "--item", "IR-001", "--json"], { cwd });
  assert.equal(status.exitCode, 0, status.stdout);
  const view = parseJson<StatusItemOutput>(status.stdout).item.confirmation;
  assert.equal(view.state, "confirmed");
  assert.equal(view.by, "alice");
  assert.equal(view.at, FIXED_NOW);
});

test("accept：BAIZE_USER 未设置时 by 落明确默认值，测试不依赖真实环境", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, undefined);
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);

  const confirmed = await acceptAndRead(cwd, "IR-001");
  assert.equal(confirmed["by"], "unknown");
  assert.equal(confirmed["at"], FIXED_NOW);
});

test("accept：缺 id 或条目不存在 → exit 2，不写文件", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);

  const noId = await run(["accept", "--json"], { cwd, now: FIXED_NOW });
  assert.equal(noId.exitCode, 2, noId.stdout);
  assert.equal(parseJson<ErrorOutput>(noId.stdout).error.rule, "cli.usage");

  const missing = await run(["accept", "IR-999", "--json"], { cwd, now: FIXED_NOW });
  assert.equal(missing.exitCode, 2, missing.stdout);
  assert.equal(parseJson<ErrorOutput>(missing.stdout).error.rule, "item.not-found");

  const text = readFileSync(join(cwd, "baize/ir/IR-001.md"), "utf8");
  assert.ok(!/^confirmed:/m.test(text), "不成立的请求不应写 confirmed");
});

test("status --item 给出确认状态：未确认 → unconfirmed（IR 录入门禁由它算出 pending，#156 呈现）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);

  const machine = await run(["status", "--item", "IR-001", "--json"], { cwd });
  assert.equal(machine.exitCode, 0, machine.stdout);
  const view = parseJson<StatusItemOutput>(machine.stdout).item.confirmation;
  assert.equal(view.state, "unconfirmed");
  assert.equal(view.by, null);
  assert.equal(view.at, null);

  const human = await run(["status", "--item", "IR-001"], { cwd });
  assert.equal(human.exitCode, 0, human.stdout);
  assert.ok(human.stdout.includes("未确认"), human.stdout);
});

test("改 statement 后确认自动失效：不落盘、无需单独操作，status 显示已失效", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  await acceptAndRead(cwd, "IR-001");

  // 只改 statement，confirmed 记录原样留在盘上
  const text = readFileSync(join(cwd, "baize/ir/IR-001.md"), "utf8");
  const changed = text.replace(
    "产品要求用户能把数据带走，不能锁死在系统里。",
    "产品要求用户能把数据带走，格式由用户自选。",
  );
  assert.notEqual(changed, text, "本用例必须真的改掉 statement");
  write(cwd, "baize/ir/IR-001.md", changed);

  const machine = await run(["status", "--item", "IR-001", "--json"], { cwd });
  assert.equal(machine.exitCode, 0, machine.stdout);
  const view = parseJson<StatusItemOutput>(machine.stdout).item.confirmation;
  assert.equal(view.state, "stale");
  assert.equal(view.by, "alice", "确认记录本身还在，只是失效");
  assert.equal(view.at, FIXED_NOW);

  // 失效不落盘：盘上 confirmed 仍是原指纹，stale 是现算的
  assert.match(readFileSync(join(cwd, "baize/ir/IR-001.md"), "utf8"), /^  by: alice$/m);

  const human = await run(["status", "--item", "IR-001"], { cwd });
  assert.equal(human.exitCode, 0, human.stdout);
  assert.ok(human.stdout.includes("已失效"), human.stdout);
});

test("改 acceptance 后确认自动失效", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  await acceptAndRead(cwd, "IR-001");

  // 加一条验收线索
  write(
    cwd,
    "baize/ir/IR-001.md",
    readFileSync(join(cwd, "baize/ir/IR-001.md"), "utf8").replace(
      "  a2: 能导出 Excel\n",
      "  a2: 能导出 Excel\n  a3: 导出可断点续传\n",
    ),
  );

  const machine = await run(["status", "--item", "IR-001", "--json"], { cwd });
  assert.equal(machine.exitCode, 0, machine.stdout);
  assert.equal(
    parseJson<StatusItemOutput>(machine.stdout).item.confirmation.state,
    "stale",
  );
});

test("改出边 covers 后确认自动失效——实质字段含出边（#155 陈旧复用同一份逻辑）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", SR_WITH_COVERS);
  await acceptAndRead(cwd, "SR-001");

  const confirmed = await run(["status", "--item", "SR-001", "--json"], { cwd });
  assert.equal(
    parseJson<StatusItemOutput>(confirmed.stdout).item.confirmation.state,
    "confirmed",
  );

  // SR 改 covers（出边是实质字段的一部分）——在盘上现有内容里改，保留 confirmed；
  // accept 落盘时 yaml 会展开流式数组，所以匹配块式写法
  write(
    cwd,
    "baize/sr/SR-001.md",
    readFileSync(join(cwd, "baize/sr/SR-001.md"), "utf8").replace(
      "  - IR-001#a1\n",
      "  - IR-001#a1\n  - IR-001#a2\n",
    ),
  );

  const machine = await run(["status", "--item", "SR-001", "--json"], { cwd });
  assert.equal(machine.exitCode, 0, machine.stdout);
  assert.equal(
    parseJson<StatusItemOutput>(machine.stdout).item.confirmation.state,
    "stale",
  );
});

test("改 title / priority 不失效", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  await acceptAndRead(cwd, "IR-001");

  const text = readFileSync(join(cwd, "baize/ir/IR-001.md"), "utf8");
  const changed = text
    .replace("title: 支持用户数据导出", "title: 数据导出（改名了）\npriority: high");
  write(cwd, "baize/ir/IR-001.md", changed);

  const machine = await run(["status", "--item", "IR-001", "--json"], { cwd });
  assert.equal(machine.exitCode, 0, machine.stdout);
  const view = parseJson<StatusItemOutput>(machine.stdout).item.confirmation;
  assert.equal(view.state, "confirmed");
  assert.equal(view.by, "alice");
});

test("没有 unaccept：撤销类命令不存在 → exit 2 未知命令", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  await acceptAndRead(cwd, "IR-001");

  const result = await run(["unaccept", "IR-001", "--json"], { cwd, now: FIXED_NOW });
  assert.equal(result.exitCode, 2, result.stdout);
  const error = parseJson<ErrorOutput>(result.stdout).error;
  assert.equal(error.rule, "cli.usage");

  // 确认记录不受影响
  const machine = await run(["status", "--item", "IR-001", "--json"], { cwd });
  assert.equal(
    parseJson<StatusItemOutput>(machine.stdout).item.confirmation.state,
    "confirmed",
  );
});

test("status --chain：状态文件缺失不是错误——六段全部未跳过，且不落任何状态文件", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  // 线索全覆盖（#150），隔离 coverage.missing-clue，只验段状态
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1, IR-001#a2"));

  const machine = await run(["status", "--chain", "IR-001", "--json"], { cwd });
  assert.equal(machine.exitCode, 0, machine.stdout);
  const chain = parseJson<ChainOutput>(machine.stdout).chain;
  assert.deepEqual(
    chain.stages.map((s) => s.stage),
    ["ir", "sr", "ar", "scenario", "usecase", "function"],
  );
  for (const stage of chain.stages) {
    assert.equal(stage.skipped, null, `段 ${stage.stage} 应无跳过记录`);
    // 没有「未开始 / 进行中 / 已完成」这类状态枚举
    assert.ok(!("state" in stage), `段 ${stage.stage} 不得有 state 字段`);
  }
  const fn = chain.stages[5];
  assert.ok(fn);
  assert.deepEqual(fn.subStages, { items: null, points: null });

  // status 只现算不落盘：能算的东西一概不写进 baize/chains/
  assert.ok(!existsSync(join(cwd, "baize/chains")), "status 不得写状态文件");

  const human = await run(["status", "--chain", "IR-001"], { cwd });
  assert.equal(human.exitCode, 0, human.stdout);
  assert.match(human.stdout, /ir: 未跳过/);
  assert.match(human.stdout, /function: 未跳过（items 未跳过 \/ points 未跳过）/);
  assert.ok(!human.stdout.includes("已跳过"), "无跳过时人读输出不应出现「已跳过」");
  for (const word of ["未开始", "进行中", "已完成"]) {
    assert.ok(!human.stdout.includes(word), `不得出现状态枚举词：${word}`);
  }

  // 状态文件缺失同样不是 validate 的错误
  const validated = await run(["validate", "--json"], { cwd });
  assert.equal(validated.exitCode, 0, validated.stdout);
  assert.deepEqual(parseJson<ValidateOutput>(validated.stdout).issues, []);
});

test("validate：stage.skip-missing-reason —— 跳过记录缺 by / at / why 任一项报 ERROR", async (t) => {
  const missing = [
    ["by", `at: 2026-10-12\nwhy: 理由\n`],
    ["at", `by: crazytomatooo\nwhy: 理由\n`],
    ["why", `by: crazytomatooo\nat: 2026-10-12\n`],
  ] as const;
  for (const [field, body] of missing) {
    const cwd = mkdtempSync(join(tmpdir(), "baize-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
    // 线索全覆盖（#150），只留 stage.skip-missing-reason 一个变量
    write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1, IR-001#a2"));
    write(cwd, "baize/chains/IR-001.yaml", `skipped:\n  sr:\n${body.split("\n").map((l) => `    ${l}`).join("\n")}`);

    const result = await run(["validate", "--json"], { cwd });
    assert.equal(result.exitCode, 1, result.stdout);
    const issues = parseJson<ValidateOutput>(result.stdout).issues;
    const issue = issues.find((i) => i.rule === "stage.skip-missing-reason");
    assert.ok(issue, `缺 ${field} 应报 stage.skip-missing-reason：${result.stdout}`);
    assert.equal(issue.level, "ERROR");
    assert.equal(issue.path, "baize/chains/IR-001.yaml");
    assert.ok(issue.message.includes("sr"), issue.message);
    assert.ok(issue.message.includes(field), issue.message);
    assert.equal(issues.length, 1, "只应有一个问题：" + result.stdout);
  }

  // 三字段齐备 → 不报
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  // 线索全覆盖（#150），只留段状态变量
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1, IR-001#a2"));
  write(
    cwd,
    "baize/chains/IR-001.yaml",
    `skipped:\n  sr:\n${COMPLETE_SKIP.split("\n").map((l) => `    ${l}`).join("\n")}`,
  );
  const ok = await run(["validate", "--json"], { cwd });
  assert.equal(ok.exitCode, 0, ok.stdout);
  assert.deepEqual(parseJson<ValidateOutput>(ok.stdout).issues, []);

  // --chain 限定作用域同样生效
  const scoped = await run(["validate", "--chain", "IR-001", "--json"], { cwd });
  assert.equal(scoped.exitCode, 0, scoped.stdout);
});

test("status --chain：区分「已跳过」与「未跳过」的段（JSON 与人类可读同源）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(
    cwd,
    "baize/chains/IR-001.yaml",
    `skipped:\n  scenario:\n${COMPLETE_SKIP.split("\n").map((l) => `    ${l}`).join("\n")}`,
  );

  const machine = await run(["status", "--chain", "IR-001", "--json"], { cwd });
  assert.equal(machine.exitCode, 0, machine.stdout);
  const stages = parseJson<ChainOutput>(machine.stdout).chain.stages;
  const scenario = stages.find((s) => s.stage === "scenario");
  assert.ok(scenario);
  assert.equal(scenario.skipped?.by, "crazytomatooo");
  assert.equal(scenario.skipped?.at, "2026-10-12");
  assert.equal(
    scenario.skipped?.why,
    "本需求由 SR 直接承载，无需独立架构决策",
  );
  for (const stage of stages.filter((s) => s.stage !== "scenario")) {
    assert.equal(stage.skipped, null, `段 ${stage.stage} 应为未跳过`);
  }

  const human = await run(["status", "--chain", "IR-001"], { cwd });
  assert.equal(human.exitCode, 0, human.stdout);
  assert.match(human.stdout, /scenario: 已跳过 — crazytomatooo @ 2026-10-12：/);
  assert.match(human.stdout, /sr: 未跳过/);
  assert.match(human.stdout, /usecase: 未跳过/);
  // 人读输出 = 同一份数据的渲染：by / at / why 都要在
  assert.ok(human.stdout.includes("本需求由 SR 直接承载，无需独立架构决策"));
});

test("status --chain：功能拆分一段写成 items / points 两个子项，可分别跳过", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(
    cwd,
    "baize/chains/IR-001.yaml",
    `skipped:
  function:
    items:
      by: crazytomatooo
      at: 2026-10-12
      why: 本需求颗粒度足够细，直接进功能点
`,
  );

  const machine = await run(["status", "--chain", "IR-001", "--json"], { cwd });
  assert.equal(machine.exitCode, 0, machine.stdout);
  const fn = parseJson<ChainOutput>(machine.stdout).chain.stages[5];
  assert.ok(fn);
  assert.equal(fn.stage, "function");
  assert.equal(fn.skipped, null, "整段未跳过时 skipped 应为 null");
  assert.equal(fn.subStages?.items?.by, "crazytomatooo");
  assert.equal(fn.subStages?.items?.why, "本需求颗粒度足够细，直接进功能点");
  assert.equal(fn.subStages?.points, null);

  const human = await run(["status", "--chain", "IR-001"], { cwd });
  assert.match(human.stdout, /function: 未跳过（items 已跳过 — crazytomatooo @ 2026-10-12：/);
  assert.match(human.stdout, / \/ points 未跳过）/);

  // 子项记录缺字段同样报 stage.skip-missing-reason
  const badCwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(badCwd, { recursive: true, force: true }));
  write(badCwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(
    badCwd,
    "baize/chains/IR-001.yaml",
    `skipped:
  function:
    items:
      by: crazytomatooo
      at: 2026-10-12
`,
  );
  const bad = await run(["validate", "--json"], { cwd: badCwd });
  assert.equal(bad.exitCode, 1, bad.stdout);
  const issue = parseJson<ValidateOutput>(bad.stdout).issues.find(
    (i) => i.rule === "stage.skip-missing-reason",
  );
  assert.ok(issue, bad.stdout);
  assert.ok(issue.message.includes("function.items"), issue.message);
  assert.ok(issue.message.includes("why"), issue.message);
});

test("链状态文件只存 skipped 与 gates：gates 通过校验且不落地为段状态", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  // 线索全覆盖（#150），隔离 coverage.missing-clue
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1, IR-001#a2"));
  // 只有功能拆分门禁留人工通过记录；IR 录入与 SR→AR 两处门禁由事实算出，不落盘
  write(
    cwd,
    "baize/chains/IR-001.yaml",
    `skipped:
  ar:
    by: crazytomatooo
    at: 2026-10-12
    why: 单 SR 直接对应实现，无需 AR
gates:
  function:
    confirmedBy: crazytomatooo
    at: 2026-10-12
    statement: 这套功能拆分足以支撑实现；未覆盖的用例与未复核的陈旧已处置。
`,
  );

  const validated = await run(["validate", "--json"], { cwd });
  assert.equal(validated.exitCode, 0, validated.stdout);

  const machine = await run(["status", "--chain", "IR-001", "--json"], { cwd });
  assert.equal(machine.exitCode, 0, machine.stdout);
  const stages = parseJson<ChainOutput>(machine.stdout).chain.stages;
  for (const stage of stages) {
    // 门禁签字不显示为段状态；文件里没有进度 / 覆盖率 / 陈旧
    assert.ok(!("gate" in stage) && !("gates" in stage), `段 ${stage.stage} 不得含门禁状态`);
    assert.ok(!("progress" in stage) && !("coverage" in stage) && !("stale" in stage));
  }
  const ar = stages.find((s) => s.stage === "ar");
  assert.equal(ar?.skipped?.why, "单 SR 直接对应实现，无需 AR");

  const human = await run(["status", "--chain", "IR-001"], { cwd });
  assert.ok(!human.stdout.includes("gate"), "人读输出不得出现门禁记录：" + human.stdout);
  assert.ok(!human.stdout.includes("足以支撑实现"));
});

const IR_THREE_CLUES = `---
id: IR-001
title: 支持用户数据导出
parent: null
acceptance:
  a1: 能导出 CSV
  a2: 能导出 Excel
  a3: 能设置导出范围
---

产品要求用户能把数据带走，不能锁死在系统里。
`;

const IR_TWO_CLUES = `---
id: IR-001
title: 支持用户数据导出
parent: null
acceptance:
  a1: 能导出 CSV
  a2: 能导出 Excel
---

产品要求用户能把数据带走，不能锁死在系统里。
`;

function srWithCovers(id: string, covers: string): string {
  return `---
id: ${id}
title: 统一导出服务
parent: IR-001
covers: [${covers}]
---

导出能力。
`;
}

test("validate：coverage.missing-clue —— 未覆盖的线索报 ERROR 且指出是哪一条（id + 文本）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", IR_THREE_CLUES);
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1"));

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  const missing = issues.filter((i) => i.rule === "coverage.missing-clue");
  assert.equal(missing.length, 2, result.stdout);
  assert.ok(
    missing.every((i) => i.level === "ERROR" && i.path === "baize/ir/IR-001.md"),
    result.stdout,
  );
  const byClue = (clue: string) => missing.find((i) => i.message.includes(clue));
  const a2 = byClue("IR-001#a2");
  const a3 = byClue("IR-001#a3");
  assert.ok(a2, "应报出 IR-001#a2：" + result.stdout);
  assert.ok(a3, "应报出 IR-001#a3：" + result.stdout);
  assert.ok(a2.message.includes("能导出 Excel"), "message 应带线索文本：" + a2.message);
  assert.ok(a3.message.includes("能设置导出范围"), "message 应带线索文本：" + a3.message);

  // 补齐覆盖后全绿；多条 SR 拼覆盖也成立
  write(cwd, "baize/sr/SR-002.md", srWithCovers("SR-002", "IR-001#a2"));
  write(cwd, "baize/sr/SR-003.md", srWithCovers("SR-003", "IR-001#a3"));
  const clean = await run(["validate", "--json"], { cwd });
  assert.equal(clean.exitCode, 0, clean.stdout);
  assert.ok(
    !parseJson<ValidateOutput>(clean.stdout).issues.some(
      (i) => i.rule === "coverage.missing-clue",
    ),
    clean.stdout,
  );
});

test("validate：covers: [] 合法（不报 field/ref），缺 covers 字段走 field.absent——两条 rule 不混", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", IR_TWO_CLUES);
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", ""));

  // covers: [] —— SR 自身没有任何 field/ref 问题；覆盖率另算（两条线索都没人覆盖）
  const empty = await run(["validate", "--json"], { cwd });
  assert.equal(empty.exitCode, 1, empty.stdout);
  const emptyIssues = parseJson<ValidateOutput>(empty.stdout).issues;
  assert.ok(
    !emptyIssues.some((i) => i.path === "baize/sr/SR-001.md"),
    "covers: [] 不得在 SR 上触发任何 field/ref rule：" + empty.stdout,
  );
  assert.equal(
    emptyIssues.filter((i) => i.rule === "coverage.missing-clue").length,
    2,
    empty.stdout,
  );

  // 缺 covers 字段 —— field.absent（不是 field.empty，也不是 coverage/ref）
  write(
    cwd,
    "baize/sr/SR-001.md",
    `---
id: SR-001
title: 统一导出服务
parent: IR-001
---

导出能力。
`,
  );
  const absent = await run(["validate", "--json"], { cwd });
  assert.equal(absent.exitCode, 1, absent.stdout);
  const absentIssues = parseJson<ValidateOutput>(absent.stdout).issues;
  const fieldAbsent = absentIssues.find(
    (i) => i.rule === "field.absent" && i.path === "baize/sr/SR-001.md",
  );
  assert.ok(fieldAbsent, absent.stdout);
  assert.ok(fieldAbsent.message.includes("covers"), fieldAbsent.message);
  assert.ok(
    !absentIssues.some((i) => i.rule === "field.empty" && i.path === "baize/sr/SR-001.md"),
    "缺字段不得报 field.empty：" + absent.stdout,
  );
});

test("validate：--chain 限定作用域——只算该链成员；跨链 covers 全仓算数、链内不算", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", IR_TWO_CLUES);
  write(
    cwd,
    "baize/ir/IR-002.md",
    IR_TWO_CLUES.replace("id: IR-001", "id: IR-002"),
  );
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a2"));
  // 跨链：SR-002 挂在 IR-002 链下，却声明覆盖 IR-001#a1
  write(
    cwd,
    "baize/sr/SR-002.md",
    srWithCovers("SR-002", "IR-001#a1").replace("parent: IR-001", "parent: IR-002"),
  );

  // 全仓：跨链 covers 算数——IR-001 全 covered；只有 IR-002 的线索没人覆盖
  const full = await run(["validate", "--json"], { cwd });
  assert.equal(full.exitCode, 1, full.stdout);
  const fullMissing = parseJson<ValidateOutput>(full.stdout).issues.filter(
    (i) => i.rule === "coverage.missing-clue",
  );
  assert.equal(fullMissing.length, 2, full.stdout);
  assert.ok(
    fullMissing.every((i) => i.path === "baize/ir/IR-002.md"),
    full.stdout,
  );

  // --chain IR-001：SR-002 不是该链成员，其 covers 不计；SR-001（链内）已覆盖 a2，只剩 a1
  const chain1 = await run(["validate", "--chain", "IR-001", "--json"], { cwd });
  assert.equal(chain1.exitCode, 1, chain1.stdout);
  const chain1Missing = parseJson<ValidateOutput>(chain1.stdout).issues.filter(
    (i) => i.rule === "coverage.missing-clue",
  );
  assert.equal(chain1Missing.length, 1, chain1.stdout);
  assert.ok(
    chain1Missing.some((i) => i.message.includes("IR-001#a1")),
    chain1.stdout,
  );
  assert.ok(
    !chain1Missing.some((i) => i.message.includes("IR-001#a2")),
    chain1.stdout,
  );
  assert.ok(
    !chain1Missing.some((i) => i.path === "baize/ir/IR-002.md"),
    "--chain IR-001 不得报链外的 IR-002：" + chain1.stdout,
  );

  // --chain IR-002：只算 IR-002 自己的线索
  const chain2 = await run(["validate", "--chain", "IR-002", "--json"], { cwd });
  assert.equal(chain2.exitCode, 1, chain2.stdout);
  const chain2Missing = parseJson<ValidateOutput>(chain2.stdout).issues.filter(
    (i) => i.rule === "coverage.missing-clue",
  );
  assert.equal(chain2Missing.length, 2, chain2.stdout);
  assert.ok(
    chain2Missing.every((i) => i.path === "baize/ir/IR-002.md"),
    chain2.stdout,
  );
});

test("status --chain IR-001 报线索覆盖率：IR-001 2/3 已覆盖", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", IR_THREE_CLUES);
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1"));
  write(cwd, "baize/sr/SR-002.md", srWithCovers("SR-002", "IR-001#a2"));

  const human = await run(["status", "--chain", "IR-001"], { cwd });
  assert.equal(human.exitCode, 0, human.stdout);
  assert.match(human.stdout, /IR-001 2\/3 已覆盖/);

  const json = await run(["status", "--chain", "IR-001", "--json"], { cwd });
  assert.equal(json.exitCode, 0, json.stdout);
  const coverage = parseJson<ChainOutput>(json.stdout).chain.coverage;
  assert.ok(coverage, json.stdout);
  const ir = coverage.find((c) => c.id === "IR-001");
  assert.ok(ir, json.stdout);
  assert.equal(ir.covered, 2);
  assert.equal(ir.total, 3);
  assert.deepEqual(ir.missing, [{ clueId: "a3", text: "能设置导出范围" }]);
});

test("validate 与 status 对同一份覆盖率数据说法一致", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", IR_THREE_CLUES);
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1"));

  const validated = await run(["validate", "--chain", "IR-001", "--json"], { cwd });
  assert.equal(validated.exitCode, 1, validated.stdout);
  const missing = parseJson<ValidateOutput>(validated.stdout).issues.filter(
    (i) => i.rule === "coverage.missing-clue",
  );

  const statused = await run(["status", "--chain", "IR-001", "--json"], { cwd });
  assert.equal(statused.exitCode, 0, statused.stdout);
  const coverage = parseJson<ChainOutput>(statused.stdout).chain.coverage ?? [];
  const ir = coverage.find((c) => c.id === "IR-001");
  assert.ok(ir, statused.stdout);

  // 两路同源：status 的 covered + validate 的 missing 数 = total，且缺的是同几条线索
  assert.equal(ir.covered + missing.length, ir.total);
  const missingIds = ir.missing.map((m) => `IR-001#${m.clueId}`).sort();
  const reportedIds = missing
    .map((i) => i.message.match(/IR-001#\w+/)?.[0] ?? "")
    .sort();
  assert.deepEqual(reportedIds, missingIds);
});
