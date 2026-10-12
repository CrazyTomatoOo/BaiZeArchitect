import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { isPlainObject } from "./guards.ts";

export const BAIZE_DIR = "baize";

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/** 受控清单：一份 YAML = 一个顶层键 + 稳定 slug → { name, description? }。
 * 清单不是条目：没有 parent、不进阶段状态、不参与陈旧传播；
 * 校验只判「被引用的 slug 是否存在」，值里的额外字段一律忽略。 */
export interface Catalogs {
  /** `baize/architecture.yaml` 的 `components` 键下的 slug 集。 */
  components: ReadonlySet<string>;
  /** `baize/scenario-catalogs.yaml` 的 `catalogs` 键下的 slug 集。 */
  scenarioCatalogs: ReadonlySet<string>;
}

/** 读一份清单文件：一个顶层键（如 `components`）+ 其下稳定 slug → { name, description? }。
 * 取该顶层键映射的 slug 集；缺文件 = 空清单，不是错误。 */
async function readSlugSet(cwd: string, file: string): Promise<ReadonlySet<string>> {
  let text: string;
  try {
    text = await fs.readFile(path.join(cwd, BAIZE_DIR, file), "utf8");
  } catch (error) {
    if (isEnoent(error)) return new Set();
    throw error;
  }
  const parsed: unknown = parseYaml(text);
  if (!isPlainObject(parsed)) return new Set();
  // 统一约定：一个 YAML 文件只有一个顶层键；slug 是它值映射的键。值里的额外字段一律忽略。
  const top = Object.values(parsed).find(isPlainObject);
  if (top === undefined) return new Set();
  return new Set(Object.keys(top));
}

export async function readCatalogs(cwd: string): Promise<Catalogs> {
  const [components, scenarioCatalogs] = await Promise.all([
    readSlugSet(cwd, "architecture.yaml"),
    readSlugSet(cwd, "scenario-catalogs.yaml"),
  ]);
  return { components, scenarioCatalogs };
}
