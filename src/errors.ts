export type AnalysisFailureCode =
  | "database_error"
  | "invalid_model_output"
  | "tool_failure"
  | "tool_timeout"
  | "mcp_failure"
  | "mcp_timeout"
  | "missing_data"
  | "cancelled"
  | "internal_error";

export class AnalysisFailureError extends Error {
  constructor(
    readonly failureCode: AnalysisFailureCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AnalysisFailureError";
  }
}

export class CancellationError extends AnalysisFailureError {
  constructor(readonly signal: "SIGINT" | "SIGTERM") {
    super("cancelled", `Analysis run cancelled by ${signal}`);
    this.name = "CancellationError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isDatabaseError(error: unknown): boolean {
  if (error instanceof AnalysisFailureError) {
    return error.failureCode === "database_error";
  }

  const code = (error as { code?: unknown }).code;

  return (
    typeof code === "string" &&
    (/^[0-9A-Z]{5}$/.test(code) ||
      /^SQLITE_[0-9A-Z_]+$/.test(code) ||
      [
        "ECONNREFUSED",
        "ECONNRESET",
        "EHOSTUNREACH",
        "ENETUNREACH",
        "ENOTFOUND",
        "ETIMEDOUT",
      ].includes(code))
  );
}

export function failureCodeForError(error: unknown): AnalysisFailureCode {
  if (error instanceof AnalysisFailureError) {
    return error.failureCode;
  }

  if (isDatabaseError(error)) {
    return "database_error";
  }

  return "internal_error";
}

export function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
  failureCode: AnalysisFailureCode,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new AnalysisFailureError(failureCode, message));
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
