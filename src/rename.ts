import { promises as fs } from "node:fs";
import path from "node:path";
import { readCatalogs } from "./catalogs.ts";
import { parseEntry } from "./entry.ts";
import { BaizeError } from "./errors.ts";
import { escapeRegExp, fieldLineOf } from "./frontmatter.ts";
import { LAYERS, type LayerKey } from "./layers.ts";
import { BAIZE_DIR, writeFileAtomic } from "./store.ts";

/** `baize rename` 的改写对象：kind 决定改哪个层、哪个字段、对哪份清单验新 slug。 */
export type RenameKind = "catalog" | "element";

export interface RenameChange {
  /** 仓库相对 posix 路径，如 `baize/scenarios/SC-001.md`。 */
  path: string;
  /** 1 起始的行号：引用旧 slug 的那一行。 */
  line: number;
  /** frontmatter 字段名（catalog / allocates）。 */
  field: string;
  old: string;
  new: string;
}

export interface RenamePlan {
  kind: RenameKind;
  field: string;
  old: string;
  new: string;
  changes: RenameChange[];
}

interface RenameTarget {
  layer: LayerKey;
  field: string;
  /** 新 slug 的权威出处——rename 只读它、绝不写它。 */
  catalogFile: string;
}

const RENAME_TARGET: Record<RenameKind, RenameTarget> = {
  catalog: {
    layer: "scenarios",
    field: "catalog",
    catalogFile: "scenario-catalogs.yaml",
  },
  element: { layer: "ar", field: "allocates", catalogFile: "architecture.yaml" },
};

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/**
 * 计划一次 rename：先验新 slug 已在清单（拒绝条件先于任何改写），
 * 再扫目标层全部条目，收集「字段值恰等于旧 slug」的引用。
 * 本函数只读不写——dry-run 与 --write 共用同一份计划。
 */
export async function planRename(
  cwd: string,
  kind: RenameKind,
  old: string,
  newSlug: string,
): Promise<RenamePlan> {
  const target = RENAME_TARGET[kind];
  const catalogs = await readCatalogs(cwd);
  const slugSet =
    kind === "catalog" ? catalogs.scenarioCatalogs : catalogs.components;
  // 拒绝条件先于改写：新 slug 不在清单 → exit 2，一个文件不动。
  if (!slugSet.has(newSlug)) {
    throw new BaizeError(
      "rename.unknown-slug",
      `新 slug「${newSlug}」不在受控清单 baize/${target.catalogFile} 里；rename 不会把条目指到清单外的 id`,
    );
  }

  const layer = LAYERS.find((candidate) => candidate.key === target.layer);
  if (!layer) {
    throw new BaizeError("cli.usage", `rename 不支持 kind：${kind}`);
  }

  const dir = path.join(cwd, BAIZE_DIR, layer.dir);
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    if (isEnoent(error)) {
      // 该层还没有条目：0 处引用，不是错误。
      return { kind, field: target.field, old, new: newSlug, changes: [] };
    }
    throw error;
  }

  const changes: RenameChange[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".md")) continue;
    const relPath = path.posix.join(BAIZE_DIR, layer.dir, name);
    const text = await fs.readFile(path.join(cwd, relPath), "utf8");
    // frontmatter 解析失败按空处理（与 validate 同一手法）：无字段值可匹配，自然跳过。
    const entry = parseEntry(layer, relPath, text);
    const value = entry.frontmatter[target.field];
    if (typeof value !== "string" || value !== old) continue;
    const location = fieldLineOf(text, target.field);
    if (!location) continue; // 解析值与文本对不上（防御）：不改这个文件
    changes.push({
      path: relPath,
      line: location.line,
      field: target.field,
      old,
      new: newSlug,
    });
  }
  return { kind, field: target.field, old, new: newSlug, changes };
}

/** 按计划落盘：只动改动行，逐文件原子写（原子性只到单文件）。 */
export async function applyRename(cwd: string, plan: RenamePlan): Promise<void> {
  for (const change of plan.changes) {
    const abs = path.join(cwd, change.path);
    const text = await fs.readFile(abs, "utf8");
    const lines = text.split("\n");
    const index = change.line - 1;
    const line = lines[index];
    if (line === undefined) continue; // 防御：行号对不上就不写
    // 只替换值部分（冒号之后）里第一次出现的旧 slug，字段名里的同形文本不动。
    const fieldPattern = new RegExp(
      `^(\\s*${escapeRegExp(change.field)}\\s*:[ \\t]*)(.*)$`,
    );
    const matched = fieldPattern.exec(line);
    if (!matched) continue;
    const valuePart = matched[2] ?? "";
    const column = valuePart.indexOf(change.old);
    if (column < 0) continue;
    lines[index] =
      line.slice(0, line.length - valuePart.length) +
      valuePart.slice(0, column) +
      change.new +
      valuePart.slice(column + change.old.length);
    await writeFileAtomic(abs, lines.join("\n"));
  }
}
