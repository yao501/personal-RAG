import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import Database from "better-sqlite3";
import type { AppSettings, ChatSession, ChatTurn, ChunkRecord, DocumentRecord, QueryLogRecord, QueryLogFeedbackStatus } from "../lib/shared/types";

interface DbRowMap {
  settings: { key: string; value: string };
  documents: DocumentRecord;
  chunks: ChunkRecord;
  chatSessions: ChatSession;
  chatTurns: { id: string; sessionId: string; question: string; answerJson: string; createdAt: string };
  queryLogs: {
    id: string;
    sessionId: string;
    question: string;
    answerJson: string;
    citationsJson: string;
    topResultsJson: string;
    createdAt: string;
    feedbackStatus: QueryLogFeedbackStatus;
    feedbackNote: string | null;
  };
}

export class AppStore {
  private db: any;
  private readonly dbPath: string;

  constructor() {
    const basePath = app.getPath("userData");
    fs.mkdirSync(basePath, { recursive: true });
    this.dbPath = path.join(basePath, "knowledge-rag.db");
    this.db = new Database(this.dbPath);
    this.migrate();
    this.seedSettings();
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        filePath TEXT NOT NULL UNIQUE,
        fileName TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        fileType TEXT NOT NULL,
        content TEXT NOT NULL,
        importedAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        sourceCreatedAt TEXT,
        sourceUpdatedAt TEXT,
        indexConfigSignature TEXT,
        chunkCount INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        documentId TEXT NOT NULL,
        text TEXT NOT NULL,
        chunkIndex INTEGER NOT NULL,
        startOffset INTEGER NOT NULL,
        endOffset INTEGER NOT NULL,
        tokenCount INTEGER NOT NULL,
        sectionTitle TEXT,
        sectionPath TEXT,
        headingTrail TEXT,
        pageStart INTEGER,
        pageEnd INTEGER,
        paragraphStart INTEGER,
        paragraphEnd INTEGER,
        locatorLabel TEXT,
        embedding TEXT,
        FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chat_turns (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        question TEXT NOT NULL,
        answerJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (sessionId) REFERENCES chat_sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS query_logs (
        id TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        question TEXT NOT NULL,
        answerJson TEXT NOT NULL,
        citationsJson TEXT NOT NULL,
        topResultsJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        feedbackStatus TEXT NOT NULL DEFAULT 'pending',
        feedbackNote TEXT
      );
    `);

    this.ensureColumn("documents", "title", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("documents", "sourceCreatedAt", "TEXT");
    this.ensureColumn("documents", "sourceUpdatedAt", "TEXT");
    this.ensureColumn("documents", "indexConfigSignature", "TEXT");
    this.ensureColumn("chunks", "sectionTitle", "TEXT");
    this.ensureColumn("chunks", "sectionPath", "TEXT");
    this.ensureColumn("chunks", "headingTrail", "TEXT");
    this.ensureColumn("chunks", "pageStart", "INTEGER");
    this.ensureColumn("chunks", "pageEnd", "INTEGER");
    this.ensureColumn("chunks", "paragraphStart", "INTEGER");
    this.ensureColumn("chunks", "paragraphEnd", "INTEGER");
    this.ensureColumn("chunks", "locatorLabel", "TEXT");
    this.ensureColumn("chunks", "embedding", "TEXT");
  }

  private ensureColumn(tableName: "documents" | "chunks", columnName: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
  }

  private seedSettings(): void {
    const defaultSettings: AppSettings = {
      libraryPath: null,
      chunkSize: 180,
      chunkOverlap: 40
    };

    const insert = this.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
    for (const [key, value] of Object.entries(defaultSettings)) {
      insert.run(key, JSON.stringify(value));
    }
  }

  getSettings(): AppSettings {
    const rows = this.db.prepare("SELECT key, value FROM settings").all() as DbRowMap["settings"][];
    const record = Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]));
    return {
      libraryPath: record.libraryPath ?? null,
      chunkSize: record.chunkSize ?? 180,
      chunkOverlap: record.chunkOverlap ?? 40
    };
  }

  updateSettings(settings: Partial<AppSettings>): AppSettings {
    const statement = this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    for (const [key, value] of Object.entries(settings)) {
      statement.run(key, JSON.stringify(value));
    }
    return this.getSettings();
  }

  listDocuments(): DocumentRecord[] {
    return this.db.prepare("SELECT * FROM documents ORDER BY COALESCE(sourceUpdatedAt, updatedAt) DESC").all() as DocumentRecord[];
  }

  getDocument(documentId: string): DocumentRecord | null {
    return (this.db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId) as DocumentRecord | undefined) ?? null;
  }

  listChunks(documentId?: string): ChunkRecord[] {
    if (documentId) {
      return this.db.prepare("SELECT * FROM chunks WHERE documentId = ? ORDER BY chunkIndex ASC").all(documentId) as ChunkRecord[];
    }
    return this.db.prepare("SELECT * FROM chunks ORDER BY rowid ASC").all() as ChunkRecord[];
  }

  getLibraryStats(): { documentCount: number; chunkCount: number } {
    const documentCount = this.db.prepare("SELECT COUNT(*) as count FROM documents").get() as { count: number };
    const chunkCount = this.db.prepare("SELECT COUNT(*) as count FROM chunks").get() as { count: number };
    return {
      documentCount: documentCount.count,
      chunkCount: chunkCount.count
    };
  }

  listChatSessions(): ChatSession[] {
    return this.db
      .prepare(
        `SELECT
           s.id,
           s.title,
           s.createdAt,
           s.updatedAt,
           COUNT(t.id) as turnCount,
           (
             SELECT question
             FROM chat_turns ct
             WHERE ct.sessionId = s.id
             ORDER BY ct.createdAt DESC
             LIMIT 1
           ) as lastQuestion
         FROM chat_sessions s
         LEFT JOIN chat_turns t ON t.sessionId = s.id
         GROUP BY s.id
         ORDER BY s.updatedAt DESC`
      )
      .all() as ChatSession[];
  }

  createChatSession(session: Omit<ChatSession, "turnCount" | "lastQuestion">): ChatSession {
    this.db
      .prepare("INSERT INTO chat_sessions (id, title, createdAt, updatedAt) VALUES (@id, @title, @createdAt, @updatedAt)")
      .run(session);

    return {
      ...session,
      turnCount: 0,
      lastQuestion: null
    };
  }

  listChatTurns(sessionId: string): ChatTurn[] {
    const rows = this.db
      .prepare("SELECT id, sessionId, question, answerJson, createdAt FROM chat_turns WHERE sessionId = ? ORDER BY createdAt ASC")
      .all(sessionId) as DbRowMap["chatTurns"][];

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      question: row.question,
      answer: JSON.parse(row.answerJson),
      createdAt: row.createdAt
    }));
  }

  listQueryLogs(limit = 50): QueryLogRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, sessionId, question, answerJson, citationsJson, topResultsJson, createdAt, feedbackStatus, feedbackNote
         FROM query_logs
         ORDER BY createdAt DESC
         LIMIT ?`
      )
      .all(limit) as DbRowMap["queryLogs"][];

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      question: row.question,
      answer: JSON.parse(row.answerJson),
      citations: JSON.parse(row.citationsJson),
      topResults: JSON.parse(row.topResultsJson),
      createdAt: row.createdAt,
      feedbackStatus: row.feedbackStatus,
      feedbackNote: row.feedbackNote
    }));
  }

  saveChatTurn(turn: ChatTurn, nextSessionTitle?: string): void {
    const transaction = this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO chat_turns (id, sessionId, question, answerJson, createdAt) VALUES (?, ?, ?, ?, ?)")
        .run(turn.id, turn.sessionId, turn.question, JSON.stringify(turn.answer), turn.createdAt);

      this.db
        .prepare("UPDATE chat_sessions SET updatedAt = ?, title = COALESCE(?, title) WHERE id = ?")
        .run(turn.createdAt, nextSessionTitle ?? null, turn.sessionId);
    });

    transaction();
  }

  saveQueryLog(log: QueryLogRecord): void {
    this.db
      .prepare(
        `INSERT INTO query_logs (id, sessionId, question, answerJson, citationsJson, topResultsJson, createdAt, feedbackStatus, feedbackNote)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        log.id,
        log.sessionId,
        log.question,
        JSON.stringify(log.answer),
        JSON.stringify(log.citations),
        JSON.stringify(log.topResults),
        log.createdAt,
        log.feedbackStatus,
        log.feedbackNote
      );
  }

  updateQueryLogStatus(logId: string, status: QueryLogFeedbackStatus, note: string | null = null): void {
    this.db
      .prepare("UPDATE query_logs SET feedbackStatus = ?, feedbackNote = ? WHERE id = ?")
      .run(status, note, logId);
  }

  deleteChatSession(sessionId: string): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM chat_turns WHERE sessionId = ?").run(sessionId);
      this.db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(sessionId);
    });
    transaction();
  }

  clearChatSessions(): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM chat_turns").run();
      this.db.prepare("DELETE FROM chat_sessions").run();
    });
    transaction();
  }

  deleteDocument(documentId: string): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM chunks WHERE documentId = ?").run(documentId);
      this.db.prepare("DELETE FROM documents WHERE id = ?").run(documentId);
    });

    transaction();
  }

  deleteDocuments(documentIds: string[]): void {
    if (documentIds.length === 0) {
      return;
    }

    const transaction = this.db.transaction(() => {
      const deleteChunks = this.db.prepare("DELETE FROM chunks WHERE documentId = ?");
      const deleteDocument = this.db.prepare("DELETE FROM documents WHERE id = ?");

      for (const documentId of documentIds) {
        deleteChunks.run(documentId);
        deleteDocument.run(documentId);
      }
    });

    transaction();
  }

  upsertDocument(document: DocumentRecord, chunks: ChunkRecord[]): void {
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO documents (id, filePath, fileName, title, fileType, content, importedAt, updatedAt, sourceCreatedAt, sourceUpdatedAt, indexConfigSignature, chunkCount)
           VALUES (@id, @filePath, @fileName, @title, @fileType, @content, @importedAt, @updatedAt, @sourceCreatedAt, @sourceUpdatedAt, @indexConfigSignature, @chunkCount)
           ON CONFLICT(id) DO UPDATE SET
             filePath = excluded.filePath,
             fileName = excluded.fileName,
             title = excluded.title,
             fileType = excluded.fileType,
             content = excluded.content,
             updatedAt = excluded.updatedAt,
             sourceCreatedAt = excluded.sourceCreatedAt,
             sourceUpdatedAt = excluded.sourceUpdatedAt,
             indexConfigSignature = excluded.indexConfigSignature,
             chunkCount = excluded.chunkCount`
        )
        .run(document);

      this.db.prepare("DELETE FROM chunks WHERE documentId = ?").run(document.id);
      const insertChunk = this.db.prepare(
        `INSERT INTO chunks (id, documentId, text, chunkIndex, startOffset, endOffset, tokenCount, sectionTitle, sectionPath, headingTrail, pageStart, pageEnd, paragraphStart, paragraphEnd, locatorLabel, embedding)
         VALUES (@id, @documentId, @text, @chunkIndex, @startOffset, @endOffset, @tokenCount, @sectionTitle, @sectionPath, @headingTrail, @pageStart, @pageEnd, @paragraphStart, @paragraphEnd, @locatorLabel, @embedding)`
      );

      for (const chunk of chunks) {
        insertChunk.run(chunk);
      }
    });

    transaction();
  }

  clearIndex(): void {
    this.db.prepare("DELETE FROM chunks").run();
    this.db.prepare("UPDATE documents SET chunkCount = 0").run();
  }

  clearLibrary(): void {
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM chunks").run();
      this.db.prepare("DELETE FROM documents").run();
    });

    transaction();
  }
}
