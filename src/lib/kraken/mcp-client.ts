// ============================================================
// Kraken MCP Client
// Spawns `kraken mcp` as a stdio subprocess and communicates
// via JSON-RPC 2.0 (the MCP transport protocol).
// ============================================================

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface KrakenMcpClientOptions {
  krakenPath?: string;
  allowDangerous?: boolean;
  timeout?: number; // ms per request, default 30s
}

export class KrakenMcpClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = "";
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private initialized = false;
  private krakenPath: string;
  private allowDangerous: boolean;
  private timeout: number;

  constructor(options: KrakenMcpClientOptions = {}) {
    super();
    this.krakenPath = options.krakenPath ?? "kraken";
    this.allowDangerous = options.allowDangerous ?? false;
    this.timeout = options.timeout ?? 30_000;
  }

  get isConnected(): boolean {
    return this.process !== null && !this.process.killed && this.initialized;
  }

  async connect(): Promise<void> {
    if (this.process) {
      throw new Error("Already connected");
    }

    const args = ["mcp"];
    if (this.allowDangerous) {
      args.push("--allow-dangerous");
    }

    // Only pass safe env vars to the subprocess (not secrets like API keys)
    const safeEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: process.env.NODE_ENV,
      TERM: process.env.TERM ?? "xterm-256color",
      KRAKEN_API_KEY: process.env.KRAKEN_API_KEY,
      KRAKEN_API_SECRET: process.env.KRAKEN_API_SECRET,
    };

    const proc = spawn(this.krakenPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: safeEnv,
    });
    this.process = proc;

    proc.stdout!.on("data", (chunk: Buffer) => {
      this.handleData(chunk.toString());
    });

    proc.stderr!.on("data", (chunk: Buffer) => {
      this.emit("log", chunk.toString());
    });

    proc.on("close", (code) => {
      this.initialized = false;
      this.rejectAllPending(new Error(`Kraken MCP process exited with code ${code}`));
      this.process = null;
      this.emit("close", code);
    });

    proc.on("error", (err) => {
      this.emit("error", err);
    });

    // MCP initialize handshake
    const initResult = await this.sendRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "trading-agent", version: "1.0.0" },
    });

    // Send initialized notification
    this.sendNotification("notifications/initialized", {});
    this.initialized = true;
    this.emit("connected", initResult);
  }

  async disconnect(): Promise<void> {
    if (!this.process) return;

    this.rejectAllPending(new Error("Client disconnecting"));

    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }
      this.process.once("close", () => {
        this.process = null;
        this.initialized = false;
        resolve();
      });
      this.process.kill("SIGTERM");
      // Force kill after 5s
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill("SIGKILL");
        }
      }, 5000);
    });
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.isConnected) {
      throw new Error("Not connected to Kraken MCP");
    }
    const result = await this.sendRequest("tools/call", { name, arguments: args });
    return this.extractToolResult(result);
  }

  async listTools(): Promise<{ name: string; description: string; inputSchema: unknown }[]> {
    if (!this.isConnected) {
      throw new Error("Not connected to Kraken MCP");
    }
    const result = (await this.sendRequest("tools/list", {})) as {
      tools: { name: string; description: string; inputSchema: unknown }[];
    };
    return result.tools;
  }

  // --- Internal ---

  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin?.writable) {
        reject(new Error("Process stdin not writable"));
        return;
      }

      const id = ++this.requestId;
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        ...(params && { params }),
      };

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${method} (id=${id}) timed out after ${this.timeout}ms`));
      }, this.timeout);

      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(JSON.stringify(request) + "\n");
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.process?.stdin?.writable) return;
    const notification = {
      jsonrpc: "2.0",
      method,
      ...(params && { params }),
    };
    this.process.stdin.write(JSON.stringify(notification) + "\n");
  }

  private handleData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed) as JsonRpcResponse;
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const pending = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          clearTimeout(pending.timer);
          if (msg.error) {
            pending.reject(
              new Error(`MCP error ${msg.error.code}: ${msg.error.message}`)
            );
          } else {
            pending.resolve(msg.result);
          }
        } else if (!msg.id) {
          // Server notification
          this.emit("notification", msg);
        }
      } catch {
        this.emit("log", `Failed to parse MCP message: ${trimmed}`);
      }
    }
  }

  private extractToolResult(result: unknown): unknown {
    // MCP tool results come as { content: [{ type: "text", text: "..." }] }
    const r = result as { content?: { type: string; text: string }[]; isError?: boolean };
    if (r?.isError) {
      const errorText = r.content?.map((c) => c.text).join("\n") ?? "Unknown tool error";
      throw new Error(errorText);
    }
    if (r?.content && Array.isArray(r.content)) {
      const text = r.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      // Try to parse as JSON
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    }
    return result;
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

// Singleton instance
let client: KrakenMcpClient | null = null;

export function getKrakenClient(options?: KrakenMcpClientOptions): KrakenMcpClient {
  if (!client) {
    client = new KrakenMcpClient(options);
  }
  return client;
}

export async function ensureConnected(options?: KrakenMcpClientOptions): Promise<KrakenMcpClient> {
  const c = getKrakenClient(options);
  if (!c.isConnected) {
    await c.connect();
  }
  return c;
}
