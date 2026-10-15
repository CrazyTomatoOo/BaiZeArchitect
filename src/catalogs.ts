import { promises as fs } from "node:fs";
import path from "node:path";
import { isMap, isNode, isScalar, LineCounter, parseDocument, type YAMLError, type YAMLMap } from "yaml";
import { BAIZE_DIR, isEnoent } from "./store.ts";
import type { Issue } from "./types.ts";

/** 受控清单：一份 YAML = 一个顶层键 + 稳定 slug → { name, description? }。
 * 清单不是条目：没有 parent、不进阶段状态、不参与陈旧传播；
 * 校验只判「被引用的 slug 是否存在」，值里的额外字段一律忽略。 */
export interface Catalogs {
  /** `baize/architecture.yaml` 的 `components` 键下的 slug 集。 */
  components: ReadonlySet<string>;
  /** `baize/scenario-catalogs.yaml` 的 `catalogs` 键下的 slug 集。 */
  scenarioCatalogs: ReadonlySet<string>;
}

/** readCatalogs 的结果：两份 slug 集 + 清单自身的问题（#186）。清单是外部
 * 维护的脏输入——解析失败与格式问题不抛，收集成 Issue 交校验层报。 */
export interface CatalogsRead extends Catalogs {
  issues: readonly Issue[];
}

/** 一份清单文件的读取结果：配定顶层键下的 slug 集 + 该文件自身的问题。 */
interface SlugSetRead {
  slugs: ReadonlySet<string>;
  issues: Issue[];
}

// catalog.unparseable（#186）：解析失败（含重复键 Map keys must be unique）不再
// 抛栈——对照 entry.ts frontmatter「解析失败按空处理」的手法，收集成一条干净的
// ERROR 交校验层；同时按空清单（引用由 ref.* 报）。只取第一个错误：后续错误
// 多是第一个的连锁，逐条报反而淹没根因。
function parseIssueOf(file: string, error: YAMLError): Issue {
  // yaml 的 message 自带「 at line N, column M:」与源码摘录——剥掉，行号统一由我们给
  const bare =
    (error.message.split("\n")[0] ?? "").replace(/\s+at line \d+(, column \d+)?:?\s*$/, "").trim();
  const line = error.linePos?.[0]?.line;
  return {
    level: "ERROR",
    rule: "catalog.unparseable",
    path: path.posix.join(BAIZE_DIR, file),
    message: `清单解析失败：${bare}${line === undefined ? "" : `（第 ${line} 行）`}`,
    fix: `修复 baize/${file} 的 YAML 语法后重试`,
  };
}

/**
 * 读一份清单文件：只读**配定的顶层键**（architecture.yaml → `components`、
 * scenario-catalogs.yaml → `catalogs`）映射下的 slug 集——同一约定里
 * 「一个 YAML 文件只有一个顶层键」，但文件里完全可能先出现别的键（如
 * `metadata`）；不配定键名就会把先出现的映射误当清单。
 * 缺文件 = 空清单，不是错误；解析失败 = 空清单 + 一条 ERROR（#186）；
 * 配定键缺失 = 空清单（引用由 ref.* 报）；键在但不是映射 = 一条 ERROR。
 */
async function readSlugSet(
  cwd: string,
  file: string,
  topKey: string,
): Promise<SlugSetRead> {
  let text: string;
  try {
    text = await fs.readFile(path.join(cwd, BAIZE_DIR, file), "utf8");
  } catch (error) {
    if (isEnoent(error)) return { slugs: new Set(), issues: [] };
    throw error;
  }
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, uniqueKeys: true });
  if (doc.errors.length > 0) {
    return { slugs: new Set(), issues: [parseIssueOf(file, doc.errors[0]!)] };
  }
  // 根不是映射 / 配定顶层键缺失 = 空清单（引用由 ref.* 报）。
  const root = doc.contents;
  if (!isMap(root)) return { slugs: new Set(), issues: [] };
  const topPair = root.items.find((pair) => keyTextOf(pair.key) === topKey);
  if (topPair === undefined) return { slugs: new Set(), issues: [] };
  // catalog.top-key-not-mapping：键在、值不是映射（序列/标量/空）——之前静默按
  // 空清单吞掉，现在报出来：清单文件既然存在，配定键就该是映射（#186）。
  if (!isMap(topPair.value)) {
    return {
      slugs: new Set(),
      issues: [
        {
          level: "ERROR",
          rule: "catalog.top-key-not-mapping",
          path: path.posix.join(BAIZE_DIR, file),
          message: `受控清单的顶层键 ${topKey} 不是映射${suffixOf(lineCounter, topPair.key)}`,
          fix: `把 ${topKey} 写成「slug → { name, description? }」的映射`,
        },
      ],
    };
  }
  const slugs = new Set<string>();
  const issues: Issue[] = [];
  for (const pair of topPair.value.items) {
    const slug = keyTextOf(pair.key);
    // 非法 slug 仍进集合：ref.* 只回答「存在与否」，格式归格式。
    slugs.add(slug);
    const relPath = path.posix.join(BAIZE_DIR, file);
    if (!KEBAB_CASE.test(slug)) {
      issues.push({
        level: "ERROR",
        rule: "catalog.invalid-slug",
        path: relPath,
        message: `清单 slug 不是 kebab-case：${slug}${suffixOf(lineCounter, pair.key)}`,
        fix: `把 slug 改成 kebab-case（小写字母、数字与连字符，如 export-service）`,
      });
    }
    // 值不是映射（标量/序列/空值）时无从取字段，一并按 name 缺失报。
    const entry: YAMLMap | null = isMap(pair.value) ? pair.value : null;
    const namePair = entry?.items.find((candidate) => keyTextOf(candidate.key) === "name");
    const nameValue =
      namePair !== undefined && isScalar(namePair.value) ? namePair.value.value : undefined;
    if (typeof nameValue !== "string" || nameValue.trim() === "") {
      issues.push({
        level: "ERROR",
        rule: "catalog.name-missing",
        path: relPath,
        message: `清单条目 ${slug} 的 name 缺失或为空${suffixOf(lineCounter, namePair?.key ?? pair.key)}`,
        fix: `给 ${slug} 写上非空 name（清单是标签，name 是给人读的显示名）`,
      });
    }
    const descPair = entry?.items.find((candidate) => keyTextOf(candidate.key) === "description");
    const descValue =
      descPair !== undefined && isScalar(descPair.value) ? descPair.value.value : undefined;
    if (descPair !== undefined && (typeof descValue !== "string" || descValue.trim() === "")) {
      issues.push({
        level: "ERROR",
        rule: "catalog.description-empty",
        path: relPath,
        message: `清单条目 ${slug} 的 description 为空——写了就必须非空${suffixOf(lineCounter, descPair.key)}`,
        fix: `补上 ${slug} 的 description 内容，或删掉该键`,
      });
    }
  }
  return { slugs, issues };
}

/** 准入格式（#168/ADR-0004）：slug 形如 kebab-case——小写字母/数字段，段间单个连字符。 */
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** 取映射键的文本（脏输入：复杂键 / 非标量键 / 缺失键都归 ""，交给格式规则报）。 */
function keyTextOf(key: unknown): string {
  if (!isScalar(key)) return "";
  return typeof key.value === "string" ? key.value : String(key.value ?? "");
}

/** 「（第 N 行）」后缀：行号来自 LineCounter；非节点 / 无 range 就不带（防御）。 */
function suffixOf(lineCounter: LineCounter, node: unknown): string {
  const offset = isNode(node) ? node.range?.[0] : undefined;
  return offset === undefined ? "" : `（第 ${lineCounter.linePos(offset).line} 行）`;
}

export async function readCatalogs(cwd: string): Promise<CatalogsRead> {
  const [components, scenarioCatalogs] = await Promise.all([
    readSlugSet(cwd, "architecture.yaml", "components"),
    readSlugSet(cwd, "scenario-catalogs.yaml", "catalogs"),
  ]);
  return {
    components: components.slugs,
    scenarioCatalogs: scenarioCatalogs.slugs,
    issues: [...components.issues, ...scenarioCatalogs.issues],
  };
}
