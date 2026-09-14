import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const mode = process.env.BAIZE_MCP_TEST_MODE;

if (mode !== "empty" && mode !== "timeout") {
  throw new Error("BAIZE_MCP_TEST_MODE must be empty or timeout");
}

const server = new McpServer({
  name: "baize-analysis-test",
  version: "0.1.0",
});

server.registerTool(
  "query_scenario_tree",
  {
    description: "Deterministic MCP server used by failure-recovery tests.",
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
    if (mode === "timeout") {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    return {
      content: [
        {
          type: "text" as const,
          text: "[]",
        },
      ],
      structuredContent: {
        count: 0,
        nodes: [],
      },
    };
  },
);

await server.connect(new StdioServerTransport());
