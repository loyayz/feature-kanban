import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type {
  BoardChangedEvent,
  CreateCardInput,
  SpecDocumentResponse,
} from "../../src/shared/lifecycle-contract.js";
import { createFeatureKanbanApp, type FeatureKanbanApp } from "../../src/server/app.js";
import { resolveServerConfig } from "../../src/server/config.js";
import { EventHub } from "../../src/server/event-hub.js";
import { LocalResourceOperationError } from "../../src/server/errors.js";
import type { LocalCardResources } from "../../src/server/local-card-resources.js";
import type { CodexTaskRunner, RunningCodexTask } from "../../src/server/codex-task-runner.js";
import { CodexProtocolError, CodexRuntimeUnavailableError } from "../../src/server/errors.js";

const card: CreateCardInput = {
  cardId: "6b6e7f6e-aafb-48af-9809-a78135db03a8",
  projectName: "feature-kanban",
  projectPath: "C:\\repo",
  title: "2026-08-12-feature-lifecycle-kanban",
  lifecycleDocumentPath: "C:\\repo\\docs\\feature\\flow.md",
  stage: "designing",
  progress: { stage: "designing", step: "writing_spec" },
  waitingForUser: false,
  blocked: false,
  aiTool: "codex",
  branch: "feat/2026-08-12-feature-lifecycle-kanban",
  session: {
    sessionRecordId: "40ea2585-ee15-4098-a20a-a0d9d3329660",
    aiTool: "codex",
  },
};

class RecordingEventHub extends EventHub {
  readonly events: BoardChangedEvent[] = [];
  override publish(event: BoardChangedEvent): void {
    this.events.push(event);
    super.publish(event);
  }
}

test("defaults to board port 46171 and accepts the source-mode port override", () => {
  const firstDirectory = mkdtempSync(join(tmpdir(), "feature-kanban-config-default-"));
  const secondDirectory = mkdtempSync(join(tmpdir(), "feature-kanban-config-override-"));
  try {
    assert.equal(resolveServerConfig({ dataDirectory: firstDirectory }).port, 46171);
    const previous = process.env.FEATURE_KANBAN_PORT;
    process.env.FEATURE_KANBAN_PORT = "49123";
    try {
      assert.equal(resolveServerConfig({ dataDirectory: secondDirectory }).port, 49123);
    } finally {
      if (previous === undefined) delete process.env.FEATURE_KANBAN_PORT;
      else process.env.FEATURE_KANBAN_PORT = previous;
    }
  } finally {
    rmSync(firstDirectory, { recursive: true, force: true });
    rmSync(secondDirectory, { recursive: true, force: true });
  }
});

async function appFixture(
  t: TestContext,
  eventHub = new RecordingEventHub(),
  localResources?: LocalCardResources,
  codexTaskRunner?: CodexTaskRunner,
): Promise<{ app: FeatureKanbanApp; baseUrl: string; eventHub: RecordingEventHub }> {
  const directory = mkdtempSync(join(tmpdir(), "feature-kanban-http-"));
  const app = createFeatureKanbanApp({
    port: 0,
    dataDirectory: directory,
    staticDirectory: join(directory, "web"),
    eventHub,
    ...(localResources ? { localResources } : {}),
    ...(codexTaskRunner ? { codexTaskRunner } : {}),
  });
  const address = await app.listen() as AddressInfo;
  t.after(async () => {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { app, baseUrl: `http://127.0.0.1:${address.port}`, eventHub };
}

class RecordingCodexRunner implements CodexTaskRunner {
  readonly calls: Array<{ cwd: string; prompt: string }> = [];
  private completeActive: (() => void) | undefined;

  async start(input: { cwd: string; prompt: string }): Promise<RunningCodexTask> {
    this.calls.push(input);
    let complete!: () => void;
    const completion = new Promise<void>((resolve) => { complete = resolve; });
    this.completeActive = complete;
    return { threadId: `thread-${this.calls.length}`, completion, stop: async () => complete() };
  }

  complete(): void {
    this.completeActive?.();
  }
}

test("creates, retries, filters, fetches, and automatically archives completed cards", async (t) => {
  const { baseUrl, eventHub } = await appFixture(t);
  const create = await fetch(`${baseUrl}/api/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });
  assert.equal(create.status, 201);
  assert.equal(eventHub.events[0]?.type, "card.created");
  assert.deepEqual(Object.keys(eventHub.events[0] ?? {}).sort(), ["cardId", "type"]);

  const retry = await fetch(`${baseUrl}/api/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });
  assert.equal(retry.status, 200);
  assert.equal(eventHub.events.length, 1);

  const list = await fetch(`${baseUrl}/api/cards?project=all&aiTool=codex`);
  const listBody = await list.json() as { cards: unknown[] };
  assert.equal(listBody.cards.length, 1);

  const update = await fetch(`${baseUrl}/api/cards/${card.cardId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stage: "completed",
      progress: { stage: "completed", step: "integrated" },
      waitingForUser: false,
      blocked: false,
      aiTool: "codex",
      branch: card.branch,
      specDocumentPath: "C:\\repo\\docs\\spec.md",
      session: card.session,
    }),
  });
  assert.equal(update.status, 200);
  assert.equal(((await update.json()) as { card: { archived: boolean } }).card.archived, true);
  assert.deepEqual(eventHub.events.at(-1), { type: "card.updated", cardId: card.cardId });

  const hide = await fetch(`${baseUrl}/api/projects/${encodeURIComponent(card.projectName)}/visibility`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hidden: true }),
  });
  assert.equal(hide.status, 200);
  assert.equal(((await hide.json()) as { project: { hidden: boolean } }).project.hidden, true);
  assert.deepEqual(eventHub.events.at(-1), { type: "project.updated", projectName: card.projectName });

  const removedArchiveEndpoint = await fetch(`${baseUrl}/api/cards/${card.cardId}/archive`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived: true }),
  });
  assert.equal(removedArchiveEndpoint.status, 404);
  const archived = await fetch(`${baseUrl}/api/cards?archived=true`);
  assert.equal(((await archived.json()) as { cards: unknown[] }).cards.length, 1);
  const active = await fetch(`${baseUrl}/api/cards?archived=false`);
  assert.equal(((await active.json()) as { cards: unknown[] }).cards.length, 0);
});

test("opens projects and reads specs only from paths stored on the card", async (t) => {
  const opened: string[] = [];
  const read: string[] = [];
  const localResources: LocalCardResources = {
    openProject: async (path) => { opened.push(path); },
    readSpec: async (path): Promise<SpecDocumentResponse> => {
      read.push(path);
      return { path, content: "# Spec" };
    },
  };
  const { baseUrl } = await appFixture(t, new RecordingEventHub(), localResources);
  await fetch(`${baseUrl}/api/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });
  await fetch(`${baseUrl}/api/cards/${card.cardId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      stage: card.stage,
      progress: card.progress,
      waitingForUser: false,
      blocked: false,
      aiTool: card.aiTool,
      branch: card.branch,
      specDocumentPath: "C:\\repo\\docs\\spec.md",
      session: card.session,
    }),
  });

  const open = await fetch(`${baseUrl}/api/cards/${card.cardId}/open-project`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "C:\\attacker" }),
  });
  assert.equal(open.status, 204);
  assert.deepEqual(opened, [card.projectPath]);

  const spec = await fetch(`${baseUrl}/api/cards/${card.cardId}/spec-document`);
  assert.equal(spec.status, 200);
  assert.deepEqual(await spec.json(), { path: "C:\\repo\\docs\\spec.md", content: "# Spec" });
  assert.deepEqual(read, ["C:\\repo\\docs\\spec.md"]);
});

test("returns clear errors for missing project and spec metadata", async (t) => {
  const { baseUrl } = await appFixture(t);
  const legacyCard = { ...card } as Record<string, unknown>;
  delete legacyCard["projectPath"];
  await fetch(`${baseUrl}/api/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(legacyCard),
  });
  assert.equal((await fetch(`${baseUrl}/api/cards/${card.cardId}/open-project`, { method: "POST" })).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/cards/${card.cardId}/spec-document`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/projects/missing/visibility`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hidden: true }),
  })).status, 404);
});

test("returns a stable local-resource error when the file manager cannot start", async (t) => {
  const localResources: LocalCardResources = {
    openProject: async () => { throw new LocalResourceOperationError("Project file manager could not be started"); },
    readSpec: async () => { throw new Error("not used"); },
  };
  const { baseUrl } = await appFixture(t, new RecordingEventHub(), localResources);
  await fetch(`${baseUrl}/api/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });
  const response = await fetch(`${baseUrl}/api/cards/${card.cardId}/open-project`, { method: "POST" });
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Project file manager could not be started" });
});

test("returns validation and identity conflict status codes", async (t) => {
  const { baseUrl } = await appFixture(t);
  const malformed = await fetch(`${baseUrl}/api/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{bad",
  });
  assert.equal(malformed.status, 400);

  await fetch(`${baseUrl}/api/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });
  const conflict = await fetch(`${baseUrl}/api/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...card, projectName: "other" }),
  });
  assert.equal(conflict.status, 409);
});

test("treats malformed encoded card paths as unknown API routes", async (t) => {
  const { baseUrl } = await appFixture(t);
  const response = await fetch(`${baseUrl}/api/cards/%E0%A4%A`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "API route not found" });
});

test("rejects non-loopback browser origins but permits non-browser local clients", async (t) => {
  const { baseUrl } = await appFixture(t);
  const rejected = await fetch(`${baseUrl}/api/health`, { headers: { Origin: "https://example.com" } });
  assert.equal(rejected.status, 403);
  const accepted = await fetch(`${baseUrl}/api/health`);
  assert.equal(accepted.status, 200);
});

test("creates a Codex thread and immediately starts its first prompt in the stored project directory", async (t) => {
  const projectDirectory = mkdtempSync(join(tmpdir(), "feature-kanban-codex-project-"));
  t.after(() => rmSync(projectDirectory, { recursive: true, force: true }));
  const runner = new RecordingCodexRunner();
  const { baseUrl } = await appFixture(t, new RecordingEventHub(), undefined, runner);
  await fetch(`${baseUrl}/api/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...card, projectPath: projectDirectory }),
  });

  const created = await fetch(`${baseUrl}/api/codex/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectName: card.projectName, prompt: "  Inspect this repository.  " }),
  });
  assert.equal(created.status, 202);
  assert.deepEqual(await created.json(), { threadId: "thread-1", status: "in_progress" });
  assert.deepEqual(runner.calls, [{ cwd: projectDirectory, prompt: "Inspect this repository." }]);

  const busy = await fetch(`${baseUrl}/api/codex/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectName: card.projectName, prompt: "second" }),
  });
  assert.equal(busy.status, 409);
  runner.complete();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await fetch(`${baseUrl}/api/codex/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectName: card.projectName, prompt: "third" }),
  })).status, 202);
});

test("rejects invalid and unsafe Codex task requests before invoking the runner", async (t) => {
  const runner = new RecordingCodexRunner();
  const { baseUrl } = await appFixture(t, new RecordingEventHub(), undefined, runner);
  for (const body of [
    { projectName: "all", prompt: "do work" },
    { projectName: "missing", prompt: "do work" },
    { projectName: "missing", prompt: "" },
    { projectName: "missing", prompt: "do work", projectPath: "C:\\attacker" },
    { projectName: "missing", prompt: "x".repeat(4001) },
  ]) {
    const response = await fetch(`${baseUrl}/api/codex/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, body.projectName === "missing" && body.prompt === "do work" && !('projectPath' in body) ? 409 : 400);
  }
  assert.equal(runner.calls.length, 0);
});

test("maps Codex runtime and protocol startup failures to stable statuses", async (t) => {
  const projectDirectory = mkdtempSync(join(tmpdir(), "feature-kanban-codex-errors-"));
  t.after(() => rmSync(projectDirectory, { recursive: true, force: true }));
  for (const [error, expected] of [
    [new CodexRuntimeUnavailableError("Codex runtime is unavailable"), 503],
    [new CodexProtocolError("Codex app-server rejected the request"), 502],
  ] as const) {
    const runner: CodexTaskRunner = { start: async () => { throw error; } };
    const { baseUrl } = await appFixture(t, new RecordingEventHub(), undefined, runner);
    await fetch(`${baseUrl}/api/cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...card,
        cardId: crypto.randomUUID(),
        projectPath: projectDirectory,
        lifecycleDocumentPath: `${projectDirectory}\\${crypto.randomUUID()}.md`,
        session: { sessionRecordId: crypto.randomUUID(), aiTool: "codex" },
      }),
    });
    const response = await fetch(`${baseUrl}/api/codex/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectName: card.projectName, prompt: "do work" }),
    });
    assert.equal(response.status, expected);
    await response.body?.cancel();
  }
});

test("does not publish SSE events when the database transaction fails", async (t) => {
  const eventHub = new RecordingEventHub();
  const { app, baseUrl } = await appFixture(t, eventHub);
  const originalConsoleError = console.error;
  console.error = () => {};
  t.after(() => { console.error = originalConsoleError; });
  app.repository["database"].exec("DROP TABLE cards");
  const response = await fetch(`${baseUrl}/api/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(card),
  });
  assert.equal(response.status, 500);
  assert.equal(eventHub.events.length, 0);
});
