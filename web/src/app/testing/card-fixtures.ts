import type { CardDetail, LifecycleStage, ProjectSummary } from "../../../../src/shared/lifecycle-contract";

export const projects: ProjectSummary[] = [
  { name: "alpha", activeCount: 2, archivedCount: 1, hidden: false },
  { name: "beta", activeCount: 1, archivedCount: 0, hidden: false },
];

export function makeCard(
  id: string,
  stage: LifecycleStage = "designing",
  overrides: Partial<CardDetail> = {},
): CardDetail {
  const progress = stage === "initializing"
    ? { stage, step: "ready" as const }
    : stage === "designing"
      ? { stage, step: "clarifying" as const }
      : stage === "requirements_review"
        ? { stage, step: "reviewing" as const }
        : stage === "implementation_planning"
          ? { stage, step: "planning" as const }
          : stage === "implementing_and_reviewing"
            ? { stage, step: "coding" as const, implementationBatch: 1 }
            : stage === "finalizing_branch"
              ? { stage, step: "quality_gate" as const }
              : stage === "awaiting_integration"
                ? { stage, step: "waiting_for_user" as const }
                : { stage, step: "integrated" as const };
  return {
    id,
    projectName: "alpha",
    projectPath: "C:\\repo",
    title: `Flow ${id.slice(-4)}`,
    stage,
    progress,
    waitingForUser: false,
    blocked: false,
    aiTool: "codex",
    branch: "feat/example",
    lifecycleDocumentPath: `C:\\repo\\docs\\feature\\${id}.md`,
    specDocumentPath: `C:\\repo\\docs\\superpowers\\specs\\${id}.md`,
    activeSessionRecordId: "22222222-2222-4222-8222-222222222222",
    archived: false,
    createdAt: "2026-08-12T08:00:00.000Z",
    lastSyncedAt: "2026-08-12T09:00:00.000Z",
    updatedAt: "2026-08-12T09:00:00.000Z",
    sessions: [
      {
        sessionRecordId: "22222222-2222-4222-8222-222222222222",
        cardId: id,
        aiTool: "codex",
        externalSessionId: "019ff483-21a6-70c0-a246-205c1f7cad0d",
        startedAt: "2026-08-12T08:00:00.000Z",
        lastSeenAt: "2026-08-12T09:00:00.000Z",
        active: true,
      },
    ],
    ...overrides,
  };
}
