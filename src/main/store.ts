import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import Database from "better-sqlite3";
import type { AppSettings, ChunkRecord, DocumentRecord } from "../lib/shared/types";

interface DbRowMap {
  settings: { key: string; value: string };
  documents: DocumentRecord;
  chunks: ChunkRecord;
}

export class AppStore {
  private db: Database.Database;

  constructor() {
    const basePath = app.getPath("userData");
    fs.mkdirSync(basePath, { recursive: true });
    const dbPath = path.join(basePath, "knowledge-rag.db");
    this.db = new Database(dbPath);
    this.migrate();
    this.seedSettings();
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
        fileType TEXT NOT NULL,
        content TEXT NOT NULL,
        importedAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
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
        FOREIGN KEY (documentId) REFERENCES documents(id) ON DELETE CASCADE
      );
    `);
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
    return this.db.prepare("SELECT * FROM documents ORDER BY updatedAt DESC").all() as DocumentRecord[];
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

  upsertDocument(document: DocumentRecord, chunks: ChunkRecord[]): void {
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO documents (id, filePath, fileName, fileType, content, importedAt, updatedAt, chunkCount)
           VALUES (@id, @filePath, @fileName, @fileType, @content, @importedAt, @updatedAt, @chunkCount)
           ON CONFLICT(id) DO UPDATE SET
             filePath = excluded.filePath,
             fileName = excluded.fileName,
             fileType = excluded.fileType,
             content = excluded.content,
             updatedAt = excluded.updatedAt,
             chunkCount = excluded.chunkCount`
        )
        .run(document);

      this.db.prepare("DELETE FROM chunks WHERE documentId = ?").run(document.id);
      const insertChunk = this.db.prepare(
        `INSERT INTO chunks (id, documentId, text, chunkIndex, startOffset, endOffset, tokenCount)
         VALUES (@id, @documentId, @text, @chunkIndex, @startOffset, @endOffset, @tokenCount)`
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
}

