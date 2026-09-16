import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export interface QueryResult<T = any> {
  rows: T[];
}

export type QueryValues = unknown[];

function toSqliteQuery(
  text: string,
  values: QueryValues,
): { sql: string; values: QueryValues } {
  const parameterOrder: number[] = [];
  const sql = text.replace(/\$(\d+)/g, (_, number: string) => {
    parameterOrder.push(Number(number));
    return "?";
  });

  return {
    sql,
    values: parameterOrder.map((parameterNumber) => values[parameterNumber - 1]),
  };
}

function decodeRows<T>(rows: unknown[]): T[] {
  return rows.map((row) => {
    if (
      typeof row === "object" &&
      row !== null &&
      "payload" in row &&
      typeof (row as { payload?: unknown }).payload === "string"
    ) {
      const record = row as { payload: string };

      try {
        return {
          ...record,
          payload: JSON.parse(record.payload),
        } as T;
      } catch {
        return row as T;
      }
    }

    return row as T;
  });
}

function executeQuery<T>(
  database: Database.Database,
  text: string,
  values: QueryValues,
): QueryResult<T> {
  const normalized = text.trim();

  if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(normalized)) {
    database.exec(normalized);
    return { rows: [] };
  }

  if (values.length === 0 && /^(CREATE|DROP|ALTER|PRAGMA)/i.test(normalized)) {
    database.exec(normalized);
    return { rows: [] };
  }

  const query = toSqliteQuery(normalized, values);
  const statement = database.prepare(query.sql);
  const rows = statement.reader
    ? statement.all(...query.values)
    : (statement.run(...query.values), []);

  return { rows: decodeRows<T>(rows) };
}

class SqliteClient {
  constructor(private readonly database: Database.Database) {}

  query<T = any>(
    text: string,
    values: QueryValues = [],
  ): Promise<QueryResult<T>> {
    return Promise.resolve(executeQuery<T>(this.database, text, values));
  }

  release(): void {
    // The client and pool share one synchronous better-sqlite3 connection.
  }
}

export class SqlitePool {
  readonly database: Database.Database;

  constructor(
    readonly filePath = process.env.BAIZE_DB_PATH ??
      path.join(process.cwd(), "baize.sqlite3"),
  ) {
    if (filePath !== ":memory:") {
      mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    }

    this.database = new Database(filePath);
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("journal_mode = WAL");
  }

  query<T = any>(
    text: string,
    values: QueryValues = [],
  ): Promise<QueryResult<T>> {
    return Promise.resolve(executeQuery<T>(this.database, text, values));
  }

  connect(): Promise<SqliteClient> {
    return Promise.resolve(new SqliteClient(this.database));
  }

  end(): Promise<void> {
    this.database.close();
    return Promise.resolve();
  }
}
