import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

if (!process.env.BAIZE_DB_PATH) {
  process.env.BAIZE_DB_PATH = path.join(
    mkdtempSync(path.join(tmpdir(), "baize-tests-")),
    "baize.sqlite3",
  );
}
