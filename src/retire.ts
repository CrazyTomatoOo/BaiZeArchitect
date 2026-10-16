import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { Entry } from "./entry.ts";
import { idOf } from "./entry.ts";
import { BaizeError } from "./errors.ts";
import { isPlainObject } from "./guards.ts";
import type { LayerKey } from "./layers.ts";
import { readEntries, writeFileAtomic } from "./store.ts";

/** 读得全的退役记录（模型「退役」词条：by / at / why，取代者可选）。 */
export interface RetiredRecord {
  by: string;
  at: string;
  why: string;
  supersededBy?: string;
}

/** `retire` 的输出与 `status --item` 共用的视图：读不全的记录把缺的填 null（由 field.retire-incomplete 报）。 */
export interface RetiredView {
  id: string;
  layer: LayerKey;
  /** `retired` 已退役 / `active` 没有退役记录（含撤销之后）。 */
  state: "retired" | "active";
  by: string | null;
  at: string | null;
  why: string | null;
  supersededBy: string | null;
}

/**
 * 退役这个事实由 `retired` 键的**存在**决定，记录完整与否是另一回事：
 * 半条记录由 `field.retire-incomplete` 报 ERROR，不在这里悄悄降级成「未退役」——
 * 否则一个笔误就会把「不做了」翻回「在做」，而被豁免的义务全部回来。
 */
export function isRetired(entry: Entry): boolean {
  const raw = entry.frontmatter["retired"];
  return raw !== undefined && raw !== null;
}

/** 读得全的退役记录；缺项或不是映射时 undefined（缺什么由 validate 说）。 */
export function retiredRecordOf(entry: Entry): RetiredRecord | undefined {
  const raw = entry.frontmatter["retired"];
  if (!isPlainObject(raw)) return undefined;
  const { by, at, why, supersededBy } = raw;
  if (typeof by !== "string" || typeof at !== "string" || typeof why !== "string") {
    return undefined;
  }
  if (supersededBy !== undefined && typeof supersededBy !== "string") return undefined;
  return supersededBy === undefined ? { by, at, why } : { by, at, why, supersededBy };
}

/** 单条目的退役视图；没有退役记录时 null（「从未退役」与「撤回过」在模型里是同一件事）。 */
export function retiredViewOf(entry: Entry): RetiredView | null {
  if (!isRetired(entry)) return null;
  const record = retiredRecordOf(entry);
  return {
    id: idOf(entry) ?? "",
    layer: entry.layer.key,
    state: "retired",
    by: record?.by ?? null,
    at: record?.at ?? null,
    why: record?.why ?? null,
    supersededBy: record?.supersededBy ?? null,
  };
}

/** 撤销退役后回落到的那一版视图。 */
function activeView(entry: Entry): RetiredView {
  return {
    id: idOf(entry) ?? "",
    layer: entry.layer.key,
    state: "active",
    by: null,
    at: null,
    why: null,
    supersededBy: null,
  };
}

/**
 * 退役一条目（#194）：把「这条不做了 / 被取代了」写进条目自己的 frontmatter，
 * 与 `confirmed` / `reviewed` 并列——退役是**人的签字**，不是从别处推导出来的状态。
 * 记录恰好 by / at / why（+ 可选取代者）；`--undo` 就是把这个键删掉，
 * 模型里没有第二处记录要同步，也没有「退役状态」这个枚举。
 */
export async function retire(
  cwd: string,
  id: string,
  options: {
    by: string;
    now: Date;
    why?: string;
    supersededBy?: string;
    undo?: boolean;
  },
): Promise<RetiredView> {
  const entries = await readEntries(cwd);
  const entry = entries.find((candidate) => idOf(candidate) === id);
  if (!entry) throw new BaizeError("item.not-found", `条目不存在：${id}`);
  const abs = path.join(cwd, entry.path);

  if (options.undo === true) {
    // 幂等：本来就没退役就不动文件（不制造无谓的写盘）。
    if (!isRetired(entry)) return activeView(entry);
    const frontmatter: Record<string, unknown> = { ...entry.frontmatter };
    delete frontmatter["retired"];
    await writeFileAtomic(abs, `---\n${stringifyYaml(frontmatter)}---\n${entry.body}`);
    return activeView(entry);
  }

  const why = options.why;
  if (why === undefined || why.trim() === "") {
    throw new BaizeError(
      "cli.usage",
      "退役需要理由：baize retire <id> --why \"为什么不做 / 被谁取代\"",
    );
  }

  let supersededBy: string | undefined;
  if (options.supersededBy !== undefined) {
    supersededBy = options.supersededBy;
    if (supersededBy === id) {
      throw new BaizeError("cli.usage", `取代者不能是自己：${id}`);
    }
    const replacement = entries.find((candidate) => idOf(candidate) === supersededBy);
    if (!replacement) throw new BaizeError("item.not-found", `取代者不存在：${supersededBy}`);
    if (replacement.layer.key !== entry.layer.key) {
      throw new BaizeError(
        "cli.usage",
        `取代者必须同层：${supersededBy} 是 ${replacement.layer.key}，${id} 是 ${entry.layer.key}`,
      );
    }
  }

  const at = options.now.toISOString();
  const frontmatter: Record<string, unknown> = { ...entry.frontmatter };
  frontmatter["retired"] =
    supersededBy === undefined
      ? { by: options.by, at, why }
      : { by: options.by, at, why, supersededBy };
  await writeFileAtomic(abs, `---\n${stringifyYaml(frontmatter)}---\n${entry.body}`);

  return {
    id,
    layer: entry.layer.key,
    state: "retired",
    by: options.by,
    at,
    why,
    supersededBy: supersededBy ?? null,
  };
}
