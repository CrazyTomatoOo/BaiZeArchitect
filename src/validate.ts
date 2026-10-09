import type { Entry } from "./entry.ts";
import { idOf } from "./entry.ts";
import { BaizeError } from "./errors.ts";
import { chainMembers } from "./chain.ts";
import { isPlainObject } from "./guards.ts";
import type { FieldKind } from "./layers.ts";
import { readEntries } from "./store.ts";
import type { Issue } from "./types.ts";

/**
 * 空判定按字段种类走。
 * - `string`：空/纯空白
 * - `array` / `map`：**任何空容器**（`[]` 与 `{}` 都可能是「没写」）
 * - `scalar`：`null`
 * 其它类型不符（例：集合字段给了非空标量）视为「已填」，本票不引入类型类 rule。
 */
function isEmptyValue(kind: FieldKind, value: unknown): boolean {
  if (kind === "string") return typeof value === "string" && value.trim() === "";
  if (kind === "scalar") return value === null;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

function fieldIssues(entry: Entry): Issue[] {
  const issues: Issue[] = [];
  for (const field of entry.layer.fields) {
    const present =
      field.source === "body" || Object.hasOwn(entry.frontmatter, field.name);
    if (!present) {
      issues.push({
        level: "ERROR",
        rule: "field.absent",
        path: entry.path,
        message: `缺少必填字段：${field.name}`,
        fix: `在 ${entry.path} 的 frontmatter 中补上 ${field.name}`,
      });
      continue;
    }
    if (!field.nonEmpty) continue;
    const value =
      field.source === "body" ? entry.body : entry.frontmatter[field.name];
    if (isEmptyValue(field.kind, value)) {
      issues.push({
        level: "ERROR",
        rule: "field.empty",
        path: entry.path,
        message: field.emptyMessage,
        fix: `补上 ${field.name} 的内容（空数组/空对象只用于「看过了确实没有」）`,
      });
    }
  }
  return issues;
}

function idIssue(entry: Entry): Issue[] {
  if (!Object.hasOwn(entry.frontmatter, "id")) return []; // 缺交由 field.absent 报
  const raw = entry.frontmatter["id"];
  if (typeof raw === "string" && raw.trim() === "") return []; // 空交由 field.empty 报

  const expected = `${entry.layer.prefix}-<三位数字>`;
  const pattern = new RegExp(`^${entry.layer.prefix}-\\d{3}$`);
  if (typeof raw === "string" && pattern.test(raw)) return [];

  // 类型不符（如 `id: 42`）也在此报——否则它会绕过 field.empty（非字符串不判空）静默通过。
  const shown = typeof raw === "string" ? raw : (JSON.stringify(raw) ?? String(raw));
  return [
    {
      level: "ERROR",
      rule: "id.invalid",
      path: entry.path,
      message: `id 不合法：「${shown}」应为 ${expected}（如 ${entry.layer.prefix}-001）`,
      fix: `把 id 改为 ${expected} 形式的顺序编号`,
    },
  ];
}

function issuesFor(entry: Entry): Issue[] {
  return [...idIssue(entry), ...fieldIssues(entry)];
}

/** 全仓（或限定一条链）跑 field / id 规则，返回按 path、rule 排序的问题。 */
export async function validate(
  cwd: string,
  options: { chain?: string } = {},
): Promise<Issue[]> {
  const entries = await readEntries(cwd);

  let scoped = entries;
  if (options.chain !== undefined) {
    if (!entries.some((entry) => idOf(entry) === options.chain)) {
      throw new BaizeError("chain.not-found", `链不存在：${options.chain}`);
    }
    scoped = chainMembers(entries, options.chain);
  }

  const issues = scoped.flatMap(issuesFor);
  issues.sort((a, b) =>
    a.path === b.path
      ? a.rule.localeCompare(b.rule)
      : a.path.localeCompare(b.path),
  );
  return issues;
}
