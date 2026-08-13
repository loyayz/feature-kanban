import { DatabaseSync } from "node:sqlite";

export interface FeatureKanbanDatabase {
  connection: DatabaseSync;
  close(): void;
}

const schema = `
  CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,
    project_name TEXT NOT NULL,
    project_path TEXT,
    title TEXT NOT NULL,
    stage TEXT NOT NULL,
    progress_json TEXT NOT NULL,
    waiting_for_user INTEGER NOT NULL CHECK (waiting_for_user IN (0, 1)),
    blocked INTEGER NOT NULL CHECK (blocked IN (0, 1)),
    blocked_reason TEXT,
    ai_tool TEXT NOT NULL,
    branch TEXT NOT NULL,
    lifecycle_document_path TEXT NOT NULL,
    spec_document_path TEXT,
    active_session_record_id TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    created_at TEXT NOT NULL,
    last_synced_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ai_sessions (
    session_record_id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    ai_tool TEXT NOT NULL,
    external_session_id TEXT,
    jump_uri TEXT,
    started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0, 1))
  );

  CREATE TABLE IF NOT EXISTS project_preferences (
    project_name TEXT PRIMARY KEY,
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1))
  );

  CREATE INDEX IF NOT EXISTS idx_cards_project_archived
    ON cards(project_name, archived);
  CREATE INDEX IF NOT EXISTS idx_cards_ai_tool_archived
    ON cards(ai_tool, archived);
  CREATE INDEX IF NOT EXISTS idx_cards_stage
    ON cards(stage);
  CREATE INDEX IF NOT EXISTS idx_sessions_card_started
    ON ai_sessions(card_id, started_at);
`;

function ensureCardColumn(connection: DatabaseSync, column: string, definition: string): void {
  const columns = connection.prepare("PRAGMA table_info(cards)").all() as Array<{ name: string }>;
  if (!columns.some((entry) => entry.name === column)) {
    connection.exec(`ALTER TABLE cards ADD COLUMN ${column} ${definition}`);
  }
}

export function openDatabase(path: string): FeatureKanbanDatabase {
  const connection = new DatabaseSync(path);
  connection.exec("PRAGMA foreign_keys = ON");
  connection.exec("PRAGMA journal_mode = WAL");
  connection.exec(schema);
  ensureCardColumn(connection, "project_path", "TEXT");
  ensureCardColumn(connection, "spec_document_path", "TEXT");
  return {
    connection,
    close: () => connection.close(),
  };
}
