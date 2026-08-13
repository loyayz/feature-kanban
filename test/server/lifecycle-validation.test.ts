import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCreateCard,
  validateProjectVisibilityBody,
  validateUpdateCard,
} from "../../src/shared/lifecycle-validation.js";

const validCreate = {
  cardId: "6b6e7f6e-aafb-48af-9809-a78135db03a8",
  projectName: "feature-kanban",
  title: "2026-08-12-feature-lifecycle-kanban",
  lifecycleDocumentPath: "C:\\repo\\docs\\feature\\flow.md",
  stage: "designing",
  progress: { stage: "designing", step: "writing_spec" },
  waitingForUser: false,
  blocked: false,
  aiTool: "Codex",
  branch: "feat/2026-08-12-feature-lifecycle-kanban",
  session: {
    sessionRecordId: "40ea2585-ee15-4098-a20a-a0d9d3329660",
    aiTool: "codex",
    externalSessionId: "019ff483-21a6-70c0-a246-205c1f7cad0d",
  },
};

test("accepts a matching stage/progress pair and normalizes the AI tool", () => {
  const result = validateCreateCard({ ...validCreate, projectPath: "C:\\repo" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.aiTool, "codex");
    assert.equal(result.value.projectPath, "C:\\repo");
  }
});

test("accepts a future non-empty AI tool name", () => {
  const result = validateCreateCard({
    ...validCreate,
    aiTool: "Gemini",
    session: { ...validCreate.session, aiTool: "gemini" },
  });
  assert.equal(result.ok, true);
});

test("rejects mismatched progress, unknown fields, malformed UUIDs, and inconsistent tools", () => {
  const result = validateCreateCard({
    ...validCreate,
    cardId: "not-a-uuid",
    surprise: true,
    progress: { stage: "requirements_review", step: "reviewing" },
    session: { ...validCreate.session, aiTool: "claude" },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.errors.some((error) => error.includes("cardId must be a UUID")));
    assert.ok(result.errors.some((error) => error.includes("surprise is not allowed")));
    assert.ok(result.errors.some((error) => error.includes("progress.stage must match stage")));
    assert.ok(result.errors.some((error) => error.includes("session.aiTool must match aiTool")));
  }
});

test("requires a blocked reason and rejects one when the card is not blocked", () => {
  const missing = validateUpdateCard({
    ...validCreate,
    blocked: true,
    blockedReason: undefined,
  });
  assert.equal(missing.ok, false);

  const unexpected = validateUpdateCard({
    stage: validCreate.stage,
    progress: validCreate.progress,
    waitingForUser: false,
    blocked: false,
    blockedReason: "not blocked",
    aiTool: validCreate.aiTool,
    branch: validCreate.branch,
    session: validCreate.session,
  });
  assert.equal(unexpected.ok, false);
});

test("validates implementation counters as non-negative integers", () => {
  const result = validateUpdateCard({
    stage: "implementing_and_reviewing",
    progress: {
      stage: "implementing_and_reviewing",
      step: "reviewing",
      implementationBatch: 2,
      reviewRound: 1,
      consecutiveCleanReviews: -1,
    },
    waitingForUser: false,
    blocked: false,
    aiTool: "codex",
    branch: validCreate.branch,
    session: validCreate.session,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((error) => error.includes("consecutiveCleanReviews")));
});

test("accepts semantic implementation summaries and rejects long or numbered-only labels", () => {
  const snapshot = {
    stage: "implementing_and_reviewing",
    waitingForUser: false,
    blocked: false,
    aiTool: "codex",
    branch: validCreate.branch,
    specDocumentPath: "C:\\repo\\docs\\feature.md",
    session: validCreate.session,
  } as const;
  const accepted = validateUpdateCard({
    ...snapshot,
    progress: {
      stage: "implementing_and_reviewing",
      step: "coding",
      implementationBatch: 1,
      implementationSummary: "项目隐藏",
    },
  });
  assert.equal(accepted.ok, true);
  if (accepted.ok) assert.equal(accepted.value.specDocumentPath, snapshot.specDocumentPath);

  for (const implementationSummary of ["批次1", "batch 2", "一二三四五六七八九十甲"]) {
    const rejected = validateUpdateCard({
      ...snapshot,
      progress: {
        stage: "implementing_and_reviewing",
        step: "coding",
        implementationSummary,
      },
    });
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.ok(rejected.errors.some((error) => error.includes("implementationSummary")));
  }
});

test("rejects relative local paths and validates project visibility bodies", () => {
  const invalidPath = validateCreateCard({ ...validCreate, projectPath: "relative/repo" });
  assert.equal(invalidPath.ok, false);
  if (!invalidPath.ok) assert.ok(invalidPath.errors.some((error) => error.includes("projectPath")));
  assert.equal(validateCreateCard({ ...validCreate, projectPath: "/srv/feature-kanban" }).ok, true);
  assert.equal(validateCreateCard({ ...validCreate, projectPath: "\\\\server\\share\\feature-kanban" }).ok, true);
  assert.deepEqual(validateProjectVisibilityBody({ hidden: true }), {
    ok: true,
    value: { hidden: true },
  });
  assert.equal(validateProjectVisibilityBody({ hidden: true, path: "C:\\repo" }).ok, false);
});
