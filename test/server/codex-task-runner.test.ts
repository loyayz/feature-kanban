import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CardRepository } from "../../src/server/card-repository.js";
import { CodexTaskCoordinator, type CodexTaskRunner, type RunningCodexTask } from "../../src/server/codex-task-runner.js";
import { openDatabase } from "../../src/server/database.js";

test("shutdown waits for a pending start, stops its child, and rejects the owning request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "feature-kanban-codex-shutdown-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  try {
    const repository = new CardRepository(database.connection);
    repository.createCard({
      cardId: "6b6e7f6e-aafb-48af-9809-a78135db03a8",
      projectName: "alpha",
      projectPath: directory,
      title: "flow",
      lifecycleDocumentPath: join(directory, "flow.md"),
      stage: "designing",
      progress: { stage: "designing", step: "writing_spec" },
      waitingForUser: false,
      blocked: false,
      aiTool: "codex",
      branch: "feat/flow",
      session: { sessionRecordId: "40ea2585-ee15-4098-a20a-a0d9d3329660", aiTool: "codex" },
    });
    let resolveStart!: (task: RunningCodexTask) => void;
    const runner: CodexTaskRunner = {
      start: () => new Promise((resolve) => { resolveStart = resolve; }),
    };
    const coordinator = new CodexTaskCoordinator(repository, runner);
    const create = coordinator.create("alpha", "work");
    let stops = 0;
    const close = coordinator.close();
    resolveStart({ threadId: "thread-starting", completion: new Promise(() => {}), stop: async () => { stops += 1; } });
    await close;
    await assert.rejects(create, /shutting down/);
    assert.equal(stops, 1);
    await assert.rejects(coordinator.create("alpha", "later"), /shutting down/);
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
