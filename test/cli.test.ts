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
