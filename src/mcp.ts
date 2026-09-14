import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Pool } from "pg";
import { recordTraceEvent } from "./db.ts";

export type McpToolResult = Awaited<ReturnType<Client["callTool"]>>;

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

async function loadServerConfig(serverName: string): Promise<McpServerConfig> {
  const configPath =
    process.env.MCP_CONFIG_PATH ?? path.join(process.cwd(), "mcp.config.json");
  const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));

  if (
    !isRecord(parsed) ||
    !isRecord(parsed.mcpServers) ||
    !isRecord(parsed.mcpServers[serverName])
  ) {
    throw new Error(`MCP server is not configured: ${serverName}`);
  }

  const { command, args, env } = parsed.mcpServers[serverName];

  if (
    typeof command !== "string" ||
    command.length === 0 ||
    (args !== undefined &&
      (!Array.isArray(args) || args.some((arg) => typeof arg !== "string"))) ||
    (env !== undefined && !isStringRecord(env))
  ) {
    throw new Error(`MCP server configuration is invalid: ${serverName}`);
  }

  return {
    command,
    args: args as string[],
    env: env as Record<string, string> | undefined,
  };
}

export class McpToolClient {
  private client?: Client;
  private transport?: StdioClientTransport;

  constructor(
    private readonly pool: Pool,
    private readonly runId: string,
    private readonly serverName = "baize-analysis",
  ) {}

  async start(): Promise<void> {
    if (this.client) {
      return;
    }

    try {
      const serverConfig = await loadServerConfig(this.serverName);
      this.transport = new StdioClientTransport({
        command: serverConfig.command,
        args: serverConfig.args,
        env: {
          ...serverConfig.env,
          DATABASE_URL: process.env.DATABASE_URL ?? "",
        },
        stderr: "pipe",
      });
      this.client = new Client({
        name: "baize-agent-mvp",
        version: "0.1.0",
      });
      await this.client.connect(this.transport);
      await recordTraceEvent(this.pool, this.runId, "mcp_server_started", {
        server: this.serverName,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await recordTraceEvent(this.pool, this.runId, "mcp_server_failed", {
        server: this.serverName,
        error: message,
      });
      await this.close();
      throw new Error(`MCP server failed to start: ${message}`);
    }
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolResult> {
    await this.start();

    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    await recordTraceEvent(this.pool, this.runId, "mcp_tool_call", {
      server: this.serverName,
      toolName,
      args,
    });

    try {
      const result = await this.client.callTool({
        name: toolName,
        arguments: args,
      });

      await recordTraceEvent(this.pool, this.runId, "mcp_tool_result", {
        server: this.serverName,
        toolName,
        result,
        isError: result.isError === true,
      });

      if (result.isError === true) {
        throw new Error(`MCP tool failed: ${toolName}`);
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!message.startsWith("MCP tool failed:")) {
        await recordTraceEvent(this.pool, this.runId, "mcp_tool_result", {
          server: this.serverName,
          toolName,
          result: {
            error: message,
          },
          isError: true,
        });
        throw new Error(`MCP tool failed: ${toolName}: ${message}`);
      }

      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = undefined;
    }

    if (this.transport) {
      await this.transport.close();
      this.transport = undefined;
    }
  }
}
