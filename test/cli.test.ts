import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { run } from "../src/cli.ts";
import { RULE_DOMAINS } from "../src/types.ts";
import { parse as parseYaml } from "yaml";

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
interface ChainStaleView {
  direct: string[];
  transitive: number;
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
    stale: ChainStaleView;
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

const LEGAL_AR = `---
id: AR-001
title: 分配导出服务
parent: SR-001
allocates: export-service
---

把导出能力分配给既有组件。
`;

// 受控清单：一个顶层键 + 稳定 slug → { name, description? }；值里的额外字段一律忽略。
const ARCHITECTURE_YAML = `components:
  export-service: { name: 导出服务, description: 产出可下载的数据文件 }
  audit-log: { name: 审计服务, owner: platform }
`;

const SCENARIO_CATALOGS_YAML = `catalogs:
  order-flow: { name: 订单流程 }
  self-service: { name: 客户自助 }
`;

// A1 边界：文件里先出现另一个映射键（如 metadata），配定的顶层键在后面——
// 不得把先出现的映射误当清单。
const ARCHITECTURE_FOREIGN_FIRST = `metadata:
  owner: platform-team
components:
  export-service: { name: 导出服务 }
`;

const SCENARIO_CATALOGS_FOREIGN_FIRST = `metadata:
  owner: design-team
catalogs:
  order-flow: { name: 订单流程 }
`;

const LEGAL_SCENARIO = `---
id: SC-001
title: 下单后导出报表
refines:
  - SR-001
catalog: order-flow
preconditions:
  - 用户已登录
trigger: 用户在订单页点击导出
mainFlow:
  - 系统生成报表文件
alternativeFlows: []
expectedOutcome: 浏览器开始下载报表
stakeholders:
  - 买家
---

用户在订单流程里导出报表。
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
  // AR 分配（#152）：合法仓库要求每条 SR 都有 AR 承接
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  // 方案层认领（#181），隔离 sr.unclaimed
  write(cwd, "baize/function-items/FN-001.md", FN_CLAIMING_SR001);

  // IR 录入门禁（#147）：未确认的链根会让下游条目报 stage.upstream-unconfirmed，先把根认下来
  await acceptAndRead(cwd, "IR-001");

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

test("validate：rule 是点分 id，域钉在字面白名单（八个域，改清单必须是有意的测试编辑）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR.replace("id: IR-001", "id: bogus"));
  write(cwd, "baize/ir/IR-002.md", "---\nid: IR-002\n---\n");

  // 白名单是测试里钉死的字面值，不是拿 RULE_DOMAINS 当预言机——
  // 动 src/types.ts 的域清单会红，编辑这份期望必须是有意的。
  const domains = [
    "catalog",
    "coverage",
    "field",
    "id",
    "ref",
    "sr",
    "stage",
    "stale",
  ];
  assert.deepEqual([...RULE_DOMAINS].sort(), domains);

  const result = await run(["validate", "--json"], { cwd });
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  assert.ok(issues.length > 0);
  for (const issue of issues) {
    const domain = issue.rule.split(".")[0] ?? "";
    assert.ok(
      domains.includes(domain) && /^[a-z]+\.[a-z-]+$/.test(issue.rule),
      `rule 必须点分且域在白名单：${issue.rule}`,
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
  // AR 承接（#152），隔离 sr.unallocated
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  // 方案层认领（#181），隔离 sr.unclaimed
  write(cwd, "baize/function-items/FN-001.md", FN_CLAIMING_SR001);
  // IR-002 的 id 格式不合法
  write(
    cwd,
    "baize/ir/IR-002.md",
    LEGAL_IR.replace("id: IR-001", "id: IR-2"),
  );

  // IR 录入门禁（#147）：未确认的链根会让下游条目报 stage.upstream-unconfirmed，先把根认下来
  await acceptAndRead(cwd, "IR-001");

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

// 线索全覆盖变体：#150 起合法仓库要求 IR 的每条线索都有 SR 覆盖（LEGAL_IR 有 a1/a2 两条）。
const LEGAL_SR_FULL = `---
id: SR-001
title: 统一导出服务
parent: IR-001
covers: [IR-001#a1, IR-001#a2]
---

系统应提供统一的导出能力。
`;

// 方案层合法条目（#154；#190 起改用认领边：场景/用例 refines、功能项/功能点 satisfies，
// 不再写 parent）。字段全必填但允许空数组（alternativeFlows: [] = 看过了确实没有）。
const LEGAL_SC = `---
id: SC-001
title: 下单主流程
refines:
  - SR-001
catalog: order-flow
preconditions:
  - 用户已登录
trigger: 用户点击下单
mainFlow:
  - 选择商品并确认
alternativeFlows: []
expectedOutcome: 订单创建成功
stakeholders:
  - 买家
---

场景陈述：买家从选购到下单成功的完整过程。
`;

const LEGAL_UC = `---
id: UC-001
title: 提交订单
refines:
  - SR-001
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
satisfies:
  - SR-001
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
satisfies:
  - SR-001
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

test("validate：ref.orphan —— SR/AR 无 parent 报 ERROR；方案层无认领边报 ERROR；IR 的 parent: null 合法", async (t) => {
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
  // 方案层没有任何认领边 → 孤儿（#190：场景/用例无 refines、功能项/功能点无 satisfies）
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC.replace("refines:\n  - SR-001\n", ""));
  write(cwd, "baize/usecases/UC-001.md", LEGAL_UC.replace("refines:\n  - SR-001\n", ""));
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN.replace("satisfies:\n  - SR-001\n", ""));
  write(cwd, "baize/function-points/FP-001.md", LEGAL_FP.replace("satisfies:\n  - SR-001\n", ""));

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  const orphans = issues.filter((i) => i.rule === "ref.orphan");
  // SR（无父）+ AR（无父）+ SC/UC/FN/FP（无认领边）= 6 条
  assert.equal(orphans.length, 6, result.stdout);
  assert.ok(
    orphans.every(
      (i) => i.level === "ERROR" && i.path !== "baize/ir/IR-001.md",
    ),
    "IR 的 parent: null 不得触发 ref.orphan：" + result.stdout,
  );
  assert.ok(
    orphans.some(
      (i) => i.path === "baize/scenarios/SC-001.md" && i.message.includes("refines"),
    ),
    "场景无认领边应点出 refines：" + result.stdout,
  );
  assert.ok(
    orphans.some(
      (i) => i.path === "baize/function-points/FP-001.md" && i.message.includes("satisfies"),
    ),
    "功能点无认领边应点出 satisfies：" + result.stdout,
  );

  // 反例：补回认领边（SR-001 即使自身是孤儿，也不挡别人认领它）→ 方案层不再报孤儿
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC);
  write(cwd, "baize/usecases/UC-001.md", LEGAL_UC);
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN);
  write(cwd, "baize/function-points/FP-001.md", LEGAL_FP);
  const claimed = await run(["validate", "--json"], { cwd });
  const claimedOrphans = parseJson<ValidateOutput>(claimed.stdout).issues.filter(
    (i) => i.rule === "ref.orphan",
  );
  assert.equal(claimedOrphans.length, 2, claimed.stdout);
  assert.ok(
    claimedOrphans.every((i) => i.path !== "baize/scenarios/SC-001.md"),
    claimed.stdout,
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
  // B1 方向纠偏：IR 输出 confirmed，其余层输出 reviewed
  const out = parseJson<{
    schemaVersion: number;
    confirmed?: Record<string, unknown>;
    reviewed?: Record<string, unknown>;
  }>(accepted.stdout);
  return out.confirmed ?? out.reviewed ?? {};
}

/** 从条目文件文本里抽出 frontmatter（已 YAML 解析）。 */
function frontmatterOf(text: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  assert.ok(match, "条目文件应有 frontmatter");
  return parseYaml(match[1] ?? "") as Record<string, unknown>;
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

  // A2：confirmed 记录的键集合恰好是 by / at / fingerprint 三项（域模型「确认」词条写死）
  const record = frontmatterOf(text)["confirmed"] as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(record).sort(),
    ["at", "by", "fingerprint"],
    "confirmed 只含三项，不得夹带 id 等多余键",
  );

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

test("改出边 covers 后下游复核失效——实质字段含出边（#155 陈旧复用同一份逻辑）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeChain(cwd);
  // B1 后确认只用在 IR 上；「出边算实质字段」改由复核指纹承担：
  // AR-001 accept 时记下上游 SR-001 的实质字段摘要（含 covers）
  await acceptAll(cwd, ["AR-001"]);

  const before = await run(["validate", "--json"], { cwd });
  assert.equal(before.exitCode, 0, before.stdout);
  assert.ok(
    !parseJson<ValidateOutput>(before.stdout).issues.some((i) => i.rule.startsWith("stale.")),
    before.stdout,
  );

  // SR 改 covers（出边是实质字段的一部分）——在盘上现有内容里改
  write(
    cwd,
    "baize/sr/SR-001.md",
    readFileSync(join(cwd, "baize/sr/SR-001.md"), "utf8").replace(
      "covers: [IR-001#a1]",
      "covers: [IR-001#a1, IR-001#a2]",
    ),
  );

  const after = await run(["validate", "--json"], { cwd });
  assert.equal(after.exitCode, 0, after.stdout);
  const stale = parseJson<ValidateOutput>(after.stdout).issues.filter(
    (i) => i.rule === "stale.direct-downstream",
  );
  assert.equal(stale.length, 1, after.stdout);
  assert.equal(stale[0]!.path, "baize/ar/AR-001.md");
  assert.ok(stale[0]!.message.includes("SR-001"), `消息应指出上游 SR-001：${after.stdout}`);
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
  // AR 承接（#152），隔离 sr.unallocated
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  // 方案层认领（#181），隔离 sr.unclaimed
  write(cwd, "baize/function-items/FN-001.md", FN_CLAIMING_SR001);

  // IR 录入门禁（#147）：未确认的链根会让下游条目报 stage.upstream-unconfirmed，先把根认下来
  await acceptAndRead(cwd, "IR-001");

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
    // AR 承接（#152），隔离 sr.unallocated
    write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
    write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
    // 方案层认领（#181），隔离 sr.unclaimed
    write(cwd, "baize/function-items/FN-001.md", FN_CLAIMING_SR001);
    write(cwd, "baize/chains/IR-001.yaml", `skipped:\n  sr:\n${body.split("\n").map((l) => `    ${l}`).join("\n")}`);

    // IR 录入门禁（#147）：未确认的链根会让下游条目报 stage.upstream-unconfirmed，先把根认下来
    await acceptAndRead(cwd, "IR-001");

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
  // AR 承接（#152），隔离 sr.unallocated
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  // 方案层认领（#181），隔离 sr.unclaimed
  write(cwd, "baize/function-items/FN-001.md", FN_CLAIMING_SR001);
  write(
    cwd,
    "baize/chains/IR-001.yaml",
    `skipped:\n  sr:\n${COMPLETE_SKIP.split("\n").map((l) => `    ${l}`).join("\n")}`,
  );
  // IR 录入门禁（#147）：未确认的链根会让下游条目报 stage.upstream-unconfirmed，先把根认下来
  await acceptAndRead(cwd, "IR-001");

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
  // 只有功能拆分门禁留人工通过记录（#156 定形：gates.function-split = by/at/criterion）；
  // IR 录入与 SR→AR 两处门禁由事实算出，不落盘
  write(
    cwd,
    "baize/chains/IR-001.yaml",
    `skipped:
  ar:
    by: crazytomatooo
    at: 2026-10-12
    why: 单 SR 直接对应实现，无需 AR
gates:
  function-split:
    by: crazytomatooo
    at: 2026-10-12
    criterion: 这套功能拆分足以支撑实现；未覆盖的用例与未复核的陈旧已处置。
`,
  );

  const validated = await run(["validate", "--json"], { cwd });
  assert.equal(validated.exitCode, 0, validated.stdout);

  const machine = await run(["status", "--chain", "IR-001", "--json"], { cwd });
  assert.equal(machine.exitCode, 0, machine.stdout);
  const chain = parseJson<ChainOutput>(machine.stdout).chain;
  const stages = chain.stages;
  for (const stage of stages) {
    // 门禁签字不显示为段状态；段视图里没有进度 / 覆盖率 / 陈旧
    assert.ok(!("gate" in stage) && !("gates" in stage), `段 ${stage.stage} 不得含门禁状态`);
    assert.ok(!("progress" in stage) && !("coverage" in stage) && !("stale" in stage));
  }
  const ar = stages.find((s) => s.stage === "ar");
  assert.equal(ar?.skipped?.why, "单 SR 直接对应实现，无需 AR");

  // #156 起 status 呈现门禁（本断言在 #153 是「不得出现」，呈现归本票）
  const human = await run(["status", "--chain", "IR-001"], { cwd });
  assert.ok(human.stdout.includes("门禁"));
  assert.ok(human.stdout.includes("足以支撑实现"));
  assert.ok(human.stdout.includes("crazytomatooo @ 2026-10-12 签字"));
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
});

// ── #154 分析三层与关联边 ─────────────────────────────────────────────

test("new 方案层各自可建：场景/用例/功能项无父边（认领边进骨架），功能点仍挂功能项", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  // 场景不再有父边（parent 只剩「场景挂场景」例外）：骨架带 refines 待填。
  const scenario = await run(["new", "scenario", "--json"], { cwd });
  assert.equal(scenario.exitCode, 0, scenario.stdout);
  assert.equal(parseJson<CreatedOutput>(scenario.stdout).created.id, "SC-001");
  const scText = readFileSync(join(cwd, "baize/scenarios/SC-001.md"), "utf8");
  const scFm = frontmatterOf(scText);
  assert.equal(scFm["id"], "SC-001");
  assert.deepEqual(scFm["refines"], [], "骨架带 refines 待填");
  assert.equal(scFm["parent"], undefined, "场景骨架不再有 parent");
  assert.deepEqual(scFm["alternativeFlows"], [], "备选流与用例统一拼写 alternativeFlows");
  assert.ok(Array.isArray(scFm["preconditions"]));
  assert.equal(typeof scFm["trigger"], "string");
  assert.ok(Array.isArray(scFm["mainFlow"]));
  assert.equal(typeof scFm["expectedOutcome"], "string");
  assert.ok(Array.isArray(scFm["stakeholders"]));
  assert.equal(scFm["alternateFlows"], undefined, "旧拼写不应存在");

  const usecase = await run(["new", "usecase", "--json"], { cwd });
  assert.equal(usecase.exitCode, 0, usecase.stdout);
  assert.equal(parseJson<CreatedOutput>(usecase.stdout).created.id, "UC-001");
  const ucText = readFileSync(join(cwd, "baize/usecases/UC-001.md"), "utf8");
  const ucFm = frontmatterOf(ucText);
  assert.deepEqual(ucFm["refines"], []);
  assert.equal(ucFm["parent"], undefined, "用例不再有父边");
  assert.ok(Array.isArray(ucFm["appearsIn"]));
  assert.equal(typeof ucFm["goal"], "string");
  assert.deepEqual(ucFm["alternativeFlows"], []);
  assert.ok(Array.isArray(ucFm["postconditions"]));

  // 功能项是薄层：title + description，无 statement。
  const fn = await run(["new", "function-item", "--json"], { cwd });
  assert.equal(fn.exitCode, 0, fn.stdout);
  assert.equal(parseJson<CreatedOutput>(fn.stdout).created.id, "FN-001");
  const fnText = readFileSync(join(cwd, "baize/function-items/FN-001.md"), "utf8");
  const fnFm = frontmatterOf(fnText);
  assert.equal(typeof fnFm["title"], "string");
  assert.deepEqual(fnFm["satisfies"], []);
  assert.equal(fnFm["parent"], undefined, "功能项不再有父边");
  assert.equal(typeof fnFm["domain"], "string");
  assert.deepEqual(fnFm["realizes"], []);
  assert.equal(typeof fnFm["description"], "string");
  assert.equal(fnFm["statement"], undefined, "功能项是薄层，不应有 statement");

  // 功能点五项必填；仍挂功能项（功能项 → 功能点是分解树保留边）；无 statement / title。
  const fp = await run(["new", "function-point", "--parent", "FN-001", "--json"], { cwd });
  assert.equal(fp.exitCode, 0, fp.stdout);
  assert.equal(parseJson<CreatedOutput>(fp.stdout).created.id, "FP-001");
  const fpText = readFileSync(join(cwd, "baize/function-points/FP-001.md"), "utf8");
  const fpFm = frontmatterOf(fpText);
  assert.equal(fpFm["parent"], "FN-001");
  assert.deepEqual(fpFm["satisfies"], []);
  assert.equal(typeof fpFm["responsibility"], "string");
  assert.ok(Array.isArray(fpFm["inputs"]));
  assert.ok(Array.isArray(fpFm["outputs"]));
  assert.ok(Array.isArray(fpFm["businessRules"]));
  assert.ok(Array.isArray(fpFm["acceptanceCriteria"]));
  assert.equal(fpFm["statement"], undefined, "功能点无 statement");
  assert.equal(fpFm["title"], undefined, "功能点按契约无 title");
});

test("new 父边规矩（#190）：sr/ar/function-point 缺 --parent → exit 2；usecase/function-item 带 --parent → exit 2", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  for (const layer of ["sr", "ar", "function-point"]) {
    const result = await run(["new", layer, "--json"], { cwd });
    assert.equal(result.exitCode, 2, result.stdout);
    assert.ok(parseJson<ErrorOutput>(result.stdout).error.rule);
  }
  for (const layer of ["usecase", "function-item"]) {
    const result = await run(["new", layer, "--parent", "SR-001", "--json"], { cwd });
    assert.equal(result.exitCode, 2, `${layer} 没有父边，--parent 应被拒：${result.stdout}`);
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

  const result = await run(["new", "usecase", "--appears-in", "SC-001,SC-002"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  const text = readFileSync(join(cwd, "baize/usecases/UC-001.md"), "utf8");
  assert.match(text, /^appearsIn:\s*$/m);
  assert.match(text, /^\s+- SC-001$/m);
  assert.match(text, /^\s+- SC-002$/m);
});

test("new function-item --realizes UC-001,UC-002 写入数组（一个功能项服务多条用例）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const result = await run(["new", "function-item", "--realizes", "UC-001,UC-002"], { cwd });
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
    ["new", "scenario", "--appears-in", "SC-001"],
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

test("new scenario --catalog order-flow 写入 catalog（parent 只剩「场景挂场景」可选例外）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const result = await run(["new", "scenario", "--catalog", "order-flow"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  const text = readFileSync(join(cwd, "baize/scenarios/SC-001.md"), "utf8");
  const fm = frontmatterOf(text);
  assert.equal(fm["id"], "SC-001");
  assert.equal(fm["catalog"], "order-flow");
  assert.equal(fm["parent"], undefined, "顶层场景无父边");

  // 子场景仍可用 --parent 挂场景（#190 保留的唯一方案层父边）
  const child = await run(["new", "scenario", "--parent", "SC-001", "--json"], { cwd });
  assert.equal(child.exitCode, 0, child.stdout);
  const childText = readFileSync(join(cwd, "baize/scenarios/SC-002.md"), "utf8");
  assert.equal(frontmatterOf(childText)["parent"], "SC-001", "子场景挂场景");
});

test("new scenario 无 --parent 也可建（场景不再有必挂的父边）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const result = await run(["new", "scenario", "--catalog", "order-flow"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  assert.ok(existsSync(join(cwd, "baize/scenarios/SC-001.md")));
});

test("new ar --parent SR-001 --allocates export-service 写入标量 allocates（不是数组）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const result = await run(["new", "ar", "--parent", "SR-001", "--allocates", "export-service"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  const text = readFileSync(join(cwd, "baize/ar/AR-001.md"), "utf8");
  assert.match(text, /^allocates: export-service$/m, "allocates 应是标量字符串");
  assert.doesNotMatch(text, /^\\s*- export-service$/m, "allocates 不应写成数组");
});

test("new 拒绝张冠李戴的选项：--catalog 只给 scenario、--allocates 只给 ar", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const badCatalog = await run(["new", "sr", "--parent", "IR-001", "--catalog", "order-flow"], { cwd });
  assert.equal(badCatalog.exitCode, 2);

  const badAllocates = await run(["new", "ir", "--allocates", "export-service"], { cwd });
  assert.equal(badAllocates.exitCode, 2);
  assert.equal(existsSync(join(cwd, "baize/ir/IR-001.md")), false);
});

test("validate：ref.unknown-element —— AR 的 allocates 指向清单里没有的组件时报 ERROR；存在的 slug（含带额外字段的）不报", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  write(
    cwd,
    "baize/ar/AR-001.md",
    LEGAL_AR.replace("allocates: export-service", "allocates: ghost-service"),
  );
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  // 方案层认领（#181），隔离 sr.unclaimed
  write(cwd, "baize/function-items/FN-001.md", FN_CLAIMING_SR001);

  // IR 录入门禁（#147）：未确认的链根会让下游条目报 stage.upstream-unconfirmed，先把根认下来
  await acceptAndRead(cwd, "IR-001");

  const bad = await run(["validate", "--json"], { cwd });
  assert.equal(bad.exitCode, 1, bad.stdout);
  const badIssues = parseJson<ValidateOutput>(bad.stdout).issues;
  assert.ok(
    badIssues.some((issue) => issue.rule === "ref.unknown-element" && issue.level === "ERROR"),
    `应报 ref.unknown-element：${JSON.stringify(badIssues)}`,
  );

  // audit-log 的值里有额外字段（owner），按统一约定忽略——引用它仍合法。
  write(
    cwd,
    "baize/ar/AR-001.md",
    LEGAL_AR.replace("allocates: export-service", "allocates: audit-log"),
  );
  const good = await run(["validate", "--json"], { cwd });
  assert.equal(good.exitCode, 0, good.stdout);
  assert.deepEqual(parseJson<ValidateOutput>(good.stdout).issues, []);
});

test("validate：ref.parent-not-allowed —— 父条目存在但不是本层分解树允许的上层", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFullChain(cwd);

  // 功能点挂在 IR 上（应挂功能项）→ ERROR
  write(
    cwd,
    "baize/function-points/FP-001.md",
    LEGAL_FP.replace("parent: FN-001", "parent: IR-001"),
  );
  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues.filter(
    (i) => i.rule === "ref.parent-not-allowed",
  );
  assert.equal(issues.length, 1, result.stdout);
  assert.equal(issues[0]!.path, "baize/function-points/FP-001.md");
  assert.ok(
    issues[0]!.message.includes("IR-001") && issues[0]!.message.includes("功能项"),
    `消息应说明功能点的上层应是功能项：${result.stdout}`,
  );

  // SR 挂 SR 同样报
  write(cwd, "baize/function-points/FP-001.md", LEGAL_FP);
  write(
    cwd,
    "baize/sr/SR-002.md",
    LEGAL_SR.replace("id: SR-001", "id: SR-002").replace("parent: IR-001", "parent: SR-001"),
  );
  const srUnderSr = await run(["validate", "--json"], { cwd });
  assert.ok(
    parseJson<ValidateOutput>(srUnderSr.stdout).issues.some(
      (i) => i.rule === "ref.parent-not-allowed" && i.path === "baize/sr/SR-002.md",
    ),
    `SR 的上层只能是 IR：${srUnderSr.stdout}`,
  );
  rmSync(join(cwd, "baize/sr/SR-002.md"));

  // IR 是链顶端，挂父也报
  const irWithParent = LEGAL_IR.replace("id: IR-001", "id: IR-002").replace(
    "parent: null",
    "parent: SR-001",
  );
  write(cwd, "baize/ir/IR-002.md", irWithParent);
  const irResult = await run(["validate", "--json"], { cwd });
  assert.ok(
    parseJson<ValidateOutput>(irResult.stdout).issues.some(
      (i) => i.rule === "ref.parent-not-allowed" && i.path === "baize/ir/IR-002.md",
    ),
    `IR 是链顶端，不允许有上层：${irResult.stdout}`,
  );
  rmSync(join(cwd, "baize/ir/IR-002.md"));

  // 场景挂场景是 #190 明确保留的例外 → 不报
  write(
    cwd,
    "baize/scenarios/SC-002.md",
    LEGAL_SC.replace("id: SC-001", "id: SC-002").replace(
      "catalog: order-flow",
      "parent: SC-001\ncatalog: order-flow",
    ),
  );
  const scUnderSc = await run(["validate", "--json"], { cwd });
  assert.ok(
    !parseJson<ValidateOutput>(scUnderSc.stdout).issues.some(
      (i) => i.rule === "ref.parent-not-allowed" && i.path === "baize/scenarios/SC-002.md",
    ),
    `场景挂场景不应报（能表达 ≠ 必须分级）：${scUnderSc.stdout}`,
  );

  // 用例再挂 SR（旧模型写法）→ parent-not-allowed（用例无父边，改用 refines 认领）
  write(
    cwd,
    "baize/usecases/UC-002.md",
    LEGAL_UC.replace("id: UC-001", "id: UC-002").replace(
      "appearsIn:",
      "parent: SR-001\nappearsIn:",
    ),
  );
  const ucUnderSr = await run(["validate", "--json"], { cwd });
  const ucViolation = parseJson<ValidateOutput>(ucUnderSr.stdout).issues.find(
    (i) => i.rule === "ref.parent-not-allowed" && i.path === "baize/usecases/UC-002.md",
  );
  assert.ok(ucViolation, `用例挂 SR 应报：${ucUnderSr.stdout}`);
  assert.ok(
    ucViolation.message.includes("refines"),
    `消息应点出认领边：${ucUnderSr.stdout}`,
  );
});

test("validate：allocates 必须是恰好一个组件 slug（标量）——数组/空串不再静默通过", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);

  // 手写数组（哪怕元素是清单里的合法 slug）→ 报 ref.unknown-element 的形状分支
  write(
    cwd,
    "baize/ar/AR-001.md",
    LEGAL_AR.replace("allocates: export-service", "allocates: [export-service]"),
  );
  const array = await run(["validate", "--json"], { cwd });
  assert.equal(array.exitCode, 1, array.stdout);
  const arrayIssues = parseJson<ValidateOutput>(array.stdout).issues.filter(
    (i) => i.rule === "ref.unknown-element",
  );
  assert.equal(arrayIssues.length, 1, array.stdout);
  assert.ok(
    arrayIssues[0]!.message.includes("标量"),
    `消息应说明必须是标量：${array.stdout}`,
  );

  // 空串同样是「不是恰好一个 slug」
  write(
    cwd,
    "baize/ar/AR-001.md",
    LEGAL_AR.replace("allocates: export-service", 'allocates: ""'),
  );
  const blank = await run(["validate", "--json"], { cwd });
  assert.equal(blank.exitCode, 1, blank.stdout);
  assert.ok(
    parseJson<ValidateOutput>(blank.stdout).issues.some(
      (i) => i.rule === "ref.unknown-element",
    ),
    `空串 allocates 不应静默通过：${blank.stdout}`,
  );

  // 标量 + 清单里的 slug → 全绿
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  const clean = await run(["validate", "--json"], { cwd });
  assert.equal(clean.exitCode, 0, clean.stdout);
});

test("validate：ref.unknown-catalog —— scenario 的 catalog 不在词表里时报 ERROR", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);

  write(
    cwd,
    "baize/scenarios/SC-001.md",
    LEGAL_SCENARIO.replace("catalog: order-flow", "catalog: no-such-catalog"),
  );
  const bad = await run(["validate", "--json"], { cwd });
  assert.equal(bad.exitCode, 1, bad.stdout);
  const badIssues = parseJson<ValidateOutput>(bad.stdout).issues;
  assert.ok(
    badIssues.some((issue) => issue.rule === "ref.unknown-catalog" && issue.level === "ERROR"),
    `应报 ref.unknown-catalog：${JSON.stringify(badIssues)}`,
  );

  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SCENARIO);
  const good = await run(["validate", "--json"], { cwd });
  assert.equal(good.exitCode, 0, good.stdout);
});

test("validate：受控清单读配定的顶层键——先出现的其它映射键不会被误当清单", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_FOREIGN_FIRST);
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_FOREIGN_FIRST);

  // 配定顶层键（components / catalogs）下的 slug 可引用：链是绿的
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SCENARIO);
  const good = await run(["validate", "--json"], { cwd });
  assert.equal(good.exitCode, 0, good.stdout);

  // 引用别的映射键里的 slug（metadata.owner）→ 两个 ref.* 都要报：顶层键配定后 owner 不在任何清单里
  write(
    cwd,
    "baize/ar/AR-001.md",
    LEGAL_AR.replace("allocates: export-service", "allocates: owner"),
  );
  write(
    cwd,
    "baize/scenarios/SC-001.md",
    LEGAL_SCENARIO.replace("catalog: order-flow", "catalog: owner"),
  );
  const bad = await run(["validate", "--json"], { cwd });
  assert.equal(bad.exitCode, 1, bad.stdout);
  const issues = parseJson<ValidateOutput>(bad.stdout).issues;
  assert.ok(
    issues.some((i) => i.rule === "ref.unknown-element" && i.message.includes("owner")),
    `metadata 里的 owner 不是组件：${bad.stdout}`,
  );
  assert.ok(
    issues.some((i) => i.rule === "ref.unknown-catalog" && i.message.includes("owner")),
    `metadata 里的 owner 不是场景目录：${bad.stdout}`,
  );
});

test("validate：sr.unallocated —— 没有 AR 挂上的 SR 报 WARNING；有 AR 则不报", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  // 方案层认领（#181），隔离 sr.unclaimed——本用例只看 sr.unallocated
  write(cwd, "baize/function-items/FN-001.md", FN_CLAIMING_SR001);

  // IR 录入门禁（#147）：未确认的链根会让下游条目报 stage.upstream-unconfirmed，先把根认下来
  await acceptAndRead(cwd, "IR-001");

  const unallocated = await run(["validate", "--json"], { cwd });
  assert.equal(unallocated.exitCode, 0, "WARNING 不挡 exit code");
  const issues = parseJson<ValidateOutput>(unallocated.stdout).issues;
  assert.deepEqual(
    issues.map((issue) => issue.rule),
    ["sr.unallocated"],
  );
  assert.equal(issues[0]?.level, "WARNING");

  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  const allocated = await run(["validate", "--json"], { cwd });
  assert.equal(allocated.exitCode, 0, allocated.stdout);
  assert.deepEqual(parseJson<ValidateOutput>(allocated.stdout).issues, []);
});

test("validate --strict 把 WARNING（sr.unallocated）也算失败（exit 1）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);

  const lax = await run(["validate"], { cwd });
  assert.equal(lax.exitCode, 0);

  const strict = await run(["validate", "--strict"], { cwd });
  assert.equal(strict.exitCode, 1);
});

test("受控清单不是条目：清单项不会被报成孤儿（回归）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SCENARIO);
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);

  // IR 录入门禁（#147）：未确认的链根会让下游条目报 stage.upstream-unconfirmed，先把根认下来
  await acceptAndRead(cwd, "IR-001");

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  assert.ok(
    !issues.some((issue) => issue.rule === "ref.orphan"),
    `清单项不应被报成孤儿：${JSON.stringify(issues)}`,
  );
  assert.deepEqual(issues, []);
});

// —— 陈旧：指纹比对、传播与分级（#155）——

const AR_UNDER_SR001 = `---
id: AR-001
title: 导出服务架构
parent: SR-001
allocates: export-service
---

导出能力的架构决策。
`;

const SR2_UNDER_IR001 = `---
id: SR-002
title: 导出权限控制
parent: IR-001
covers: [IR-001#a2]
---

谁可以导出、导出什么范围。
`;

/** 铺 IR-001 → SR-001 → AR-001 与 IR-001 → SR-002 两条路径。 */
function writeChain(cwd: string): void {
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", SR_WITH_COVERS);
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", AR_UNDER_SR001);
  write(cwd, "baize/sr/SR-002.md", SR2_UNDER_IR001);
}

/** 只改上游 IR-001 的 statement（实质字段）。 */
function changeIrStatement(cwd: string): void {
  const text = readFileSync(join(cwd, "baize/ir/IR-001.md"), "utf8");
  const changed = text.replace(
    "产品要求用户能把数据带走，不能锁死在系统里。",
    "产品要求用户能把数据带走，格式由用户自选。",
  );
  assert.notEqual(changed, text, "本用例必须真的改掉 statement");
  write(cwd, "baize/ir/IR-001.md", changed);
}

async function acceptAll(cwd: string, ids: string[]): Promise<void> {
  for (const id of ids) await acceptAndRead(cwd, id);
}

interface AcceptedOutput {
  schemaVersion: number;
  /** B1：IR 上是 confirmed；其余层是 reviewed（确认只用在 IR 上）。 */
  confirmed?: {
    kind: "confirmed";
    id: string;
    by: string;
    at: string;
    fingerprint: string;
    reviewed: Record<string, string>;
  };
  reviewed?: {
    kind: "reviewed";
    id: string;
    by: string;
    at: string;
    reviewed: Record<string, string>;
  };
}

test("accept SR-001 对上游写 reviewed；非 IR 不写 confirmed（方向纠偏）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", SR_WITH_COVERS);

  const result = await run(["accept", "SR-001", "--json"], { cwd, now: FIXED_NOW });
  assert.equal(result.exitCode, 0, result.stdout);
  const out = parseJson<AcceptedOutput>(result.stdout);
  assert.ok(out.confirmed === undefined, "非 IR 的 accept 不得再输出 confirmed");
  const reviewedOut = out.reviewed!;
  assert.equal(reviewedOut.kind, "reviewed");
  assert.equal(reviewedOut.id, "SR-001");
  assert.equal(reviewedOut.by, "alice");
  assert.equal(reviewedOut.at, FIXED_NOW);
  const reviewed = reviewedOut.reviewed;
  assert.deepEqual(Object.keys(reviewed), ["IR-001"], "上游集合 = parent（单亲分解树）");
  assert.match(reviewed["IR-001"] ?? "", /^[0-9a-f]{64}$/);

  // 落盘：只有 reviewed，没有 confirmed；上游 IR-001 文件不被反向改写
  const srText = readFileSync(join(cwd, "baize/sr/SR-001.md"), "utf8");
  assert.match(srText, /^reviewed:/m);
  assert.match(srText, /^  IR-001: [0-9a-f]{64}$/m);
  assert.ok(!/^confirmed:/m.test(srText), "确认只用在 IR 上，非 IR 不写 confirmed");
  const irText = readFileSync(join(cwd, "baize/ir/IR-001.md"), "utf8");
  assert.ok(!/^reviewed:/m.test(irText), "上游文件不写反向关系（目录是位置、边是语义）");

  // 人读输出与 JSON 同源：已复核（不是「已确认」）
  const human = await run(["accept", "SR-001"], { cwd, now: FIXED_NOW });
  assert.equal(human.exitCode, 0, human.stdout);
  assert.match(human.stdout, /已复核 SR-001：alice/);
  assert.ok(!/已确认/.test(human.stdout), "非 IR 的人读输出不得说「已确认」");

  // reviewed 记的是上游当前实质字段摘要：改 IR 的 title（非实质字段）后重 accept，摘要不变
  const before = reviewed["IR-001"];
  write(
    cwd,
    "baize/ir/IR-001.md",
    irText.replace("title: 支持用户数据导出", "title: 数据导出（改名了）"),
  );
  const again = parseJson<AcceptedOutput>(
    (await run(["accept", "SR-001", "--json"], { cwd, now: FIXED_NOW })).stdout,
  ).reviewed!;
  assert.equal(again.reviewed["IR-001"], before, "title 不进实质字段，复核指纹不变");
});

test("accept 链顶端（IR 无 parent）不写 reviewed", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);

  const result = await run(["accept", "IR-001", "--json"], { cwd, now: FIXED_NOW });
  assert.equal(result.exitCode, 0, result.stdout);
  assert.deepEqual(parseJson<AcceptedOutput>(result.stdout).confirmed?.reviewed, {});
  const text = readFileSync(join(cwd, "baize/ir/IR-001.md"), "utf8");
  assert.match(text, /^confirmed:/m);
  assert.ok(!/^reviewed:/m.test(text), "链顶端没有上游，不写 reviewed");
});

test("stale.direct-downstream：上游实质字段被改后报 WARNING，exit 0；--strict 升级为失败", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeChain(cwd);
  await acceptAll(cwd, ["SR-001", "AR-001", "SR-002"]);
  changeIrStatement(cwd);

  const loose = await run(["validate", "--json"], { cwd });
  assert.equal(loose.exitCode, 0, loose.stdout);
  const issues = parseJson<ValidateOutput>(loose.stdout).issues;
  const direct = issues.filter((issue) => issue.rule === "stale.direct-downstream");
  assert.deepEqual(
    direct.map((issue) => issue.level),
    ["WARNING", "WARNING"],
  );
  assert.deepEqual(
    direct.map((issue) => issue.path).sort(),
    ["baize/sr/SR-001.md", "baize/sr/SR-002.md"],
  );

  const human = await run(["validate"], { cwd });
  assert.equal(human.exitCode, 0, human.stdout);
  for (const issue of direct) {
    assert.ok(human.stdout.includes(issue.rule), human.stdout);
    assert.ok(human.stdout.includes(issue.message), human.stdout);
  }

  const strict = await run(["validate", "--strict", "--json"], { cwd });
  assert.equal(strict.exitCode, 1, strict.stdout);
  assert.deepEqual(parseJson<ValidateOutput>(strict.stdout).issues, issues);
});

test("陈旧不会自己消失：重复 validate 结果一致，且上下游关系现算不落盘", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeChain(cwd);
  await acceptAll(cwd, ["SR-001", "AR-001", "SR-002"]);
  changeIrStatement(cwd);

  const snapshot = (rel: string) => readFileSync(join(cwd, rel), "utf8");
  const srBefore = snapshot("baize/sr/SR-001.md");
  const arBefore = snapshot("baize/ar/AR-001.md");

  const first = await run(["validate", "--json"], { cwd });
  const second = await run(["validate", "--json"], { cwd });
  assert.equal(first.exitCode, 0, first.stdout);
  assert.deepEqual(
    parseJson<ValidateOutput>(second.stdout).issues,
    parseJson<ValidateOutput>(first.stdout).issues,
    "陈旧现算、不落盘，不会自己消失",
  );
  assert.equal(snapshot("baize/sr/SR-001.md"), srBefore, "validate 不改写条目文件");
  assert.equal(snapshot("baize/ar/AR-001.md"), arBefore, "validate 不改写条目文件");
});

test("未复核过不算陈旧：没有 reviewed 记录就没有「又变了」", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeChain(cwd);
  changeIrStatement(cwd); // 从未 accept 过任何条目

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  assert.ok(
    issues.every((issue) => !issue.rule.startsWith("stale.")),
    `未复核的下游不应报陈旧：${JSON.stringify(issues)}`,
  );
});

test("缺清单文件 = 空清单，不是错误：不引用清单的仓 exit 0；引用了 slug 而清单缺失时报 unknown", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  // 方案层认领（#181），隔离 sr.unclaimed
  write(cwd, "baize/function-items/FN-001.md", FN_CLAIMING_SR001);

  // 没有 baize/architecture.yaml 且仓里没有引用：清单缺失本身不是错误
  // （唯一的 sr.unallocated 是 WARNING，不挡 exit code）。
  // IR 录入门禁（#147）：未确认的链根会让下游条目报 stage.upstream-unconfirmed，先把根认下来
  await acceptAndRead(cwd, "IR-001");

  const plain = await run(["validate", "--json"], { cwd });
  assert.equal(plain.exitCode, 0, plain.stdout);

  // 引用了 slug 而清单缺失（= 空清单）→ 只有 ref.unknown-element 一条。
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  const referenced = await run(["validate", "--json"], { cwd });
  assert.equal(referenced.exitCode, 1, referenced.stdout);
  assert.deepEqual(
    parseJson<ValidateOutput>(referenced.stdout).issues.map((issue) => issue.rule),
    ["ref.unknown-element"],
  );
});

test("validate：ref.unknown-target —— appearsIn / realizes 指向不存在的条目 → ERROR", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC);
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);
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

  // 指向存在的条目则不报本 rule；补齐线索覆盖（#150）后全绿
  write(cwd, "baize/usecases/UC-001.md", LEGAL_UC);
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN);
  write(cwd, "baize/sr/SR-002.md", srWithCovers("SR-002", "IR-001#a2"));
  const clean = await run(["validate", "--json"], { cwd });
  assert.equal(clean.exitCode, 0, clean.stdout);
  assert.ok(
    !parseJson<ValidateOutput>(clean.stdout).issues.some(
      (i) => i.rule === "ref.unknown-target",
    ),
    clean.stdout,
  );
});

test("validate：ref.unknown-target 也判目标层——appearsIn 必须指向场景、realizes 必须指向用例", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC);
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);

  // 目标存在但层不对：用例 appearsIn 指向 IR（不是场景）→ ERROR
  write(
    cwd,
    "baize/usecases/UC-001.md",
    LEGAL_UC.replace("  - SC-001", "  - IR-001"),
  );
  const uc = await run(["validate", "--json"], { cwd });
  assert.equal(uc.exitCode, 1, uc.stdout);
  const ucIssues = parseJson<ValidateOutput>(uc.stdout).issues.filter(
    (i) => i.rule === "ref.unknown-target",
  );
  assert.equal(ucIssues.length, 1, uc.stdout);
  assert.ok(
    ucIssues[0]!.message.includes("不是场景") && ucIssues[0]!.message.includes("IR-001"),
    `消息应说明目标不是场景：${uc.stdout}`,
  );

  // 功能项 realizes 指向场景（不是用例）→ ERROR
  write(cwd, "baize/usecases/UC-001.md", LEGAL_UC);
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN.replace("  - UC-001", "  - SC-001"));
  const fn = await run(["validate", "--json"], { cwd });
  assert.equal(fn.exitCode, 1, fn.stdout);
  const fnIssues = parseJson<ValidateOutput>(fn.stdout).issues.filter(
    (i) => i.rule === "ref.unknown-target",
  );
  assert.equal(fnIssues.length, 1, fn.stdout);
  assert.ok(
    fnIssues[0]!.message.includes("不是用例") && fnIssues[0]!.message.includes("SC-001"),
    `消息应说明目标不是用例：${fn.stdout}`,
  );

  // 改回正确的层 → 不再报本 rule
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN);
  const clean = await run(["validate", "--json"], { cwd });
  assert.ok(
    !parseJson<ValidateOutput>(clean.stdout).issues.some(
      (i) => i.rule === "ref.unknown-target",
    ),
    clean.stdout,
  );
});

test("validate：认领边（refines / satisfies）也走 ref.unknown-target——存在、且必须是 SR", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC);
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);

  // 反例：指向不存在的 SR
  write(cwd, "baize/usecases/UC-001.md", LEGAL_UC.replace("  - SR-001", "  - SR-999"));
  const missing = await run(["validate", "--json"], { cwd });
  assert.equal(missing.exitCode, 1, missing.stdout);
  const missingIssues = parseJson<ValidateOutput>(missing.stdout).issues.filter(
    (i) => i.rule === "ref.unknown-target" && i.path === "baize/usecases/UC-001.md",
  );
  assert.equal(missingIssues.length, 1, missing.stdout);
  assert.ok(missingIssues[0]!.message.includes("SR-999"), missing.stdout);

  // 正例（层不对）：refines 指向场景（不是 SR）→ ERROR；satisfies 指向用例 → ERROR
  write(cwd, "baize/usecases/UC-001.md", LEGAL_UC.replace("  - SR-001", "  - SC-001"));
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN.replace("  - SR-001", "  - UC-001"));
  const wrongLayer = await run(["validate", "--json"], { cwd });
  assert.equal(wrongLayer.exitCode, 1, wrongLayer.stdout);
  const wrongLayerIssues = parseJson<ValidateOutput>(wrongLayer.stdout).issues.filter(
    (i) => i.rule === "ref.unknown-target",
  );
  assert.ok(
    wrongLayerIssues.some(
      (i) =>
        i.path === "baize/usecases/UC-001.md" &&
        i.message.includes("refines") &&
        i.message.includes("系统需求"),
    ),
    `refines 指错层应报：${wrongLayer.stdout}`,
  );
  assert.ok(
    wrongLayerIssues.some(
      (i) =>
        i.path === "baize/function-items/FN-001.md" &&
        i.message.includes("satisfies") &&
        i.message.includes("系统需求"),
    ),
    `satisfies 指错层应报：${wrongLayer.stdout}`,
  );

  // 改回 SR → 不再报本 rule
  write(cwd, "baize/usecases/UC-001.md", LEGAL_UC);
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN);
  const clean = await run(["validate", "--json"], { cwd });
  assert.ok(
    !parseJson<ValidateOutput>(clean.stdout).issues.some(
      (i) => i.rule === "ref.unknown-target",
    ),
    clean.stdout,
  );
});

test("validate：ref.cross-edge-break —— 功能项认领的 SR 与用例认领的 SR 完全不相交报 ERROR；有交集不报", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  // SR-002 也挂在 IR-001 下（跨需求复用才需要第二条 SR）
  write(cwd, "baize/sr/SR-002.md", srWithCovers("SR-002", "IR-001#a1, IR-001#a2"));
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC);
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  write(cwd, "baize/usecases/UC-001.md", LEGAL_UC);
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN);

  // IR 录入门禁（#147）：未确认的链根会让下游条目报 stage.upstream-unconfirmed，先把根认下来
  await acceptAndRead(cwd, "IR-001");

  // 反例：FN 只认领 SR-002，UC 只认领 SR-001 → 完全不相交（断链）
  write(
    cwd,
    "baize/function-items/FN-001.md",
    LEGAL_FN.replace("  - SR-001", "  - SR-002"),
  );
  const broken = await run(["validate", "--json"], { cwd });
  assert.equal(broken.exitCode, 1, broken.stdout);
  const breaks = parseJson<ValidateOutput>(broken.stdout).issues.filter(
    (i) => i.rule === "ref.cross-edge-break",
  );
  assert.equal(breaks.length, 1, broken.stdout);
  assert.equal(breaks[0]!.level, "ERROR");
  assert.equal(breaks[0]!.path, "baize/function-items/FN-001.md");
  assert.ok(
    breaks[0]!.message.includes("SR-002") && breaks[0]!.message.includes("SR-001"),
    `消息应点出两侧认领的 SR：${broken.stdout}`,
  );

  // 正例：FN 认领的 SR-002 ∩ UC 认领的 SR-001 之外，再让 UC 同时认领 SR-002（多值）→ 相交，不报
  write(
    cwd,
    "baize/usecases/UC-001.md",
    LEGAL_UC.replace("refines:\n  - SR-001", "refines:\n  - SR-001\n  - SR-002"),
  );
  const crossed = await run(["validate", "--json"], { cwd });
  assert.equal(crossed.exitCode, 0, crossed.stdout);
  assert.ok(
    !parseJson<ValidateOutput>(crossed.stdout).issues.some(
      (i) => i.rule === "ref.cross-edge-break",
    ),
    crossed.stdout,
  );

  // 功能项没有 realizes（功能侧还没承载任何用例）→ 不报本 rule（由 ref.orphan /
  // coverage.unrealized-usecase 各管各的）
  write(
    cwd,
    "baize/function-items/FN-001.md",
    LEGAL_FN.replace("  - SR-001", "  - SR-002").replace("realizes:\n  - UC-001\n", ""),
  );
  const noRealizes = await run(["validate", "--json"], { cwd });
  assert.ok(
    !parseJson<ValidateOutput>(noRealizes.stdout).issues.some(
      (i) => i.rule === "ref.cross-edge-break",
    ),
    noRealizes.stdout,
  );
});

test("validate：一条用例可同时认领多条 SR（refines 多值正例，#190 user story 2）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  write(cwd, "baize/sr/SR-002.md", srWithCovers("SR-002", "IR-001#a1, IR-001#a2"));
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC);
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  // SR-002 也要有 AR 承接，隔离 sr.unallocated
  write(
    cwd,
    "baize/ar/AR-002.md",
    LEGAL_AR.replace("id: AR-001", "id: AR-002").replace("parent: SR-001", "parent: SR-002"),
  );
  write(
    cwd,
    "baize/usecases/UC-001.md",
    LEGAL_UC.replace("refines:\n  - SR-001", "refines:\n  - SR-001\n  - SR-002"),
  );
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN);

  // IR 录入门禁（#147）：未确认的链根会让下游条目报 stage.upstream-unconfirmed，先把根认下来
  await acceptAndRead(cwd, "IR-001");

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  assert.equal(parseJson<ValidateOutput>(result.stdout).issues.length, 0, result.stdout);
});

test("validate：covers: [] 合法（不报 field/ref），缺 covers 字段走 field.absent——两条 rule 不混", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", IR_TWO_CLUES);
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", ""));
  // AR 承接（#152），隔离 sr.unallocated——本测试只验 covers 的 field/ref 行为
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  // 方案层认领（#181），隔离 sr.unclaimed——SR 路径上不得有任何无关 rule
  write(cwd, "baize/function-items/FN-001.md", FN_CLAIMING_SR001);

  // covers: [] —— SR 自身没有任何 field/ref 问题；覆盖率另算（两条线索都没人覆盖）
  // IR 录入门禁（#147）：未确认的链根会让下游条目报 stage.upstream-unconfirmed，先把根认下来
  await acceptAndRead(cwd, "IR-001");

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

test("validate：coverage.unrealized-usecase —— 未被任何功能项 realizes 的用例 → ERROR", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC);
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  write(cwd, "baize/usecases/UC-001.md", LEGAL_UC);
  const legalUc2 = LEGAL_UC.replace("id: UC-001", "id: UC-002").replace(
    "title: 提交订单",
    "title: 取消订单",
  );
  write(cwd, "baize/usecases/UC-002.md", legalUc2);
  // FN-001 只 realizes UC-001；UC-002 无人承载
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN);

  // IR 录入门禁（#147）：未确认的链根会让下游条目报 stage.upstream-unconfirmed，先把根认下来
  await acceptAndRead(cwd, "IR-001");

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  const unrealized = issues.filter((i) => i.rule === "coverage.unrealized-usecase");
  assert.equal(unrealized.length, 1, result.stdout);
  assert.equal(unrealized[0]!.level, "ERROR");
  assert.equal(unrealized[0]!.path, "baize/usecases/UC-002.md");
  assert.ok(unrealized[0]!.message.includes("UC-002"), "message 应指出是哪个用例");

  // 补上 realizes 后全绿；线索覆盖已由 SR-001（LEGAL_SR_FULL）补齐
  write(
    cwd,
    "baize/function-items/FN-001.md",
    LEGAL_FN.replace("realizes:\n  - UC-001", "realizes:\n  - UC-001\n  - UC-002"),
  );
  const clean = await run(["validate", "--json"], { cwd });
  assert.equal(clean.exitCode, 0, clean.stdout);
  assert.equal(parseJson<ValidateOutput>(clean.stdout).issues.length, 0, clean.stdout);
});

test("validate：场景/用例字段全必填但允许空数组 —— 场景缺 alternativeFlows 报 field.absent，空数组不报错（#190 与用例统一拼写）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR);
  // 场景整段缺 alternativeFlows；用例整段缺 alternativeFlows
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC.replace("alternativeFlows: []\n", ""));
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);
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
      (i) => i.path === "baize/scenarios/SC-001.md" && i.message.includes("alternativeFlows"),
    ),
    "场景缺 alternativeFlows 应报 field.absent：" + result.stdout,
  );
  assert.ok(
    absent.some(
      (i) =>
        i.path === "baize/usecases/UC-001.md" && i.message.includes("alternativeFlows"),
    ),
    "用例缺 alternativeFlows 应报 field.absent：" + result.stdout,
  );

  // 空数组合法：[] = 看过了确实没有。补回空数组并配齐 realizes 与线索覆盖（#150）使全仓全绿
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC);
  write(cwd, "baize/usecases/UC-001.md", LEGAL_UC);
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN);
  write(cwd, "baize/sr/SR-002.md", srWithCovers("SR-002", "IR-001#a2"));
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

test("validate：场景/用例的正文 statement 不必填——必填止于字段 schema（#190 起方案层无父边，用认领边认领 SR）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFullChain(cwd);
  // 六项齐备、正文为空：statement 词条是「需求」的陈述，分析层不强求
  write(
    cwd,
    "baize/scenarios/SC-001.md",
    LEGAL_SC.replace("场景陈述：买家从选购到下单成功的完整过程。", ""),
  );
  write(
    cwd,
    "baize/usecases/UC-001.md",
    LEGAL_UC.replace("用例陈述：买家提交购物车，系统生成订单。", ""),
  );

  // IR 录入门禁（#147）：未确认的链根会让下游条目报 stage.upstream-unconfirmed，先把根认下来
  await acceptAndRead(cwd, "IR-001");

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  assert.deepEqual(
    parseJson<ValidateOutput>(result.stdout).issues,
    [],
    "空正文不是场景/用例的缺陷：" + result.stdout,
  );

  // 放松的只是正文 statement：六项里缺 trigger 仍报 field.absent
  write(
    cwd,
    "baize/scenarios/SC-001.md",
    LEGAL_SC.replace("trigger: 用户点击下单\n", ""),
  );
  const missing = await run(["validate", "--json"], { cwd });
  assert.equal(missing.exitCode, 1, missing.stdout);
  assert.ok(
    parseJson<ValidateOutput>(missing.stdout).issues.some(
      (i) =>
        i.rule === "field.absent" &&
        i.path === "baize/scenarios/SC-001.md" &&
        i.message.includes("trigger"),
    ),
    `六项必填不受影响：${missing.stdout}`,
  );
});

test("上游只改 title 不产生陈旧（title 不在实质字段清单）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeChain(cwd);
  await acceptAll(cwd, ["SR-001", "AR-001", "SR-002"]);

  const text = readFileSync(join(cwd, "baize/ir/IR-001.md"), "utf8");
  write(
    cwd,
    "baize/ir/IR-001.md",
    text.replace("title: 支持用户数据导出", "title: 数据导出（改名了）\npriority: high"),
  );

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  assert.ok(
    issues.every((issue) => !issue.rule.startsWith("stale.")),
    `title/priority 非实质字段，不应产生陈旧：${JSON.stringify(issues)}`,
  );
});

test("重新 accept 按现版复核：陈旧比对恢复一致", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeChain(cwd);
  await acceptAll(cwd, ["SR-001", "AR-001", "SR-002"]);
  changeIrStatement(cwd);

  const stale = await run(["validate", "--json"], { cwd });
  assert.ok(
    parseJson<ValidateOutput>(stale.stdout).issues.some(
      (issue) => issue.rule === "stale.direct-downstream" && issue.path === "baize/sr/SR-001.md",
    ),
  );

  await acceptAll(cwd, ["SR-001", "SR-002"]); // 按现版上游复核
  const fresh = await run(["validate", "--json"], { cwd });
  assert.equal(fresh.exitCode, 0, fresh.stdout);
  const issues = parseJson<ValidateOutput>(fresh.stdout).issues;
  assert.ok(
    issues.every((issue) => issue.rule !== "stale.direct-downstream"),
    `复核后不应再有直接下游陈旧：${JSON.stringify(issues)}`,
  );
});

test("stale.transitive：陈旧条目的严格后代报 INFO，陈旧条目自己不报传递", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeChain(cwd);
  // 方案层认领（#181），隔离 sr.unclaimed——FN 经认领边也是 SR-001 的严格后代
  write(cwd, "baize/function-items/FN-001.md", FN_CLAIMING_SR001);
  await acceptAll(cwd, ["SR-001", "AR-001", "SR-002"]);
  changeIrStatement(cwd);

  // IR 录入门禁（#147）：未确认的链根会让下游条目报 stage.upstream-unconfirmed，先把根认下来
  await acceptAndRead(cwd, "IR-001");

  const loose = await run(["validate", "--json"], { cwd });
  assert.equal(loose.exitCode, 0, loose.stdout); // 不传 --strict 时两条都不影响 exit code
  const issues = parseJson<ValidateOutput>(loose.stdout).issues;

  const transitive = issues.filter((issue) => issue.rule === "stale.transitive");
  assert.deepEqual(
    transitive.map((issue) => [issue.level, issue.path]),
    [
      ["INFO", "baize/ar/AR-001.md"],
      ["INFO", "baize/function-items/FN-001.md"],
    ],
    "AR-001（parent 边）与 FN-001（认领边）都是 SR-001 的严格后代、自己复核未失效",
  );
  // 陈旧条目自己不算传递：SR-001 只有 WARNING direct，没有 INFO transitive
  const srIssues = issues.filter((issue) => issue.path === "baize/sr/SR-001.md");
  assert.deepEqual(
    srIssues.map((issue) => issue.rule).sort(),
    ["stale.direct-downstream"],
  );

  const human = await run(["validate"], { cwd });
  assert.ok(human.stdout.includes("stale.transitive"), human.stdout);
  assert.ok(human.stdout.includes(transitive[0]?.message ?? ""), human.stdout);
});

test("自身已直接陈旧的条目不重复计入传递影响", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeChain(cwd);
  await acceptAll(cwd, ["SR-001", "AR-001", "SR-002"]);

  // 上游 IR 与中间 SR 都改：AR-001 自己的 reviewed 也失效 → 直接陈旧，不再算传递
  changeIrStatement(cwd);
  const srText = readFileSync(join(cwd, "baize/sr/SR-001.md"), "utf8");
  write(
    cwd,
    "baize/sr/SR-001.md",
    srText.replace("把「数据可带走」落成服务端导出能力。", "导出能力，含异步任务队列。"),
  );

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  const transitive = issues.filter((issue) => issue.rule === "stale.transitive");
  assert.deepEqual(transitive, [], "AR-001 已直接陈旧，不重复报传递 INFO");
  const direct = issues.filter((issue) => issue.rule === "stale.direct-downstream");
  assert.deepEqual(
    direct.map((issue) => issue.path).sort(),
    ["baize/ar/AR-001.md", "baize/sr/SR-001.md", "baize/sr/SR-002.md"],
  );
});

test("--strict 只升级直接下游的陈旧：stale.transitive 的 INFO 永不升级", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeChain(cwd);
  await acceptAll(cwd, ["SR-001", "AR-001", "SR-002"]);
  changeIrStatement(cwd);

  const strict = await run(["validate", "--strict", "--json"], { cwd });
  assert.equal(strict.exitCode, 1, strict.stdout);
  const issues = parseJson<ValidateOutput>(strict.stdout).issues;
  const transitive = issues.filter((issue) => issue.rule === "stale.transitive");
  assert.ok(transitive.length > 0, "本用例应存在传递影响");
  assert.deepEqual(
    transitive.map((issue) => issue.level),
    transitive.map(() => "INFO"),
    "INFO 在 --strict 下仍是 INFO（永不升级）；exit 1 只由 WARNING 造成",
  );
});

test("validate --chain 限定陈旧作用域", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/ir/IR-002.md", LEGAL_IR.replace("id: IR-001", "id: IR-002"));
  write(cwd, "baize/sr/SR-001.md", SR_WITH_COVERS);
  write(
    cwd,
    "baize/sr/SR-002.md",
    SR2_UNDER_IR001.replace("parent: IR-001", "parent: IR-002").replace(
      "covers: [IR-001#a2]",
      "covers: [IR-002#a1, IR-002#a2]",
    ),
  );
  // IR-001 链的 a2 由另一条 SR 覆盖（#150 起 --chain 作用域内线索须全覆盖）
  write(cwd, "baize/sr/SR-003.md", SR2_UNDER_IR001.replace("id: SR-002", "id: SR-003"));
  await acceptAll(cwd, ["SR-001", "SR-002"]);
  changeIrStatement(cwd); // 只改 IR-001

  const other = await run(["validate", "--chain", "IR-002", "--json"], { cwd });
  assert.equal(other.exitCode, 0, other.stdout);
  assert.ok(
    parseJson<ValidateOutput>(other.stdout).issues.every(
      (issue) => !issue.rule.startsWith("stale."),
    ),
    "IR-002 链不应有陈旧",
  );

  const affected = await run(["validate", "--chain", "IR-001", "--json"], { cwd });
  assert.equal(affected.exitCode, 0, affected.stdout);
  assert.ok(
    parseJson<ValidateOutput>(affected.stdout).issues.some(
      (issue) => issue.rule === "stale.direct-downstream" && issue.path === "baize/sr/SR-001.md",
    ),
  );
});

test("status --chain 汇总传递影响：另有 N 条下游受影响", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeChain(cwd);
  await acceptAll(cwd, ["SR-001", "AR-001", "SR-002"]);
  changeIrStatement(cwd);

  const machine = await run(["status", "--chain", "IR-001", "--json"], { cwd });
  assert.equal(machine.exitCode, 0, machine.stdout);
  const stale = parseJson<ChainOutput>(machine.stdout).chain.stale;
  assert.deepEqual(stale.direct, ["SR-001", "SR-002"], "两条直接下游待复核（升序）");
  assert.equal(stale.transitive, 1, "AR-001 是 SR-001 的严格后代，另有 1 条受影响");

  const human = await run(["status", "--chain", "IR-001"], { cwd });
  assert.equal(human.exitCode, 0, human.stdout);
  assert.ok(human.stdout.includes("另有 1 条下游受影响"), human.stdout);
  assert.ok(human.stdout.includes("SR-001"), human.stdout);

  // 复核两条直接下游后，链上不再有陈旧
  await acceptAll(cwd, ["SR-001", "SR-002"]);
  const fresh = parseJson<ChainOutput>(
    (await run(["status", "--chain", "IR-001", "--json"], { cwd })).stdout,
  ).chain.stale;
  assert.deepEqual(fresh, { direct: [], transitive: 0 });
});

// —— #156：status 全貌（三入口、两类门禁、反向视图）——

/** 功能拆分门禁的固定判据原文（#139）：签字人要对着它签，必须能原样取出。 */
const FUNCTION_SPLIT_CRITERION =
  "这套功能拆分足以支撑实现；未覆盖的用例与未复核的陈旧已处置。";

interface GateCheckView {
  check: string;
  passed: boolean;
}
interface GatePendingView {
  unrealizedUsecases: { id: string; path: string }[];
  unreviewedStale: { id: string; path: string; upstreams: string[] }[];
}
interface GateView {
  gate: string;
  kind: "auto" | "signed";
  blocking: boolean;
  state: "pending" | "passed";
  criterion: string;
  by: string | null;
  at: string | null;
  checks?: GateCheckView[];
  pending?: GatePendingView;
  /** 仅 function-split（B2）：签字记录里存的判据；无有效签字为 null。 */
  signedCriterion?: string | null;
  /** 仅 function-split（B2）：pending 时缺的是哪几样（签字 / 判据一致 / 三项自动挡）。 */
  missing?: string[];
}
interface ChainGatesOutput {
  schemaVersion: number;
  chain: {
    id: string;
    coverage: { id: string; covered: number; total: number }[];
    stale: ChainStaleView;
    gates: GateView[];
  };
}
interface ChainSummaryView {
  id: string;
  layer: string;
  title: string;
  path: string;
  items: number;
  coverage: { covered: number; total: number };
  stale: { direct: number; transitive: number };
}
interface StatusChainsOverviewOutput {
  schemaVersion: number;
  chains: ChainSummaryView[];
}
interface ItemClueCoverageView {
  clueId: string;
  text: string;
  covered: boolean;
  coveredBy: string[];
}
interface ItemCatalogSourceView {
  scenario: string;
  catalog: string;
}
interface FullItemView extends ItemView {
  chain: string | null;
  clueCoverage?: ItemClueCoverageView[];
  catalogs?: ItemCatalogSourceView[];
  realizedBy?: string[];
}
interface StatusFullItemOutput {
  schemaVersion: number;
  item: FullItemView;
}

const SC_SELF_SERVICE = LEGAL_SC.replace("id: SC-001", "id: SC-002").replace(
  "catalog: order-flow",
  "catalog: self-service",
);

const UC_TWO_SCENARIOS = LEGAL_UC.replace(
  "appearsIn:\n  - SC-001",
  "appearsIn:\n  - SC-001\n  - SC-002",
);

/** 铺一条七层齐全且无陈旧的链：IR → SR → AR；SC / UC / FN / FP 用认领边挂到 SR-001（#190）。 */
function writeFullChain(cwd: string): void {
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC);
  write(cwd, "baize/usecases/UC-001.md", LEGAL_UC);
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN);
  write(cwd, "baize/function-points/FP-001.md", LEGAL_FP);
}

test("status 无参总览：每条链一行，带条目数 / 覆盖率进度 / 陈旧两档计数", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFullChain(cwd);
  const ir2 = LEGAL_IR.replace("id: IR-001", "id: IR-002").replace(
    "title: 支持用户数据导出",
    "title: 审计日志留存",
  );
  write(cwd, "baize/ir/IR-002.md", ir2);

  const machine = await run(["status", "--json"], { cwd });
  assert.equal(machine.exitCode, 0, machine.stdout);
  const chains = parseJson<StatusChainsOverviewOutput>(machine.stdout).chains;
  assert.equal(chains.length, 2);
  const first = chains.find((c) => c.id === "IR-001");
  assert.ok(first, machine.stdout);
  assert.equal(first.title, "支持用户数据导出");
  assert.equal(first.items, 7, "IR/SR/AR/SC/UC/FN/FP 共 7 个条目");
  assert.deepEqual(first.coverage, { covered: 2, total: 2 });
  assert.deepEqual(first.stale, { direct: 0, transitive: 0 });
  const second = chains.find((c) => c.id === "IR-002");
  assert.ok(second, machine.stdout);
  assert.equal(second.items, 1);
  assert.deepEqual(second.coverage, { covered: 0, total: 2 });

  const human = await run(["status"], { cwd });
  assert.equal(human.exitCode, 0, human.stdout);
  const lines = human.stdout.trim().split("\n").slice(1);
  assert.equal(lines.length, 2, "每条链一行");
  assert.match(lines[0]!, /IR-001.*支持用户数据导出.*7 个条目.*覆盖 2\/2/);
  assert.match(lines[0]!, /陈旧 直接 0 \/ 传递 0/);
  assert.match(lines[1]!, /IR-002.*覆盖 0\/2/);
});

test("status --chain：三处门禁带 kind 与原样 criterion；IR 录入未确认 → pending，accept 后 → passed", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeFullChain(cwd);

  const before = parseJson<ChainGatesOutput>(
    (await run(["status", "--chain", "IR-001", "--json"], { cwd })).stdout,
  ).chain;
  assert.deepEqual(
    before.gates.map((g) => g.gate),
    ["ir-entry", "sr-ar", "function-split"],
  );
  const irEntry = before.gates[0]!;
  assert.equal(irEntry.kind, "auto");
  assert.equal(irEntry.blocking, true);
  assert.equal(irEntry.state, "pending", "IR 未确认 → 门禁未过");
  assert.equal(irEntry.criterion, "父 IR 的 statement 与 acceptance 已人工确认");
  assert.equal(irEntry.by, null);
  assert.equal(irEntry.at, null);
  const srAr = before.gates[1]!;
  assert.equal(srAr.kind, "auto");
  assert.equal(srAr.blocking, false, "sr-ar 是提醒，不阻止推进");
  assert.equal(srAr.state, "passed", "SR-001 已有 AR 承接");
  assert.equal(srAr.criterion, "每条 SR 已 allocates");
  const fnSplit = before.gates[2]!;
  assert.equal(fnSplit.kind, "signed");
  assert.equal(fnSplit.blocking, true);
  assert.equal(fnSplit.state, "pending", "没有人签字就没有通过记录");
  assert.equal(fnSplit.criterion, FUNCTION_SPLIT_CRITERION, "判据原样可取");
  assert.equal(fnSplit.by, null);
  assert.equal(fnSplit.at, null);

  // 链视图仍带覆盖率进度与陈旧两档计数（#156 验收：链视图含两者）
  assert.deepEqual(before.coverage.map((c) => [c.id, c.covered, c.total]), [
    ["IR-001", 2, 2],
  ]);
  assert.deepEqual(before.stale, { direct: [], transitive: 0 });

  const human = await run(["status", "--chain", "IR-001"], { cwd });
  assert.equal(human.exitCode, 0, human.stdout);
  assert.match(human.stdout, /门禁/);
  assert.match(human.stdout, /提醒/, "sr-ar 门禁要能让人看出只是提醒");
  assert.ok(human.stdout.includes(FUNCTION_SPLIT_CRITERION));

  // accept 之后 IR 录入门禁由 confirmationOf 现算转 passed（不落盘门禁状态）
  await acceptAndRead(cwd, "IR-001");
  const after = parseJson<ChainGatesOutput>(
    (await run(["status", "--chain", "IR-001", "--json"], { cwd })).stdout,
  ).chain;
  assert.equal(after.gates[0]!.state, "passed");
});

test("sr-ar 门禁是提醒：没有 AR 时 pending 但 blocking=false，补上 AR 后 passed", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);

  const pending = parseJson<ChainGatesOutput>(
    (await run(["status", "--chain", "IR-001", "--json"], { cwd })).stdout,
  ).chain.gates[1]!;
  assert.equal(pending.state, "pending");
  assert.equal(pending.blocking, false);
  assert.equal(pending.kind, "auto");

  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  const passed = parseJson<ChainGatesOutput>(
    (await run(["status", "--chain", "IR-001", "--json"], { cwd })).stdout,
  ).chain.gates[1]!;
  assert.equal(passed.state, "passed");
});

test("function-split 门禁读链状态文件的 gates 记录：签字齐且自动挡过 → passed 带出 by/at；无记录或缺 by → pending", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFullChain(cwd);

  const unsigned = parseJson<ChainGatesOutput>(
    (await run(["status", "--chain", "IR-001", "--json"], { cwd })).stdout,
  ).chain.gates[2]!;
  assert.equal(unsigned.state, "pending");
  assert.equal(unsigned.by, null);
  assert.equal(unsigned.at, null);

  write(
    cwd,
    "baize/chains/IR-001.yaml",
    `skipped: {}
gates:
  function-split:
    by: alice
    at: 2026-10-12
    criterion: ${FUNCTION_SPLIT_CRITERION}
`,
  );
  const signed = parseJson<ChainGatesOutput>(
    (await run(["status", "--chain", "IR-001", "--json"], { cwd })).stdout,
  ).chain.gates[2]!;
  assert.equal(signed.state, "passed");
  assert.equal(signed.by, "alice");
  assert.equal(signed.at, "2026-10-12");
  assert.equal(signed.criterion, FUNCTION_SPLIT_CRITERION);

  const human = await run(["status", "--chain", "IR-001"], { cwd });
  assert.equal(human.exitCode, 0, human.stdout);
  assert.match(human.stdout, /alice @ 2026-10-12/);

  // 记录缺 by = 不是一条签字（无从追问谁签的）
  write(
    cwd,
    "baize/chains/IR-001.yaml",
    `skipped: {}
gates:
  function-split:
    at: 2026-10-12
    criterion: ${FUNCTION_SPLIT_CRITERION}
`,
  );
  const broken = parseJson<ChainGatesOutput>(
    (await run(["status", "--chain", "IR-001", "--json"], { cwd })).stdout,
  ).chain.gates[2]!;
  assert.equal(broken.state, "pending");
  assert.equal(broken.by, null);
});

test("function-split 门禁 = 签字 + 三项自动挡 + 判据一致：三者不齐 → pending 并说明缺哪样", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFullChain(cwd);
  // 本测试内取第 3 处门禁 / 写签字记录的固定姿势（各 4 处调用，保持一致）
  const gateOf = async () =>
    parseJson<ChainGatesOutput>(
      (await run(["status", "--chain", "IR-001", "--json"], { cwd })).stdout,
    ).chain.gates[2]!;
  const writeSignature = (criterion: string) => {
    write(
      cwd,
      "baize/chains/IR-001.yaml",
      `skipped: {}
gates:
  function-split:
    by: alice
    at: 2026-10-12
    criterion: ${criterion}
`,
    );
  };

  // ① 签字在、判据对，但自动挡挂（UC-002 无人 realizes）→ pending，missing 点名自动挡
  writeSignature(FUNCTION_SPLIT_CRITERION);
  const uc2 = LEGAL_UC.replace("id: UC-001", "id: UC-002").replace(
    "title: 提交订单",
    "title: 取消订单",
  );
  write(cwd, "baize/usecases/UC-002.md", uc2);
  const autoFail = await gateOf();
  assert.equal(autoFail.state, "pending", "自动挡不过，签了也不算过");
  assert.equal(autoFail.signedCriterion, FUNCTION_SPLIT_CRITERION);
  assert.deepEqual(autoFail.missing, [
    "自动挡未过：每条用例都有功能点 realizes 它",
  ]);

  // ② 签的是旧判据文案 → 旧签字作废；signedCriterion 原样可取
  rmSync(join(cwd, "baize/usecases/UC-002.md"));
  writeSignature("旧版判据：签字时对的还是上一版文案");
  const oldCriterion = await gateOf();
  assert.equal(oldCriterion.state, "pending", "判据改了，旧签字不再算数");
  assert.equal(oldCriterion.signedCriterion, "旧版判据：签字时对的还是上一版文案");
  assert.ok(
    oldCriterion.missing?.some((m) => m.includes("判据")),
    `missing 应点名判据不一致：${JSON.stringify(oldCriterion.missing)}`,
  );
  const human = await run(["status", "--chain", "IR-001"], { cwd });
  assert.match(human.stdout, /缺：/, "人读输出要说明缺什么");
  assert.match(human.stdout, /判据不一致/);

  // ③ 三者齐（签字 + 当前判据 + 自动挡全过）→ passed，missing 为空
  writeSignature(FUNCTION_SPLIT_CRITERION);
  const passed = await gateOf();
  assert.equal(passed.state, "passed");
  assert.deepEqual(passed.missing, []);
});

test("function-split 三项自动挡：未覆盖用例 / 功能点缺字段 / 直接下游陈旧各自可算、各自可修", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeFullChain(cwd);

  const allClear = parseJson<ChainGatesOutput>(
    (await run(["status", "--chain", "IR-001", "--json"], { cwd })).stdout,
  ).chain.gates[2]!;
  assert.deepEqual(
    allClear.checks!.map((c) => [c.check, c.passed]),
    [
      ["每条用例都有功能点 realizes 它", true],
      ["每个功能点五项字段齐备", true],
      ["无未复核的直接下游陈旧", true],
    ],
  );
  assert.deepEqual(allClear.pending!.unrealizedUsecases, []);
  assert.deepEqual(allClear.pending!.unreviewedStale, []);

  // 三处各自制造一个缺陷
  const uc2 = LEGAL_UC.replace("id: UC-001", "id: UC-002").replace(
    "title: 提交订单",
    "title: 取消订单",
  );
  write(cwd, "baize/usecases/UC-002.md", uc2); // 无人 realizes
  write(
    cwd,
    "baize/function-points/FP-001.md",
    LEGAL_FP.replace("acceptanceCriteria:\n  - 非法参数返回 400\n", ""),
  ); // 缺第五项
  await acceptAndRead(cwd, "SR-001"); // 复核上游 IR-001
  changeIrStatement(cwd); // 上游再改 → SR-001 直接陈旧

  const dirty = parseJson<ChainGatesOutput>(
    (await run(["status", "--chain", "IR-001", "--json"], { cwd })).stdout,
  ).chain.gates[2]!;
  assert.deepEqual(
    dirty.checks!.map((c) => c.passed),
    [false, false, false],
  );
  assert.deepEqual(
    dirty.pending!.unrealizedUsecases.map((u) => u.id),
    ["UC-002"],
  );
  assert.deepEqual(
    dirty.pending!.unreviewedStale.map((s) => [s.id, s.upstreams]),
    [["SR-001", ["IR-001"]]],
  );

  // 人读输出把三张待处置清单渲染在同一份数据上
  const human = await run(["status", "--chain", "IR-001"], { cwd });
  assert.equal(human.exitCode, 0, human.stdout);
  assert.match(human.stdout, /未覆盖的用例：UC-002/);
  assert.match(human.stdout, /未复核的陈旧：SR-001（上游 IR-001）/);

  // 各自修复后三样复归全过
  write(
    cwd,
    "baize/function-items/FN-001.md",
    LEGAL_FN.replace("realizes:\n  - UC-001", "realizes:\n  - UC-001\n  - UC-002"),
  );
  write(cwd, "baize/function-points/FP-001.md", LEGAL_FP);
  await acceptAndRead(cwd, "SR-001"); // 按现版复核
  const fixed = parseJson<ChainGatesOutput>(
    (await run(["status", "--chain", "IR-001", "--json"], { cwd })).stdout,
  ).chain.gates[2]!;
  assert.deepEqual(
    fixed.checks!.map((c) => c.passed),
    [true, true, true],
  );
  assert.deepEqual(fixed.pending!.unrealizedUsecases, []);
  assert.deepEqual(fixed.pending!.unreviewedStale, []);
});

test("签字要看的两张清单与 validate 同源：pending == coverage.unrealized-usecase 与 stale.direct-downstream 的 issue 集合", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeFullChain(cwd);
  const uc2 = LEGAL_UC.replace("id: UC-001", "id: UC-002").replace(
    "title: 提交订单",
    "title: 取消订单",
  );
  write(cwd, "baize/usecases/UC-002.md", uc2);
  await acceptAndRead(cwd, "SR-001");
  changeIrStatement(cwd);

  const validated = parseJson<ValidateOutput>(
    (await run(["validate", "--chain", "IR-001", "--json"], { cwd })).stdout,
  );
  const unrealizedIds = validated.issues
    .filter((i) => i.rule === "coverage.unrealized-usecase")
    .map((i) => i.path)
    .sort();
  const staleIds = validated.issues
    .filter((i) => i.rule === "stale.direct-downstream")
    .map((i) => i.path)
    .sort();

  const gate = parseJson<ChainGatesOutput>(
    (await run(["status", "--chain", "IR-001", "--json"], { cwd })).stdout,
  ).chain.gates[2]!;
  const pendingUcPaths = gate.pending!.unrealizedUsecases.map((u) => u.path).sort();
  const pendingStalePaths = gate.pending!.unreviewedStale.map((s) => s.path).sort();
  assert.deepEqual(pendingUcPaths, unrealizedIds, "未覆盖用例清单与 validate 同一份数据");
  assert.deepEqual(pendingStalePaths, staleIds, "未复核陈旧清单与 validate 同一份数据");
});

test("status --item IR-001：反向视图给出每条线索被哪几条 SR 覆盖（线索级）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", IR_THREE_CLUES);
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1"));
  write(cwd, "baize/sr/SR-002.md", srWithCovers("SR-002", "IR-001#a1"));

  const item = parseJson<StatusFullItemOutput>(
    (await run(["status", "--item", "IR-001", "--json"], { cwd })).stdout,
  ).item;
  assert.deepEqual(item.clueCoverage, [
    { clueId: "a1", text: "能导出 CSV", covered: true, coveredBy: ["SR-001", "SR-002"] },
    { clueId: "a2", text: "能导出 Excel", covered: false, coveredBy: [] },
    { clueId: "a3", text: "能设置导出范围", covered: false, coveredBy: [] },
  ]);

  const human = await run(["status", "--item", "IR-001"], { cwd });
  assert.equal(human.exitCode, 0, human.stdout);
  assert.match(human.stdout, /被 SR-001、SR-002 覆盖/);
  assert.match(human.stdout, /未覆盖/);
});

test("status --item UC-001：反向视图给出继承自哪些场景目录（一条用例可属多个目录）与谁 realizes 了它", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFullChain(cwd);
  write(cwd, "baize/scenarios/SC-002.md", SC_SELF_SERVICE);
  write(cwd, "baize/usecases/UC-001.md", UC_TWO_SCENARIOS);

  const item = parseJson<StatusFullItemOutput>(
    (await run(["status", "--item", "UC-001", "--json"], { cwd })).stdout,
  ).item;
  assert.deepEqual(item.catalogs, [
    { scenario: "SC-001", catalog: "order-flow" },
    { scenario: "SC-002", catalog: "self-service" },
  ]);
  assert.deepEqual(item.realizedBy, ["FN-001"]);

  const human = await run(["status", "--item", "UC-001"], { cwd });
  assert.equal(human.exitCode, 0, human.stdout);
  assert.match(human.stdout, /SC-001 → order-flow/);
  assert.match(human.stdout, /SC-002 → self-service/);
  assert.match(human.stdout, /FN-001/);
});

test("status --item：任意条目都看得到自己属于哪条链（沿 parent 边、方案层沿认领边到根的反向信息，#190）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFullChain(cwd);

  for (const id of ["IR-001", "SR-001", "FP-001"]) {
    const item = parseJson<StatusFullItemOutput>(
      (await run(["status", "--item", id, "--json"], { cwd })).stdout,
    ).item;
    assert.equal(item.chain, "IR-001", `${id} 属于链 IR-001`);
  }

  const human = await run(["status", "--item", "FP-001"], { cwd });
  assert.equal(human.exitCode, 0, human.stdout);
  assert.match(human.stdout, /chain: IR-001/);
});

// —— IR 录入门禁的机械落地（#147：门禁的强度）——

test("validate：stage.upstream-unconfirmed —— 上游 IR 未确认时下游报 WARNING、--strict 升级；确认后不再报，确认失效后重新报", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1, IR-001#a2"));
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  // 方案层认领（#181），隔离 sr.unclaimed——FN 也是下游条目，未确认时同样报
  write(cwd, "baize/function-items/FN-001.md", FN_CLAIMING_SR001);

  // 未确认：下游条目报 WARNING，IR 自己不报；WARNING 不挡 exit code
  const unconfirmed = await run(["validate", "--json"], { cwd });
  assert.equal(unconfirmed.exitCode, 0, "WARNING 不挡 exit code");
  const issues = parseJson<ValidateOutput>(unconfirmed.stdout).issues;
  assert.deepEqual(
    issues.map((issue) => `${issue.rule} ${issue.path}`).sort(),
    [
      "stage.upstream-unconfirmed baize/ar/AR-001.md",
      "stage.upstream-unconfirmed baize/function-items/FN-001.md",
      "stage.upstream-unconfirmed baize/sr/SR-001.md",
    ],
    unconfirmed.stdout,
  );
  const warning = issues[0];
  assert.ok(warning);
  assert.equal(warning.level, "WARNING");
  assert.ok(warning.message.includes("IR-001"), warning.message);
  assert.ok(warning.message.includes("尚未人工确认"), warning.message);

  // --strict 把它升级为失败
  const strict = await run(["validate", "--strict", "--json"], { cwd });
  assert.equal(strict.exitCode, 1, strict.stdout);

  // 确认链根后不再报
  await acceptAndRead(cwd, "IR-001");
  const confirmed = await run(["validate", "--strict", "--json"], { cwd });
  assert.equal(confirmed.exitCode, 0, confirmed.stdout);
  assert.deepEqual(parseJson<ValidateOutput>(confirmed.stdout).issues, []);

  // 改掉实质内容 → 确认失效 → 重新报（陈旧不会自己消失）
  const irPath = join(cwd, "baize/ir/IR-001.md");
  writeFileSync(irPath, readFileSync(irPath, "utf8").replace("不能锁死在系统里", "改了口径"), "utf8");
  const stale = await run(["validate", "--json"], { cwd });
  const staleIssues = parseJson<ValidateOutput>(stale.stdout).issues;
  const reappeared = staleIssues.find((issue) => issue.rule === "stage.upstream-unconfirmed");
  assert.ok(reappeared, "确认失效后应重新报：" + stale.stdout);
  assert.ok(reappeared.message.includes("确认已失效"), reappeared.message);
});

// ---- baize rename（#184）：把条目里的清单引用跟到新 slug ----
// 共同契约（与 #185 migrate 同族，纪律见 ADR-0006）：默认 dry-run、--write 才落盘、
// 只改条目绝不写清单、拒绝条件先于改写、原子性只到单文件。

/** 递归快照目录内所有文件的文本内容，用于「目录零变化」协议级断言。 */
function snapshotDir(cwd: string, rel: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (abs: string, prefix: string): void => {
    for (const name of readdirSync(abs)) {
      const childAbs = join(abs, name);
      const childRel = prefix === "" ? name : `${prefix}/${name}`;
      if (statSync(childAbs).isDirectory()) walk(childAbs, childRel);
      else out.set(childRel, readFileSync(childAbs, "utf8"));
    }
  };
  walk(join(cwd, rel), "");
  return out;
}

function snapshotEqual(
  before: Map<string, string>,
  after: Map<string, string>,
): boolean {
  if (before.size !== after.size) return false;
  for (const [key, value] of before) {
    if (after.get(key) !== value) return false;
  }
  return true;
}

// 两条场景引用 order-flow，一条引用 self-service；清单里两个 slug 都在。
function writeRenameRepo(cwd: string): void {
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SCENARIO);
  write(
    cwd,
    "baize/scenarios/SC-002.md",
    LEGAL_SCENARIO.replace("id: SC-001", "id: SC-002"),
  );
  write(
    cwd,
    "baize/scenarios/SC-003.md",
    LEGAL_SCENARIO.replace("id: SC-001", "id: SC-003").replace(
      "catalog: order-flow",
      "catalog: self-service",
    ),
  );
}

test("rename catalog dry-run：打印文件 + 行 + 旧值 → 新值与「建议先提交」，文件字节不变", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeRenameRepo(cwd);

  const before = snapshotDir(cwd, "baize");
  const result = await run(["rename", "catalog", "order-flow", "self-service"], {
    cwd,
  });
  assert.equal(result.exitCode, 0, result.stdout);
  // 文件 + 行 + 旧值 → 新值：行号由条目内容决定，只断言形状（别把行号钉死，夹具一改就假红）
  assert.match(result.stdout, /baize\/scenarios\/SC-001\.md:\d+: catalog: order-flow → self-service/);
  assert.match(result.stdout, /baize\/scenarios\/SC-002\.md:\d+: catalog: order-flow → self-service/);
  assert.match(result.stdout, /2 处引用/);
  assert.match(result.stdout, /建议先提交/);
  assert.doesNotMatch(result.stdout, /SC-003/, "未引用的条目不得出现在清单里");
  // 协议级断言：dry-run 前后文件字节不变（含清单文件）
  assert.ok(snapshotEqual(before, snapshotDir(cwd, "baize")), "dry-run 不得写盘");
});

test("rename catalog --write 落盘：只改引用了旧 slug 的条目，清单文件与其余条目字节不变", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeRenameRepo(cwd);
  const sc3Before = readFileSync(join(cwd, "baize/scenarios/SC-003.md"), "utf8");
  const catalogsBefore = readFileSync(
    join(cwd, "baize/scenario-catalogs.yaml"),
    "utf8",
  );

  const result = await run(
    ["rename", "catalog", "order-flow", "self-service", "--write"],
    { cwd },
  );
  assert.equal(result.exitCode, 0, result.stdout);
  assert.match(result.stdout, /已改写 2 处引用/);

  const sc1 = readFileSync(join(cwd, "baize/scenarios/SC-001.md"), "utf8");
  assert.equal(frontmatterOf(sc1)["catalog"], "self-service");
  const sc2 = readFileSync(join(cwd, "baize/scenarios/SC-002.md"), "utf8");
  assert.equal(frontmatterOf(sc2)["catalog"], "self-service");
  // 只改条目、绝不写清单：其余文件一字未动
  assert.equal(
    readFileSync(join(cwd, "baize/scenarios/SC-003.md"), "utf8"),
    sc3Before,
  );
  assert.equal(
    readFileSync(join(cwd, "baize/scenario-catalogs.yaml"), "utf8"),
    catalogsBefore,
  );
});

test("rename：新 slug 不在清单里 → exit 2 且目录零变化（拒绝条件先于改写）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeRenameRepo(cwd);

  const before = snapshotDir(cwd, "baize");
  const result = await run(
    ["rename", "catalog", "order-flow", "no-such-catalog", "--write", "--json"],
    { cwd },
  );
  assert.equal(result.exitCode, 2);
  const error = parseJson<ErrorOutput>(result.stdout).error;
  assert.equal(error.rule, "rename.unknown-slug");
  assert.match(error.message, /no-such-catalog/);
  assert.match(error.message, /scenario-catalogs\.yaml/);
  // 协议级断言：被拒时目录零变化
  assert.ok(snapshotEqual(before, snapshotDir(cwd, "baize")), "拒绝后不得动任何文件");
});

test("rename element 改 AR 的 allocates；清单文件（architecture.yaml）不被写", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", LEGAL_AR);
  const catalogsBefore = readFileSync(join(cwd, "baize/architecture.yaml"), "utf8");

  // dry-run：LEGAL_AR 的 allocates 在第 5 行，字节不变
  const dry = await run(["rename", "element", "export-service", "audit-log"], {
    cwd,
  });
  assert.equal(dry.exitCode, 0, dry.stdout);
  assert.match(dry.stdout, /baize\/ar\/AR-001\.md:5: allocates: export-service → audit-log/);
  assert.equal(
    readFileSync(join(cwd, "baize/ar/AR-001.md"), "utf8"),
    LEGAL_AR,
    "dry-run 不得写盘",
  );

  const written = await run(
    ["rename", "element", "export-service", "audit-log", "--write"],
    { cwd },
  );
  assert.equal(written.exitCode, 0, written.stdout);
  const ar = readFileSync(join(cwd, "baize/ar/AR-001.md"), "utf8");
  assert.equal(frontmatterOf(ar)["allocates"], "audit-log");
  // 只改条目：清单文件一字未动
  assert.equal(readFileSync(join(cwd, "baize/architecture.yaml"), "utf8"), catalogsBefore);
});

test("rename：无任何引用时打印「0 处引用」并以成功退出（不是用法错）", async (t) => {
  // 有清单但还没有任何条目：0 处引用，同样成功
  const emptyCwd = mkdtempSync(join(tmpdir(), "baize-empty-"));
  t.after(() => rmSync(emptyCwd, { recursive: true, force: true }));
  write(emptyCwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);
  const result = await run(["rename", "catalog", "order-flow", "self-service"], {
    cwd: emptyCwd,
  });
  assert.equal(result.exitCode, 0, result.stdout);
  assert.match(result.stdout, /0 处引用/);

  // 有仓库、有条目，但没人引用旧 slug：同样成功、不动文件
  const noneCwd = mkdtempSync(join(tmpdir(), "baize-none-"));
  t.after(() => rmSync(noneCwd, { recursive: true, force: true }));
  write(noneCwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);
  write(
    noneCwd,
    "baize/scenarios/SC-001.md",
    LEGAL_SCENARIO.replace("catalog: order-flow", "catalog: self-service"),
  );
  const before = snapshotDir(noneCwd, "baize");
  const none = await run(["rename", "catalog", "order-flow", "self-service"], {
    cwd: noneCwd,
  });
  assert.equal(none.exitCode, 0, none.stdout);
  assert.match(none.stdout, /0 处引用/);
  assert.ok(snapshotEqual(before, snapshotDir(noneCwd, "baize")));
});

test("rename：kind 不合法或参数缺失 → exit 2 用法错，不写文件", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeRenameRepo(cwd);

  const badKind = await run(["rename", "widget", "a", "b"], { cwd });
  assert.equal(badKind.exitCode, 2);
  const missing = await run(["rename", "catalog", "order-flow"], { cwd });
  assert.equal(missing.exitCode, 2);
  const none = await run(["rename"], { cwd });
  assert.equal(none.exitCode, 2);
  const extra = await run(["rename", "catalog", "a", "b", "c"], { cwd });
  assert.equal(extra.exitCode, 2);
  const wrongOption = await run(["rename", "catalog", "a", "b", "--strict"], { cwd });
  assert.equal(wrongOption.exitCode, 2);
});

// ---- #183 陈旧与复核沿认领边（refines / satisfies）传 ----

/**
 * 认领边陈旧的靶子仓：IR-001（两条线索）→ SR-001（两条线索都盖）+ AR 承接，
 * 方案层四层各一条、全部认领 SR-001（场景/用例 refines，功能项/功能点 satisfies）。
 * 覆盖与承接都齐：什么都没改时 validate 全绿。
 */
function writeClaimChain(cwd: string): void {
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1, IR-001#a2"));
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", AR_UNDER_SR001);
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC);
  write(cwd, "baize/usecases/UC-001.md", LEGAL_UC);
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN);
  write(cwd, "baize/function-points/FP-001.md", LEGAL_FP);
}

/** 只改 SR-001 的 statement（实质字段）。 */
function changeSrStatement(cwd: string): void {
  const text = readFileSync(join(cwd, "baize/sr/SR-001.md"), "utf8");
  const changed = text.replace("导出能力。", "导出能力，含异步任务队列。");
  assert.notEqual(changed, text, "本用例必须真的改掉 SR 的 statement");
  write(cwd, "baize/sr/SR-001.md", changed);
}

test("认领边陈旧：accept 方案层条目把认领的 SR 记进 reviewed；改 SR 的 statement → 认领它的条目报 stale.direct-downstream（WARNING，门禁处阻塞）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeClaimChain(cwd);
  // 链根先确认，否则 stage.upstream-unconfirmed 会掺进本用例的断言
  await acceptAndRead(cwd, "IR-001");
  await acceptAll(cwd, ["SC-001", "UC-001", "FN-001", "FP-001"]);

  // 复核记录：被复核的上游可以是 SR（场景/用例 refines、功能项/功能点 satisfies；
  // 功能点还带 parent 功能项，两个上游都记）
  const sc = frontmatterOf(readFileSync(join(cwd, "baize/scenarios/SC-001.md"), "utf8"));
  assert.deepEqual(
    Object.keys((sc["reviewed"] ?? {}) as object),
    ["SR-001"],
    "场景的认领边应记进 reviewed",
  );
  const fp = frontmatterOf(readFileSync(join(cwd, "baize/function-points/FP-001.md"), "utf8"));
  assert.deepEqual(Object.keys((fp["reviewed"] ?? {}) as object), ["FN-001", "SR-001"]);

  // 不触发（一反）：什么都没改时全绿
  const before = await run(["validate", "--json"], { cwd });
  assert.equal(before.exitCode, 0, before.stdout);
  assert.deepEqual(parseJson<ValidateOutput>(before.stdout).issues, []);

  // 触发（一正）：SR 的 statement 一改，认领它的四层条目都是直接下游
  changeSrStatement(cwd);
  const loose = await run(["validate", "--json"], { cwd });
  assert.equal(loose.exitCode, 0, loose.stdout);
  const direct = parseJson<ValidateOutput>(loose.stdout).issues.filter(
    (issue) => issue.rule === "stale.direct-downstream",
  );
  assert.deepEqual(
    direct.map((issue) => issue.path).sort(),
    [
      "baize/function-items/FN-001.md",
      "baize/function-points/FP-001.md",
      "baize/scenarios/SC-001.md",
      "baize/usecases/UC-001.md",
    ],
  );
  assert.ok(direct.every((issue) => issue.level === "WARNING"), loose.stdout);
  assert.ok(direct.every((issue) => issue.message.includes("SR-001")), loose.stdout);

  // 门禁处阻塞（WARNING）：--strict 升级为失败
  const strict = await run(["validate", "--strict", "--json"], { cwd });
  assert.equal(strict.exitCode, 1, strict.stdout);

  // 复核仍走 baize accept：按现版 SR 再认一次 SC-001，它退出待复核清单
  await acceptAndRead(cwd, "SC-001");
  const after = await run(["validate", "--json"], { cwd });
  const remaining = parseJson<ValidateOutput>(after.stdout).issues
    .filter((issue) => issue.rule === "stale.direct-downstream")
    .map((issue) => issue.path);
  assert.ok(!remaining.includes("baize/scenarios/SC-001.md"), after.stdout);
  assert.equal(remaining.length, 3, "其余三条认领者仍在待复核：" + after.stdout);
});

test("认领边闭包：SR 直接陈旧 → 认领它的方案层条目报 stale.transitive（INFO，消息点名该 SR）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeClaimChain(cwd);
  await acceptAll(cwd, ["IR-001", "SR-001", "SC-001", "UC-001", "FN-001", "FP-001"]);
  changeIrStatement(cwd); // IR 改 → 只有复核过 IR 的 SR-001 是直接下游

  const loose = await run(["validate", "--json"], { cwd });
  assert.equal(loose.exitCode, 0, loose.stdout);
  const issues = parseJson<ValidateOutput>(loose.stdout).issues;

  const direct = issues.filter((issue) => issue.rule === "stale.direct-downstream");
  assert.deepEqual(
    direct.map((issue) => issue.path),
    ["baize/sr/SR-001.md"],
    "SR-001 自己没改，只有它复核过的 IR 失效",
  );

  // 闭包沿认领边传：认领 SR-001 的四层条目自己的复核未失效（SR-001 没改），
  // 只算传递影响；AR-001 沿 parent 边照旧在闭包里（既有语义不变）
  const transitive = issues.filter((issue) => issue.rule === "stale.transitive");
  assert.deepEqual(
    transitive.map((issue) => [issue.level, issue.path]),
    [
      ["INFO", "baize/ar/AR-001.md"],
      ["INFO", "baize/function-items/FN-001.md"],
      ["INFO", "baize/function-points/FP-001.md"],
      ["INFO", "baize/scenarios/SC-001.md"],
      ["INFO", "baize/usecases/UC-001.md"],
    ],
  );
  // 消息点名陈旧的上游：认领边回溯到 SR-001（不是 parent 祖先）
  assert.ok(
    transitive.every((issue) => issue.message.includes("SR-001")),
    loose.stdout,
  );
});

test("认领边陈旧不级联：--strict 下方案层的 stale.transitive 仍 INFO 永不升级，exit 1 只由直接下游的 WARNING 造成", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeClaimChain(cwd);
  await acceptAll(cwd, ["IR-001", "SR-001", "SC-001", "UC-001", "FN-001", "FP-001"]);
  changeIrStatement(cwd);

  const strict = await run(["validate", "--strict", "--json"], { cwd });
  assert.equal(strict.exitCode, 1, strict.stdout);
  const issues = parseJson<ValidateOutput>(strict.stdout).issues;

  // 认领边进闭包的四条也在场（断言不是空转），且全部 INFO
  const transitive = issues.filter((issue) => issue.rule === "stale.transitive");
  assert.deepEqual(
    transitive.map((issue) => issue.path).sort(),
    [
      "baize/ar/AR-001.md",
      "baize/function-items/FN-001.md",
      "baize/function-points/FP-001.md",
      "baize/scenarios/SC-001.md",
      "baize/usecases/UC-001.md",
    ],
  );
  assert.ok(transitive.every((issue) => issue.level === "INFO"), strict.stdout);
  const direct = issues.filter((issue) => issue.rule === "stale.direct-downstream");
  assert.deepEqual(direct.map((issue) => issue.level), ["WARNING"]);
});

/** 子场景：挂在 SC-001 下（场景挂场景的例外），也认领 SR-001。 */
const SC_002_UNDER_SC001 = `---
id: SC-002
title: 导出失败重试
parent: SC-001
refines:
  - SR-001
catalog: order-flow
preconditions:
  - 用户已登录
trigger: 导出失败后用户点击重试
mainFlow:
  - 系统重新发起导出
alternativeFlows: []
expectedOutcome: 重试成功并下载
stakeholders:
  - 买家
---

子场景：主流程之外的重试分支。
`;

/** 给条目的认领边列表追加一条（出边变化，不动 statement）。 */
function addClaim(cwd: string, rel: string, extra: string): void {
  const text = readFileSync(join(cwd, rel), "utf8");
  const changed = text.replace(/^(\s*)- SR-001$/m, `$1- SR-001
$1- ${extra}`);
  assert.notEqual(changed, text, "本用例必须真的改掉认领边");
  write(cwd, rel, changed);
}

test("认领边是实质字段：改场景的 refines / 功能项的 satisfies 同样让复核过的下游失效", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeClaimChain(cwd);
  // SR-002 供改边后认领（改边要指向存在的条目，否则 ref.unknown-target 盖过本用例）
  write(cwd, "baize/sr/SR-002.md", srWithCovers("SR-002", "IR-001#a1"));
  write(cwd, "baize/scenarios/SC-002.md", SC_002_UNDER_SC001);
  // SC-002 复核 parent 场景 SC-001；FP-001 复核 parent 功能项 FN-001
  await acceptAll(cwd, ["IR-001", "SC-001", "SC-002", "FP-001"]);

  const before = await run(["validate", "--json"], { cwd });
  const beforeIssues = parseJson<ValidateOutput>(before.stdout).issues;
  assert.ok(
    beforeIssues.every((issue) => !issue.rule.startsWith("stale.")),
    `改边之前不应有陈旧：${JSON.stringify(beforeIssues)}`,
  );

  // 出边一改（SC-001 多认领 SR-002、FN-001 多认领 SR-002），statement 一字未动
  addClaim(cwd, "baize/scenarios/SC-001.md", "SR-002");
  addClaim(cwd, "baize/function-items/FN-001.md", "SR-002");

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  const direct = parseJson<ValidateOutput>(result.stdout).issues.filter(
    (issue) => issue.rule === "stale.direct-downstream",
  );
  assert.deepEqual(
    direct.map((issue) => issue.path).sort(),
    ["baize/function-points/FP-001.md", "baize/scenarios/SC-002.md"],
    "复核过 SC-001 / FN-001 的下游应失效",
  );
  assert.ok(direct.every((issue) => issue.level === "WARNING"), result.stdout);
  const sc2 = direct.find((issue) => issue.path === "baize/scenarios/SC-002.md");
  assert.ok(sc2?.message.includes("SC-001"), "消息应点名被改的上游 SC-001：" + sc2?.message);
  const fp1 = direct.find((issue) => issue.path === "baize/function-points/FP-001.md");
  assert.ok(fp1?.message.includes("FN-001"), "消息应点名被改的上游 FN-001：" + fp1?.message);
});

// ── #181 两条新 WARNING：acceptance 超阈值 / SR 未被认领 ──────────────────

/** N 条验收线索（a1..aN）的 IR。 */
function irWithClues(clueCount: number): string {
  const clues = Array.from({ length: clueCount }, (_, i) => `  a${i + 1}: 线索 ${i + 1}`);
  return `---
id: IR-001
title: 支持用户数据导出
parent: null
acceptance:
${clues.join("\n")}
---

产品要求用户能把数据带走，不能锁死在系统里。
`;
}

/**
 * clueCount 条线索的「除阈值外全绿」仓库：SR 全盖、AR 承接、场景认领 SR、
 * 根已确认（其余 WARNING/ERROR 都不掺进来，只剩 acceptance 条数这一件事）。
 */
async function writeThresholdRepo(cwd: string, clueCount: number): Promise<void> {
  const covers = Array.from({ length: clueCount }, (_, i) => `IR-001#a${i + 1}`).join(", ");
  write(cwd, "baize/ir/IR-001.md", irWithClues(clueCount));
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", covers));
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", AR_UNDER_SR001);
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC);
  await acceptAndRead(cwd, "IR-001");
}

test("validate：field.acceptance-too-many —— 8 条线索报 WARNING（消息带条数与阈值），恰好 7 条不报", async (t) => {
  const sevenCwd = mkdtempSync(join(tmpdir(), "baize-"));
  const eightCwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => {
    rmSync(sevenCwd, { recursive: true, force: true });
    rmSync(eightCwd, { recursive: true, force: true });
  });

  await writeThresholdRepo(sevenCwd, 7);
  const seven = await run(["validate", "--json"], { cwd: sevenCwd });
  assert.equal(seven.exitCode, 0, seven.stdout);
  assert.deepEqual(
    parseJson<ValidateOutput>(seven.stdout).issues,
    [],
    "恰好 7 条不报：" + seven.stdout,
  );

  await writeThresholdRepo(eightCwd, 8);
  const eight = await run(["validate", "--json"], { cwd: eightCwd });
  assert.equal(eight.exitCode, 0, "WARNING 不挡 exit code：" + eight.stdout);
  const issues = parseJson<ValidateOutput>(eight.stdout).issues;
  assert.deepEqual(
    issues.map((issue) => issue.rule),
    ["field.acceptance-too-many"],
    eight.stdout,
  );
  const issue = issues[0];
  assert.ok(issue, eight.stdout);
  assert.equal(issue.level, "WARNING");
  assert.equal(issue.path, "baize/ir/IR-001.md");
  assert.ok(issue.message.includes("8 条"), "消息带条数：" + issue.message);
  assert.ok(issue.message.includes("阈值 7"), "消息带阈值：" + issue.message);
  assert.ok(issue.fix?.includes("拆"), "fix 指向拆分：" + (issue.fix ?? ""));
});

test("validate --strict 把 WARNING（field.acceptance-too-many）也算失败（exit 1）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  await writeThresholdRepo(cwd, 8);
  const strict = await run(["validate", "--strict"], { cwd });
  assert.equal(strict.exitCode, 1, strict.stdout);
});


/**
 * 最小认领者（#181）：一条功能项 satisfies SR-001、realizes 允许空——
 * 单文件即可把 sr.unclaimed 从用例里隔离掉（不需要场景目录清单）。
 */
const FN_CLAIMING_SR001 = `---
id: FN-001
title: 导出服务
satisfies:
  - SR-001
domain: 数据服务
realizes: []
description: 承载导出能力。
---
`;

test("validate：sr.unclaimed —— 没有方案层条目认领的 SR 报 WARNING；被 refines/satisfies 认领则不报", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1, IR-001#a2"));
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", AR_UNDER_SR001); // AR 承接（#152），隔离 sr.unallocated
  await acceptAndRead(cwd, "IR-001");

  const unclaimed = await run(["validate", "--json"], { cwd });
  assert.equal(unclaimed.exitCode, 0, "WARNING 不挡 exit code");
  const issues = parseJson<ValidateOutput>(unclaimed.stdout).issues;
  assert.deepEqual(
    issues.map((issue) => issue.rule),
    ["sr.unclaimed"],
    unclaimed.stdout,
  );
  assert.equal(issues[0]?.level, "WARNING");
  assert.equal(issues[0]?.path, "baize/sr/SR-001.md");
  assert.ok(issues[0]?.message.includes("SR-001"), "消息应点名 SR：" + issues[0]?.message);

  // 认领者出现（场景 refines / 功能项 satisfies 都算数）→ 不再报
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC);
  const claimedByScenario = await run(["validate", "--json"], { cwd });
  assert.equal(claimedByScenario.exitCode, 0, claimedByScenario.stdout);
  assert.deepEqual(
    parseJson<ValidateOutput>(claimedByScenario.stdout).issues,
    [],
    "场景 refines 认领后不报：" + claimedByScenario.stdout,
  );

  rmSync(join(cwd, "baize/scenarios"), { recursive: true, force: true });
  write(cwd, "baize/function-items/FN-001.md", FN_CLAIMING_SR001);
  const claimedByFn = await run(["validate", "--json"], { cwd });
  assert.equal(claimedByFn.exitCode, 0, claimedByFn.stdout);
  assert.deepEqual(
    parseJson<ValidateOutput>(claimedByFn.stdout).issues,
    [],
    "功能项 satisfies 认领后不报：" + claimedByFn.stdout,
  );
});

test("validate --strict 把 WARNING（sr.unclaimed）也算失败（exit 1）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1, IR-001#a2"));
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", AR_UNDER_SR001);
  await acceptAndRead(cwd, "IR-001");

  const lax = await run(["validate"], { cwd });
  assert.equal(lax.exitCode, 0);
  const strict = await run(["validate", "--strict"], { cwd });
  assert.equal(strict.exitCode, 1);
});

// ---- #182 链成员跟认领边 + status 共享标注 ----

interface SharedChainView {
  chain: string;
  count: number;
}

interface ChainSharedOutput {
  schemaVersion: number;
  chain: {
    id: string;
    items: { id: string }[];
    shared?: SharedChainView[];
    stages: StageView[];
    gates: GateView[];
  };
}

/**
 * 共两条链的靶子仓：IR-001→SR-001（有 AR 承接）与 IR-002→SR-002 各一条链；
 * UC-001 同时认领两条 SR——两条链的成员都含它；SC-001 / FN-001 / FP-001 只认领 SR-001。
 */
function writeSharedChains(cwd: string): void {
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1, IR-001#a2"));
  write(
    cwd,
    "baize/ir/IR-002.md",
    LEGAL_IR.replace("id: IR-001", "id: IR-002").replace(
      "title: 支持用户数据导出",
      "title: 审计日志留存",
    ),
  );
  write(
    cwd,
    "baize/sr/SR-002.md",
    srWithCovers("SR-002", "IR-002#a1, IR-002#a2").replace("parent: IR-001", "parent: IR-002"),
  );
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);
  write(cwd, "baize/ar/AR-001.md", AR_UNDER_SR001);
  write(cwd, "baize/scenarios/SC-001.md", LEGAL_SC);
  // UC-001 认领两条 SR：同属两条链（#190 user story 2）——共享标注的靶子
  write(
    cwd,
    "baize/usecases/UC-001.md",
    LEGAL_UC.replace("refines:\n  - SR-001", "refines:\n  - SR-001\n  - SR-002"),
  );
  write(cwd, "baize/function-items/FN-001.md", LEGAL_FN);
  write(cwd, "baize/function-points/FP-001.md", LEGAL_FP);
}

test("status --chain：一条用例认领两条 SR → 两条链的 items 都含它，shared 互指（现算不落盘）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeSharedChains(cwd);

  const first = parseJson<ChainSharedOutput>(
    (await run(["status", "--chain", "IR-001", "--json"], { cwd })).stdout,
  ).chain;
  assert.ok(
    first.items.some((item) => item.id === "UC-001"),
    `链 IR-001 的条目应含共享的 UC-001：${JSON.stringify(first.items)}`,
  );
  assert.deepEqual(first.shared, [{ chain: "IR-002", count: 1 }]);

  const second = parseJson<ChainSharedOutput>(
    (await run(["status", "--chain", "IR-002", "--json"], { cwd })).stdout,
  ).chain;
  assert.ok(
    second.items.some((item) => item.id === "UC-001"),
    `链 IR-002 的条目也应含共享的 UC-001：${JSON.stringify(second.items)}`,
  );
  assert.deepEqual(second.shared, [{ chain: "IR-001", count: 1 }], "共享计数应互指");

  // 人类可读输出加一行（与 --json 同源）
  const human = await run(["status", "--chain", "IR-001"], { cwd });
  assert.equal(human.exitCode, 0, human.stdout);
  assert.ok(human.stdout.includes("与链 IR-002 共享 1 条条目"), human.stdout);

  // 现算不落盘：共享是反向现算信息，status 不得写状态文件
  assert.ok(!existsSync(join(cwd, "baize/chains")), "共享信息不得落盘");
});

test("签字不复用：给链 IR-001 签功能拆分，链 IR-002 仍 pending，缺的正是签字", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeSharedChains(cwd);
  const splitOf = async (chain: string) =>
    parseJson<ChainSharedOutput>(
      (await run(["status", "--chain", chain, "--json"], { cwd })).stdout,
    ).chain.gates.find((gate) => gate.gate === "function-split")!;

  // 起点：两条链都没人签过
  assert.equal((await splitOf("IR-001")).state, "pending");
  assert.equal((await splitOf("IR-002")).state, "pending");

  // 只给链 IR-001 签字（UC-001 由 FN-001 realizes，两条链的自动挡都过——差的只有签字）
  write(
    cwd,
    "baize/chains/IR-001.yaml",
    `skipped: {}
gates:
  function-split:
    by: alice
    at: 2026-10-12
    criterion: ${FUNCTION_SPLIT_CRITERION}
`,
  );

  const signed = await splitOf("IR-001");
  assert.equal(signed.state, "passed", "IR-001：签字 + 自动挡齐 → passed");
  assert.equal(signed.by, "alice");

  const other = await splitOf("IR-002");
  assert.equal(other.state, "pending", "签字按链各签各的，不跨链复用");
  assert.equal(other.by, null);
  assert.deepEqual(
    other.missing,
    ["签字：gates.function-split 缺 by + at 的人工通过记录"],
    `缺的正是签字：${JSON.stringify(other.missing)}`,
  );
});

test("跳过不跨链：链 IR-001 跳过 scenario 段，链 IR-002 的同一段仍未跳过", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeSharedChains(cwd);
  // 只在链 IR-001 的状态文件里记跳过（跳过记录是链级属性）
  write(
    cwd,
    "baize/chains/IR-001.yaml",
    `skipped:
  scenario:
    by: crazytomatooo
    at: 2026-10-12
    why: 交互由既有产品承载，本链不再单独设计场景
`,
  );

  const stageOf = async (chain: string, stage: string) =>
    parseJson<ChainSharedOutput>(
      (await run(["status", "--chain", chain, "--json"], { cwd })).stdout,
    ).chain.stages.find((view) => view.stage === stage)!;

  const mine = await stageOf("IR-001", "scenario");
  assert.notEqual(mine.skipped, null, "IR-001 的 scenario 段已跳过");
  assert.equal(mine.skipped?.by, "crazytomatooo");
  assert.equal(mine.skipped?.why, "交互由既有产品承载，本链不再单独设计场景");

  const other = await stageOf("IR-002", "scenario");
  assert.equal(other.skipped, null, "跳过记录只管本链：IR-002 的 scenario 仍未跳过");
});

test("自动挡各自按本链成员算：只有链 IR-001 有的未实现用例，只有那条链的自动挡不过", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeSharedChains(cwd);
  // UC-002 只认领 SR-001（只进链 IR-001），没有任何功能项 realizes 它
  write(cwd, "baize/usecases/UC-002.md", LEGAL_UC.replace("id: UC-001", "id: UC-002"));

  const splitOf = async (chain: string) =>
    parseJson<ChainSharedOutput>(
      (await run(["status", "--chain", chain, "--json"], { cwd })).stdout,
    ).chain.gates.find((gate) => gate.gate === "function-split")!;
  const mine = await splitOf("IR-001");
  assert.equal(
    mine.checks?.find((check) => check.check.includes("realizes"))?.passed,
    false,
    "UC-002 无人承载 → 链 IR-001 的自动挡不过",
  );
  assert.deepEqual(
    mine.pending?.unrealizedUsecases.map((usecase) => usecase.id),
    ["UC-002"],
  );

  const other = await splitOf("IR-002");
  assert.equal(
    other.checks?.find((check) => check.check.includes("realizes"))?.passed,
    true,
    "UC-002 不在链 IR-002 的成员里 → 同一项自动挡在该链照过",
  );
  assert.deepEqual(other.pending?.unrealizedUsecases, []);
});

// ---- #186 清单格式校验 + 解析保护：清单是外部维护的文件，按脏输入处理 ----

test("validate：catalog.unparseable —— 清单写重复键不再抛栈，报一条带文件与行号的 ERROR（--json 可解析、退出码 1）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  // 第二个 a 在第 3 行——之前这里会抛 YAMLParseError: Map keys must be unique 一坨栈
  write(cwd, "baize/architecture.yaml", "components:\n  a: { name: A }\n  a: { name: B }\n");

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const unparseable = parseJson<ValidateOutput>(result.stdout).issues.filter(
    (issue) => issue.rule === "catalog.unparseable",
  );
  assert.equal(unparseable.length, 1, result.stdout);
  assert.equal(unparseable[0]!.level, "ERROR");
  assert.equal(unparseable[0]!.path, "baize/architecture.yaml");
  assert.match(unparseable[0]!.message, /第 3 行/, `消息应带行号：${result.stdout}`);

  // 人读模式同一份数据，同样不出栈
  const human = await run(["validate"], { cwd });
  assert.equal(human.exitCode, 1, human.stdout);
  assert.match(human.stdout, /catalog\.unparseable baize\/architecture\.yaml/);

  // 解析保护惠及所有读者：rename 读同一份清单，拒绝时 exit 2（不抛栈、不动文件）
  const rename = await run(["rename", "element", "a", "b", "--json"], { cwd });
  assert.equal(rename.exitCode, 2, rename.stdout);
  assert.equal(parseJson<ErrorOutput>(rename.stdout).error.rule, "rename.unknown-slug");
});

test("validate：catalog.invalid-slug —— 清单 slug 不是 kebab-case 报 ERROR（带 slug 与行号）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  write(
    cwd,
    "baize/architecture.yaml",
    "components:\n  Export Service: { name: A }\n  export_service: { name: B }\n",
  );

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const invalid = parseJson<ValidateOutput>(result.stdout).issues.filter(
    (issue) => issue.rule === "catalog.invalid-slug",
  );
  assert.equal(invalid.length, 2, result.stdout);
  assert.ok(
    invalid.every(
      (issue) => issue.level === "ERROR" && issue.path === "baize/architecture.yaml",
    ),
    result.stdout,
  );
  assert.match(invalid[0]!.message, /Export Service/, result.stdout);
  assert.match(invalid[0]!.message, /第 2 行/, `消息应带行号：${result.stdout}`);
  assert.match(invalid[1]!.message, /export_service/, result.stdout);

  // kebab-case 不报——顺带守住「粒度不查」：一个组件的清单也零清单问题
  write(cwd, "baize/architecture.yaml", "components:\n  export-service: { name: 导出服务 }\n");
  const good = await run(["validate", "--json"], { cwd });
  assert.equal(good.exitCode, 0, good.stdout);
  assert.ok(
    parseJson<ValidateOutput>(good.stdout).issues.every((issue) => !issue.rule.startsWith("catalog.")),
    `不应有清单问题：${good.stdout}`,
  );
});

test("validate：catalog.name-missing / catalog.description-empty —— name 缺失或空、description 写了就非空，都报 ERROR", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  // 三种坏法：name 空串 / name 缺失 / description 空串（写了就必须非空）
  write(
    cwd,
    "baize/architecture.yaml",
    'components:\n  export-service: { name: "" }\n  audit-log: {}\n  billing: { name: 账单, description: "" }\n',
  );

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues;
  const missing = issues.filter((issue) => issue.rule === "catalog.name-missing");
  assert.equal(missing.length, 2, result.stdout);
  assert.match(missing[0]!.message, /export-service/, result.stdout);
  assert.match(missing[0]!.message, /第 2 行/, `消息应带行号：${result.stdout}`);
  assert.match(missing[1]!.message, /audit-log/, result.stdout);
  const emptyDesc = issues.filter((issue) => issue.rule === "catalog.description-empty");
  assert.equal(emptyDesc.length, 1, result.stdout);
  assert.match(emptyDesc[0]!.message, /billing/, result.stdout);
  assert.match(emptyDesc[0]!.message, /第 4 行/, `消息应带行号：${result.stdout}`);

  // 修好 → 零清单问题（description 不写也合法——「若存在则非空」）
  write(
    cwd,
    "baize/architecture.yaml",
    "components:\n  export-service: { name: 导出服务 }\n  audit-log: { name: 审计 }\n  billing: { name: 账单, description: 出账 }\n",
  );
  const good = await run(["validate", "--json"], { cwd });
  assert.equal(good.exitCode, 0, good.stdout);
  assert.ok(
    parseJson<ValidateOutput>(good.stdout).issues.every(
      (issue) => !issue.rule.startsWith("catalog."),
    ),
    `不应有清单问题：${good.stdout}`,
  );
});

test("validate：catalog.top-key-not-mapping —— 配定顶层键不是映射时报 ERROR（两份清单对称）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", LEGAL_SR_FULL);
  write(cwd, "baize/architecture.yaml", "components:\n  - export-service\n  - audit-log\n");

  const result = await run(["validate", "--json"], { cwd });
  assert.equal(result.exitCode, 1, result.stdout);
  const issues = parseJson<ValidateOutput>(result.stdout).issues.filter(
    (issue) => issue.rule === "catalog.top-key-not-mapping",
  );
  assert.equal(issues.length, 1, result.stdout);
  assert.equal(issues[0]!.level, "ERROR");
  assert.equal(issues[0]!.path, "baize/architecture.yaml");
  assert.match(issues[0]!.message, /components/, result.stdout);
  assert.match(issues[0]!.message, /第 1 行/, `消息应带行号：${result.stdout}`);

  // 场景目录词表同一读法（ADR-0004：两份清单是同一类东西，形态与校验统一）
  write(cwd, "baize/scenario-catalogs.yaml", "catalogs: order-flow\n");
  const both = await run(["validate", "--json"], { cwd });
  assert.equal(both.exitCode, 1, both.stdout);
  const paths = parseJson<ValidateOutput>(both.stdout).issues
    .filter((issue) => issue.rule === "catalog.top-key-not-mapping")
    .map((issue) => issue.path);
  assert.deepEqual(
    [...paths].sort(),
    ["baize/architecture.yaml", "baize/scenario-catalogs.yaml"],
    both.stdout,
  );

  // 修好 → 零清单问题
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);
  const good = await run(["validate", "--json"], { cwd });
  assert.equal(good.exitCode, 0, good.stdout);
  assert.ok(
    parseJson<ValidateOutput>(good.stdout).issues.every(
      (issue) => !issue.rule.startsWith("catalog."),
    ),
    `不应有清单问题：${good.stdout}`,
  );
});

test("validate：清单只查格式不查粒度——1 个或 200 个组件的清单都零清单问题（ADR-0004 禁区）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFullChain(cwd);
  await acceptAndRead(cwd, "IR-001");

  // 只剩 1 个组件（AR 引用的 export-service 还在）→ 全绿
  write(cwd, "baize/architecture.yaml", "components:\n  export-service: { name: 导出服务 }\n");
  const single = await run(["validate", "--json"], { cwd });
  assert.equal(single.exitCode, 0, single.stdout);
  assert.ok(
    parseJson<ValidateOutput>(single.stdout).issues.every(
      (issue) => !issue.rule.startsWith("catalog."),
    ),
    `组件多少不是格式问题：${single.stdout}`,
  );

  // 200 个组件同样零清单问题——粒度/层级/数量都在「组件该怎么分」的界外
  const big = ["components:", "  export-service: { name: 导出服务 }"];
  for (let i = 2; i <= 200; i++) {
    big.push(`  comp-${String(i).padStart(3, "0")}: { name: 组件${i} }`);
  }
  write(cwd, "baize/architecture.yaml", `${big.join("\n")}\n`);
  const many = await run(["validate", "--json"], { cwd });
  assert.equal(many.exitCode, 0, many.stdout);
  assert.deepEqual(
    parseJson<ValidateOutput>(many.stdout).issues.filter((issue) =>
      issue.rule.startsWith("catalog."),
    ),
    [],
    `粒度不是格式问题：${many.stdout}`,
  );
});

// ---- baize migrate（#185）：把旧模型的条目搬到新形状 ----
// 旧模型（#180 之前）：场景 / 用例 / 功能项用 parent 挂在 SR 下，功能点 parent 挂功能项
// 且没有认领边，场景的备选流拼作 alternateFlows。识别规则唯一（方案层的 parent 指向 SR），
// 默认 dry-run、--write 才落盘，拿不准就跳过并点名（纪律见 ADR-0006）。

/** 旧模型的场景：parent 挂 SR、备选流拼作 alternateFlows。 */
const OLD_MODEL_SC = `---
id: SC-001
title: 下单主流程
parent: SR-001
catalog: order-flow
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

/** 旧模型的用例：parent 挂 SR（备选流本来就是 alternativeFlows 拼写）。 */
const OLD_MODEL_UC = `---
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

/** 旧模型的功能项：parent 挂 SR。 */
const OLD_MODEL_FN = `---
id: FN-001
title: 订单服务
parent: SR-001
domain: 交易
realizes:
  - UC-001
description: 承载下单与订单查询的功能项。
---`;

/** 旧模型的功能点：parent 挂功能项、没有认领边（旧模型根本没有这条边）。 */
const OLD_MODEL_FP = `---
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
---`;

/** 旧模型靶子：pre-#180 的 chain-sample 形状（七层各一条，方案层挂在 SR 下）。 */
function writeOldModelChain(cwd: string): void {
  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1, IR-001#a2"));
  write(cwd, "baize/architecture.yaml", ARCHITECTURE_YAML);
  write(cwd, "baize/ar/AR-001.md", AR_UNDER_SR001);
  write(cwd, "baize/scenario-catalogs.yaml", SCENARIO_CATALOGS_YAML);
  write(cwd, "baize/scenarios/SC-001.md", OLD_MODEL_SC);
  write(cwd, "baize/usecases/UC-001.md", OLD_MODEL_UC);
  write(cwd, "baize/function-items/FN-001.md", OLD_MODEL_FN);
  write(cwd, "baize/function-points/FP-001.md", OLD_MODEL_FP);
}

test("migrate：多余参数或不支持的选项 → exit 2 用法错；仓库里没有旧模型的边 → 0 处改动、exit 0", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeOldModelChain(cwd);

  const extra = await run(["migrate", "now"], { cwd });
  assert.equal(extra.exitCode, 2);
  const strict = await run(["migrate", "--strict"], { cwd });
  assert.equal(strict.exitCode, 2);
  const chain = await run(["migrate", "--chain", "IR-001"], { cwd });
  assert.equal(chain.exitCode, 2);

  // 连 baize/ 都没有的空仓库：0 处改动也是成功（幂等的另一面）
  const emptyCwd = mkdtempSync(join(tmpdir(), "baize-empty-"));
  t.after(() => rmSync(emptyCwd, { recursive: true, force: true }));
  const empty = await run(["migrate"], { cwd: emptyCwd });
  assert.equal(empty.exitCode, 0, empty.stdout);
  assert.match(empty.stdout, /0 处改动/);
});

test("migrate dry-run：打印 文件+行+旧值→新值 与「建议先提交」，文件字节不变", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeOldModelChain(cwd);

  const before = snapshotDir(cwd, "baize");
  const result = await run(["migrate"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  assert.match(result.stdout, /发现 \d+ 处改动/);
  // 行号由条目内容决定，只断言形状（别把行号钉死，夹具一改就假红）
  assert.match(result.stdout, /baize\/scenarios\/SC-001\.md:\d+: parent: SR-001 → refines: \[SR-001\]/);
  assert.match(result.stdout, /baize\/usecases\/UC-001\.md:\d+: parent: SR-001 → refines: \[SR-001\]/);
  assert.match(result.stdout, /baize\/scenarios\/SC-001\.md:\d+: alternateFlows → alternativeFlows/);
  assert.match(
    result.stdout,
    /baize\/function-points\/FP-001\.md:\d+: \(缺失\) → satisfies: \[SR-001\]（继承 FN-001 的认领）/,
  );
  assert.match(result.stdout, /baize\/function-items\/FN-001\.md:\d+: parent: SR-001 → satisfies: \[SR-001\]/);
  assert.match(result.stdout, /建议先提交/);
  // 协议级断言：dry-run 前后文件字节不变（含清单文件）
  assert.ok(snapshotEqual(before, snapshotDir(cwd, "baize")), "dry-run 不得写盘");
});

test("migrate --write：旧模型七层链搬到新形状，validate --strict 零问题；不该动的边原样", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "fixture");
  writeOldModelChain(cwd);
  // 链根先确认，严格模式才不被 stage.upstream-unconfirmed 挡（migrate 不动 IR，确认不失效）
  await acceptAndRead(cwd, "IR-001");

  const arBefore = readFileSync(join(cwd, "baize/ar/AR-001.md"), "utf8");
  const srBefore = readFileSync(join(cwd, "baize/sr/SR-001.md"), "utf8");

  const result = await run(["migrate", "--write"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  assert.match(result.stdout, /已改写 5 处改动/);

  // 场景：parent 换成 refines（原位），备选流统一拼写；其余字段不动
  const sc = readFileSync(join(cwd, "baize/scenarios/SC-001.md"), "utf8");
  const scFm = frontmatterOf(sc);
  assert.deepEqual(scFm["refines"], ["SR-001"], "parent 换成 refines（原位）");
  assert.equal(scFm["parent"], undefined);
  assert.deepEqual(scFm["alternativeFlows"], [], "备选流统一拼写");
  assert.equal(scFm["alternateFlows"], undefined, "旧拼写不应残留");
  // 用例：parent 换成 refines；关联边原样
  const uc = readFileSync(join(cwd, "baize/usecases/UC-001.md"), "utf8");
  const ucFm = frontmatterOf(uc);
  assert.deepEqual(ucFm["refines"], ["SR-001"]);
  assert.equal(ucFm["parent"], undefined);
  assert.deepEqual(ucFm["appearsIn"], ["SC-001"], "关联边原样");
  // 功能项：parent 换成 satisfies；关联边原样
  const fn = readFileSync(join(cwd, "baize/function-items/FN-001.md"), "utf8");
  const fnFm = frontmatterOf(fn);
  assert.deepEqual(fnFm["satisfies"], ["SR-001"]);
  assert.equal(fnFm["parent"], undefined);
  assert.deepEqual(fnFm["realizes"], ["UC-001"], "关联边原样");
  // 功能点：parent 原样（不误伤），认领边从所属功能项继承（旧模型没有这条边，所属
  // 功能项的认领是唯一可推导的来源）
  const fp = readFileSync(join(cwd, "baize/function-points/FP-001.md"), "utf8");
  const fpFm = frontmatterOf(fp);
  assert.equal(fpFm["parent"], "FN-001");
  assert.deepEqual(fpFm["satisfies"], ["SR-001"]);
  // AR 的 parent（SR→AR 在新模型仍合法）与 SR 的 covers：一字未动
  assert.equal(readFileSync(join(cwd, "baize/ar/AR-001.md"), "utf8"), arBefore);
  assert.equal(readFileSync(join(cwd, "baize/sr/SR-001.md"), "utf8"), srBefore);

  // 搬完就是新形状：严格校验零问题
  const strict = await run(["validate", "--strict", "--json"], { cwd });
  assert.equal(strict.exitCode, 0, strict.stdout);
  assert.deepEqual(parseJson<ValidateOutput>(strict.stdout).issues, []);
});

test("migrate 拿不准就不猜：指向不存在 / 指错层的 parent → 跳过并点名，parent 一字不动", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeOldModelChain(cwd);
  // SC-002：parent 指向不存在的 SR-099（备选流改名是独立判断，照常做）
  write(
    cwd,
    "baize/scenarios/SC-002.md",
    OLD_MODEL_SC.replace("id: SC-001", "id: SC-002").replace(
      "parent: SR-001",
      "parent: SR-099",
    ),
  );
  // UC-002：parent 指向 IR-001——条目存在但不是 SR
  write(
    cwd,
    "baize/usecases/UC-002.md",
    OLD_MODEL_UC.replace("id: UC-001", "id: UC-002").replace(
      "parent: SR-001",
      "parent: IR-001",
    ),
  );
  // SC-003：子场景（parent 挂 SC-001，新旧模型都合法）——parent 不动，缺认领边时点名
  write(
    cwd,
    "baize/scenarios/SC-003.md",
    OLD_MODEL_SC.replace("id: SC-001", "id: SC-003").replace(
      "parent: SR-001",
      "parent: SC-001",
    ),
  );
  // FP-002：parent 指向 SR——功能点的 parent 应指功能项，不敢改写
  write(
    cwd,
    "baize/function-points/FP-002.md",
    OLD_MODEL_FP.replace("id: FP-001", "id: FP-002").replace(
      "parent: FN-001",
      "parent: SR-001",
    ),
  );
  // FN-002 的 parent 也指向不存在的 SR-099；FP-003 挂在它下面——所属功能项没有
  // 可继承的认领边，功能点也拿不准
  write(
    cwd,
    "baize/function-items/FN-002.md",
    OLD_MODEL_FN.replace("id: FN-001", "id: FN-002").replace(
      "parent: SR-001",
      "parent: SR-099",
    ),
  );
  write(
    cwd,
    "baize/function-points/FP-003.md",
    OLD_MODEL_FP.replace("id: FP-001", "id: FP-003").replace(
      "parent: FN-001",
      "parent: FN-002",
    ),
  );

  const before = snapshotDir(cwd, "baize");
  const result = await run(["migrate", "--json"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  interface MigrateOutput {
    write: boolean;
    changes: unknown[];
    skipped: { path: string; reason: string }[];
  }
  const data = parseJson<MigrateOutput>(result.stdout);
  // 六处点名：每个拿不准的条目都在清单里
  assert.deepEqual(
    data.skipped.map((skip) => skip.path).sort(),
    [
      "baize/function-items/FN-002.md",
      "baize/function-points/FP-002.md",
      "baize/function-points/FP-003.md",
      "baize/scenarios/SC-002.md",
      "baize/scenarios/SC-003.md",
      "baize/usecases/UC-002.md",
    ],
    result.stdout,
  );
  // 点名要说清指向了谁、为什么不动
  const reasonOf = (suffix: string): string =>
    data.skipped.find((skip) => skip.path.endsWith(suffix))?.reason ?? "";
  assert.match(reasonOf("SC-002.md"), /SR-099/);
  assert.match(reasonOf("UC-002.md"), /IR-001/);
  assert.match(reasonOf("SC-003.md"), /refines/);
  assert.match(reasonOf("FP-002.md"), /SR-001/);
  assert.match(reasonOf("FP-003.md"), /FN-002/);

  // --write：能搬的照样搬，被点名的 parent 一字不动
  const written = await run(["migrate", "--write"], { cwd });
  assert.equal(written.exitCode, 0, written.stdout);
  // 旧链 5 处 + 两个拿不准场景的备选流改名（改名独立于 parent 判断）= 7 处
  assert.match(written.stdout, /已改写 7 处改动/);
  assert.match(written.stdout, /跳过 6 处/);
  // snapshotDir 的键相对 baize/（与 rename 的用例同一份快照工具）
  for (const rel of [
    "scenarios/SC-002.md",
    "usecases/UC-002.md",
    "scenarios/SC-003.md",
    "function-points/FP-002.md",
    "function-items/FN-002.md",
    "function-points/FP-003.md",
  ]) {
    const after = readFileSync(join(cwd, "baize", rel), "utf8");
    assert.equal(
      frontmatterOf(after)["parent"],
      frontmatterOf(before.get(rel) ?? "")["parent"],
      `${rel} 的 parent 一字不动`,
    );
    // 除场景的备选流键改名外，拿不准的条目整个文件不动
    if (rel !== "scenarios/SC-002.md" && rel !== "scenarios/SC-003.md") {
      assert.equal(after, before.get(rel), `${rel} 拿不准就整个不动`);
    }
  }
  // 子场景不代填认领边：解析后看，refines 确实没长出来
  assert.equal(
    frontmatterOf(readFileSync(join(cwd, "baize/scenarios/SC-003.md"), "utf8"))["refines"],
    undefined,
    "子场景的认领边由人决定，migrate 不代填",
  );
});

/** 递归收集目录内每个文件的 mtime（毫秒），用于「0 改动时文件 mtime 不变」的协议级断言。 */
function mtimesOf(cwd: string, rel: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (abs: string, prefix: string): void => {
    for (const name of readdirSync(abs)) {
      const childAbs = join(abs, name);
      const childRel = prefix === "" ? name : `${prefix}/${name}`;
      if (statSync(childAbs).isDirectory()) walk(childAbs, childRel);
      else out.set(childRel, statSync(childAbs).mtimeMs);
    }
  };
  walk(join(cwd, rel), "");
  return out;
}

test("migrate 幂等：对已迁移的仓库再跑（含 --write）= 0 处改动、exit 0、文件字节与 mtime 不变", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeOldModelChain(cwd);
  const first = await run(["migrate", "--write"], { cwd });
  assert.equal(first.exitCode, 0, first.stdout);

  const bytesBefore = snapshotDir(cwd, "baize");
  const mtimesBefore = mtimesOf(cwd, "baize");
  const dry = await run(["migrate"], { cwd });
  assert.equal(dry.exitCode, 0, dry.stdout);
  assert.match(dry.stdout, /0 处改动/);
  const again = await run(["migrate", "--write"], { cwd });
  assert.equal(again.exitCode, 0, again.stdout);
  assert.match(again.stdout, /0 处改动/);
  // 协议级断言：0 改动时不写任何文件——字节与 mtime 都不变
  assert.ok(snapshotEqual(bytesBefore, snapshotDir(cwd, "baize")), "幂等再跑不得写盘");
  assert.deepEqual(mtimesOf(cwd, "baize"), mtimesBefore, "0 改动时文件 mtime 不变");
});

test("migrate 对已迁移的 fixture（chain-sample，已是新形状）→ 0 处改动、exit 0、一字不写", async () => {
  const fixture = join(import.meta.dirname, "fixtures/chain-sample");
  const before = snapshotDir(fixture, "baize");
  const result = await run(["migrate"], { cwd: fixture });
  assert.equal(result.exitCode, 0, result.stdout);
  assert.match(result.stdout, /0 处改动/);
  assert.ok(snapshotEqual(before, snapshotDir(fixture, "baize")), "dry-run 不得写盘");
});

test("migrate 不碰半迁移的僵局：已有认领边却留着 parent、两种备选流拼写并存 → 各自点名，僵局由人解", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeOldModelChain(cwd);
  // SC-004：已有 refines 却还留着 parent: SR-001——改写 parent 会产生重复键
  write(
    cwd,
    "baize/scenarios/SC-004.md",
    OLD_MODEL_SC.replace("id: SC-001", "id: SC-004").replace(
      "parent: SR-001",
      "parent: SR-001\nrefines:\n  - SR-002",
    ),
  );
  // SC-005：alternateFlows 与 alternativeFlows 并存——改名会造成重复键
  write(
    cwd,
    "baize/scenarios/SC-005.md",
    OLD_MODEL_SC.replace("id: SC-001", "id: SC-005").replace(
      "alternateFlows: []",
      "alternateFlows: []\nalternativeFlows: []",
    ),
  );

  const before = snapshotDir(cwd, "baize");
  const result = await run(["migrate", "--json"], { cwd });
  assert.equal(result.exitCode, 0, result.stdout);
  interface MigrateOutput {
    write: boolean;
    changes: { path: string }[];
    skipped: { path: string; reason: string }[];
  }
  const data = parseJson<MigrateOutput>(result.stdout);
  assert.deepEqual(
    data.skipped.map((skip) => skip.path).sort(),
    ["baize/scenarios/SC-004.md", "baize/scenarios/SC-005.md"],
    result.stdout,
  );
  assert.match(
    data.skipped.find((skip) => skip.path.endsWith("SC-004.md"))?.reason ?? "",
    /refines/,
  );
  assert.match(
    data.skipped.find((skip) => skip.path.endsWith("SC-005.md"))?.reason ?? "",
    /同时存在/,
  );

  const written = await run(["migrate", "--write"], { cwd });
  assert.equal(written.exitCode, 0, written.stdout);
  // SC-004：parent 与已有 refines 一字不动（僵局由人解），备选流照常改名
  const sc4 = readFileSync(join(cwd, "baize/scenarios/SC-004.md"), "utf8");
  const sc4Fm = frontmatterOf(sc4);
  assert.equal(sc4Fm["parent"], "SR-001", "僵局里的 parent 一字不动");
  assert.deepEqual(sc4Fm["refines"], ["SR-002"], "僵局里的 refines 一字不动");
  assert.deepEqual(sc4Fm["alternativeFlows"], [], "备选流照常改名");
  // SC-005：两种拼写都留着（不敢改名），parent 照常搬（它没有别的认领边）
  const sc5 = readFileSync(join(cwd, "baize/scenarios/SC-005.md"), "utf8");
  const sc5Fm = frontmatterOf(sc5);
  assert.deepEqual(sc5Fm["alternateFlows"], [], "旧拼写不敢改名");
  assert.deepEqual(sc5Fm["alternativeFlows"], [], "新拼写照旧保留");
  assert.deepEqual(sc5Fm["refines"], ["SR-001"]);
  assert.equal(sc5Fm["parent"], undefined, "parent 照常搬");
  // 其余条目不受僵局影响：旧链 5 处 + SC-004 改名 + SC-005 搬边 = 7 处
  assert.match(written.stdout, /已改写 7 处改动/);
});

// —— #190 评审修复：认领多条 SR 的条目同属多条链，未确认门禁按所有链根判 ——

test("validate：stage.upstream-unconfirmed —— 一条用例认领两条 SR、只确认其中一条链根 → 仍报另一条链的未确认", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeSharedChains(cwd);
  // 两条链根都未确认：UC-001 / SC-001 / FN-001 / FP-001 / SR-001 / SR-002 / AR-001 全部报
  const none = parseJson<ValidateOutput>((await run(["validate", "--json"], { cwd })).stdout);
  const gated = none.issues
    .filter((issue) => issue.rule === "stage.upstream-unconfirmed")
    .map((issue) => issue.path);
  assert.ok(gated.includes("baize/usecases/UC-001.md"), JSON.stringify(gated));

  // 只确认第一条链的根（IR-001）：UC-001 仍认领 SR-002，其链根 IR-002 未确认 → 继续报
  await acceptAndRead(cwd, "IR-001");
  const half = await run(["validate", "--json"], { cwd });
  const still = parseJson<ValidateOutput>(half.stdout).issues.filter(
    (issue) => issue.rule === "stage.upstream-unconfirmed",
  );
  assert.deepEqual(
    still.map((issue) => issue.path).sort(),
    ["baize/sr/SR-002.md", "baize/usecases/UC-001.md"],
    half.stdout,
  );
  const ucIssue = still.find((issue) => issue.path === "baize/usecases/UC-001.md");
  assert.ok(ucIssue, half.stdout);
  assert.ok(ucIssue?.message.includes("IR-002"), ucIssue?.message);

  // 同一判据在 status 链视图的门禁里也成立：共享成员踩着未确认的另一条链 → ir-entry pending
  const gatePending = parseJson<ChainSharedOutput>(
    (await run(["status", "--chain", "IR-001", "--json"], { cwd })).stdout,
  ).chain.gates.find((gate) => gate.gate === "ir-entry");
  assert.equal(gatePending?.state, "pending");

  // 两条链根都确认后，门禁问题清空（SR-002 无 AR 的 sr.unallocated 与本测试无关）
  await acceptAndRead(cwd, "IR-002");
  const both = await run(["validate", "--json"], { cwd });
  const gateLeft = parseJson<ValidateOutput>(both.stdout).issues.filter(
    (issue) => issue.rule === "stage.upstream-unconfirmed",
  );
  const gatePassed = parseJson<ChainSharedOutput>(
    (await run(["status", "--chain", "IR-001", "--json"], { cwd })).stdout,
  ).chain.gates.find((gate) => gate.gate === "ir-entry");
  assert.equal(gatePassed?.state, "passed");
  assert.deepEqual(gateLeft, [], both.stdout);
});

// 评审发现（`/code-review` Spec 轴，P1）：功能点**同时**有父（挂功能项）与认领边，
// 向上走时只跟了父那一路——它认领的另一条链的链根就漏出链根集合，门禁随之漏报。
test("stage.upstream-unconfirmed：功能点同时有父与认领边 → 两条链的链根都参与门禁（#190 评审修复）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  injectUser(t, "alice");
  writeSharedChains(cwd);
  // FP-001 的父是 FN-001（认领 SR-001），但它自己认领 SR-002 —— 同属两条链
  write(
    cwd,
    "baize/function-points/FP-001.md",
    LEGAL_FP.replace("satisfies:\n  - SR-001", "satisfies:\n  - SR-002"),
  );
  await acceptAndRead(cwd, "IR-001"); // 只确认第一条链的链根

  const result = await run(["validate", "--json"], { cwd });
  const fp = parseJson<ValidateOutput>(result.stdout).issues.filter(
    (issue) => issue.rule === "stage.upstream-unconfirmed" && issue.path.endsWith("FP-001.md"),
  );
  assert.equal(fp.length, 1, result.stdout);
  assert.ok(
    fp[0]?.message.includes("IR-002"),
    "应点名它认领的那条链的链根 IR-002：" + fp[0]?.message,
  );

  // 第二条链根也确认后，这一条清空
  await acceptAndRead(cwd, "IR-002");
  const after = parseJson<ValidateOutput>(
    (await run(["validate", "--json"], { cwd })).stdout,
  ).issues.filter(
    (issue) => issue.rule === "stage.upstream-unconfirmed" && issue.path.endsWith("FP-001.md"),
  );
  assert.deepEqual(after, []);
});

// ——— #193 发号账本与条目发现 ————————————————————————————————
// 已发出去的编号不得复用：账本记「发过哪些号」，层目录只能记「现在有什么」。
// 断言只落在 CLI 缝上；账本断言的是解析后的数据，不是文件措辞。

function idsOf(cwd: string, layer: string): unknown {
  const text = readFileSync(join(cwd, "baize/ids.yaml"), "utf8");
  return (parseYaml(text) as Record<string, unknown>)[layer];
}

function issuesOf(result: { stdout: string }): Issue[] {
  return parseJson<ValidateOutput>(result.stdout).issues;
}

test("#193 发号当场记账；删掉刚建的条目后再发号，编号不回退", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  const first = parseJson<CreatedOutput>((await run(["new", "ir", "--json"], { cwd })).stdout);
  assert.equal(first.created.id, "IR-001");
  assert.equal(idsOf(cwd, "ir"), 1, "发号当场记账");

  rmSync(join(cwd, "baize/ir/IR-001.md"));

  const second = await run(["new", "ir", "--json"], { cwd });
  assert.equal(second.exitCode, 0, second.stdout);
  assert.equal(
    parseJson<CreatedOutput>(second.stdout).created.id,
    "IR-002",
    "编号一旦发出就不复用：" + second.stdout,
  );
  assert.equal(idsOf(cwd, "ir"), 2);
});

test("#193 把条目搬进层目录的子目录：编号不回退，该路径被点名（id.stray）", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  // 账本缺失时以「层目录里已有的最大号」为基线：接下去的新号是 IR-002
  const issued = parseJson<CreatedOutput>((await run(["new", "ir", "--json"], { cwd })).stdout);
  assert.equal(issued.created.id, "IR-002");

  // 当成「归档」搬进子目录：模型只扫层目录第一层，它就此从模型里消失
  write(cwd, "baize/ir/archive/IR-002.md", LEGAL_IR);
  rmSync(join(cwd, "baize/ir/IR-002.md"));

  const next = parseJson<CreatedOutput>((await run(["new", "ir", "--json"], { cwd })).stdout);
  assert.equal(next.created.id, "IR-003", "搬走条目也不退号");

  const strays = issuesOf(await run(["validate", "--json"], { cwd })).filter(
    (issue) => issue.rule === "id.stray",
  );
  assert.equal(strays.length, 1, "一个子目录只报一次，不逐文件刷：" + JSON.stringify(strays));
  assert.equal(strays[0]?.path, "baize/ir/archive");
  assert.equal(strays[0]?.level, "WARNING");
});

test("#193 层目录里的非 .md 路径被点名；.md 文件一律当条目读；隐藏文件不算", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  write(cwd, "baize/ir/IR-001.md", LEGAL_IR);
  write(cwd, "baize/ir/notes.txt", "随手记\n");
  write(cwd, "baize/ir/archive/IR-002.md", LEGAL_IR);
  write(cwd, "baize/ir/.DS_Store", "系统留下的\n");
  // 名字不是三位号也是条目——条目只由「第一层的 .md」决定，id 取自正文 frontmatter
  write(cwd, "baize/ir/IR-1.md", LEGAL_IR.replaceAll("IR-001", "IR-008"));

  const strays = issuesOf(await run(["validate", "--json"], { cwd }))
    .filter((issue) => issue.rule === "id.stray")
    .map((issue) => issue.path)
    .sort();
  assert.deepEqual(strays, ["baize/ir/archive", "baize/ir/notes.txt"]);
});

test("#193 删掉被引用的条目后再发号：旧 covers 继续报 ref.unknown-clue，不静默改指", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  // 这条链是 CLI 建的：IR-001 被 SR-001 的 covers 指着
  await run(["new", "ir", "--json"], { cwd });
  write(cwd, "baize/sr/SR-001.md", srWithCovers("SR-001", "IR-001#a1"));
  rmSync(join(cwd, "baize/ir/IR-001.md"));

  // 新需求起草时又写了一条叫 a1 的验收线索——但号不复用，旧引用不得被顶替
  const created = parseJson<CreatedOutput>((await run(["new", "ir", "--json"], { cwd })).stdout);
  assert.equal(created.created.id, "IR-002");

  const issues = issuesOf(await run(["validate", "--json"], { cwd }));
  const dangling = issues.filter((issue) => issue.rule === "ref.unknown-clue");
  assert.equal(
    dangling.length,
    1,
    "旧引用必须继续报错，不能因为新条目同号同名就变成有效：" + JSON.stringify(issues),
  );
  assert.match(dangling[0]?.message ?? "", /IR-001#a1/);
});

test("#193 账本落后于目录：id.ledger-behind（INFO），下次发号自动跟上", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  await run(["new", "ir", "--json"], { cwd });
  // 有人手工塞了一条：0009 没走过 CLI，账本里只有 ir: 1
  write(cwd, "baize/ir/IR-009.md", LEGAL_IR.replaceAll("IR-001", "IR-009"));

  const issues = issuesOf(await run(["validate", "--json"], { cwd }));
  const behind = issues.find((issue) => issue.rule === "id.ledger-behind");
  assert.ok(behind, "账本落后必须报：" + JSON.stringify(issues));
  assert.equal(behind.level, "INFO");
  assert.equal(behind.path, "baize/ids.yaml");

  const next = parseJson<CreatedOutput>((await run(["new", "ir", "--json"], { cwd })).stdout);
  assert.equal(next.created.id, "IR-010", "手工塞进来的号也要被尊重");
  assert.equal(idsOf(cwd, "ir"), 10);

  const after = issuesOf(await run(["validate", "--json"], { cwd }));
  assert.ok(
    !after.some((issue) => issue.rule === "id.ledger-behind"),
    "账本跟上后不再报：" + JSON.stringify(after),
  );
});

test("#193 账本读不懂就不发号：new 拒绝（exit 2、目录零变化），validate 报 id.ledger-invalid", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "baize-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));

  write(cwd, "baize/ids.yaml", "ir: 3\nexport-service: 4\n");

  const result = await run(["new", "ir", "--json"], { cwd });
  assert.equal(result.exitCode, 2, result.stdout);
  assert.ok(parseJson<ErrorOutput>(result.stdout).error.rule, "拒绝必须带 rule");
  assert.ok(!existsSync(join(cwd, "baize/ir")), "读不懂账本时不许发号，目录零变化");

  const issues = issuesOf(await run(["validate", "--json"], { cwd }));
  const invalid = issues.find((issue) => issue.rule === "id.ledger-invalid");
  assert.ok(invalid, "账本读不懂必须报：" + JSON.stringify(issues));
  assert.equal(invalid.level, "ERROR");
  assert.equal(invalid.path, "baize/ids.yaml");
});
