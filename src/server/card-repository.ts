import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";
import type {
  CardDetail,
  CardFilters,
  CardSummary,
  CreateCardInput,
  LifecycleProgress,
  LifecycleStage,
  ProjectSummary,
  SessionInput,
  SessionRecord,
  UpdateCardInput,
} from "../shared/lifecycle-contract.js";
import { validateLifecycleProgress } from "../shared/lifecycle-validation.js";
import { ConflictError, NotFoundError, ValidationStorageError } from "./errors.js";

type Row = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function booleanValue(value: unknown): boolean {
  return value === 1 || value === true;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseProgress(value: unknown, stage: unknown): LifecycleProgress {
  try {
    const validation = validateLifecycleProgress(stage, JSON.parse(String(value)));
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    return validation.value;
  } catch (error) {
    throw new ValidationStorageError(`Stored progress is invalid: ${(error as Error).message}`);
  }
}

function mapCard(row: Row): CardSummary {
  const blockedReason = optionalText(row.blocked_reason);
  const projectPath = optionalText(row.project_path);
  const specDocumentPath = optionalText(row.spec_document_path);
  const progress = parseProgress(row.progress_json, row.stage);
  return {
    id: String(row.id),
    projectName: String(row.project_name),
    ...(projectPath ? { projectPath } : {}),
    title: String(row.title),
    stage: progress.stage,
    progress,
    waitingForUser: booleanValue(row.waiting_for_user),
    blocked: booleanValue(row.blocked),
    ...(blockedReason ? { blockedReason } : {}),
    aiTool: String(row.ai_tool),
    branch: String(row.branch),
    lifecycleDocumentPath: String(row.lifecycle_document_path),
    ...(specDocumentPath ? { specDocumentPath } : {}),
    activeSessionRecordId: String(row.active_session_record_id),
    archived: booleanValue(row.archived),
    createdAt: String(row.created_at),
    lastSyncedAt: String(row.last_synced_at),
    updatedAt: String(row.updated_at),
  };
}

function mapSession(row: Row): SessionRecord {
  const externalSessionId = optionalText(row.external_session_id);
  const jumpUri = optionalText(row.jump_uri);
  return {
    sessionRecordId: String(row.session_record_id),
    cardId: String(row.card_id),
    aiTool: String(row.ai_tool),
    ...(externalSessionId ? { externalSessionId } : {}),
    ...(jumpUri ? { jumpUri } : {}),
    startedAt: String(row.started_at),
    lastSeenAt: String(row.last_seen_at),
    active: booleanValue(row.active),
  };
}

function transaction<T>(database: DatabaseSync, action: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {}
    throw error;
  }
}

function rowFrom(statement: StatementSync, ...values: SQLInputValue[]): Row | undefined {
  return statement.get(...values) as Row | undefined;
}

export class CardRepository {
  constructor(private readonly database: DatabaseSync) {}

  createCard(input: CreateCardInput): { card: CardDetail; created: boolean } {
    return transaction(this.database, () => {
      const existing = rowFrom(this.database.prepare("SELECT * FROM cards WHERE id = ?"), input.cardId);
      if (existing) {
        const existingProjectPath = optionalText(existing.project_path);
        if (
          existing.project_name !== input.projectName
          || existing.lifecycle_document_path !== input.lifecycleDocumentPath
          || (existingProjectPath && input.projectPath && existingProjectPath !== input.projectPath)
        ) {
          throw new ConflictError("cardId already belongs to another lifecycle flow");
        }
        return { card: this.getCard(input.cardId), created: false };
      }

      const timestamp = nowIso();
      this.database.prepare(`
        INSERT INTO cards (
          id, project_name, project_path, title, stage, progress_json, waiting_for_user, blocked,
          blocked_reason, ai_tool, branch, lifecycle_document_path,
          spec_document_path, active_session_record_id, archived, created_at, last_synced_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.cardId,
        input.projectName,
        input.projectPath ?? null,
        input.title,
        input.stage,
        JSON.stringify(input.progress),
        input.waitingForUser ? 1 : 0,
        input.blocked ? 1 : 0,
        input.blockedReason ?? null,
        input.aiTool,
        input.branch,
        input.lifecycleDocumentPath,
        input.specDocumentPath ?? null,
        input.session.sessionRecordId,
        input.stage === "completed" ? 1 : 0,
        timestamp,
        timestamp,
        timestamp,
      );
      this.insertSession(input.cardId, input.session, timestamp);
      return { card: this.getCard(input.cardId), created: true };
    });
  }

  updateCard(cardId: string, input: UpdateCardInput): CardDetail {
    return transaction(this.database, () => {
      if (!rowFrom(this.database.prepare("SELECT id FROM cards WHERE id = ?"), cardId)) {
        throw new NotFoundError("Card not found");
      }
      const timestamp = nowIso();
      this.upsertSession(cardId, input.session, timestamp);
      const result = this.database.prepare(`
        UPDATE cards SET
          stage = ?, progress_json = ?, waiting_for_user = ?, blocked = ?,
          blocked_reason = ?, ai_tool = ?, branch = ?, active_session_record_id = ?,
          spec_document_path = COALESCE(?, spec_document_path),
          archived = ?, last_synced_at = ?, updated_at = ?
        WHERE id = ?
      `).run(
        input.stage,
        JSON.stringify(input.progress),
        input.waitingForUser ? 1 : 0,
        input.blocked ? 1 : 0,
        input.blockedReason ?? null,
        input.aiTool,
        input.branch,
        input.session.sessionRecordId,
        input.specDocumentPath ?? null,
        input.stage === "completed" ? 1 : 0,
        timestamp,
        timestamp,
        cardId,
      );
      if (Number(result.changes) !== 1) throw new NotFoundError("Card not found");
      return this.getCard(cardId);
    });
  }

  getCard(cardId: string): CardDetail {
    const row = rowFrom(this.database.prepare("SELECT * FROM cards WHERE id = ?"), cardId);
    if (!row) throw new NotFoundError("Card not found");
    const sessions = this.database.prepare(
      "SELECT * FROM ai_sessions WHERE card_id = ? ORDER BY started_at ASC, session_record_id ASC",
    ).all(cardId) as Row[];
    return { ...mapCard(row), sessions: sessions.map(mapSession) };
  }

  listCards(filters: CardFilters = {}): CardSummary[] {
    const clauses: string[] = [];
    const values: SQLInputValue[] = [];
    if (filters.project && filters.project !== "all") {
      clauses.push("project_name = ?");
      values.push(filters.project);
    }
    if (filters.aiTool) {
      clauses.push("ai_tool = ?");
      values.push(filters.aiTool.toLowerCase());
    }
    clauses.push("archived = ?");
    values.push(filters.archived ? 1 : 0);
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database.prepare(
      `SELECT * FROM cards ${where} ORDER BY updated_at DESC, id ASC`,
    ).all(...values) as Row[];
    return rows.map(mapCard);
  }

  listProjects(): ProjectSummary[] {
    const rows = this.database.prepare(`
      SELECT cards.project_name,
             SUM(CASE WHEN cards.archived = 0 THEN 1 ELSE 0 END) AS active_count,
             SUM(CASE WHEN cards.archived = 1 THEN 1 ELSE 0 END) AS archived_count,
             COALESCE(project_preferences.hidden, 0) AS hidden
      FROM cards
      LEFT JOIN project_preferences ON project_preferences.project_name = cards.project_name
      GROUP BY cards.project_name, project_preferences.hidden
      ORDER BY cards.project_name COLLATE NOCASE ASC
    `).all() as Row[];
    return rows.map((row) => ({
      name: String(row.project_name),
      activeCount: Number(row.active_count),
      archivedCount: Number(row.archived_count),
      hidden: booleanValue(row.hidden),
    }));
  }

  listProjectPaths(projectName: string): string[] {
    const rows = this.database.prepare(`
      SELECT DISTINCT project_path
      FROM cards
      WHERE project_name = ? AND project_path IS NOT NULL AND TRIM(project_path) <> ''
      ORDER BY project_path COLLATE NOCASE ASC
    `).all(projectName) as Row[];
    return rows.map((row) => String(row.project_path));
  }

  setProjectHidden(projectName: string, hidden: boolean): ProjectSummary {
    return transaction(this.database, () => {
      if (!rowFrom(this.database.prepare("SELECT 1 FROM cards WHERE project_name = ? LIMIT 1"), projectName)) {
        throw new NotFoundError("Project not found");
      }
      this.database.prepare(`
        INSERT INTO project_preferences (project_name, hidden) VALUES (?, ?)
        ON CONFLICT(project_name) DO UPDATE SET hidden = excluded.hidden
      `).run(projectName, hidden ? 1 : 0);
      const project = this.listProjects().find((entry) => entry.name === projectName);
      if (!project) throw new NotFoundError("Project not found");
      return project;
    });
  }

  private insertSession(cardId: string, session: SessionInput, timestamp: string): void {
    const existing = rowFrom(
      this.database.prepare("SELECT card_id FROM ai_sessions WHERE session_record_id = ?"),
      session.sessionRecordId,
    );
    if (existing) throw new ConflictError("sessionRecordId already belongs to another card");
    this.database.prepare(`
      INSERT INTO ai_sessions (
        session_record_id, card_id, ai_tool, external_session_id, jump_uri,
        started_at, last_seen_at, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      session.sessionRecordId,
      cardId,
      session.aiTool,
      session.externalSessionId ?? null,
      session.jumpUri ?? null,
      timestamp,
      timestamp,
    );
  }

  private upsertSession(cardId: string, session: SessionInput, timestamp: string): void {
    const existing = rowFrom(
      this.database.prepare("SELECT * FROM ai_sessions WHERE session_record_id = ?"),
      session.sessionRecordId,
    );
    if (existing && existing.card_id !== cardId) {
      throw new ConflictError("sessionRecordId already belongs to another card");
    }
    if (existing && existing.ai_tool !== session.aiTool) {
      throw new ConflictError("sessionRecordId cannot change AI tool");
    }
    if (
      existing
      && existing.external_session_id
      && session.externalSessionId
      && existing.external_session_id !== session.externalSessionId
    ) {
      throw new ConflictError("sessionRecordId cannot change external session identity");
    }
    this.database.prepare("UPDATE ai_sessions SET active = 0 WHERE card_id = ?").run(cardId);
    if (existing) {
      this.database.prepare(`
        UPDATE ai_sessions SET
          ai_tool = ?, external_session_id = COALESCE(?, external_session_id),
          jump_uri = COALESCE(?, jump_uri), last_seen_at = ?, active = 1
        WHERE session_record_id = ?
      `).run(
        session.aiTool,
        session.externalSessionId ?? null,
        session.jumpUri ?? null,
        timestamp,
        session.sessionRecordId,
      );
      return;
    }
    this.insertSession(cardId, session, timestamp);
  }
}
