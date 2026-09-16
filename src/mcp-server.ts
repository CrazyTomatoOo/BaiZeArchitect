import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { listScenarioNodes, SqlitePool } from "./db.ts";

export async function runMcpServer(): Promise<void> {
  const databasePath = process.env.BAIZE_DB_PATH;

  if (!databasePath) {
    throw new Error("BAIZE_DB_PATH is required");
  }

  const server = new McpServer({
    name: "baize-analysis",
    version: "0.1.0",
  });

  server.registerTool(
    "query_scenario_tree",
    {
      description: "Query the full scenario tree from SQLite.",
      outputSchema: {
        count: z.number(),
        nodes: z.array(
          z.object({
            id: z.string(),
            parentId: z.string().nullable(),
            name: z.string(),
            description: z.string(),
          }),
        ),
      },
    },
    async () => {
      const pool = new SqlitePool(databasePath);

      try {
        const nodes = await listScenarioNodes(pool);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(nodes),
            },
          ],
          structuredContent: {
            count: nodes.length,
            nodes,
          },
        };
      } finally {
        await pool.end();
      }
    },
  );

  await server.connect(new StdioServerTransport());
}

const entryPath = process.argv[1] ?? "";

if (
  entryPath.endsWith("mcp-server.js") ||
  entryPath.endsWith("mcp-server.ts")
) {
  void runMcpServer();
}
