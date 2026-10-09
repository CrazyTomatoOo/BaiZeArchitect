/** 内部错误：请求不成立（命令用错、条目/链不存在）→ exit 2，仍输出 JSON。 */
export class BaizeError extends Error {
  readonly rule: string;
  readonly exitCode: number;

  constructor(rule: string, message: string, exitCode = 2) {
    super(message);
    this.name = "BaizeError";
    this.rule = rule;
    this.exitCode = exitCode;
  }
}
