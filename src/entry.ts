import { parse as parseYaml } from "yaml";
import type { LayerDef } from "./layers.ts";
import { isPlainObject } from "./guards.ts";

/** 一条解析后的条目：层级、仓库相对路径、frontmatter、正文。 */
export interface Entry {
  layer: LayerDef;
  /** 仓库相对 posix 路径，如 `baize/ir/IR-001.md`。 */
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

/** 解析 markdown 条目：`---` frontmatter 块 + 正文。无 frontmatter 时整体当正文。 */
export function parseEntry(layer: LayerDef, path: string, text: string): Entry {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/.exec(text);
  if (!match) {
    return { layer, path, frontmatter: {}, body: text };
  }

  const raw = match[1] ?? "";
  const body = match[2] ?? "";
  let frontmatter: Record<string, unknown> = {};
  try {
    const parsed: unknown = parseYaml(raw);
    if (isPlainObject(parsed)) frontmatter = parsed;
  } catch {
    // frontmatter 不可解析 → 视为空，必填字段随之报 field.absent。
    frontmatter = {};
  }
  return { layer, path, frontmatter, body };
}

/** 取条目 id；非字符串视作缺失。 */
export function idOf(entry: Entry): string | undefined {
  const value = entry.frontmatter["id"];
  return typeof value === "string" ? value : undefined;
}

/** 取父 id；`null` / 空白 / 非字符串视作「无父」（IR 的 `parent: null`）。 */
export function parentIdOf(entry: Entry): string | undefined {
  const value = entry.frontmatter["parent"];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
