import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { CodexProtocolError, CodexRuntimeUnavailableError } from "./errors.js";
import type { CodexTaskRunner, RunningCodexTask } from "./codex-task-runner.js";

const maxProtocolLineBytes = 1024 * 1024;
const defaultStartupTimeoutMs = 30_000;
const processShutdownTimeoutMs = 2_000;

type SpawnAppServer = (command: string) => ChildProcessWithoutNullStreams;

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface TurnWaiter {
  resolve(): void;
  reject(error: Error): void;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nestedString(value: unknown, ...keys: string[]): string | undefined {
  let current: unknown = value;
  for (const key of keys) current = asRecord(current)?.[key];
  return typeof current === "string" && current.length > 0 ? current : undefined;
}

export function resolveCodexCommand(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.FEATURE_KANBAN_CODEX_PATH?.trim();
  if (!configured) return "codex";
  if (!isAbsolute(configured)) throw new CodexRuntimeUnavailableError("FEATURE_KANBAN_CODEX_PATH must be absolute");
  try {
    if (!statSync(configured).isFile()) throw new Error("not a file");
  } catch {
    throw new CodexRuntimeUnavailableError("Configured Codex runtime is unavailable");
  }
  return configured;
}

function spawnDefaultAppServer(command: string): ChildProcessWithoutNullStreams {
  try {
    return spawn(command, ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch {
    throw new CodexRuntimeUnavailableError("Codex runtime could not be started");
  }
}

class AppServerConnection {
  private readonly pending = new Map<number, PendingRequest>();
  private readonly turnWaiters = new Map<string, TurnWaiter>();
  private readonly terminalTurns = new Map<string, Error | undefined>();
  private readonly exited: Promise<void>;
  private closing?: Promise<void>;
  private nextId = 0;
  private stdoutBuffer = Buffer.alloc(0);
  private stderrDiagnostic = "";
  private closed = false;
  private initialized = false;

  private readonly onStdoutData = (chunk: Buffer | string): void => {
    this.consume(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  };
  private readonly onStderrData = (chunk: Buffer | string): void => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
    this.stderrDiagnostic = `${this.stderrDiagnostic}${text}`.slice(-8192);
  };
  private readonly onStreamError = (): void => this.fail(new CodexProtocolError("Codex protocol stream failed"));
  private readonly onProtocolClosed = (): void => this.fail(
    this.initialized
      ? new CodexProtocolError("Codex protocol stream closed unexpectedly")
      : new CodexRuntimeUnavailableError("Codex runtime exited before initialization"),
  );
  private readonly onProcessError = (): void => this.fail(new CodexRuntimeUnavailableError("Codex runtime could not be started"));
  private readonly onProcessExit = (): void => this.onProtocolClosed();

  constructor(
    private readonly process: ChildProcessWithoutNullStreams,
    private readonly shutdownTimeoutMs = processShutdownTimeoutMs,
  ) {
    this.exited = process.exitCode !== null || process.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => process.once("exit", () => resolve()));
    process.stdout.on("data", this.onStdoutData);
    process.stderr.on("data", this.onStderrData);
    process.stdout.on("error", this.onStreamError);
    process.stdin.on("error", this.onStreamError);
    process.stdout.once("end", this.onProtocolClosed);
    process.stdout.once("close", this.onProtocolClosed);
    process.once("error", this.onProcessError);
    process.once("exit", this.onProcessExit);
  }

  markInitialized(): void {
    this.initialized = true;
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed) return Promise.reject(new CodexProtocolError("Codex app-server is closed"));
    const id = this.nextId++;
    const response = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.write({ method, id, params });
    return response;
  }

  notify(method: string, params: Record<string, unknown>): void {
    if (this.closed) throw new CodexProtocolError("Codex app-server is closed");
    this.write({ method, params });
  }

  waitForTurn(turnId: string): Promise<void> {
    if (this.terminalTurns.has(turnId)) {
      const error = this.terminalTurns.get(turnId);
      this.terminalTurns.delete(turnId);
      return error ? Promise.reject(error) : Promise.resolve();
    }
    if (this.closed) return Promise.reject(new CodexProtocolError("Codex app-server is closed"));
    return new Promise<void>((resolve, reject) => this.turnWaiters.set(turnId, { resolve, reject }));
  }

  close(): Promise<void> {
    this.closing ??= this.closeProcess();
    return this.closing;
  }

  private write(message: unknown): void {
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private consume(chunk: Buffer): void {
    if (this.closed) return;
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
    while (true) {
      const newline = this.stdoutBuffer.indexOf(0x0a);
      if (newline < 0) break;
      if (newline > maxProtocolLineBytes) {
        this.fail(new CodexProtocolError("Codex protocol message is too large"));
        return;
      }
      const line = this.stdoutBuffer.subarray(0, newline).toString("utf8").trim();
      this.stdoutBuffer = this.stdoutBuffer.subarray(newline + 1);
      if (line) this.handleLine(line);
      if (this.closed) return;
    }
    if (this.stdoutBuffer.length > maxProtocolLineBytes) {
      this.fail(new CodexProtocolError("Codex protocol message is too large"));
    }
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>;
    try {
      const parsed = asRecord(JSON.parse(line));
      if (!parsed) throw new Error("not an object");
      message = parsed;
    } catch {
      this.fail(new CodexProtocolError("Codex protocol returned invalid JSON"));
      return;
    }

    const method = message["method"];
    const requestId = message["id"];
    if (typeof method === "string" && (typeof requestId === "number" || typeof requestId === "string")) {
      if (
        method === "item/commandExecution/requestApproval"
        || method === "item/fileChange/requestApproval"
        || method === "execCommandApproval"
        || method === "applyPatchApproval"
      ) {
        this.write({ id: requestId, result: { decision: "decline" } });
      } else if (method === "mcpServer/elicitation/request") {
        this.write({ id: requestId, result: { action: "decline", content: null, _meta: null } });
      } else {
        this.write({ id: requestId, error: { code: -32601, message: "Client request is not supported" } });
      }
      return;
    }

    if (typeof requestId === "number") {
      const pending = this.pending.get(requestId);
      if (!pending) return;
      this.pending.delete(requestId);
      const rpcError = asRecord(message["error"]);
      if (rpcError) pending.reject(new CodexProtocolError("Codex app-server rejected the request"));
      else pending.resolve(message["result"]);
      return;
    }

    if (message["method"] === "turn/completed") {
      const turnId = nestedString(message["params"], "turn", "id");
      if (!turnId) return;
      const status = nestedString(message["params"], "turn", "status") ?? "completed";
      const terminalError = status === "completed"
        ? undefined
        : new CodexProtocolError(
          nestedString(message["params"], "turn", "error", "message") ?? `Codex turn ${status}`,
        );
      const waiter = this.turnWaiters.get(turnId);
      if (waiter) {
        this.turnWaiters.delete(turnId);
        if (terminalError) waiter.reject(terminalError);
        else waiter.resolve();
      } else {
        this.terminalTurns.set(turnId, terminalError);
      }
    }
  }

  private async closeProcess(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      this.rejectOutstanding(new CodexProtocolError("Codex task stopped"));
      this.cleanupListeners();
      this.process.stdin.end();
    }
    if (this.process.exitCode !== null || this.process.signalCode !== null) return;
    this.process.kill();
    if (await this.waitForExit(this.shutdownTimeoutMs)) return;
    if (this.process.exitCode === null && this.process.signalCode === null) this.process.kill("SIGKILL");
    await this.waitForExit(this.shutdownTimeoutMs);
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      return await Promise.race([this.exited.then(() => true), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectOutstanding(error);
    this.cleanupListeners();
    if (this.process.exitCode === null && this.process.signalCode === null) this.process.kill();
  }

  private rejectOutstanding(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    for (const waiter of this.turnWaiters.values()) waiter.reject(error);
    this.turnWaiters.clear();
  }

  private cleanupListeners(): void {
    this.process.stdout.removeListener("data", this.onStdoutData);
    this.process.stderr.removeListener("data", this.onStderrData);
    this.process.stdout.removeListener("error", this.onStreamError);
    this.process.stdin.removeListener("error", this.onStreamError);
    this.process.stdout.removeListener("end", this.onProtocolClosed);
    this.process.stdout.removeListener("close", this.onProtocolClosed);
    this.process.removeListener("error", this.onProcessError);
    this.process.removeListener("exit", this.onProcessExit);
  }
}

async function withinTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new CodexProtocolError("Codex task start timed out")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface CodexAppServerRunnerOptions {
  resolveCommand?: () => string;
  spawnProcess?: SpawnAppServer;
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

export class CodexAppServerTaskRunner implements CodexTaskRunner {
  private readonly resolveCommand: () => string;
  private readonly spawnProcess: SpawnAppServer;
  private readonly startupTimeoutMs: number;
  private readonly shutdownTimeoutMs: number;

  constructor(options: CodexAppServerRunnerOptions = {}) {
    this.resolveCommand = options.resolveCommand ?? resolveCodexCommand;
    this.spawnProcess = options.spawnProcess ?? spawnDefaultAppServer;
    this.startupTimeoutMs = options.startupTimeoutMs ?? defaultStartupTimeoutMs;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? processShutdownTimeoutMs;
  }

  async start(input: { cwd: string; prompt: string }): Promise<RunningCodexTask> {
    const connection = new AppServerConnection(this.spawnProcess(this.resolveCommand()), this.shutdownTimeoutMs);
    try {
      await withinTimeout(connection.request("initialize", {
        clientInfo: { name: "feature_kanban", title: "Feature Kanban", version: "0.1.0" },
      }), this.startupTimeoutMs);
      connection.markInitialized();
      connection.notify("initialized", {});
      const threadResult = await withinTimeout(connection.request("thread/start", {
        cwd: input.cwd,
        threadSource: "user",
      }), this.startupTimeoutMs);
      const threadId = nestedString(threadResult, "thread", "id");
      if (!threadId) throw new CodexProtocolError("Codex app-server did not return a thread id");
      const turnResult = await withinTimeout(connection.request("turn/start", {
        threadId,
        input: [{ type: "text", text: input.prompt }],
      }), this.startupTimeoutMs);
      const turnId = nestedString(turnResult, "turn", "id");
      if (!turnId) throw new CodexProtocolError("Codex app-server did not return a turn id");
      const completion = connection.waitForTurn(turnId).finally(() => connection.close());
      return {
        threadId,
        completion,
        stop: () => connection.close(),
      };
    } catch (error) {
      await connection.close();
      if (error instanceof CodexProtocolError || error instanceof CodexRuntimeUnavailableError) throw error;
      throw new CodexProtocolError("Codex task could not be started");
    }
  }
}
