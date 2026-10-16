import { promises as fs } from "node:fs";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { LAYERS, type FieldKind, type LayerDef } from "./layers.ts";
import { parseEntry, type Entry } from "./entry.ts";

export const BAIZE_DIR = "baize";

/** 文件/目录不存在：读路径上「缺了就当空」的地方共用这一份判定（`ENOENT` 的形状只有一处认识）。 */
export function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/** 层目录第一层的名字（已排序）；目录不存在 = 该层还没有条目。 */
export async function listLayerDir(cwd: string, layer: LayerDef): Promise<string[]> {
  try {
    return (await fs.readdir(path.join(cwd, BAIZE_DIR, layer.dir))).sort();
  } catch (error) {
    // 目录不存在 = 该层还没有条目；其它失败（权限、路径是文件）必须上抛，
    // 否则「读不到」会被当成「没有」，validate 会静默通过。
    if (isEnoent(error)) return [];
    throw error;
  }
}

/**
 * 扫描全仓的已知层级目录，返回所有条目（一层内扁平）。
 * 条目只由「层目录第一层的 `.md` 文件」决定——子目录与非 `.md` 的路径都不算，
 * 这一点由 `id.stray` 报出（#193）。
 */
export async function readEntries(cwd: string): Promise<Entry[]> {
  const entries: Entry[] = [];
  for (const layer of LAYERS) {
    for (const name of await listLayerDir(cwd, layer)) {
      if (!name.endsWith(".md")) continue;
      const text = await fs.readFile(
        path.join(cwd, BAIZE_DIR, layer.dir, name),
        "utf8",
      );
      entries.push(
        parseEntry(layer, path.posix.join(BAIZE_DIR, layer.dir, name), text),
      );
    }
  }
  return entries;
}

/** 层目录里现有条目用到的最大编号（只看 `<PREFIX>-<数字>.md` 这个名字形状）；空层为 0。 */
export async function maxNumberInDir(cwd: string, layer: LayerDef): Promise<number> {
  const pattern = new RegExp(`^${layer.prefix}-(\\d+)\\.md$`);
  let max = 0;
  for (const name of await listLayerDir(cwd, layer)) {
    const matched = pattern.exec(name)?.[1];
    if (matched !== undefined) max = Math.max(max, Number(matched));
  }
  return max;
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

/** 建文件的初始内容：frontmatter 写齐该层必填字段（值留空），正文留空待填。
 *  overrides 覆盖默认值（如 --parent / --covers 把声明写进 frontmatter）。 */
export function scaffold(
  layer: LayerDef,
  id: string,
  overrides: Record<string, unknown> = {},
): string {
  const frontmatter: Record<string, unknown> = {};
  for (const field of layer.fields) {
    if (field.source !== "frontmatter") continue;
    frontmatter[field.name] = field.name === "id" ? id : emptyValue(field.kind);
  }
  Object.assign(frontmatter, overrides);
  return `---\n${stringifyYaml(frontmatter)}---\n\n`;
}

/** 原子写：临时文件 + rename，保证「别写坏文件」（并发交给 git）。 */
export async function writeFileAtomic(abs: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, abs);
}
