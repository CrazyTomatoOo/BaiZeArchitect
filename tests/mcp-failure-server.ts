import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({
  name: "baize-analysis-test",
  version: "0.1.0",
});

server.registerTool("query_scenario_tree", {}, async () => ({
  content: [
    {
      type: "text" as const,
      text: "Forced MCP query failure",
    },
  ],
  isError: true,
}));

await server.connect(new StdioServerTransport());
