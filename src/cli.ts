import { Pool } from "pg";
import { runFauxAgent } from "./agent/faux.ts";
import {
  completeAnalysisRun,
  createAnalysisRun,
  failAnalysisRun,
  initializeSchema,
  recordTraceEvent,
} from "./db.ts";

interface CliResult {
  runId: string;
  status: "succeeded";
  assistantText: string;
}

async function main(): Promise<void> {
  const requirement = process.argv[2]?.trim();

  if (!requirement) {
    console.error("Usage: npm start -- <requirement>");
    process.exitCode = 2;
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exitCode = 2;
    return;
  }

  const pool = new Pool({ connectionString: databaseUrl });
  let runId: string | undefined;

  try {
    await initializeSchema(pool);
    const run = await createAnalysisRun(pool, requirement);
    runId = run.id;

    await recordTraceEvent(pool, run.id, "analysis_run_started", {
      requirement,
    });

    const agentResult = await runFauxAgent(requirement);

    await recordTraceEvent(pool, run.id, "analysis_run_completed", {
      assistantText: agentResult.text,
      callCount: agentResult.callCount,
    });

    await completeAnalysisRun(pool, run.id);

    const result: CliResult = {
      runId: run.id,
      status: "succeeded",
      assistantText: agentResult.text,
    };

    console.log(JSON.stringify(result));
  } catch (error) {
    if (runId) {
      await recordTraceEvent(pool, runId, "analysis_run_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      await failAnalysisRun(pool, runId);
    }

    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();
