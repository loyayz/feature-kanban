import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { CreateCardInput, UpdateCardInput } from "../../src/shared/lifecycle-contract.js";
import { CardRepository } from "../../src/server/card-repository.js";
import { openDatabase } from "../../src/server/database.js";
import { ConflictError } from "../../src/server/errors.js";

const base: CreateCardInput = {
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
    externalSessionId: "thread-1",
  },
};

function repositoryFixture(t: TestContext): CardRepository {
  const directory = mkdtempSync(join(tmpdir(), "feature-kanban-repository-"));
  const database = openDatabase(join(directory, "test.sqlite"));
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return new CardRepository(database.connection);
}

test("POST retry returns the existing card without overwriting completed snapshot or archive state", (t) => {
  const repository = repositoryFixture(t);
  const first = repository.createCard(base);
  assert.equal(first.created, true);
  repository.updateCard(base.cardId, {
    stage: "completed",
    progress: { stage: "completed", step: "integrated" },
    waitingForUser: false,
    blocked: false,
    aiTool: "codex",
    branch: base.branch,
    session: base.session,
  });

  const retried = repository.createCard(base);
  assert.equal(retried.created, false);
  assert.equal(retried.card.stage, "completed");
  assert.equal(retried.card.archived, true);
  assert.equal(retried.card.projectPath, base.projectPath);
});

test("rejects a reused card ID with a different flow identity", (t) => {
  const repository = repositoryFixture(t);
  repository.createCard(base);
  assert.throws(
    () => repository.createCard({ ...base, lifecycleDocumentPath: "C:\\other\\flow.md" }),
    ConflictError,
  );
  assert.throws(
    () => repository.createCard({ ...base, projectPath: "C:\\other" }),
    ConflictError,
  );
});

test("rejects a session record ID already owned by another card", (t) => {
  const repository = repositoryFixture(t);
  repository.createCard(base);
  assert.throws(
    () => repository.createCard({
      ...base,
      cardId: "260ab8ce-dc3e-45b6-bfb6-79acd34ad7fd",
      lifecycleDocumentPath: "C:\\repo\\docs\\feature\\another.md",
    }),
    ConflictError,
  );
});

test("rejects malformed lifecycle progress read from storage", (t) => {
  const repository = repositoryFixture(t);
  repository.createCard(base);
  const database = (repository as unknown as { database: DatabaseSync }).database;
  database.prepare("UPDATE cards SET progress_json = ? WHERE id = ?").run(
    JSON.stringify({ stage: "completed", step: "integrated" }),
    base.cardId,
  );
  assert.throws(() => repository.getCard(base.cardId), /Stored progress is invalid/);
});

test("last PATCH may regress stage, restores an archived card, and preserves session history", (t) => {
  const repository = repositoryFixture(t);
  repository.createCard(base);
  const completed = repository.updateCard(base.cardId, {
    stage: "completed",
    progress: { stage: "completed", step: "integrated" },
    waitingForUser: false,
    blocked: false,
    aiTool: "codex",
    branch: base.branch,
    session: base.session,
  });
  assert.equal(completed.archived, true);
  const beforePatch = repository.getCard(base.cardId);

  const update: UpdateCardInput = {
    stage: "requirements_review",
    progress: { stage: "requirements_review", step: "complete" },
    waitingForUser: false,
    blocked: false,
    aiTool: "claude",
    branch: base.branch,
    specDocumentPath: "C:\\repo\\docs\\spec.md",
    session: {
      sessionRecordId: "8362030f-5f20-4577-9c0f-84ec84252db4",
      aiTool: "claude",
    },
  };
  const reactivated = repository.updateCard(base.cardId, update);
  assert.equal(reactivated.archived, false);
  const regressed = repository.updateCard(base.cardId, {
    ...update,
    stage: "designing",
    progress: { stage: "designing", step: "clarifying" },
  });

  assert.equal(regressed.stage, "designing");
  assert.equal(regressed.archived, false);
  assert.equal(regressed.aiTool, "claude");
  assert.equal(regressed.sessions.length, 2);
  assert.equal(regressed.sessions.filter((session) => session.active).length, 1);
  assert.equal(regressed.activeSessionRecordId, update.session.sessionRecordId);
  assert.equal(regressed.specDocumentPath, update.specDocumentPath);
  assert.equal(beforePatch.lastSyncedAt < regressed.lastSyncedAt, true);
});

test("persists project visibility separately from card archive counts", (t) => {
  const repository = repositoryFixture(t);
  repository.createCard(base);
  assert.equal(repository.listProjects()[0]?.hidden, false);
  assert.equal(repository.setProjectHidden(base.projectName, true).hidden, true);
  assert.equal(repository.listProjects()[0]?.hidden, true);
  repository.updateCard(base.cardId, {
    stage: "completed",
    progress: { stage: "completed", step: "integrated" },
    waitingForUser: false,
    blocked: false,
    aiTool: "codex",
    branch: base.branch,
    session: base.session,
  });
  assert.deepEqual(repository.listProjects()[0], {
    name: base.projectName,
    activeCount: 0,
    archivedCount: 1,
    hidden: true,
  });
  assert.throws(() => repository.setProjectHidden("missing", true), /Project not found/);
});

test("lists distinct stored paths for a project without changing project aggregation", (t) => {
  const repository = repositoryFixture(t);
  repository.createCard(base);
  repository.createCard({
    ...base,
    cardId: "260ab8ce-dc3e-45b6-bfb6-79acd34ad7fd",
    lifecycleDocumentPath: "C:\\repo\\docs\\feature\\second.md",
    session: { sessionRecordId: "8362030f-5f20-4577-9c0f-84ec84252db4", aiTool: "codex" },
  });
  repository.createCard({
    ...base,
    cardId: "cb578b75-daad-4bc0-aaed-22a33d234a52",
    projectPath: "D:\\other-repo",
    lifecycleDocumentPath: "D:\\other-repo\\docs\\feature\\third.md",
    session: { sessionRecordId: "8cac0846-b45c-4366-b9dd-763f238bd6e8", aiTool: "codex" },
  });
  assert.deepEqual(repository.listProjectPaths(base.projectName), ["C:\\repo", "D:\\other-repo"]);
  assert.deepEqual(repository.listProjectPaths("missing"), []);
  assert.equal(repository.listProjects().length, 1);
});

test("migrates legacy card tables with nullable project and spec paths", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "feature-kanban-legacy-"));
  const path = join(directory, "legacy.sqlite");
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE cards (
      id TEXT PRIMARY KEY, project_name TEXT NOT NULL, title TEXT NOT NULL, stage TEXT NOT NULL,
      progress_json TEXT NOT NULL, waiting_for_user INTEGER NOT NULL, blocked INTEGER NOT NULL,
      blocked_reason TEXT, ai_tool TEXT NOT NULL, branch TEXT NOT NULL,
      lifecycle_document_path TEXT NOT NULL, active_session_record_id TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      last_synced_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  legacy.close();
  const migrated = openDatabase(path);
  t.after(() => {
    migrated.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const columns = migrated.connection.prepare("PRAGMA table_info(cards)").all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === "project_path"));
  assert.ok(columns.some((column) => column.name === "spec_document_path"));
  assert.doesNotThrow(() => migrated.connection.prepare("SELECT * FROM project_preferences").all());
});

test("completed create and update snapshots archive cards as part of synchronization", async (t) => {
  const repository = repositoryFixture(t);
  const created = repository.createCard(base).card;
  await new Promise((resolve) => setTimeout(resolve, 2));
  const archived = repository.updateCard(base.cardId, {
    stage: "completed",
    progress: { stage: "completed", step: "integrated" },
    waitingForUser: false,
    blocked: false,
    aiTool: "codex",
    branch: base.branch,
    session: base.session,
  });
  assert.equal(archived.archived, true);
  assert.notEqual(archived.lastSyncedAt, created.lastSyncedAt);
  assert.notEqual(archived.updatedAt, created.updatedAt);

  const createdCompleted = repository.createCard({
    ...base,
    cardId: "260ab8ce-dc3e-45b6-bfb6-79acd34ad7fd",
    lifecycleDocumentPath: "C:\\repo\\docs\\feature\\completed.md",
    stage: "completed",
    progress: { stage: "completed", step: "integrated" },
    session: { sessionRecordId: "8362030f-5f20-4577-9c0f-84ec84252db4", aiTool: "codex" },
  }).card;
  assert.equal(createdCompleted.archived, true);
  assert.equal(repository.listCards({ archived: true }).length, 2);
  assert.equal(repository.listCards({ archived: false }).length, 0);
});

test("an anonymous session can continue and later retain a discovered external ID", (t) => {
  const repository = repositoryFixture(t);
  repository.createCard({
    ...base,
    session: { sessionRecordId: base.session.sessionRecordId, aiTool: "codex" },
  });
  repository.updateCard(base.cardId, {
    stage: base.stage,
    progress: base.progress,
    waitingForUser: false,
    blocked: false,
    aiTool: "codex",
    branch: base.branch,
    session: { ...base.session, externalSessionId: "thread-discovered" },
  });
  const card = repository.getCard(base.cardId);
  assert.equal(card.sessions.length, 1);
  assert.equal(card.sessions[0]?.externalSessionId, "thread-discovered");
});

test("an existing session record cannot overwrite its tool or real session identity", (t) => {
  const repository = repositoryFixture(t);
  repository.createCard(base);
  const update: UpdateCardInput = {
    stage: base.stage,
    progress: base.progress,
    waitingForUser: false,
    blocked: false,
    aiTool: "claude",
    branch: base.branch,
    session: { ...base.session, aiTool: "claude" },
  };
  assert.throws(() => repository.updateCard(base.cardId, update), /cannot change AI tool/);
  assert.throws(
    () => repository.updateCard(base.cardId, {
      ...update,
      aiTool: "codex",
      session: { ...base.session, externalSessionId: "thread-2" },
    }),
    /cannot change external session identity/,
  );
  const card = repository.getCard(base.cardId);
  assert.equal(card.aiTool, "codex");
  assert.equal(card.sessions.length, 1);
  assert.equal(card.sessions[0]?.externalSessionId, "thread-1");
});
