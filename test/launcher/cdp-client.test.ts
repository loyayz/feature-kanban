import assert from "node:assert/strict";
import test from "node:test";
import { CdpClient, CdpSession, type WebSocketLike } from "../../src/launcher/cdp-client.js";

class FakeSocket implements WebSocketLike {
  readyState = 1;
  readonly sent: Array<{ id: number; method: string }> = [];
  closed = false;
  autoRespond = false;
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();

  addEventListener(type: string, handler: (event: { data?: unknown }) => void): void {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  send(data: string): void {
    const command = JSON.parse(data) as { id: number; method: string };
    this.sent.push(command);
    if (this.autoRespond) queueMicrotask(() => this.emit("message", { data: JSON.stringify({ id: command.id, result: {} }) }));
  }

  close(): void {
    this.closed = true;
    this.emit("close", {});
  }

  respond(id: number, result: unknown): void {
    this.emit("message", { data: JSON.stringify({ id, result }) });
  }

  private emit(type: string, event: { data?: unknown }): void {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }
}

test("correlates out-of-order CDP commands and closes explicitly", async () => {
  const socket = new FakeSocket();
  const session = new CdpSession(socket, 100);
  const first = session.send("First");
  const second = session.send("Second");
  socket.respond(2, { order: 2 });
  socket.respond(1, { order: 1 });
  assert.deepEqual(await second, { order: 2 });
  assert.deepEqual(await first, { order: 1 });
  session.close();
  assert.equal(socket.closed, true);
});

test("times out a CDP command that never receives a response", async () => {
  const session = new CdpSession(new FakeSocket(), 5);
  await assert.rejects(session.send("Never"), /timed out: Never/);
});

test("discovers page targets and configures CSP, preload injection, and current renderer", async () => {
  const socket = new FakeSocket();
  socket.autoRespond = true;
  const fetcher = async () => new Response(JSON.stringify([
    { id: "worker", type: "worker", url: "x" },
    { id: "page-1", type: "page", url: "https://codex.local", webSocketDebuggerUrl: "ws://fake/page" },
  ]), { status: 200 });
  const client = new CdpClient({
    fetcher: fetcher as typeof fetch,
    socketFactory: () => socket,
    commandTimeoutMs: 100,
  });
  const pages = await client.listPages();
  assert.equal(pages.length, 1);
  await client.configureTarget(pages[0]!, "window.injected = true");
  assert.deepEqual(socket.sent.map((command) => command.method), [
    "Page.setBypassCSP",
    "Page.addScriptToEvaluateOnNewDocument",
    "Runtime.evaluate",
  ]);
  assert.equal(socket.closed, true);
});

test("uses the fixed loopback CDP discovery port by default", async () => {
  let requested = "";
  const client = new CdpClient({
    fetcher: (async (input) => {
      requested = String(input);
      return new Response("[]", { status: 200 });
    }) as typeof fetch,
  });

  assert.deepEqual(await client.listPages(), []);
  assert.equal(requested, "http://127.0.0.1:46172/json/list");
});
