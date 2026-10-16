import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { BaizeError } from "./errors.ts";
import { isPlainObject } from "./guards.ts";
import { LAYERS, type LayerDef, type LayerKey } from "./layers.ts";
import { BAIZE_DIR, isEnoent, maxNumberInDir, writeFileAtomic } from "./store.ts";

/**
 * 发号账本：`baize/ids.yaml`，每层一行「已发出去的最大编号」。
 *
 * 为什么需要它（#193）：条目文件能记住的只有「现在有什么」。删掉最后一个条目，
 * 或者把整层搬进子目录（模型只扫层目录第一层），编号就退回来了——下一个新条目
 * 拿到同一个号，指向旧号的 `covers` / `parent` / `refines` 于是**静默改指**到新条目，
 * 而报告里只会出现一句「下游待复核」，一次 `baize accept` 就抹平。账本是唯一记得
 * 「这个号发过」的地方，所以它只增不减。
 *
 * 与其它落盘状态同一条纪律：记的是**算不出来的东西**——目录能算出「现在有什么」，
 * 算不出「发过什么」。进度、覆盖率、陈旧一概不进来。
 */
export const IDS_FILE = `${BAIZE_DIR}/ids.yaml`;

/** 每层已发出去的最大编号；没记的层 = 没记（不是 0，由调用方与目录基线取大）。 */
export type IssuedNumbers = Partial<Record<LayerKey, number>>;

export interface IssuedLedger {
  /** 文件是否存在：缺文件 = 老仓库（还没账本），不是「空账本」。 */
  present: boolean;
  numbers: IssuedNumbers;
}

function invalid(detail: string): BaizeError {
  return new BaizeError("ids.invalid", `发号账本 ${IDS_FILE} 读不懂：${detail}`);
}

/** 解析账本内容。形状不对就抛——账本读不懂时宁可不发号，也不冒复用编号的险。 */
export function parseIssued(text: string): IssuedNumbers {
  const parsed: unknown = parseYaml(text);
  if (parsed === null || parsed === undefined) return {};
  if (!isPlainObject(parsed)) {
    throw invalid("顶层要是一份映射（层名: 编号）");
  }
  const numbers: IssuedNumbers = {};
  for (const [key, value] of Object.entries(parsed)) {
    const layer = LAYERS.find((candidate) => candidate.key === key);
    if (layer === undefined) {
      throw invalid(
        `不认识的层名「${key}」（只认：${LAYERS.map((item) => item.key).join(" / ")}）`,
      );
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw invalid(`层「${key}」的编号要写成 0 或正整数，读到的是 ${JSON.stringify(value)}`);
    }
    numbers[layer.key] = value;
  }
  return numbers;
}

/** 读账本：文件不存在 → `present: false`；内容读不懂 → 抛。 */
export async function readIssued(cwd: string): Promise<IssuedLedger> {
  let text: string;
  try {
    text = await fs.readFile(path.join(cwd, IDS_FILE), "utf8");
  } catch (error) {
    if (isEnoent(error)) return { present: false, numbers: {} };
    throw error;
  }
  return { present: true, numbers: parseIssued(text) };
}

/** 发号：账本记的号与层目录里现有条目的号，取大者 +1，零填充三位。 */
export async function nextId(cwd: string, layer: LayerDef): Promise<string> {
  const { numbers } = await readIssued(cwd);
  const max = Math.max(numbers[layer.key] ?? 0, await maxNumberInDir(cwd, layer));
  return `${layer.prefix}-${String(max + 1).padStart(3, "0")}`;
}

function ledgerText(numbers: IssuedNumbers): string {
  const ordered: Record<string, number> = {};
  for (const layer of LAYERS) {
    const value = numbers[layer.key];
    if (value !== undefined) ordered[layer.key] = value;
  }
  return (
    "# 由 baize 维护：每层已发出去的最大编号。编号只增不减——删掉或搬走条目都不会让号退回来（#193）。\n" +
    stringifyYaml(ordered)
  );
}

/**
 * 记账：把刚发出去的号写下来。账本缺失时先用各层目录的现状补基线（老仓库升级的路径），
 * 再记这一号。发号与记账都在落盘之前——号一旦发出就不再复用，半途失败只留一个空洞。
 */
export async function recordIssued(
  cwd: string,
  layer: LayerDef,
  id: string,
): Promise<void> {
  const { present, numbers } = await readIssued(cwd);
  const next: IssuedNumbers = { ...numbers };
  if (!present) {
    for (const other of LAYERS) {
      const max = await maxNumberInDir(cwd, other);
      if (max > 0) next[other.key] = max;
    }
  }
  const matched = new RegExp(`^${layer.prefix}-(\\d+)$`).exec(id)?.[1];
  if (matched === undefined) {
    throw new BaizeError("ids.invalid", `不是该层的编号：${id}`);
  }
  next[layer.key] = Math.max(next[layer.key] ?? 0, Number(matched));
  await writeFileAtomic(path.join(cwd, IDS_FILE), ledgerText(next));
}
