import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { Entry } from "./entry.ts";
import { idOf } from "./entry.ts";
import { BaizeError } from "./errors.ts";
import { fingerprintOf } from "./fingerprint.ts";
import { isPlainObject } from "./guards.ts";
import { readEntries, writeFileAtomic } from "./store.ts";

/** `BAIZE_USER` 未设置时的明确默认值（审计线索里一眼能看出「没人署名」）。 */
export const DEFAULT_USER = "unknown";

/** 单条目的确认状态视图：`status --item` 的人读与 `--json` 共用这一份。 */
export interface ConfirmationView {
  /** `unconfirmed` 未确认 / `confirmed` 已确认且未失效 / `stale` 记过但实质内容已改。 */
  state: "unconfirmed" | "confirmed" | "stale";
  by: string | null;
  at: string | null;
}

export interface Accepted {
  id: string;
  by: string;
  at: string;
  fingerprint: string;
}

interface ConfirmedRecord {
  by: string;
  at: string;
  fingerprint: string;
}

/** 读条目上的 `confirmed` 记录；形状不符（缺 by/at/fingerprint 任一）视作未确认。 */
function confirmedRecordOf(entry: Entry): ConfirmedRecord | undefined {
  const raw = entry.frontmatter["confirmed"];
  if (!isPlainObject(raw)) return undefined;
  const { by, at, fingerprint } = raw;
  if (
    typeof by === "string" &&
    typeof at === "string" &&
    typeof fingerprint === "string"
  ) {
    return { by, at, fingerprint };
  }
  return undefined;
}

/**
 * 确认状态：失效靠重算指纹——`confirmed.fingerprint` 与当前实质字段不符即 `stale`。
 * 纯现算、不落盘；「撤销」与「改了内容」在模型里是同一件事，不设独立撤销命令。
 */
export function confirmationOf(entry: Entry): ConfirmationView {
  const record = confirmedRecordOf(entry);
  if (!record) return { state: "unconfirmed", by: null, at: null };
  const stale = fingerprintOf(entry) !== record.fingerprint;
  return {
    state: stale ? "stale" : "confirmed",
    by: record.by,
    at: record.at,
  };
}

/**
 * 认领一条目：把 `confirmed: { by, at, fingerprint }` 写进该条目的 frontmatter。
 * 指纹取该条目自己的实质字段（#155 的陈旧比对复用同一份 `fingerprintOf`）。
 * 重复 accept 是「按现在这版再认一次」，覆盖旧记录。
 */
export async function accept(
  cwd: string,
  id: string,
  options: { by: string; now: Date },
): Promise<Accepted> {
  const entries = await readEntries(cwd);
  const entry = entries.find((candidate) => idOf(candidate) === id);
  if (!entry) throw new BaizeError("item.not-found", `条目不存在：${id}`);

  const accepted: Accepted = {
    id,
    by: options.by,
    at: options.now.toISOString(),
    fingerprint: fingerprintOf(entry),
  };

  const abs = path.join(cwd, entry.path);
  // 只改 frontmatter 的 confirmed，正文与其余字段原样保留（body 含原始换行）。
  await writeFileAtomic(
    abs,
    `---\n${stringifyYaml({ ...entry.frontmatter, confirmed: accepted })}---\n${entry.body}`,
  );
  return accepted;
}
