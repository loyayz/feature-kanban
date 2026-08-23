import {
  lifecycleStages,
  type CardSnapshotInput,
  type CreateCardInput,
  type LifecycleProgress,
  type LifecycleStage,
  type ProjectVisibilityInput,
  type SessionInput,
  type UpdateCardInput,
  type ValidationResult,
} from "./lifecycle-contract.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stageSet = new Set<string>(lifecycleStages);

const progressSteps: Record<LifecycleStage, ReadonlySet<string>> = {
  initializing: new Set(["creating_worktree", "creating_lifecycle_document", "ready"]),
  designing: new Set(["clarifying", "comparing_approaches", "writing_spec", "complete"]),
  requirements_review: new Set(["reviewing", "updating_spec", "complete"]),
  implementation_planning: new Set(["planning", "complete"]),
  implementing_and_reviewing: new Set(["coding", "validating", "reviewing", "fixing"]),
  finalizing_branch: new Set(["quality_gate", "squashing", "rebasing", "verifying_final_state"]),
  awaiting_integration: new Set(["waiting_for_user", "integration_declined"]),
  completed: new Set(["integrated"]),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(input)) {
    if (!allowedSet.has(key)) errors.push(`${path}.${key} is not allowed`);
  }
}

function requiredString(
  input: Record<string, unknown>,
  key: string,
  errors: string[],
  maxLength = 2048,
): string {
  const value = input[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${key} must be a non-empty string`);
    return "";
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) errors.push(`${key} exceeds ${maxLength} characters`);
  return normalized;
}

function optionalString(
  input: Record<string, unknown>,
  key: string,
  errors: string[],
  maxLength = 4096,
): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${key} must be a non-empty string when provided`);
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) errors.push(`${key} exceeds ${maxLength} characters`);
  return normalized;
}

function optionalAbsolutePath(
  input: Record<string, unknown>,
  key: string,
  errors: string[],
): string | undefined {
  const value = optionalString(input, key, errors, 4096);
  const absolute = value && (
    value.startsWith("/")
    || /^[a-z]:[\\/]/iu.test(value)
    || /^\\\\[^\\/]+[\\/][^\\/]+/u.test(value)
  );
  if (value && !absolute) {
    errors.push(`${key} must be an absolute path`);
  }
  return value;
}

function requiredBoolean(input: Record<string, unknown>, key: string, errors: string[]): boolean {
  const value = input[key];
  if (typeof value !== "boolean") {
    errors.push(`${key} must be a boolean`);
    return false;
  }
  return value;
}

function parseSession(value: unknown, errors: string[]): SessionInput {
  if (!isRecord(value)) {
    errors.push("session must be an object");
    return { sessionRecordId: "", aiTool: "" };
  }
  rejectUnknownKeys(value, ["sessionRecordId", "aiTool", "externalSessionId", "jumpUri"], "session", errors);
  const sessionRecordId = requiredString(value, "sessionRecordId", errors, 64);
  if (sessionRecordId && !uuidPattern.test(sessionRecordId)) {
    errors.push("sessionRecordId must be a UUID");
  }
  const aiTool = requiredString(value, "aiTool", errors, 64).toLowerCase();
  const externalSessionId = optionalString(value, "externalSessionId", errors, 256);
  const jumpUri = optionalString(value, "jumpUri", errors, 2048);
  if (jumpUri) {
    try {
      const parsed = new URL(jumpUri);
      if (!["https:", "codex:"].includes(parsed.protocol)) {
        errors.push("jumpUri must use https or codex protocol");
      }
    } catch {
      errors.push("jumpUri must be a valid absolute URI");
    }
  }
  return {
    sessionRecordId,
    aiTool,
    ...(externalSessionId ? { externalSessionId } : {}),
    ...(jumpUri ? { jumpUri } : {}),
  };
}

function parseProgress(value: unknown, stage: LifecycleStage, errors: string[]): LifecycleProgress {
  if (!isRecord(value)) {
    errors.push("progress must be an object");
    return { stage: "initializing", step: "creating_worktree" };
  }
  const allowed = ["stage", "step"];
  if (stage === "implementing_and_reviewing") {
    allowed.push("implementationBatch", "implementationSummary", "reviewRound", "consecutiveCleanReviews");
  }
  rejectUnknownKeys(value, allowed, "progress", errors);
  const progressStage = requiredString(value, "stage", errors, 64);
  const step = requiredString(value, "step", errors, 64);
  if (progressStage !== stage) errors.push("progress.stage must match stage");
  if (!progressSteps[stage].has(step)) errors.push(`progress.step is invalid for ${stage}`);

  const numeric: Record<string, number> = {};
  for (const key of ["implementationBatch", "reviewRound", "consecutiveCleanReviews"] as const) {
    const candidate = value[key];
    if (candidate === undefined) continue;
    if (!Number.isInteger(candidate) || (candidate as number) < 0) {
      errors.push(`progress.${key} must be a non-negative integer`);
    } else {
      numeric[key] = candidate as number;
    }
  }

  const implementationSummary = stage === "implementing_and_reviewing"
    ? optionalString(value, "implementationSummary", errors, 100)
    : undefined;
  if (implementationSummary) {
    if (Array.from(implementationSummary).length > 10) {
      errors.push("progress.implementationSummary exceeds 10 characters");
    }
    if (/^(?:批次|batch)\s*\d+$/iu.test(implementationSummary)) {
      errors.push("progress.implementationSummary must describe the batch work");
    }
  }

  return {
    stage,
    step,
    ...numeric,
    ...(implementationSummary ? { implementationSummary } : {}),
  } as LifecycleProgress;
}

export function validateLifecycleProgress(
  stageValue: unknown,
  progressValue: unknown,
): ValidationResult<LifecycleProgress> {
  const errors: string[] = [];
  const stageText = typeof stageValue === "string" ? stageValue : "";
  if (!stageSet.has(stageText)) errors.push("stage is invalid");
  const stage = (stageSet.has(stageText) ? stageText : "initializing") as LifecycleStage;
  const progress = parseProgress(progressValue, stage, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: progress };
}

function parseSnapshot(input: Record<string, unknown>, errors: string[]): CardSnapshotInput {
  const stageValue = requiredString(input, "stage", errors, 64);
  const stage = (stageSet.has(stageValue) ? stageValue : "initializing") as LifecycleStage;
  if (!stageSet.has(stageValue)) errors.push("stage is invalid");
  const progress = parseProgress(input.progress, stage, errors);
  const waitingForUser = requiredBoolean(input, "waitingForUser", errors);
  const blocked = requiredBoolean(input, "blocked", errors);
  const blockedReason = optionalString(input, "blockedReason", errors, 1000);
  if (blocked && !blockedReason) errors.push("blockedReason is required when blocked is true");
  if (!blocked && blockedReason) errors.push("blockedReason is only allowed when blocked is true");
  const aiTool = requiredString(input, "aiTool", errors, 64).toLowerCase();
  const branch = requiredString(input, "branch", errors, 512);
  const specDocumentPath = optionalAbsolutePath(input, "specDocumentPath", errors);
  const session = parseSession(input.session, errors);
  if (session.aiTool && aiTool && session.aiTool !== aiTool) {
    errors.push("session.aiTool must match aiTool");
  }
  return {
    stage,
    progress,
    waitingForUser,
    blocked,
    ...(blockedReason ? { blockedReason } : {}),
    aiTool,
    branch,
    ...(specDocumentPath ? { specDocumentPath } : {}),
    session,
  };
}

export function validateCreateCard(value: unknown): ValidationResult<CreateCardInput> {
  if (!isRecord(value)) return { ok: false, errors: ["body must be an object"] };
  const errors: string[] = [];
  rejectUnknownKeys(
    value,
    [
      "cardId", "projectName", "projectPath", "title", "lifecycleDocumentPath", "stage", "progress",
      "specDocumentPath",
      "waitingForUser", "blocked", "blockedReason", "aiTool", "branch", "session",
    ],
    "body",
    errors,
  );
  const cardId = requiredString(value, "cardId", errors, 64);
  if (cardId && !uuidPattern.test(cardId)) errors.push("cardId must be a UUID");
  const projectName = requiredString(value, "projectName", errors, 255);
  const projectPath = optionalAbsolutePath(value, "projectPath", errors);
  const title = requiredString(value, "title", errors, 255);
  const lifecycleDocumentPath = requiredString(value, "lifecycleDocumentPath", errors, 4096);
  const snapshot = parseSnapshot(value, errors);
  return errors.length > 0
    ? { ok: false, errors }
    : {
        ok: true,
        value: {
          cardId,
          projectName,
          ...(projectPath ? { projectPath } : {}),
          title,
          lifecycleDocumentPath,
          ...snapshot,
        },
      };
}

export function validateUpdateCard(value: unknown): ValidationResult<UpdateCardInput> {
  if (!isRecord(value)) return { ok: false, errors: ["body must be an object"] };
  const errors: string[] = [];
  rejectUnknownKeys(
    value,
    [
      "stage", "progress", "waitingForUser", "blocked", "blockedReason", "aiTool", "branch",
      "specDocumentPath", "session",
    ],
    "body",
    errors,
  );
  const snapshot = parseSnapshot(value, errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: snapshot };
}

export function validateProjectVisibilityBody(
  value: unknown,
): ValidationResult<ProjectVisibilityInput> {
  if (!isRecord(value)) return { ok: false, errors: ["body must be an object"] };
  const errors: string[] = [];
  rejectUnknownKeys(value, ["hidden"], "body", errors);
  const hidden = requiredBoolean(value, "hidden", errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { hidden } };
}
