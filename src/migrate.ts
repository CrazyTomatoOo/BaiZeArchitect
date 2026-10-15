import { promises as fs } from "node:fs";
import path from "node:path";
import { claimIdsOf, idOf, parentIdOf, type Entry } from "./entry.ts";
import { CLAIM_FIELD } from "./layers.ts";
import { readEntries, writeFileAtomic } from "./store.ts";

/**
 * `baize migrate`（#185）：把旧模型（#180 之前）的方案层条目搬到新形状。
 * 识别规则唯一且现成——**方案层条目的 `parent` 指向 SR**（那条边在新模型里非法，
 * `ref.parent-not-allowed` 已经在报它），不引入版本标记文件。
 *
 * 改写规则（#178 结算）：
 * - 场景 / 用例：`parent: SR-001` → `refines: [SR-001]`（parent 行原位换成认领块）
 * - 功能项：`parent: SR-001` → `satisfies: [SR-001]`
 * - 功能点：`parent: FN-001` 不动（同一堆内部保留分解）；缺的认领边从所属功能项继承
 *   （旧模型的功能点没有任何指向 SR 的边，所属功能项迁移后的认领是唯一可推导的来源）
 * - 子场景：`parent: SC-00N` 不动（场景挂场景在新模型仍是合法例外）
 * - 场景 `alternateFlows` → `alternativeFlows`（与用例统一拼写）
 * - `covers` / `allocates` / `appearsIn` / `realizes`、AR 的 `parent`：一律不动
 *
 * 拿不准就不猜（ADR-0006 纪律 3）：parent 指向不存在的条目、指向 SR 之外的层、
 * 已有认领边字段却还留着 parent——跳过并在报告里点名，那个文件不动。
 */

/** parent 行原位换成认领块（一行变两行）。 */
export interface MigrateEditClaim {
  kind: "parent-to-claim";
  claim: "refines" | "satisfies";
  ids: string[];
}

/** 功能点补认领边：在锚行（parent 行）之后插入认领块。 */
export interface MigrateEditAdd {
  kind: "add-claim";
  claim: "refines" | "satisfies";
  ids: string[];
}

/** 场景的备选流键改名（值原样保留）。 */
export interface MigrateEditRename {
  kind: "rename-key";
  fromKey: "alternateFlows";
  toKey: "alternativeFlows";
}

export type MigrateEdit = MigrateEditClaim | MigrateEditAdd | MigrateEditRename;

/** 一处改动：人读的「旧值 → 新值」+ 落盘动作（dry-run 与 --write 共用同一份计划）。 */
export interface MigrateChange {
  /** 仓库相对 posix 路径，如 `baize/scenarios/SC-001.md`。 */
  path: string;
  /** 1 起始的行号：改写发生在哪一行；add-claim 是锚定行（插入发生在它之后）。 */
  line: number;
  /** 旧值（人读），如 `parent: SR-001`。 */
  from: string;
  /** 新值（人读），如 `refines: [SR-001]`。 */
  to: string;
  edit: MigrateEdit;
}

/** 层的中文叫法（点名消息里人读用）：键为 layer key。 */
const LAYER_LABEL: Record<string, string> = {
  ir: "初始需求",
  sr: "系统需求",
  ar: "分配需求",
  scenarios: "场景",
  usecases: "用例",
  "function-items": "功能项",
  "function-points": "功能点",
};

/** 一处「拿不准、没动」：点名给用户，剩余问题由 validate 报。 */
export interface MigrateSkip {
  path: string;
  /** 相关行号；定位不到时为 null。 */
  line: number | null;
  reason: string;
}

export interface MigratePlan {
  changes: MigrateChange[];
  skipped: MigrateSkip[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 在 frontmatter 块里定位 `field:` 所在行（1 起始）。
 * 重复键时 YAML 语义是后者生效，故取最后一次出现（与 rename 的手法一致）。
 */
function fieldLineOf(text: string, field: string): number | undefined {
  const lines = text.split("\n");
  const pattern = new RegExp(`^\\s*${escapeRegExp(field)}\\s*:`);
  let found: number | undefined;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^---[ \t]*\r?$/.test(line)) break; // frontmatter 结束
    if (pattern.test(line)) found = i + 1;
  }
  return found;
}

/**
 * 计划一次 migrate：读全仓条目，识别旧模型的边，收集「改什么」与「什么拿不准」。
 * 本函数只读不写——dry-run 与 --write 共用同一份计划（拒绝条件先于改写）。
 */
export async function planMigrate(cwd: string): Promise<MigratePlan> {
  const entries = await readEntries(cwd);
  const byId = new Map<string, Entry>();
  for (const entry of entries) {
    const id = idOf(entry);
    if (id !== undefined && !byId.has(id)) byId.set(id, entry);
  }

  const changes: MigrateChange[] = [];
  const skipped: MigrateSkip[] = [];
  const textCache = new Map<string, string>();
  const textOf = async (entry: Entry): Promise<string> => {
    let text = textCache.get(entry.path);
    if (text === undefined) {
      text = await fs.readFile(path.join(cwd, entry.path), "utf8");
      textCache.set(entry.path, text);
    }
    return text;
  };

  // 功能项「迁移后」的认领集合：已有 satisfies 用它；否则旧 parent 指向的那条 SR。
  // 功能点继承认领边时用它——继承的是所属功能项搬完之后的认领。
  const effectiveClaims = (entry: Entry): string[] => {
    const field = CLAIM_FIELD[entry.layer.key];
    if (field !== undefined && Object.hasOwn(entry.frontmatter, field)) {
      return claimIdsOf(entry);
    }
    const parent = parentIdOf(entry);
    if (parent === undefined) return [];
    const target = byId.get(parent);
    return target !== undefined && target.layer.key === "sr" ? [parent] : [];
  };

  for (const entry of entries) {
    const claimField = CLAIM_FIELD[entry.layer.key];
    if (claimField === undefined) continue; // 需求侧三层（IR/SR/AR）的 parent 合法，不迁

    // 场景的备选流改名（与认领边无关，独立判断）：与用例统一拼写
    if (
      entry.layer.key === "scenarios" &&
      Object.hasOwn(entry.frontmatter, "alternateFlows")
    ) {
      if (Object.hasOwn(entry.frontmatter, "alternativeFlows")) {
        skipped.push({
          path: entry.path,
          line: null,
          reason: "alternateFlows 与 alternativeFlows 同时存在，不敢改名（改了就是重复键）",
        });
      } else {
        const line = fieldLineOf(await textOf(entry), "alternateFlows");
        if (line === undefined) {
          skipped.push({
            path: entry.path,
            line: null,
            reason: "frontmatter 里找不到 alternateFlows 行，不敢改名",
          });
        } else {
          changes.push({
            path: entry.path,
            line,
            from: "alternateFlows",
            to: "alternativeFlows",
            edit: {
              kind: "rename-key",
              fromKey: "alternateFlows",
              toKey: "alternativeFlows",
            },
          });
        }
      }
    }

    const parent = parentIdOf(entry);
    if (parent === undefined) continue; // 没有 parent：不是旧模型的边，validate 自会报
    const target = byId.get(parent);

    // 功能点：parent 本来就该挂功能项（新旧模型同形，不动）；旧模型没有它指向 SR 的
    // 边，缺的认领边从所属功能项继承。拿不准的情况逐个点名，文件不动。
    if (entry.layer.key === "function-points") {
      if (Object.hasOwn(entry.frontmatter, claimField)) continue; // 已有认领边：新形状
      const parentLineOf = async (): Promise<number | null> =>
        fieldLineOf(await textOf(entry), "parent") ?? null;
      if (target === undefined) {
        skipped.push({
          path: entry.path,
          line: await parentLineOf(),
          reason: `parent 指向不存在的条目：${parent}`,
        });
        continue;
      }
      if (target.layer.key !== "function-items") {
        skipped.push({
          path: entry.path,
          line: await parentLineOf(),
          reason: `功能点的 parent 指向 ${parent}（${
            LAYER_LABEL[target.layer.key] ?? target.layer.key
          }层条目）——应指功能项，不敢改写`,
        });
        continue;
      }
      const inherited = effectiveClaims(target);
      if (inherited.length === 0) {
        skipped.push({
          path: entry.path,
          line: await parentLineOf(),
          reason: `所属功能项 ${parent} 没有可继承的认领边，不猜`,
        });
        continue;
      }
      const line = await parentLineOf();
      if (line === null) {
        skipped.push({
          path: entry.path,
          line: null,
          reason: "frontmatter 里找不到 parent 行，不敢插入认领边",
        });
        continue;
      }
      changes.push({
        path: entry.path,
        line,
        from: "(缺失)",
        to: `satisfies: [${inherited.join(", ")}]（继承 ${parent} 的认领）`,
        edit: { kind: "add-claim", claim: "satisfies", ids: inherited },
      });
      continue;
    }

    // 子场景例外：parent 挂场景在新模型仍是合法分解边——parent 不动；缺认领边时
    // 点名（认领哪条 SR 是人的决定，migrate 不代填）
    if (
      entry.layer.key === "scenarios" &&
      target !== undefined &&
      target.layer.key === "scenarios"
    ) {
      if (!Object.hasOwn(entry.frontmatter, claimField)) {
        skipped.push({
          path: entry.path,
          line: fieldLineOf(await textOf(entry), "parent") ?? null,
          reason: `子场景没有认领边（${claimField} 缺失）：parent 保留（场景挂场景仍合法），认领哪条 SR 由人决定`,
        });
      }
      continue;
    }

    // 场景 / 用例 / 功能项：parent 指向 SR 的那条边就是要搬的旧模型边
    if (target !== undefined && target.layer.key === "sr") {
      if (Object.hasOwn(entry.frontmatter, claimField)) {
        // 已有认领边字段却还留着 parent：改写会产生重复键，不敢动
        skipped.push({
          path: entry.path,
          line: fieldLineOf(await textOf(entry), "parent") ?? null,
          reason: `已有 ${claimField} 字段，不敢改写 parent（先手工合并认领边）`,
        });
        continue;
      }
      const line = fieldLineOf(await textOf(entry), "parent");
      if (line === undefined) {
        skipped.push({
          path: entry.path,
          line: null,
          reason: "frontmatter 里找不到 parent 行，不敢改写",
        });
        continue;
      }
      changes.push({
        path: entry.path,
        line,
        from: `parent: ${parent}`,
        to: `${claimField}: [${parent}]`,
        edit: { kind: "parent-to-claim", claim: claimField, ids: [parent] },
      });
      continue;
    }

    // 剩下的全是拿不准：parent 指向不存在的条目，或指向 SR 之外的层——点名，不动
    skipped.push({
      path: entry.path,
      line: fieldLineOf(await textOf(entry), "parent") ?? null,
      reason:
        target === undefined
          ? `parent 指向不存在的条目：${parent}`
          : `parent 指向的 ${parent} 是${
              LAYER_LABEL[target.layer.key] ?? target.layer.key
            }层条目，不是 SR——不敢改写`,
    });
  }

  return { changes, skipped };
}

/** 按计划落盘：逐文件原子写（原子性只到单文件），只动计划内的行。 */
export async function applyMigrate(cwd: string, plan: MigratePlan): Promise<void> {
  const byPath = new Map<string, MigrateChange[]>();
  for (const change of plan.changes) {
    const list = byPath.get(change.path);
    if (list === undefined) byPath.set(change.path, [change]);
    else list.push(change);
  }
  for (const [relPath, fileChanges] of byPath) {
    const abs = path.join(cwd, relPath);
    const text = await fs.readFile(abs, "utf8");
    const lines = text.split("\n");
    // 自底向上落盘：后面的行号不因前面的改写（一行变多行 / 插入）而失效
    const ordered = [...fileChanges].sort((a, b) => b.line - a.line);
    for (const change of ordered) {
      const index = change.line - 1;
      const line = lines[index];
      if (line === undefined) continue; // 防御：行号对不上就不改这一处
      if (change.edit.kind === "rename-key") {
        const pattern = new RegExp(
          `^(\\s*)${escapeRegExp(change.edit.fromKey)}(\\s*:)(.*)$`,
        );
        if (!pattern.test(line)) continue; // 防御：锚行应仍是旧键
        lines[index] = line.replace(pattern, `$1${change.edit.toKey}$2$3`);
        continue;
      }
      // parent-to-claim / add-claim 的锚行都应是 parent 行
      if (!/^\s*parent\s*:/.test(line)) continue; // 防御
      const indent = /^(\s*)/.exec(line)?.[1] ?? "";
      const block = [
        `${indent}${change.edit.claim}:`,
        ...change.edit.ids.map((id) => `${indent}  - ${id}`),
      ];
      if (change.edit.kind === "parent-to-claim") lines.splice(index, 1, ...block);
      else lines.splice(index + 1, 0, ...block);
    }
    await writeFileAtomic(abs, lines.join("\n"));
  }
}
