import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { CodexAppServerTaskRunner, resolveCodexCommand } from "../../src/server/codex-app-server-runner.js";

class FakeProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed = true;
    this.signalCode = signal;
    queueMicrotask(() => this.emit("exit", null, signal));
    return true;
  }
}

class StubbornProcess extends FakeProcess {
  readonly signals: NodeJS.Signals[] = [];

  override kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killed = true;
    this.signals.push(signal);
    if (signal === "SIGKILL") {
      this.signalCode = signal;
      queueMicrotask(() => this.emit("exit", null, signal));
    }
    return true;
  }
}

test("uses PATH by default and validates an explicitly configured Codex executable", () => {
  assert.equal(resolveCodexCommand({}), "codex");
  assert.throws(() => resolveCodexCommand({ FEATURE_KANBAN_CODEX_PATH: "relative/codex" }), /must be absolute/);
  const directory = mkdtempSync(join(tmpdir(), "feature-kanban-codex-command-"));
  try {
    const command = join(directory, "codex.exe");
    writeFileSync(command, "fixture");
    assert.equal(resolveCodexCommand({ FEATURE_KANBAN_CODEX_PATH: command }), command);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("creates a visible user thread and preserves an early turn completion", async () => {
  const child = new FakeProcess();
  const requests: Array<Record<string, unknown>> = [];
  let inputBuffer = "";
  child.stdin.on("data", (chunk: Buffer) => {
    inputBuffer += chunk.toString("utf8");
    while (inputBuffer.includes("\n")) {
      const index = inputBuffer.indexOf("\n");
      const line = inputBuffer.slice(0, index);
      inputBuffer = inputBuffer.slice(index + 1);
      const message = JSON.parse(line) as Record<string, unknown>;
      requests.push(message);
      if (message["method"] === "initialize") {
        child.stdout.write(`${JSON.stringify({ id: message["id"], result: { userAgent: "test" } })}\n`);
      }
      if (message["method"] === "thread/start") {
        child.stdout.write(`${JSON.stringify({ id: message["id"], result: { thread: { id: "thread-real" } } })}\n`);
      }
      if (message["method"] === "turn/start") {
        child.stdout.write(`${JSON.stringify({ id: message["id"], result: { turn: { id: "turn-real" } } })}\n`);
        child.stdout.write(`${JSON.stringify({ method: "turn/completed", params: { turn: { id: "turn-real" } } })}\n`);
      }
    }
  });
  const runner = new CodexAppServerTaskRunner({
    resolveCommand: () => "C:\\runtime\\codex.exe",
    spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
    startupTimeoutMs: 1000,
  });

  const task = await runner.start({ cwd: "C:\\repo", prompt: "Build the feature" });
  assert.equal(task.threadId, "thread-real");
  assert.deepEqual(requests.find((request) => request["method"] === "thread/start")?.["params"], {
    cwd: "C:\\repo",
    threadSource: "user",
  });
  assert.deepEqual((requests.find((request) => request["method"] === "turn/start")?.["params"] as Record<string, unknown>)["input"], [
    { type: "text", text: "Build the feature" },
  ]);
  await task.completion;
  assert.equal(child.killed, true);
});

test("declines approvals and rejects unsupported client requests", async () => {
  const child = new FakeProcess();
  const messages: Array<Record<string, unknown>> = [];
  let inputBuffer = "";
  child.stdin.on("data", (chunk: Buffer) => {
    inputBuffer += chunk.toString("utf8");
    while (inputBuffer.includes("\n")) {
      const index = inputBuffer.indexOf("\n");
      const message = JSON.parse(inputBuffer.slice(0, index)) as Record<string, unknown>;
      inputBuffer = inputBuffer.slice(index + 1);
      messages.push(message);
      if (message["method"] === "initialize") child.stdout.write(`${JSON.stringify({ id: message["id"], result: {} })}\n`);
      if (message["method"] === "thread/start") {
        child.stdout.write(`${JSON.stringify({ method: "item/commandExecution/requestApproval", id: "approval", params: {} })}\n`);
        child.stdout.write(`${JSON.stringify({ method: "item/tool/requestUserInput", id: "question", params: {} })}\n`);
        child.stdout.write(`${JSON.stringify({ id: message["id"], result: { thread: { id: "thread-real" } } })}\n`);
      }
      if (message["method"] === "turn/start") child.stdout.write(`${JSON.stringify({ id: message["id"], result: { turn: { id: "turn-real" } } })}\n`);
    }
  });
  const runner = new CodexAppServerTaskRunner({
    resolveCommand: () => "codex",
    spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
    startupTimeoutMs: 1000,
  });
  const task = await runner.start({ cwd: "C:\\repo", prompt: "work" });
  const completion = task.completion.catch(() => undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(messages.find((message) => message["id"] === "approval")?.["result"], { decision: "decline" });
  assert.deepEqual(messages.find((message) => message["id"] === "question")?.["error"], {
    code: -32601,
    message: "Client request is not supported",
  });
  await task.stop();
  await completion;
});

test("rejects a failed terminal turn instead of reporting completion", async () => {
  const child = new FakeProcess();
  let inputBuffer = "";
  child.stdin.on("data", (chunk: Buffer) => {
    inputBuffer += chunk.toString("utf8");
    while (inputBuffer.includes("\n")) {
      const index = inputBuffer.indexOf("\n");
      const message = JSON.parse(inputBuffer.slice(0, index)) as Record<string, unknown>;
      inputBuffer = inputBuffer.slice(index + 1);
      if (message["method"] === "initialize") child.stdout.write(`${JSON.stringify({ id: message["id"], result: {} })}\n`);
      if (message["method"] === "thread/start") child.stdout.write(`${JSON.stringify({ id: message["id"], result: { thread: { id: "thread-real" } } })}\n`);
      if (message["method"] === "turn/start") {
        child.stdout.write(`${JSON.stringify({ id: message["id"], result: { turn: { id: "turn-failed" } } })}\n`);
        child.stdout.write(`${JSON.stringify({
          method: "turn/completed",
          params: { turn: { id: "turn-failed", status: "failed", error: { message: "model failed" } } },
        })}\n`);
      }
    }
  });
  const runner = new CodexAppServerTaskRunner({
    resolveCommand: () => "codex",
    spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
    startupTimeoutMs: 1000,
  });
  const task = await runner.start({ cwd: "C:\\repo", prompt: "work" });
  await assert.rejects(task.completion, /model failed/);
  assert.equal(child.killed, true);
});

test("waits for shutdown and force-kills an app server that ignores termination", async () => {
  const child = new StubbornProcess();
  let inputBuffer = "";
  child.stdin.on("data", (chunk: Buffer) => {
    inputBuffer += chunk.toString("utf8");
    while (inputBuffer.includes("\n")) {
      const index = inputBuffer.indexOf("\n");
      const message = JSON.parse(inputBuffer.slice(0, index)) as Record<string, unknown>;
      inputBuffer = inputBuffer.slice(index + 1);
      if (message["method"] === "initialize") child.stdout.write(`${JSON.stringify({ id: message["id"], result: {} })}\n`);
      if (message["method"] === "thread/start") child.stdout.write(`${JSON.stringify({ id: message["id"], result: { thread: { id: "thread-real" } } })}\n`);
      if (message["method"] === "turn/start") child.stdout.write(`${JSON.stringify({ id: message["id"], result: { turn: { id: "turn-running" } } })}\n`);
    }
  });
  const runner = new CodexAppServerTaskRunner({
    resolveCommand: () => "codex",
    spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
    startupTimeoutMs: 1000,
    shutdownTimeoutMs: 10,
  });
  const task = await runner.start({ cwd: "C:\\repo", prompt: "work" });
  const completion = task.completion.catch(() => undefined);
  await task.stop();
  await completion;
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
});

test("rejects malformed protocol output and stops the child process", async () => {
  const child = new FakeProcess();
  child.stdin.once("data", () => child.stdout.write("not-json\n"));
  const runner = new CodexAppServerTaskRunner({
    resolveCommand: () => "codex",
    spawnProcess: () => child as unknown as ChildProcessWithoutNullStreams,
    startupTimeoutMs: 1000,
  });
  await assert.rejects(runner.start({ cwd: "C:\\repo", prompt: "work" }), /invalid JSON/);
  assert.equal(child.killed, true);
});
