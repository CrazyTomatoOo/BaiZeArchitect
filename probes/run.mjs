#!/usr/bin/env node
/**
 * 探针 runner：一条一条跑 probes.yaml，每条都在干净目录里起真实 harness
 * （pi 或 Claude Code，本地 checkout、不发布），把完整记录落到结果目录，
 * 按期望做机械判定，最后打一张表。
 *
 * 用法：
 *   node probes/run.mjs                       # 默认全部、pi
 *   node probes/run.mjs --gate                # 门槛集（每个 skill 一条 trigger）×3 次、取多数决
 *   node probes/run.mjs --only ir-miss        # 只跑一条（改完文案后的快回归）
 *   node probes/run.mjs --only ir-1 --only sr-2   可重复
 *   node probes/run.mjs --repeat 3            # 显式多跑（默认：门槛集 3，其余 1）
 *   node probes/run.mjs --harness claude      # 换 harness
 *   node probes/run.mjs --list                # 列出全部探针
 *
 * 记录落在 probes/results/<harness>-<时间戳>/（gitignored）：
 *   <id>/{prompt,cmd,stdout,stderr}.txt + transcript.jsonl + meta.json
 *   projects/<id>-xxx/  干净目录（fixture 搭出的初始项目状态，保留备查）
 *   summary.md / summary.json
 */
import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { FIXTURES } from "./fixtures.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const SKILLS_DIR = path.join(REPO, "skills");

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const only = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--only") only.push(argv[i + 1]);
}
const harness = flag("harness") ?? "pi";
const model = flag("model");
const outDir = flag("out");
const timeoutSec = Number(flag("timeout") ?? 600);
const repeatFlag = flag("repeat");
const gateMode = argv.includes("--gate");
const DEFAULT_MODEL = { pi: "volcengine-apigw/glm-5.2", claude: undefined };

if (!["pi", "claude"].includes(harness)) {
  console.error(`未知 harness：${harness}（可用：pi | claude）`);
  process.exit(2);
}

// ---------- skill 证据标记 ----------
/** 每个.skill：目录名（=skill 名）、正文一级标题（剥掉 frontmatter 后第一个 `# ` 行）。 */
async function loadSkillMarkers() {
  const dirs = (await fs.readdir(SKILLS_DIR)).filter((d) => !d.startsWith(".")).sort();
  const markers = {};
  for (const dir of dirs) {
    const text = await fs.readFile(path.join(SKILLS_DIR, dir, "SKILL.md"), "utf8");
    const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
    const heading = body.split("\n").find((line) => line.startsWith("# "));
    if (!heading) throw new Error(`${dir}/SKILL.md 没有一级标题`);
    markers[dir] = { name: dir, heading };
  }
  // 唯一性预检：一个 skill 的标题不许出现在别的 skill 正文里，否则「打开了 A」
  // 会被误判成「打开了 B」，机械判定就不可信了。
  for (const [dir, { heading }] of Object.entries(markers)) {
    for (const other of dirs) {
      if (other === dir) continue;
      const otherText = await fs.readFile(path.join(SKILLS_DIR, other, "SKILL.md"), "utf8");
      if (otherText.includes(heading)) {
        throw new Error(`标记污染：${other}/SKILL.md 里含有 ${dir} 的一级标题`);
      }
    }
  }
  return markers;
}

// ---------- 转录分析 ----------
/**
 * 把会话转录按行归类出三样东西：
 * - searchable：可能承载「skill 正文被读进上下文」的文本（assistant 文本、
 *   工具结果、注入附件）。两处系统级清单除外——它们天生包含所有 skill 的
 *   名字/描述/路径（pi 的 system 消息、claude 的 skill_listing），不能当证据。
 * - toolArgs：所有工具调用的参数（JSON 序列化后拼起来）。
 * - skillInvokes：claude 的 Skill 工具调用目标。
 */
function analyzeTranscript(raw, kind) {
  const searchable = [];
  const toolArgs = [];
  const calls = []; // {argsText, resultText}——判「真跑了」要配对结果，防把失败尝试当证据
  const skillInvokes = [];
  const model = [];
  const resultsById = new Map();
  const registerCall = (id, argsText, resultText = "") => {
    calls.push({ id, argsText, resultText });
    toolArgs.push(argsText);
  };
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (kind === "pi") {
      if (entry.type === "model_change") {
        model.push(`${entry.provider}/${entry.modelId}`);
        continue;
      }
      if (entry.type !== "message" || !entry.message) continue;
      const { role, content, toolCallId } = entry.message;
      if (role === "system") continue; // 系统提示含全部 skill 的路径，不算证据
      if (role === "toolResult") {
        const text = (Array.isArray(content) ? content : [])
          .map((part) => part.text ?? "")
          .join("\n");
        const call = calls.find((c) => c.id === toolCallId);
        if (call) call.resultText = text;
        else resultsById.set(toolCallId, text);
        continue;
      }
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === "text") searchable.push(part.text ?? "");
          else if (part.type === "toolCall") {
            registerCall(
              part.id,
              JSON.stringify(part.arguments ?? {}),
              resultsById.get(part.id) ?? "",
            );
          }
        }
      } else if (typeof content === "string") {
        searchable.push(content);
      }
    } else {
      if (entry.type === "attachment") {
        const t = entry.attachment?.type;
        if (t === "skill_listing" || t === "agent_listing_delta") continue;
        const text =
          typeof entry.attachment?.stdout === "string" ? entry.attachment.stdout : "";
        if (text) searchable.push(text);
        if (entry.attachment?.model) model.push(String(entry.attachment.model));
        continue;
      }
      if (entry.type === "assistant" && entry.message?.content) {
        for (const part of entry.message.content) {
          if (part.type === "text") searchable.push(part.text ?? "");
          else if (part.type === "tool_use") {
            registerCall(part.id, JSON.stringify(part.input ?? {}));
            if (part.name === "Skill") skillInvokes.push(JSON.stringify(part.input ?? {}));
          }
        }
      } else if (entry.type === "user" && entry.message?.content) {
        const content = entry.message.content;
        if (typeof content === "string") searchable.push(content);
        else if (Array.isArray(content)) {
          for (const part of content) {
            if (part.type === "tool_result") {
              const text =
                typeof part.content === "string"
                  ? part.content
                  : Array.isArray(part.content)
                    ? part.content.map((c) => c.text ?? "").join("\n")
                    : "";
              const call = calls.find((c) => c.id === part.tool_use_id);
              if (call) call.resultText = text;
              else resultsById.set(part.tool_use_id, text);
            } else if (part.type === "text") searchable.push(part.text ?? "");
          }
        }
      }
    }
  }
  // 迟到的结果（结果行先于调用行出现时已暂存）补挂到对应调用上。
  for (const call of calls) {
    if (call.resultText === "" && resultsById.has(call.id)) {
      call.resultText = resultsById.get(call.id) ?? "";
    }
  }
  return {
    searchable: searchable.join("\n"),
    toolArgs: toolArgs.join("\n"),
    calls,
    skillInvokes,
    model,
  };
}

/** 「真跑了」的证据：命令参数命中，且配对结果不是 command not found 这类失败。
 *  只看参数会把失败尝试也当命中——va-miss 那种「跑了但没跑成」必须区分出来。 */
function toolRan(analysis, re) {
  const regex = new RegExp(re);
  return analysis.calls.some(
    (call) => regex.test(call.argsText) && !/command not found/i.test(call.resultText),
  );
}

function judge(probe, analysis, reply, markers) {
  const fired = Object.values(markers)
    .filter((m) => skillEvidence(m, analysis))
    .map((m) => m.name);
  const hits = [];
  for (const criterion of probe.expect.any) {
    if (criterion.skill !== undefined) {
      if (skillEvidence(markers[criterion.skill], analysis)) hits.push(criterion);
    } else if (criterion.tool !== undefined) {
      if (toolRan(analysis, criterion.tool)) hits.push(criterion);
    } else if (criterion.reply !== undefined) {
      if (new RegExp(criterion.reply).test(reply)) hits.push(criterion);
    }
  }
  const pass = probe.expect.present ? hits.length > 0 : hits.length === 0;
  return { pass, hits, fired };
}

/** skill 被打开/调用的证据：正文标题进入上下文，或工具调用指向它的文件，或 Skill 调用。 */
function skillEvidence(marker, analysis) {
  return (
    analysis.searchable.includes(marker.heading) ||
    analysis.toolArgs.includes(`skills/${marker.name}/SKILL.md`) ||
    analysis.skillInvokes.some((inv) => inv.includes(marker.name))
  );
}

// ---------- harness 启动 ----------
function runHarness({ probe, projDir, probeOut }) {
  return new Promise((resolve) => {
    let cmd;
    let args;
    const env = { ...process.env };
    if (harness === "pi") {
      env.BAIZE_BOOTSTRAP_LOG = path.join(probeOut, "bootstrap.log");
      cmd = "pi";
      args = [
        "-p",
        "--approve",
        "--model",
        model ?? DEFAULT_MODEL.pi,
        "--session-dir",
        path.join(projDir, "sessions"),
        probe.prompt,
      ];
    } else {
      cmd = "claude";
      args = [
        "--plugin-dir",
        REPO,
        "--dangerously-skip-permissions",
        "-p",
        probe.prompt,
      ];
    }
    const started = Date.now();
    const child = spawn(cmd, args, { cwd: projDir, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(
      () => child.kill("SIGKILL"),
      timeoutSec * 1000,
    );
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ error: `无法启动 ${cmd}：${error.message}`, stdout, stderr, started });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, started, cmdLine: `${cmd} ${args.join(" ")}` });
    });
  });
}

/** 找本次会话的转录：pi 在 --session-dir 里取最新；claude 在 ~/.claude/projects/<munged>/ 里取 start 之后最新的。 */
async function findTranscript(projDir, startedMs) {
  if (harness === "pi") {
    const dir = path.join(projDir, "sessions");
    const files = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith(".jsonl"));
    if (files.length === 0) return undefined;
    const stats = await Promise.all(
      files.map(async (f) => ({ f, m: (await fs.stat(path.join(dir, f))).mtimeMs })),
    );
    stats.sort((a, b) => b.m - a.m);
    return path.join(dir, stats[0].f);
  }
  const real = await fs.realpath(projDir);
  const munged = real.split("/").join("-");
  const dir = path.join(os.homedir(), ".claude", "projects", munged);
  const files = (await fs.readdir(dir).catch(() => [])).filter((f) => f.endsWith(".jsonl"));
  const stats = (
    await Promise.all(
      files.map(async (f) => ({ f, m: (await fs.stat(path.join(dir, f))).mtimeMs })),
    )
  ).filter((s) => s.m >= startedMs - 2000);
  if (stats.length === 0) return undefined;
  stats.sort((a, b) => b.m - a.m);
  return path.join(dir, stats[0].f);
}

// ---------- 主流程 ----------
const probes = parseYaml(await fs.readFile(path.join(HERE, "probes.yaml"), "utf8"));
const markers = await loadSkillMarkers();

for (const probe of probes) {
  if (!FIXTURES[probe.fixture]) {
    console.error(`探针 ${probe.id} 引用了不存在的 fixture：${probe.fixture}`);
    process.exit(2);
  }
  for (const c of probe.expect.any) {
    if (c.skill !== undefined && !markers[c.skill]) {
      console.error(`探针 ${probe.id} 引用了不存在的 skill：${c.skill}`);
      process.exit(2);
    }
  }
}

if (argv.includes("--list")) {
  for (const p of probes) {
    console.log(`${p.id.padEnd(12)} ${p.skill.padEnd(15)} ${p.scenario.padEnd(8)} ${p.fixture.padEnd(18)} ${p.prompt}`);
  }
  process.exit(0);
}

if (gateMode && only.length > 0) {
  console.error("--gate 与 --only 不能同时用（门槛集是固定的那一批）");
  process.exit(2);
}
const selected = gateMode
  ? probes.filter((p) => p.gate === true)
  : only.length > 0
    ? probes.filter((p) => only.includes(p.id))
    : probes;
if (selected.length === 0) {
  console.error(gateMode ? "probes.yaml 里没有标 gate: true 的探针" : "--only 没有匹配到任何探针（可用 id 见 --list）");
  process.exit(2);
}
// 门槛集默认 N=3 多数决（关键处多采两次，抵消单采样翻转）；其余默认单次。
const repeat = repeatFlag !== undefined ? Number(repeatFlag) : gateMode ? 3 : 1;
if (!Number.isInteger(repeat) || repeat < 1) {
  console.error(`--repeat 需要一个正整数，收到：${repeatFlag}`);
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 17);
const out = path.resolve(outDir ?? path.join(HERE, "results", `${harness}-${stamp}`));
await fs.mkdir(path.join(out, "projects"), { recursive: true });
console.log(
  `# 探针集：${selected.length} 条${gateMode ? "（门槛集）" : ""}${repeat > 1 ? ` × ${repeat} 次 = ${selected.length * repeat} 次运行` : ""} · harness=${harness}${model ? ` · model=${model}` : ""}`,
);
console.log(`# 记录目录：${out}\n`);

const rows = [];
const attempts = selected.flatMap((probe) =>
  Array.from({ length: repeat }, (_, i) => ({ probe, n: i + 1 })),
);
for (const { probe, n } of attempts) {
  const label = repeat > 1 ? `${probe.id}#${n}` : probe.id;
  const probeOut = path.join(out, label);
  await fs.mkdir(probeOut, { recursive: true });
  await fs.writeFile(path.join(probeOut, "prompt.txt"), probe.prompt, "utf8");

  const projDir = await fs.mkdtemp(path.join(out, "projects", `${probe.id}-`));
  let status = "RUN";
  let detail = "";
  const meta = { id: probe.id, skill: probe.skill, scenario: probe.scenario, fixture: probe.fixture, attempt: n, attempts: repeat };

  try {
    // 1) 干净目录 + 初始状态（fixture 自带真 CLI 校验）
    if (harness === "pi") {
      await fs.mkdir(path.join(projDir, ".pi"), { recursive: true });
      await fs.writeFile(
        path.join(projDir, ".pi", "settings.json"),
        `${JSON.stringify({ packages: [REPO] }, null, 2)}\n`,
        "utf8",
      );
    }
    await FIXTURES[probe.fixture].build(projDir, REPO);
    await FIXTURES[probe.fixture].verify(projDir);

    // 2) 真实 harness、干净会话、一句自然语言
    const run = await runHarness({ probe, projDir, probeOut });
    await fs.writeFile(path.join(probeOut, "cmd.txt"), `${run.cmdLine ?? "(未启动)"}\ncwd: ${projDir}\n`, "utf8");
    await fs.writeFile(path.join(probeOut, "stdout.txt"), run.stdout, "utf8");
    await fs.writeFile(path.join(probeOut, "stderr.txt"), run.stderr, "utf8");
    meta.durationMs = Date.now() - run.started;
    meta.exitCode = run.code;
    meta.projectDir = projDir;
    if (run.error) throw new Error(run.error);
    if (run.code === null) {
      detail = "超时被杀（触发证据以转录为准，无最终回复）";
      meta.timedOut = true;
    } else if (run.code !== 0) detail = `exit=${run.code}`;

    // 3) 转录与注入证据
    const transcriptPath = await findTranscript(projDir, run.started);
    if (!transcriptPath) throw new Error("找不到会话转录");
    const raw = await fs.readFile(transcriptPath, "utf8");
    await fs.writeFile(path.join(probeOut, "transcript.jsonl"), raw, "utf8");
    const analysis = analyzeTranscript(raw, harness);
    meta.modelUsed = analysis.model[0] ?? (model ?? DEFAULT_MODEL[harness] ?? null);

    // 4) 机械判定（判据与命中细节全部落盘，供人复核）
    const reply = run.stdout.trim();
    meta.replyChars = reply.length;
    const verdict = judge(probe, analysis, reply, markers);
    meta.verdict = verdict.pass ? "PASS" : "FAIL";
    meta.expect = probe.expect;
    meta.hits = verdict.hits;
    meta.fired = verdict.fired;
    status = verdict.pass ? "PASS" : "FAIL";
  } catch (error) {
    status = "ERROR";
    detail = error.message;
    meta.verdict = "ERROR";
    meta.error = error.message;
  }
  await fs.writeFile(path.join(probeOut, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  rows.push({ probe, label, status, detail, meta });
  const mark = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : "!";
  console.log(
    `${mark} ${label.padEnd(15)} ${probe.skill.padEnd(15)} ${probe.scenario.padEnd(8)} ${status}${detail ? `（${detail}）` : ""}`,
  );
}

// ---------- 汇总 ----------
// 一条探针跑了 N 次 → 多数决（N=1 时就是那一次）。观察项（observe: true）照列不计分。
const verdicts = selected.map((probe) => {
  const own = rows.filter((row) => row.probe === probe);
  const passes = own.filter((row) => row.status === "PASS").length;
  const errors = own.filter((row) => row.status === "ERROR").length;
  const verdict =
    passes > own.length / 2 ? "PASS" : errors === own.length ? "ERROR" : "FAIL";
  const flipped = new Set(own.map((row) => row.status)).size > 1;
  return { probe, own, verdict, passes, flipped, observed: probe.observe === true };
});
const scored = verdicts.filter((v) => !v.observed);
const counts = { PASS: 0, FAIL: 0, ERROR: 0 };
for (const v of scored) counts[v.verdict] = (counts[v.verdict] ?? 0) + 1;
const tally = (v) =>
  v.own.length > 1
    ? `${v.passes}/${v.own.length} ${v.verdict}${v.flipped ? "（有翻转）" : ""}`
    : v.verdict;
const table = rows
  .map(
    (r) =>
      `| ${r.probe.observe === true ? "观察 " : ""}${r.label} | ${r.probe.skill} | ${r.probe.scenario} | ${r.status}${r.detail ? `（${r.detail}）` : ""} | ${r.meta.fired?.join("、") ?? "—"} | ${path.join(out, r.label)} |`,
  )
  .join("\n");
const verdictTable = verdicts
  .map(
    (v) =>
      `| ${v.observed ? "观察 " : ""}${v.probe.id} | ${v.probe.skill} | ${tally(v)}${v.flipped ? `：${v.own.map((r) => `${r.label.split("#")[1] ?? "1"}=${r.status}`).join(" ")}` : ""} |`,
  )
  .join("\n");
const summaryMd = `# 探针汇总 · ${harness} · ${stamp}

- 跑了 ${selected.length} 条${repeat > 1 ? ` × ${repeat} 次 = ${rows.length} 次运行` : ""}（单条多跑取**多数决**）；计分 ${scored.length} 条：PASS ${counts.PASS} / FAIL ${counts.FAIL} / ERROR ${counts.ERROR}${verdicts.length - scored.length > 0 ? `；另有观察项 ${verdicts.length - scored.length} 条（不计分）` : ""}
- harness：${harness}${model ? `（--model ${model}）` : ""}；skill 来源：本地 checkout \`${REPO}\`（未发布）
- 判定口径：机械判定只管「目标 skill 的动作在记录里查到/查不到」；触发后干得对不对由人看 transcript.jsonl。**「打开 skill」≠「照它做」**——trap 类若不判路径（如 sr-trap），读它的前置条件是正确动作的一部分。

## 每条探针

| id | skill | 结果 |
|---|---|---|
${verdictTable}

## 每次运行

| id | skill | 场景 | 结果 | 实际打开的 skill | 记录 |
|---|---|---|---|---|---|
${table}
`;
await fs.writeFile(path.join(out, "summary.md"), summaryMd, "utf8");
await fs.writeFile(
  path.join(out, "summary.json"),
  `${JSON.stringify(
    {
      harness,
      stamp,
      repo: REPO,
      repeat,
      counts,
      verdicts: verdicts.map((v) => ({
        id: v.probe.id,
        skill: v.probe.skill,
        observed: v.observed,
        verdict: v.verdict,
        passes: v.passes,
        attempts: v.own.length,
        flipped: v.flipped,
        runs: v.own.map((r) => r.status),
      })),
      rows: rows.map((r) => ({ ...r.meta, label: r.label, prompt: r.probe.prompt })),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log("");
for (const v of verdicts) {
  if (v.own.length === 1) continue;
  const mark = v.observed ? "•" : v.verdict === "PASS" ? "✓" : v.verdict === "FAIL" ? "✗" : "!";
  console.log(`${mark} ${v.probe.id.padEnd(12)} ${tally(v)}`);
}
console.log(`\n# ${selected.length} 条：PASS ${counts.PASS} / FAIL ${counts.FAIL} / ERROR ${counts.ERROR}${verdicts.length - scored.length > 0 ? `（+观察项 ${verdicts.length - scored.length}）` : ""}`);
console.log(`# 汇总：${path.join(out, "summary.md")}`);
process.exitCode = counts.ERROR > 0 ? 1 : 0;
