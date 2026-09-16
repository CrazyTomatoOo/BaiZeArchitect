import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { SqlitePool } from "./db.ts";
import {
  AnalysisFailureError,
  failureCodeForError,
  withTimeout,
} from "./errors.ts";
import { recordTraceEvent } from "./db.ts";

export type McpToolResult = Awaited<ReturnType<Client["callTool"]>>;

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

function positiveEnvInteger(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function mcpStartTimeoutMs(): number {
  return positiveEnvInteger("BAIZE_MCP_START_TIMEOUT_MS", 5_000);
}

function mcpTimeoutMs(): number {
  return positiveEnvInteger("BAIZE_MCP_TIMEOUT_MS", 5_000);
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
    private readonly pool: SqlitePool,
    private readonly runId: string,
    private readonly serverName = "baize-analysis",
  ) {}

  async start(): Promise<void> {
    if (this.client) {
      return;
    }

    let serverStderr = "";

    try {
      const serverConfig = await loadServerConfig(this.serverName);
      const childEnv: Record<string, string> = {
        ...serverConfig.env,
        BAIZE_DB_PATH:
          process.env.BAIZE_DB_PATH ?? path.join(process.cwd(), "baize.sqlite3"),
      };

      if (childEnv.PKG_EXECPATH === undefined) {
        // pkg injects this variable into spawned processes. If the child is the
        // same packaged executable, it would treat its first argument as a
        // script path instead of passing it through to the CLI.
        childEnv.PKG_EXECPATH = "";
      }

      this.transport = new StdioClientTransport({
        command: serverConfig.command,
        args: serverConfig.args,
        env: childEnv,
        stderr: "pipe",
      });
      this.client = new Client({
        name: "baize-agent-mvp",
        version: "0.1.0",
      });
      this.transport.stderr?.on("data", (chunk: string | Buffer) => {
        serverStderr += chunk.toString();
      });
      await withTimeout(
        this.client.connect(this.transport),
        mcpStartTimeoutMs(),
        `MCP server timed out: ${this.serverName}`,
        "mcp_timeout",
      );
      await recordTraceEvent(this.pool, this.runId, "mcp_server_started", {
        server: this.serverName,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timeout = error instanceof AnalysisFailureError &&
        error.failureCode === "mcp_timeout";
      const classifiedCode = failureCodeForError(error);
      const failureCode = timeout
        ? "mcp_timeout"
        : classifiedCode === "database_error"
          ? "database_error"
          : "mcp_failure";

      await recordTraceEvent(
        this.pool,
        this.runId,
        timeout ? "mcp_server_timeout" : "mcp_server_failed",
        {
          server: this.serverName,
          error: message,
          timeoutMs: timeout ? mcpStartTimeoutMs() : undefined,
        },
      );
      await this.close().catch(() => undefined);
      throw new AnalysisFailureError(
        failureCode,
        `MCP server failed to start: ${message}${
          serverStderr ? `: ${serverStderr.trim()}` : ""
        }`,
        { cause: error },
      );
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
      const result = await withTimeout(
        this.client.callTool({
          name: toolName,
          arguments: args,
        }),
        mcpTimeoutMs(),
        `MCP tool timed out: ${toolName}`,
        "mcp_timeout",
      );

      await recordTraceEvent(this.pool, this.runId, "mcp_tool_result", {
        server: this.serverName,
        toolName,
        result,
        isError: result.isError === true,
      });

      if (result.isError === true) {
        throw new AnalysisFailureError(
          "mcp_failure",
          `Analysis tool failed: ${toolName}`,
        );
      }

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const timeout = error instanceof AnalysisFailureError &&
        error.failureCode === "mcp_timeout";
      const classifiedCode = failureCodeForError(error);
      const failureCode = timeout
        ? "mcp_timeout"
        : classifiedCode === "database_error"
          ? "database_error"
          : "mcp_failure";

      if (timeout) {
        await recordTraceEvent(this.pool, this.runId, "mcp_tool_timeout", {
          server: this.serverName,
          toolName,
          timeoutMs: mcpTimeoutMs(),
          error: message,
        });
        await this.close().catch(() => undefined);
        throw error;
      }

      if (!(error instanceof AnalysisFailureError)) {
        await recordTraceEvent(this.pool, this.runId, "mcp_tool_result", {
          server: this.serverName,
          toolName,
          result: {
            error: message,
          },
          isError: true,
        });
        throw new AnalysisFailureError(
          failureCode,
          `Analysis tool failed: ${toolName}: ${message}`,
          { cause: error },
        );
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
