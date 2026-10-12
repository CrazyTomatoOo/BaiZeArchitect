import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { BAIZE_DIR } from "./store.ts";
import { isPlainObject } from "./guards.ts";

/**
 * 阶段状态（链状态）文件：baize/chains/<起始条目 id>.yaml。
 * 只存算不出来的东西——跳过记录（skipped）与功能拆分门禁的人工通过（gates），
 * 就这两样。进度、覆盖率、陈旧一概不写；没有「未开始 / 进行中 / 已完成」状态枚举。
 * 文件缺失等价于「无跳过、无签字门禁」，不是错误。
 */

/** 链上六段。段名与层名是同一个词；「功能拆分」一段产出两个层级（见 FUNCTION_SUB_STAGES）。 */
export const STAGES = [
  "ir",
  "sr",
  "ar",
  "scenario",
  "usecase",
  "function",
] as const;
export type StageName = (typeof STAGES)[number];

/** 「功能拆分」一段的两个子层级：功能条目（function-items）与功能点（function-points）。 */
export const FUNCTION_SUB_STAGES = ["items", "points"] as const;

/** 一条跳过记录：谁决定、什么时候、为什么——三样缺一都无从追问。 */
export interface SkipRecord {
  by: string;
  at: string;
  why: string;
}

export interface ChainState {
  /** 段名 → 跳过记录；function 段的值可以是 { items: …, points: … } 子项形状。 */
  skipped: Record<string, unknown>;
  /** 功能拆分门禁的人工通过；本票只读不消费（呈现归后续工单）。 */
  gates: Record<string, unknown>;
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/** 链状态文件的仓库相对路径。 */
export function chainStateRelPath(chainId: string): string {
  return path.posix.join(BAIZE_DIR, "chains", `${chainId}.yaml`);
}

/**
 * 读一条链的阶段状态；文件不存在返回 undefined。
 * YAML 解析失败按条目 frontmatter 的先例处理：视为空状态（不据此报新 rule）。
 */
export async function readChainState(
  cwd: string,
  chainId: string,
): Promise<ChainState | undefined> {
  let text: string;
  try {
    text = await fs.readFile(path.join(cwd, chainStateRelPath(chainId)), "utf8");
  } catch (error) {
    if (isEnoent(error)) return undefined;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch {
    return { skipped: {}, gates: {} };
  }
  if (!isPlainObject(parsed)) return { skipped: {}, gates: {} };
  return {
    skipped: isPlainObject(parsed["skipped"]) ? parsed["skipped"] : {},
    gates: isPlainObject(parsed["gates"]) ? parsed["gates"] : {},
  };
}

/** 列出全部有状态文件的链 id（<链 id>.yaml 的文件名即链 id）；目录不存在返回 []。 */
export async function chainIdsWithState(cwd: string): Promise<string[]> {
  const dir = path.join(cwd, BAIZE_DIR, "chains");
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (isEnoent(error)) return [];
    throw error;
  }
  return names
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => name.slice(0, -".yaml".length))
    .sort();
}

/** 把跳过记录收窄为字符串三元组；不是对象时返回 null（= 不是一条跳过记录）。 */
export function skipRecordOf(value: unknown): SkipRecord | null {
  if (!isPlainObject(value)) return null;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return { by: str(value["by"]), at: str(value["at"]), why: str(value["why"]) };
}

/** 跳过的必填字段：by / at / why 缺任一项都报 stage.skip-missing-reason。 */
export function missingSkipFields(value: unknown): string[] {
  if (!isPlainObject(value)) return ["by", "at", "why"];
  const empty = (v: unknown): boolean =>
    typeof v !== "string" || v.trim() === "";
  return ["by", "at", "why"].filter((field) => empty(value[field]));
}

/**
 * function 段的跳过：整段跳（{ by, at, why }），或 items / points 两个子层级分别跳。
 * 子项只收录显式出现的键——缺键是「未跳过」，不是缺字段。
 */
export function flattenSkipped(
  skipped: Record<string, unknown>,
): Array<{ stagePath: string; value: unknown }> {
  const out: Array<{ stagePath: string; value: unknown }> = [];
  for (const [stage, value] of Object.entries(skipped)) {
    if (
      stage === "function" &&
      isPlainObject(value) &&
      FUNCTION_SUB_STAGES.some((key) => key in value)
    ) {
      if ("items" in value) {
        out.push({ stagePath: "function.items", value: value["items"] });
      }
      if ("points" in value) {
        out.push({ stagePath: "function.points", value: value["points"] });
      }
      continue;
    }
    out.push({ stagePath: stage, value });
  }
  return out;
}

/** function 段跳过记录的三元视图：整段跳，或 items / points 子层级分别跳。 */
export interface FunctionSkipView {
  whole: SkipRecord | null;
  items: SkipRecord | null;
  points: SkipRecord | null;
}

export function functionSkipOf(value: unknown): FunctionSkipView {
  if (!isPlainObject(value)) return { whole: null, items: null, points: null };
  // 带 items / points 键的是子项形状；否则按整段跳过记录收窄。
  if (FUNCTION_SUB_STAGES.some((key) => key in value)) {
    return {
      whole: null,
      items: skipRecordOf(value["items"]),
      points: skipRecordOf(value["points"]),
    };
  }
  return { whole: skipRecordOf(value), items: null, points: null };
}

/** 一条人工通过记录（门禁签字）：谁签的、什么时候。by / at 缺任一项视为无效（= 未签，无从追问）。 */
export interface GateRecord {
  by: string;
  at: string;
}

/** 收窄链状态文件 gates 里的一条签字记录；不是带非空 by/at 的对象返回 null。 */
export function gateRecordOf(value: unknown): GateRecord | null {
  if (!isPlainObject(value)) return null;
  const by = value["by"];
  const at = value["at"];
  if (typeof by !== "string" || by.trim() === "") return null;
  if (typeof at !== "string" || at.trim() === "") return null;
  return { by, at };
}
