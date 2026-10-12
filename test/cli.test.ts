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
interface ItemView {
  id: string;
  layer: string;
  title: string;
  path: string;
  parent: string | null;
}
interface StatusItemOutput {
  schemaVersion: number;
  item: ItemView;
}
interface StatusChainsOutput {
  schemaVersion: number;
  chains: unknown[];
}
interface ChainOutput {
  schemaVersion: number;
  chain: { id: string; items: { id: string }[] };
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

// 分析层合法条目（#154）。场景/用例字段全必填但允许空数组（alternateFlows: [] = 看过了确实没有）。
const LEGAL_SC = `---
id: SC-001
title: 下单主流程
parent: SR-001
preconditions:
  - 用户已登录
trigger: 用户点击下单
mainFlow:
  - 选择商品并确认
alternateFlows: []
expectedOutcome: 订单创建成功
stakeholders:
  - 买家
---

场景陈述：买家从选购到下单成功的完整过程。
`;

const LEGAL_UC = `---
id: UC-001
title: 提交订单
parent: SR-001
appearsIn:
  - SC-001
goal: 买家能提交购物车生成订单
preconditions:
  - 购物车非空
mainFlow:
  - 确认购物车并提交
alternativeFlows: []
postconditions:
  - 生成订单号
stakeholders:
  - 买家
---

用例陈述：买家提交购物车，系统生成订单。
`;

// 功能项是薄层：title + description（内容由子功能点承载），无 statement。
const LEGAL_FN = `---
id: FN-001
title: 订单服务
parent: SR-001
domain: 交易
realizes:
  - UC-001
description: 承载下单与订单查询的功能项。
---
`;

// 功能点五项必填：职责 / 输入 / 输出 / 业务规则 / 验收条件；无 statement。
const LEGAL_FP = `---
id: FP-001
parent: FN-001
responsibility: 校验并创建订单
inputs:
  - 购物车快照
outputs:
  - 订单号
businessRules:
  - 库存不足时拒绝下单
acceptanceCriteria:
  - 非法参数返回 400
---
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
  write(cwd, "baize/sr/SR-002.md", LEGAL_SR.replace("id: SR-001", "id: SR-002"));
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

// ── #154 分析三层与关联边 ─────────────────────────────────────────────

test("new 分析四层各自可建：scenario / usecase / function-item / function-point 带 --parent 与全字段", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const scenario = await run(["new", "scenario", "--parent", "SR-001", "--json"], { cwd });
  assert.equal(scenario.exitCode, 0, scenario.stdout);
  assert.equal(parseJson<CreatedOutput>(scenario.stdout).created.id, "SC-001");
  const scText = readFileSync(join(cwd, "baize/scenarios/SC-001.md"), "utf8");
  assert.match(scText, /^id: SC-001$/m);
  assert.match(scText, /^parent: SR-001$/m);
  assert.match(scText, /^preconditions:/m);
  assert.match(scText, /^trigger:/m);
  assert.match(scText, /^mainFlow:/m);
  assert.match(scText, /^alternateFlows:/m);
  assert.match(scText, /^expectedOutcome:/m);
  assert.match(scText, /^stakeholders:/m);

  const usecase = await run(["new", "usecase", "--parent", "SR-001", "--json"], { cwd });
  assert.equal(usecase.exitCode, 0, usecase.stdout);
  assert.equal(parseJson<CreatedOutput>(usecase.stdout).created.id, "UC-001");
  const ucText = readFileSync(join(cwd, "baize/usecases/UC-001.md"), "utf8");
  assert.match(ucText, /^appearsIn:/m);
  assert.match(ucText, /^goal:/m);
  assert.match(ucText, /^alternativeFlows:/m);
  assert.match(ucText, /^postconditions:/m);

  // 功能项是薄层：title + description，无 statement。
  const fn = await run(["new", "function-item", "--parent", "SR-001", "--json"], { cwd });
  assert.equal(fn.exitCode, 0, fn.stdout);
  assert.equal(parseJson<CreatedOutput>(fn.stdout).created.id, "FN-001");
  const fnText = readFileSync(join(cwd, "baize/function-items/FN-001.md"), "utf8");
  assert.match(fnText, /^title:/m);
  assert.match(fnText, /^domain:/m);
  assert.match(fnText, /^realizes:/m);
  assert.match(fnText, /^description:/m);
  assert.ok(!/^statement:/m.test(fnText), "功能项是薄层，不应有 statement");

  // 功能点五项必填；无 statement / title。
  const fp = await run(["new", "function-point", "--parent", "FN-001", "--json"], { cwd });
  assert.equal(fp.exitCode, 0, fp.stdout);
  assert.equal(parseJson<CreatedOutput>(fp.stdout).created.id, "FP-001");
  const fpText = readFileSync(join(cwd, "baize/function-points/FP-001.md"), "utf8");
  assert.match(fpText, /^parent: FN-001$/m);
  assert.match(fpText, /^responsibility:/m);
  assert.match(fpText, /^inputs:/m);
  assert.match(fpText, /^outputs:/m);
  assert.match(fpText, /^businessRules:/m);
  assert.match(fpText, /^acceptanceCriteria:/m);
  assert.ok(!/^statement:/m.test(fpText), "功能点无 statement");
  assert.ok(!/^title:/m.test(fpText), "功能点按契约无 title");
});

test("new 分析四层缺 --parent → exit 2 且不写文件", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  for (const layer of ["scenario", "usecase", "function-item", "function-point"]) {
    const result = await run(["new", layer, "--json"], { cwd });
    assert.equal(result.exitCode, 2, result.stdout);
    assert.ok(parseJson<ErrorOutput>(result.stdout).error.rule);
  }
  assert.ok(!existsSync(join(cwd, "baize")), "不成立请求不应写任何文件");
});

test("功能域不是一层：new function-domain → exit 2（未知层级）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const result = await run(["new", "function-domain", "--parent", "SR-001", "--json"], { cwd });
  assert.equal(result.exitCode, 2, result.stdout);
  assert.ok(!existsSync(join(cwd, "baize")), "不成立请求不应写文件");
});

test("new usecase --appears-in SC-001,SC-002 写入数组（一条用例同时出现在多个场景，不必复制）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const result = await run(
    ["new", "usecase", "--parent", "SR-001", "--appears-in", "SC-001,SC-002"],
    { cwd },
  );
  assert.equal(result.exitCode, 0, result.stdout);
  const text = readFileSync(join(cwd, "baize/usecases/UC-001.md"), "utf8");
  assert.match(text, /^appearsIn:\s*$/m);
  assert.match(text, /^\s+- SC-001$/m);
  assert.match(text, /^\s+- SC-002$/m);
});

test("new function-item --realizes UC-001,UC-002 写入数组（一个功能项服务多条用例）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const result = await run(
    ["new", "function-item", "--parent", "SR-001", "--realizes", "UC-001,UC-002"],
    { cwd },
  );
  assert.equal(result.exitCode, 0, result.stdout);
  const text = readFileSync(join(cwd, "baize/function-items/FN-001.md"), "utf8");
  assert.match(text, /^realizes:\s*$/m);
  assert.match(text, /^\s+- UC-001$/m);
  assert.match(text, /^\s+- UC-002$/m);
});

test("new 拒绝张冠李戴的关联选项（--appears-in 只适用 usecase，--realizes 只适用 function-item）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const wrongAppearsIn = await run(
    ["new", "scenario", "--parent", "SR-001", "--appears-in", "SC-001"],
    { cwd },
  );
  assert.equal(wrongAppearsIn.exitCode, 2, wrongAppearsIn.stdout);

  const wrongRealizes = await run(
    ["new", "function-point", "--parent", "FN-001", "--realizes", "UC-001"],
    { cwd },
  );
  assert.equal(wrongRealizes.exitCode, 2, wrongRealizes.stdout);
  assert.ok(!existsSync(join(cwd, "baize")), "不成立请求不应写文件");
});

test("validate：ref.unknown-target —— appearsIn / realizes 指向不存在的条目 → ERROR", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR);
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC);
  write(cwd, "baize/usecases/UC-001.md", LEGAL_UC.replace("SC-001", "SC-999"));
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN.replace("UC-001", "UC-999"));

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  const unknown = issues.filter((i) => i.rule === "ref.unknown-target");
  assert.equal(unknown.length, 2, result.stdout);
  assert.ok(unknown.every((i) => i.level === "ERROR"), result.stdout);
  assert.ok(
    unknown.some((i) => i.path === "baize/usecases/UC-001.md" && i.message.includes("SC-999")),
    "appearsIn 的悬空引用应指出 SC-999：" + result.stdout,
  );
  assert.ok(
    unknown.some(
      (i) => i.path === "baize/function-items/FN-001.md" && i.message.includes("UC-999"),
    ),
    "realizes 的悬空引用应指出 UC-999：" + result.stdout,
  );

  // 指向存在的条目则不报本 rule
  write(cwd, "baize/usecases/UC-001.md", LEGAL_UC);
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN);
  const clean = await run(["validate", "--json"], { cwd });
  assert.equal(clean.exitCode, 0, clean.stdout);
  assert.ok(
    !parseJson<ValidateOutput>(clean.stdout).issues.some(
      (i) => i.rule === "ref.unknown-target",
    ),
    clean.stdout,
  );
});

test("validate：coverage.unrealized-usecase —— 未被任何功能项 realizes 的用例 → ERROR", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR);
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC);
  write(cwd, "baize/usecases/UC-001.md", LEGAL_UC);
  const legalUc2 = LEGAL_UC.replace("id: UC-001", "id: UC-002").replace(
    "title: 提交订单",
    "title: 取消订单",
  );
  write(cwd, "baize/usecases/UC-002.md", legalUc2);
  // FN-001 只 realizes UC-001；UC-002 无人承载
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN);

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  const unrealized = issues.filter((i) => i.rule === "coverage.unrealized-usecase");
  assert.equal(unrealized.length, 1, result.stdout);
  assert.equal(unrealized[0]!.level, "ERROR");
  assert.equal(unrealized[0]!.path, "baize/usecases/UC-002.md");
  assert.ok(unrealized[0]!.message.includes("UC-002"), "message 应指出是哪个用例");

  // 补上 realizes 后全绿
  write(
    cwd,
    "baize/function-items/FN-001.md",
    LEGAL_FN.replace("realizes:\n  - UC-001", "realizes:\n  - UC-001\n  - UC-002"),
  );
  const clean = await run(["validate", "--json"], { cwd });
  assert.equal(clean.exitCode, 0, clean.stdout);
  assert.equal(parseJson<ValidateOutput>(clean.stdout).issues.length, 0, clean.stdout);
});

test("validate：场景/用例字段全必填但允许空数组 —— 缺 alternateFlows/alternativeFlows 报 field.absent，空数组不报错", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR);
  // 场景整段缺 alternateFlows；用例整段缺 alternativeFlows
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC.replace("alternateFlows: []\n", ""));
  write(
    cwd,
    "baize/usecases/UC-001.md",
    LEGAL_UC.replace("alternativeFlows: []\n", ""),
  );

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  const absent = issues.filter((i) => i.rule === "field.absent");
  assert.ok(
    absent.some(
      (i) => i.path === "baize/scenarios/SC-001.md" && i.message.includes("alternateFlows"),
    ),
    "缺 alternateFlows 应报 field.absent：" + result.stdout,
  );
  assert.ok(
    absent.some(
      (i) =>
        i.path === "baize/usecases/UC-001.md" && i.message.includes("alternativeFlows"),
    ),
    "缺 alternativeFlows 应报 field.absent：" + result.stdout,
  );

  // 空数组合法：[] = 看过了确实没有。补回空数组并配齐 realizes 使全仓全绿
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC);
  write(cwd, "baize/usecases/UC-001.md", LEGAL_UC);
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN);
  const clean = await run(["validate", "--json"], { cwd });
  assert.equal(clean.exitCode, 0, clean.stdout);
  const cleanIssues = parseJson<ValidateOutput>(clean.stdout).issues;
  assert.ok(
    !cleanIssues.some(
      (i) =>
        (i.rule === "field.absent" || i.rule === "field.empty") &&
        (i.path === "baize/scenarios/SC-001.md" ||
          i.path === "baize/usecases/UC-001.md"),
    ),
    "空数组不应触发 field.empty / field.absent：" + clean.stdout,
  );
});
