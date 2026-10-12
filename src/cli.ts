import path from "node:path";
import { BaizeError } from "./errors.ts";
import { LAYERS } from "./layers.ts";
import { BAIZE_DIR, nextId, scaffold, writeFileAtomic } from "./store.ts";
import { chainStatus, chainSummaries, itemStatus } from "./status.ts";
import { validate } from "./validate.ts";
import {
  SCHEMA_VERSION,
  renderChain,
  renderChains,
  renderCreated,
  renderError,
  renderIssues,
  renderItem,
  toJson,
  type Created,
} from "./render.ts";

export interface RunResult {
  exitCode: number;
  stdout: string;
}
export interface RunOptions {
  cwd?: string;
}

interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  json: boolean;
  strict: boolean;
  chain: string | undefined;
  item: string | undefined;
  parent: string | undefined;
  covers: string | undefined;
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
  let chain: string | undefined;
  let item: string | undefined;
  let parent: string | undefined;
  let covers: string | undefined;

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
    if (token === "--parent" || token === "--covers") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new BaizeError("cli.usage", `${token} 需要一个取值`);
      }
      if (token === "--parent") parent = value;
      else covers = value;
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
    chain,
    item,
    parent,
    covers,
  };
}

async function runNew(args: ParsedArgs, cwd: string): Promise<CommandOutput> {
  const layerKey = args.positionals[0];
  if (layerKey === undefined) {
    throw new BaizeError("cli.usage", "用法：baize new <layer>（如 baize new ir）");
  }
  if (args.positionals.length > 1) {
    throw new BaizeError("cli.usage", `多余参数：${args.positionals.slice(1).join(" ")}`);
  }
  if (args.chain !== undefined || args.item !== undefined || args.strict) {
    throw new BaizeError("cli.usage", "new 只接受 --json（不支持 --chain / --item / --strict）");
  }
  const layer = LAYERS.find((candidate) => candidate.key === layerKey);
  if (!layer) {
    throw new BaizeError(
      "layer.unknown",
      `未知层级：${layerKey}（可用：${LAYERS.map((item) => item.key).join(", ")}）`,
    );
  }
  if (layer.fields.length === 0) {
    throw new BaizeError("cli.usage", `暂不支持新建该层：${layerKey}`);
  }

  // 父边：IR 是链顶端（parent 恒为 null），SR / AR 必须有 --parent。引用是否存在不在这里
  // 挡——由 validate 的 ref.* 规则报（new 只负责把声明写对形状）。
  if (layer.key === "ir" && args.parent !== undefined) {
    throw new BaizeError("cli.usage", "ir 是链顶端，不接受 --parent（parent 恒为 null）");
  }
  if ((layer.key === "sr" || layer.key === "ar") && args.parent === undefined) {
    throw new BaizeError(
      "cli.usage",
      `新建 ${layer.key} 必须指定 --parent <条目id>（SR/AR 必由上层条目分解而来）`,
    );
  }
  if (args.covers !== undefined && layer.key !== "sr") {
    throw new BaizeError("cli.usage", "--covers 只适用于 sr（SR → IR 验收线索）");
  }

  const overrides: Record<string, unknown> = {};
  if (args.parent !== undefined) overrides["parent"] = args.parent;
  if (args.covers !== undefined) {
    overrides["covers"] = args.covers
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== "");
  }

  const id = await nextId(cwd, layer);
  const relPath = path.posix.join(BAIZE_DIR, layer.dir, `${id}.md`);
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

async function dispatch(args: ParsedArgs, cwd: string): Promise<CommandOutput> {
  switch (args.command) {
    case "new":
      return runNew(args, cwd);
    case "validate":
      return runValidate(args, cwd);
    case "status":
      return runStatus(args, cwd);
    case undefined:
      throw new BaizeError("cli.usage", "用法：baize <new|validate|status> [选项]");
    default:
      throw new BaizeError("cli.usage", `未知命令：${args.command}`);
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
  const wantsJson = argv.includes("--json");

  try {
    const args = parseArgs(argv);
    const output = await dispatch(args, cwd);
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
