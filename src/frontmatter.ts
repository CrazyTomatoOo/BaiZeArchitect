// frontmatter 块内的行定位：rename 与 migrate 共用一份（#190 评审修复——
// 此前两个命令各有一份几乎一样的实现）。

/** 把字面文本转义成安全拼进 RegExp 的源串。 */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 在 frontmatter 块里定位 `field:` 所在行（1 起始）。
 * 重复键时 YAML 语义是后者生效，故取最后一次出现；标量字段的值在同一行。
 */
export function fieldLineOf(
  text: string,
  field: string,
): { line: number; valuePart: string } | undefined {
  const lines = text.split("\n");
  const fieldPattern = new RegExp(`^(\\s*${escapeRegExp(field)}\\s*:[ \\t]*)(.*)$`);
  let found: { line: number; valuePart: string } | undefined;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^---[ \t]*\r?$/.test(line)) break; // frontmatter 结束
    const matched = fieldPattern.exec(line);
    if (matched) found = { line: i + 1, valuePart: matched[2] ?? "" };
  }
  return found;
}
