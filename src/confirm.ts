import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { Entry } from "./entry.ts";
import { idOf, upstreamIdsOf } from "./entry.ts";
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
  /** 方向（#147）：IR 上是 `confirmed`（对自己）；其余层是 `reviewed`（对上游）。 */
  kind: "confirmed" | "reviewed";
  id: string;
  by: string;
  at: string;
  /** 仅 `confirmed`：本条目实质字段的指纹。 */
  fingerprint?: string;
  /** 对上游的复核（一条命令两个方向）：上游 id（parent ∪ 认领边）→ 该上游当前实质字段指纹。无上游为空对象。 */
  reviewed: Record<string, string>;
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
 * 认领一条目。一条命令两个方向（#147 / #155）：
 * - **IR** → 写 `confirmed: { by, at, fingerprint }`（对自己；恰好三项，见域模型「确认」词条）；
 * - **非 IR** → 只写 `reviewed: { <上游 id>: <上游实质字段摘要> }`（对上游），
 *   **不写 `confirmed`**——确认只用在 IR 上。
 * 上游集合 = `parent` ∪ 认领边 `refines` / `satisfies`（#183：方案层条目认领的 SR
 * 也是被复核的上游）；重复 accept 是「按现在这版再认一次」，覆盖旧记录。
 */
export async function accept(
  cwd: string,
  id: string,
  options: { by: string; now: Date },
): Promise<Accepted> {
  const entries = await readEntries(cwd);
  const entry = entries.find((candidate) => idOf(candidate) === id);
  if (!entry) throw new BaizeError("item.not-found", `条目不存在：${id}`);

  // 对上游的复核：上游集合 = parent ∪ 认领边（#183），摘要取上游当前实质字段
  // （与 #151 的陈旧比对共用 fingerprintOf）；上游不存在的（断边）不记，由 ref.* 报。
  const reviewed: Record<string, string> = {};
  for (const upstreamId of upstreamIdsOf(entry)) {
    const upstream = entries.find((candidate) => idOf(candidate) === upstreamId);
    if (upstream) reviewed[upstreamId] = fingerprintOf(upstream);
  }

  const isIr = entry.layer.key === "ir";
  const accepted: Accepted = isIr
    ? {
        kind: "confirmed",
        id,
        by: options.by,
        at: options.now.toISOString(),
        fingerprint: fingerprintOf(entry),
        reviewed,
      }
    : { kind: "reviewed", id, by: options.by, at: options.now.toISOString(), reviewed };

  const abs = path.join(cwd, entry.path);
  // 只改 frontmatter 的 confirmed / reviewed，正文与其余字段原样保留（body 含原始换行）。
  const frontmatter: Record<string, unknown> = { ...entry.frontmatter };
  if (isIr && accepted.fingerprint !== undefined) {
    frontmatter["confirmed"] = {
      by: accepted.by,
      at: accepted.at,
      fingerprint: accepted.fingerprint,
    };
  }
  if (Object.keys(reviewed).length > 0) frontmatter["reviewed"] = reviewed;
  await writeFileAtomic(abs, `---\n${stringifyYaml(frontmatter)}---\n${entry.body}`);
  return accepted;
}
