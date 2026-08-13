export const lifecycleStages = [
  "initializing",
  "designing",
  "requirements_review",
  "implementation_planning",
  "implementing_and_reviewing",
  "finalizing_branch",
  "awaiting_integration",
  "completed",
] as const;

export type LifecycleStage = (typeof lifecycleStages)[number];

export type LifecycleProgress =
  | {
      stage: "initializing";
      step: "creating_worktree" | "creating_lifecycle_document" | "ready";
    }
  | {
      stage: "designing";
      step: "clarifying" | "comparing_approaches" | "writing_spec" | "complete";
    }
  | {
      stage: "requirements_review";
      step: "reviewing" | "updating_spec" | "complete";
    }
  | {
      stage: "implementation_planning";
      step: "planning" | "complete";
    }
  | {
      stage: "implementing_and_reviewing";
      step: "coding" | "validating" | "reviewing" | "fixing";
      implementationBatch?: number;
      implementationSummary?: string;
      reviewRound?: number;
      consecutiveCleanReviews?: number;
    }
  | {
      stage: "finalizing_branch";
      step: "quality_gate" | "squashing" | "rebasing" | "verifying_final_state";
    }
  | {
      stage: "awaiting_integration";
      step: "waiting_for_user" | "integration_declined";
    }
  | {
      stage: "completed";
      step: "integrated";
    };

export interface SessionInput {
  sessionRecordId: string;
  aiTool: string;
  externalSessionId?: string;
  jumpUri?: string;
}

export interface SessionRecord extends SessionInput {
  cardId: string;
  startedAt: string;
  lastSeenAt: string;
  active: boolean;
}

export interface CardSnapshotInput {
  stage: LifecycleStage;
  progress: LifecycleProgress;
  waitingForUser: boolean;
  blocked: boolean;
  blockedReason?: string;
  aiTool: string;
  branch: string;
  specDocumentPath?: string;
  session: SessionInput;
}

export interface CreateCardInput extends CardSnapshotInput {
  cardId: string;
  projectName: string;
  projectPath?: string;
  title: string;
  lifecycleDocumentPath: string;
}

export type UpdateCardInput = CardSnapshotInput;

export interface CardSummary {
  id: string;
  projectName: string;
  projectPath?: string;
  title: string;
  stage: LifecycleStage;
  progress: LifecycleProgress;
  waitingForUser: boolean;
  blocked: boolean;
  blockedReason?: string;
  aiTool: string;
  branch: string;
  lifecycleDocumentPath: string;
  specDocumentPath?: string;
  activeSessionRecordId: string;
  archived: boolean;
  createdAt: string;
  lastSyncedAt: string;
  updatedAt: string;
}

export interface CardDetail extends CardSummary {
  sessions: SessionRecord[];
}

export interface ProjectSummary {
  name: string;
  activeCount: number;
  archivedCount: number;
  hidden: boolean;
}

export interface CardFilters {
  project?: string;
  aiTool?: string;
  archived?: boolean;
}

export interface CardChangedEvent {
  type: "card.created" | "card.updated" | "card.archived";
  cardId: string;
}

export interface ProjectChangedEvent {
  type: "project.updated";
  projectName: string;
}

export type BoardChangedEvent = CardChangedEvent | ProjectChangedEvent;

export interface ProjectVisibilityInput {
  hidden: boolean;
}

export interface SpecDocumentResponse {
  path: string;
  content: string;
}

export interface HealthResponse {
  product: "feature-kanban";
  version: string;
  pid: number;
}

export interface ApiErrorBody {
  error: string;
  details?: string[];
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };
