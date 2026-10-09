import { promises as fs } from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { LAYERS, type FieldKind, type LayerDef } from "./layers.ts";
import { parseEntry, type Entry } from "./entry.ts";

export const BAIZE_DIR = "baize";

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/** 扫描全仓的已知层级目录，返回所有条目（一层内扁平）。 */
export async function readEntries(cwd: string): Promise<Entry[]> {
  const entries: Entry[] = [];
  for (const layer of LAYERS) {
    const dir = path.join(cwd, BAIZE_DIR, layer.dir);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (error) {
      // 目录不存在 = 该层还没有条目；其它失败（权限、路径是文件）必须上抛，
      // 否则「读不到」会被当成「没有」，validate 会静默通过。
      if (isEnoent(error)) continue;
      throw error;
    }
    for (const name of names.sort()) {
      if (!name.endsWith(".md")) continue;
      const text = await fs.readFile(path.join(dir, name), "utf8");
      entries.push(
        parseEntry(layer, path.posix.join(BAIZE_DIR, layer.dir, name), text),
      );
    }
  }
  return entries;
}

/** 发号：扫描该层目录的 `PREFIX-NNN.md`，取最大号 +1，零填充三位。 */
export async function nextId(cwd: string, layer: LayerDef): Promise<string> {
  const dir = path.join(cwd, BAIZE_DIR, layer.dir);
  const pattern = new RegExp(`^${layer.prefix}-(\\d+)\\.md$`);
  let max = 0;
  try {
    for (const name of await fs.readdir(dir)) {
      const matched = pattern.exec(name)?.[1];
      if (matched !== undefined) max = Math.max(max, Number(matched));
    }
  } catch (error) {
    // 目录不存在 → 从 001 起；其它失败必须上抛，否则可能覆盖已有编号。
    if (!isEnoent(error)) throw error;
  }
  return `${layer.prefix}-${String(max + 1).padStart(3, "0")}`;
}

function emptyValue(kind: FieldKind): unknown {
  switch (kind) {
    case "string":
      return "";
    case "map":
      return {};
    case "array":
      return [];
    case "scalar":
      return null;
  }
}

/** 建文件的初始内容：frontmatter 写齐该层必填字段（值留空），正文留空待填。 */
export function scaffold(layer: LayerDef, id: string): string {
  const frontmatter: Record<string, unknown> = {};
  for (const field of layer.fields) {
    if (field.source !== "frontmatter") continue;
    frontmatter[field.name] = field.name === "id" ? id : emptyValue(field.kind);
  }
  return `---\n${stringifyYaml(frontmatter)}---\n\n`;
}

/** 原子写：临时文件 + rename，保证「别写坏文件」（并发交给 git）。 */
export async function writeFileAtomic(abs: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, abs);
}
