/**
 * Chat history persistence — chunk 26. SQLite-backed conversations
 * and messages keyed by document path. Designed so each chat
 * conversation belongs to exactly one document; switching tabs in the
 * UI swaps which conversation is currently shown.
 *
 * Schema:
 *   conversations(id, doc_path, title, created_at, updated_at)
 *   messages(id, conversation_id FK, role, content, created_at)
 *
 * Indexes:
 *   conversations(doc_path) — list-by-doc is the hot path
 *   messages(conversation_id, id) — chronological reads inside a conv
 *
 * The DB file lives at `userData/chat-history.db`. WAL mode is on for
 * sane concurrency under future multi-window scenarios. Migrations
 * are versioned via PRAGMA user_version; bump it when adding columns.
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import { app } from 'electron';

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (db) return db;
  const dbPath = path.join(app.getPath('userData'), 'chat-history.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(d: Database.Database): void {
  const v = d.pragma('user_version', { simple: true }) as number;
  if (v < 1) {
    d.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_path TEXT,
        title TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_doc_path
        ON conversations(doc_path);
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id)
          ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation
        ON messages(conversation_id, id);
      PRAGMA user_version = 1;
    `);
  }
  // Future migrations: bump user_version, add migration block guarded
  // by `if (v < N)`.
}

export interface ConversationRow {
  id: number;
  docPath: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface MessageRow {
  id: number;
  conversationId: number;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: number;
}

interface ConversationDb {
  id: number;
  doc_path: string | null;
  title: string;
  created_at: number;
  updated_at: number;
}

interface MessageDb {
  id: number;
  conversation_id: number;
  role: string;
  content: string;
  created_at: number;
}

const fromConvRow = (r: ConversationDb): ConversationRow => ({
  id: r.id,
  docPath: r.doc_path,
  title: r.title,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const fromMsgRow = (r: MessageDb): MessageRow => ({
  id: r.id,
  conversationId: r.conversation_id,
  role: r.role as MessageRow['role'],
  content: r.content,
  createdAt: r.created_at,
});

/** List conversations, optionally filtered by doc path. Most-recently
 * updated first. */
export function listConversations(docPath: string | null): ConversationRow[] {
  const d = getDb();
  if (docPath === null) {
    const rows = d
      .prepare(`SELECT * FROM conversations ORDER BY updated_at DESC`)
      .all() as ConversationDb[];
    return rows.map(fromConvRow);
  }
  const rows = d
    .prepare(
      `SELECT * FROM conversations WHERE doc_path = ? ORDER BY updated_at DESC`,
    )
    .all(docPath) as ConversationDb[];
  return rows.map(fromConvRow);
}

/** Read a conversation's messages in chronological order. */
export function getMessages(conversationId: number): MessageRow[] {
  const d = getDb();
  const rows = d
    .prepare(`SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC`)
    .all(conversationId) as MessageDb[];
  return rows.map(fromMsgRow);
}

/** Create a new conversation and return its id. */
export function createConversation(
  docPath: string | null,
  title: string,
): number {
  const d = getDb();
  const now = Date.now();
  const r = d
    .prepare(
      `INSERT INTO conversations (doc_path, title, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(docPath, title, now, now);
  return Number(r.lastInsertRowid);
}

/** Append a message to a conversation. Bumps the conversation's
 * updated_at so list ordering stays fresh-first. Returns the new
 * message id. */
export function appendMessage(
  conversationId: number,
  role: MessageRow['role'],
  content: string,
): number {
  const d = getDb();
  const now = Date.now();
  const ins = d
    .prepare(
      `INSERT INTO messages (conversation_id, role, content, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(conversationId, role, content, now);
  d.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(
    now,
    conversationId,
  );
  return Number(ins.lastInsertRowid);
}

export function renameConversation(id: number, title: string): void {
  const d = getDb();
  d.prepare(
    `UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`,
  ).run(title, Date.now(), id);
}

export function deleteConversation(id: number): void {
  const d = getDb();
  // Foreign key cascade removes messages.
  d.pragma('foreign_keys = ON');
  d.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
}

/** Test-only: close the DB so a fresh instance can be opened on
 * next call. Production never closes — Electron lifetime owns it. */
export function closeForTest(): void {
  if (db) {
    db.close();
    db = null;
  }
}
