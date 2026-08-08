/**
 * EvolverMcpClient — 容器内 evolver-mcp stdio 子进程的最小 JSON-RPC 客户端。
 *
 * #9b: 可选的本地 Evolver 客户端，供 distill-gene 等离线工具复用。
 * 否则 local-only(空 store → recall 返 "(无可用 gene)")。
 *
 * ponytail: 不引 @modelcontextprotocol/sdk(未装),手写 newline-delimited JSON-RPC。
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";

export class EvolverMcpClient {
	private proc: ChildProcessWithoutNullStreams | null = null;
	private buf = "";
	private nextId = 1;
	private pending = new Map<
		number,
		{ resolve: (v: unknown) => void; reject: (e: Error) => void }
	>();

	async start(): Promise<void> {
		// evolver-mcp 的 stdio 入口随包走(容器/本地一致)
		const bin = join(
			import.meta.dirname,
			"node_modules/@evomap/evolver-mcp/dist/stdio.js",
		);
		this.proc = spawn("node", [bin], { stdio: ["pipe", "pipe", "pipe"], detached: true });
		this.proc.stdout.setEncoding("utf8");
		this.proc.stdout.on("data", (d: string) => this.onData(d));
		this.proc.on("exit", () => {
			for (const p of this.pending.values())
				p.reject(new Error("evolver-mcp exited"));
			this.pending.clear();
			this.proc = null;
		});
		// MCP 握手: initialize → initialized 通知
		await this.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "baize-architect", version: "1" },
		});
		this.notify("notifications/initialized", {});
	}

	private onData(chunk: string): void {
		this.buf += chunk;
		let i: number;
		while ((i = this.buf.indexOf("\n")) >= 0) {
			const line = this.buf.slice(0, i);
			this.buf = this.buf.slice(i + 1);
			if (!line.trim()) continue;
			let msg: { id?: number; result?: unknown; error?: { message?: string } };
			try {
				msg = JSON.parse(line);
			} catch {
				continue; // 非 JSON 行(stderr 已分流)跳过
			}
			if (msg.id != null && this.pending.has(msg.id)) {
				const p = this.pending.get(msg.id)!;
				this.pending.delete(msg.id);
				if (msg.error)
					p.reject(new Error(msg.error.message ?? "evolver-mcp error"));
				else p.resolve(msg.result);
			}
		}
	}

	call(tool: string, args: Record<string, unknown>): Promise<unknown> {
		return this.request("tools/call", { name: tool, arguments: args });
	}

	private request(method: string, params: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.proc) return reject(new Error("evolver-mcp not started"));
			const id = this.nextId++;
			this.pending.set(id, { resolve, reject });
			this.proc.stdin.write(
				JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
			);
			// ponytail: 30s 硬超时 — evolver-mcp 本地查询应秒级,卡死即放弃(不阻断设计)
			setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					reject(new Error(`evolver-mcp ${method} timeout`));
				}
			}, 30_000);
		});
	}

	private notify(method: string, params: unknown): void {
		this.proc?.stdin.write(
			JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n",
		);
	}

	dispose(): void {
		// ponytail: SIGKILL 进程组 — evolver-mcp 及其子进程,避免 node 退出后
		// 子进程被 reparent 到 tini(PID1) 使容器不退。detached:true 使子自成进程组。
		if (this.proc?.pid) {
			try {
				process.kill(-this.proc.pid, "SIGKILL");
			} catch {
				this.proc?.kill("SIGKILL");
			}
		}
	}
}

let client: EvolverMcpClient | null = null;
let startFailed = false;

/** BAIZE_EVOLVER=1 时 lazy-spawn 单例;未启用或失败返 null(不阻断主流程)。 */
export async function getEvolverClient(): Promise<EvolverMcpClient | null> {
	if (process.env.BAIZE_EVOLVER !== "1") return null;
	if (startFailed) return null;
	if (client) return client;
	try {
		client = new EvolverMcpClient();
		await client.start();
		console.log("[baize] evolver-mcp stdio started (local gene discovery)");
		return client;
	} catch (e) {
		startFailed = true;
		console.error(
			`[baize] evolver-mcp spawn failed: ${e instanceof Error ? e.message : e}`,
		);
		return null;
	}
}

process.on("exit", () => client?.dispose());
