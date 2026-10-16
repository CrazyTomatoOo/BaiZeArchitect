import path from "node:path";
import { accept, DEFAULT_USER } from "./confirm.ts";
import { BaizeError } from "./errors.ts";
import { nextId, recordIssued } from "./ids.ts";
import { LAYERS } from "./layers.ts";
import { BAIZE_DIR, scaffold, writeFileAtomic } from "./store.ts";
import { applyMigrate, planMigrate } from "./migrate.ts";
import { applyRename, planRename } from "./rename.ts";
import { retire } from "./retire.ts";
import { chainStatus, chainSummaries, itemStatus } from "./status.ts";
import { validate } from "./validate.ts";
import {
  SCHEMA_VERSION,
  renderAccepted,
  renderChain,
  renderChains,
  renderCreated,
  renderError,
  renderIssues,
  renderItem,
  renderMigrate,
  renderRename,
  renderRetired,
  toJson,
  type Created,
} from "./render.ts";

export interface RunResult {
  exitCode: number;
  stdout: string;
}
export interface RunOptions {
  cwd?: string;
  /** 注入时钟（本仓唯一的测试替身）：accept 的 `at` 从这里取 ISO 时间戳。 */
  now?: Date | string | number;
}

interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  json: boolean;
  strict: boolean;
  write: boolean;
  chain: string | undefined;
  item: string | undefined;
  parent: string | undefined;
  covers: string | undefined;
  appearsIn: string | undefined;
  realizes: string | undefined;
  catalog: string | undefined;
  allocates: string | undefined;
  why: string | undefined;
  supersededBy: string | undefined;
  undo: boolean;
}

interface CommandOutput {
  data: unknown;
  human: string;
  exitCode: number;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  let json = false;
  let strict = false;
  let write = false;
  let chain: string | undefined;
  let item: string | undefined;
  let parent: string | undefined;
  let covers: string | undefined;
  let appearsIn: string | undefined;
  let realizes: string | undefined;
  let catalog: string | undefined;
  let allocates: string | undefined;
  let why: string | undefined;
  let supersededBy: string | undefined;
  let undo = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined) continue;
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--strict") {
      strict = true;
      continue;
    }
    if (token === "--write") {
      write = true;
      continue;
    }
    if (token === "--undo") {
      undo = true;
      continue;
    }
    if (token === "--chain" || token === "--item") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new BaizeError("cli.usage", `${token} 需要一个取值`);
      }
      if (token === "--chain") chain = value;
      else item = value;
      i++;
      continue;
    }
    if (
      token === "--parent" ||
      token === "--covers" ||
      token === "--appears-in" ||
      token === "--realizes" ||
      token === "--catalog" ||
      token === "--allocates" ||
      token === "--why" ||
      token === "--superseded-by"
    ) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new BaizeError("cli.usage", `${token} 需要一个取值`);
      }
      if (token === "--parent") parent = value;
      else if (token === "--covers") covers = value;
      else if (token === "--appears-in") appearsIn = value;
      else if (token === "--realizes") realizes = value;
      else if (token === "--catalog") catalog = value;
      else if (token === "--allocates") allocates = value;
      else if (token === "--why") why = value;
      else supersededBy = value;
      i++;
      continue;
    }
    if (token.startsWith("--")) {
      throw new BaizeError("cli.usage", `未知选项：${token}`);
    }
    positionals.push(token);
  }

  return {
    command: positionals[0],
    positionals: positionals.slice(1),
    json,
    strict,
    write,
    chain,
    item,
    parent,
    covers,
    appearsIn,
    realizes,
    catalog,
    allocates,
    why,
    supersededBy,
    undo,
  };
}

async function runNew(args: ParsedArgs, cwd: string): Promise<CommandOutput> {
  // `baize new scenario` 是场景层的口头层名（注册键为复数 scenarios）。
  const layerKey = args.positionals[0] === "scenario" ? "scenarios" : args.positionals[0];
  if (layerKey === undefined) {
    throw new BaizeError("cli.usage", "用法：baize new <layer>（如 baize new ir）");
  }
  if (args.positionals.length > 1) {
    throw new BaizeError("cli.usage", `多余参数：${args.positionals.slice(1).join(" ")}`);
  }
  if (args.chain !== undefined || args.item !== undefined || args.strict) {
    throw new BaizeError("cli.usage", "new 只接受 --json（不支持 --chain / --item / --strict）");
  }
  // 分析层的常用单数叫法（票面与验收均写 baize new scenario|usecase|function-item|function-point）。
  const NEW_ALIASES: Record<string, string> = {
    scenario: "scenarios",
    usecase: "usecases",
    "function-item": "function-items",
    "function-point": "function-points",
  };
  const resolvedKey = NEW_ALIASES[layerKey] ?? layerKey;
  const layer = LAYERS.find((candidate) => candidate.key === resolvedKey);
  if (!layer) {
    throw new BaizeError(
      "layer.unknown",
      `未知层级：${layerKey}（可用：${LAYERS.map((item) => item.key).join(", ")}）`,
    );
  }
  if (layer.fields.length === 0) {
    throw new BaizeError("cli.usage", `暂不支持新建该层：${layerKey}`);
  }

  // 父边（#190 新模型）：IR 是链顶端（parent 恒为 null）；SR / AR / 功能点必须有
  // --parent（分解树：IR → SR → AR、功能项 → 功能点）；场景可选 --parent（只挂场景，
  // 表达子场景）；用例 / 功能项没有父边——它们用 refines / satisfies 认领 SR。
  // 引用是否存在不在这里挡——由 validate 的 ref.* 规则报（new 只负责把声明写对形状）。
  const PARENT_REQUIRED = new Set(["sr", "ar", "function-points"]);
  const PARENT_FORBIDDEN = new Set(["ir", "usecases", "function-items"]);
  if (PARENT_FORBIDDEN.has(layer.key) && args.parent !== undefined) {
    throw new BaizeError(
      "cli.usage",
      layer.key === "ir"
        ? "ir 是链顶端，不接受 --parent（parent 恒为 null）"
        : `${layer.key} 没有父边：它用 ${layer.key === "usecases" ? "refines" : "satisfies"} 认领 SR（不要传 --parent）`,
    );
  }
  if (PARENT_REQUIRED.has(layer.key) && args.parent === undefined) {
    throw new BaizeError(
      "cli.usage",
      `新建 ${layer.key} 必须指定 --parent <条目id>（必由上层条目分解而来）`,
    );
  }
  if (args.covers !== undefined && layer.key !== "sr") {
    throw new BaizeError("cli.usage", "--covers 只适用于 sr（SR → IR 验收线索）");
  }
  if (args.appearsIn !== undefined && layer.key !== "usecases") {
    throw new BaizeError("cli.usage", "--appears-in 只适用于 usecase（用例 → 场景）");
  }
  if (args.realizes !== undefined && layer.key !== "function-items") {
    throw new BaizeError("cli.usage", "--realizes 只适用于 function-item（功能项 → 用例）");
  }
  if (args.catalog !== undefined && layer.key !== "scenarios") {
    throw new BaizeError("cli.usage", "--catalog 只适用于 scenario（场景挂场景目录）");
  }
  if (args.allocates !== undefined && layer.key !== "ar") {
    throw new BaizeError("cli.usage", "--allocates 只适用于 ar（AR 分配架构组件）");
  }

  const splitList = (raw: string): string[] =>
    raw
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  const overrides: Record<string, unknown> = {};
  if (args.parent !== undefined) overrides["parent"] = args.parent;
  if (args.covers !== undefined) overrides["covers"] = splitList(args.covers);
  if (args.appearsIn !== undefined) overrides["appearsIn"] = splitList(args.appearsIn);
  if (args.realizes !== undefined) overrides["realizes"] = splitList(args.realizes);
  if (args.catalog !== undefined) overrides["catalog"] = args.catalog;
  if (args.allocates !== undefined) overrides["allocates"] = args.allocates;

  const id = await nextId(cwd, layer);
  const relPath = path.posix.join(BAIZE_DIR, layer.dir, `${id}.md`);
  // 先记账再落盘（#193）：号一旦发出就不再复用；半途失败只留一个空洞，不留一次复用。
  await recordIssued(cwd, layer, id);
  await writeFileAtomic(path.join(cwd, relPath), scaffold(layer, id, overrides));
  const created: Created = { id, path: relPath };
  return {
    data: { schemaVersion: SCHEMA_VERSION, created },
    human: renderCreated(created),
    exitCode: 0,
  };
}

async function runValidate(args: ParsedArgs, cwd: string): Promise<CommandOutput> {
  if (args.positionals.length > 0) {
    throw new BaizeError("cli.usage", `多余参数：${args.positionals.join(" ")}`);
  }
  if (args.item !== undefined) {
    throw new BaizeError("cli.usage", "validate 不支持 --item");
  }

  const issues = await validate(
    cwd,
    args.chain !== undefined ? { chain: args.chain } : {},
  );
  const failing = issues.filter(
    (issue) => issue.level === "ERROR" || (args.strict && issue.level === "WARNING"),
  );
  return {
    data: { schemaVersion: SCHEMA_VERSION, issues },
    human: renderIssues(issues),
    exitCode: failing.length > 0 ? 1 : 0,
  };
}

async function runStatus(args: ParsedArgs, cwd: string): Promise<CommandOutput> {
  if (args.positionals.length > 0) {
    throw new BaizeError("cli.usage", `多余参数：${args.positionals.join(" ")}`);
  }
  if (args.chain !== undefined && args.item !== undefined) {
    throw new BaizeError("cli.usage", "--chain 与 --item 不能同时使用");
  }
  if (args.strict) {
    throw new BaizeError("cli.usage", "status 不支持 --strict");
  }

  if (args.item !== undefined) {
    const item = await itemStatus(cwd, args.item);
    return {
      data: { schemaVersion: SCHEMA_VERSION, item },
      human: renderItem(item),
      exitCode: 0,
    };
  }
  if (args.chain !== undefined) {
    const chain = await chainStatus(cwd, args.chain);
    return {
      data: { schemaVersion: SCHEMA_VERSION, chain },
      human: renderChain(chain),
      exitCode: 0,
    };
  }
  const chains = await chainSummaries(cwd);
  return {
    data: { schemaVersion: SCHEMA_VERSION, chains },
    human: renderChains(chains),
    exitCode: 0,
  };
}

async function runAccept(
  args: ParsedArgs,
  cwd: string,
  now: Date,
): Promise<CommandOutput> {
  const id = args.positionals[0];
  if (id === undefined) {
    throw new BaizeError("cli.usage", "用法：baize accept <id>（如 baize accept IR-001）");
  }
  if (args.positionals.length > 1) {
    throw new BaizeError("cli.usage", `多余参数：${args.positionals.slice(1).join(" ")}`);
  }
  if (args.chain !== undefined || args.item !== undefined || args.strict) {
    throw new BaizeError("cli.usage", "accept 只接受 --json（不支持 --chain / --item / --strict）");
  }
  const by = process.env.BAIZE_USER ?? DEFAULT_USER;
  const accepted = await accept(cwd, id, { by, now });
  // B1：同一动作的两个方向用域模型的两个词——IR 是 confirmed，其余层是 reviewed。
  const data =
    accepted.kind === "confirmed"
      ? { schemaVersion: SCHEMA_VERSION, confirmed: accepted }
      : { schemaVersion: SCHEMA_VERSION, reviewed: accepted };
  return {
    data,
    human: renderAccepted(accepted),
    exitCode: 0,
  };
}

async function runRetire(
  args: ParsedArgs,
  cwd: string,
  now: Date,
): Promise<CommandOutput> {
  const id = args.positionals[0];
  if (id === undefined) {
    throw new BaizeError(
      "cli.usage",
      '用法：baize retire <id> --why "为什么不做" [--superseded-by <id>] [--undo] [--json]',
    );
  }
  if (args.positionals.length > 1) {
    throw new BaizeError("cli.usage", `多余参数：${args.positionals.slice(1).join(" ")}`);
  }
  if (args.chain !== undefined || args.item !== undefined || args.strict) {
    throw new BaizeError("cli.usage", "retire 只接受 --json（不支持 --chain / --item / --strict）");
  }
  if (args.undo && args.why !== undefined) {
    throw new BaizeError("cli.usage", "--undo 与 --why 不能同时给：撤销不需要理由");
  }
  const by = process.env.BAIZE_USER ?? DEFAULT_USER;
  const outcome = await retire(cwd, id, {
    by,
    now,
    undo: args.undo,
    ...(args.why !== undefined ? { why: args.why } : {}),
    ...(args.supersededBy !== undefined ? { supersededBy: args.supersededBy } : {}),
  });
  return {
    data: { schemaVersion: SCHEMA_VERSION, retired: outcome.retired },
    human: renderRetired(outcome),
    exitCode: 0,
  };
}

async function runRename(args: ParsedArgs, cwd: string): Promise<CommandOutput> {
  const kindRaw = args.positionals[0];
  const old = args.positionals[1];
  const newSlug = args.positionals[2];
  if (kindRaw === undefined || old === undefined || newSlug === undefined) {
    throw new BaizeError(
      "cli.usage",
      "用法：baize rename <catalog|element> <old> <new> [--write]",
    );
  }
  if (args.positionals.length > 3) {
    throw new BaizeError("cli.usage", `多余参数：${args.positionals.slice(3).join(" ")}`);
  }
  if (kindRaw !== "catalog" && kindRaw !== "element") {
    throw new BaizeError(
      "cli.usage",
      `未知 kind：${kindRaw}（可用：catalog | element）`,
    );
  }
  if (args.chain !== undefined || args.item !== undefined || args.strict) {
    throw new BaizeError(
      "cli.usage",
      "rename 只接受 --write / --json（不支持 --chain / --item / --strict）",
    );
  }
  const kind = kindRaw;

  // 计划先行：新 slug 不在清单会在 planRename 里被拒（exit 2，先于任何改写）。
  const plan = await planRename(cwd, kind, old, newSlug);
  if (args.write) await applyRename(cwd, plan);
  return {
    data: {
      schemaVersion: SCHEMA_VERSION,
      kind: plan.kind,
      old: plan.old,
      new: plan.new,
      write: args.write,
      changes: plan.changes,
    },
    human: renderRename(plan, { write: args.write }),
    exitCode: 0,
  };
}

async function runMigrate(args: ParsedArgs, cwd: string): Promise<CommandOutput> {
  if (args.positionals.length > 0) {
    throw new BaizeError("cli.usage", `多余参数：${args.positionals.join(" ")}`);
  }
  if (args.chain !== undefined || args.item !== undefined || args.strict) {
    throw new BaizeError(
      "cli.usage",
      "migrate 只接受 --write / --json（不支持 --chain / --item / --strict）",
    );
  }
  // 计划先行：识别旧模型（方案层 parent 指向 SR）→ 改写清单；拿不准的在计划里点名。
  const plan = await planMigrate(cwd);
  if (args.write) await applyMigrate(cwd, plan);
  return {
    data: {
      schemaVersion: SCHEMA_VERSION,
      write: args.write,
      changes: plan.changes,
      skipped: plan.skipped,
    },
    human: renderMigrate(plan, { write: args.write }),
    exitCode: 0,
  };
}

async function dispatch(
  args: ParsedArgs,
  cwd: string,
  now: Date,
): Promise<CommandOutput> {
  switch (args.command) {
    case "new":
      return runNew(args, cwd);
    case "validate":
      return runValidate(args, cwd);
    case "status":
      return runStatus(args, cwd);
    case "accept":
      return runAccept(args, cwd, now);
    case "retire":
      return runRetire(args, cwd, now);
    case "rename":
      return runRename(args, cwd);
    case "migrate":
      return runMigrate(args, cwd);
    case undefined:
      throw new BaizeError(
        "cli.usage",
        "用法：baize <new|validate|status|accept|retire|rename|migrate> [选项]",
      );
    default:
      throw new BaizeError(
        "cli.usage",
        "用法：baize <new|validate|status|accept|retire|rename|migrate> [选项]",
      );
  }
}

/**
 * CLI 的可观察边界：argv + 初始目录状态 → stdout / exit code。
 * `--json` 走机器可读；否则人类可读（同一份数据的渲染）。
 */
export async function run(
  argv: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const cwd = options.cwd ?? process.cwd();
  const now = options.now !== undefined ? new Date(options.now) : new Date();
  const wantsJson = argv.includes("--json");

  try {
    const args = parseArgs(argv);
    const output = await dispatch(args, cwd, now);
    return {
      exitCode: output.exitCode,
      stdout: args.json ? toJson(output.data) : output.human,
    };
  } catch (error) {
    if (error instanceof BaizeError) {
      const payload = {
        schemaVersion: SCHEMA_VERSION,
        error: { rule: error.rule, message: error.message },
      };
      return {
        exitCode: error.exitCode,
        stdout: wantsJson ? toJson(payload) : renderError(payload.error),
      };
    }
    throw error;
  }
}
