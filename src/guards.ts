/** 普通对象判定（排除 null 与数组），用于收窄 YAML 解析结果与字段值。 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
