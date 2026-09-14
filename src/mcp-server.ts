import { Pool } from "pg";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import { listScenarioNodes } from "./db.ts";

export async function runMcpServer(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const server = new McpServer({
    name: "baize-analysis",
    version: "0.1.0",
  });

  server.registerTool(
    "query_scenario_tree",
    {
      description: "Query the full scenario tree from PostgreSQL.",
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
      const pool = new Pool({ connectionString: databaseUrl });

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
