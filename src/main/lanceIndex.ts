import path from "node:path";
import { app } from "electron";
import * as lancedb from "@lancedb/lancedb";

interface LanceChunkRow {
  [key: string]: unknown;
  chunkId: string;
  documentId: string;
  fileName: string;
  documentTitle: string;
  sectionTitle: string;
  sectionPath: string;
  text: string;
  vector: number[];
}

interface LanceIndexStatus {
  available: boolean;
  tableReady: boolean;
  reason: string | null;
  lastErrorAt: string | null;
  lastOperation: string | null;
}

const TABLE_NAME = "knowledge_chunks";

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export class LanceIndex {
  private connectionPromise: Promise<lancedb.Connection> | null = null;
  private status: LanceIndexStatus = {
    available: false,
    tableReady: false,
    reason: "Vector index has not been initialized yet.",
    lastErrorAt: null,
    lastOperation: null
  };

  getStatus(): LanceIndexStatus {
    return { ...this.status };
  }

  async inspectStatus(): Promise<LanceIndexStatus> {
    try {
      const connection = await this.getConnection();
      const existingTables = await connection.tableNames();
      if (existingTables.includes(TABLE_NAME)) {
        this.markReady("status", true);
      } else {
        this.markReady("status", false, "Vector index table does not exist.");
      }
    } catch (error) {
      this.markFailed("status", error);
    }
    return this.getStatus();
  }

  private markReady(operation: string, tableReady: boolean, reason: string | null = null): void {
    this.status = {
      available: tableReady,
      tableReady,
      reason,
      lastErrorAt: null,
      lastOperation: operation
    };
  }

  private markFailed(operation: string, error: unknown): void {
    this.status = {
      available: false,
      tableReady: false,
      reason: error instanceof Error ? error.message : String(error),
      lastErrorAt: new Date().toISOString(),
      lastOperation: operation
    };
  }

  private async getConnection(): Promise<lancedb.Connection> {
    if (!this.connectionPromise) {
      const dbPath = path.join(app.getPath("userData"), "lancedb");
      this.connectionPromise = lancedb.connect(dbPath);
    }

    return this.connectionPromise;
  }

  async rebuild(rows: LanceChunkRow[]): Promise<void> {
    try {
      const connection = await this.getConnection();
      const existingTables = await connection.tableNames();

      if (rows.length === 0) {
        if (existingTables.includes(TABLE_NAME)) {
          await connection.dropTable(TABLE_NAME);
        }
        this.markReady("rebuild", false, "No vector rows are available for indexing.");
        return;
      }

      const table = await connection.createTable(TABLE_NAME, rows, {
        mode: "overwrite"
      });

      try {
        await table.createIndex("vector");
      } catch {
        // LanceDB can still search without an ANN index for small local datasets.
      }
      this.markReady("rebuild", true);
    } catch (error) {
      this.markFailed("rebuild", error);
      throw error;
    }
  }

  async replaceDocument(documentId: string, rows: LanceChunkRow[]): Promise<void> {
    const connection = await this.getConnection();
    const existingTables = await connection.tableNames();

    if (!existingTables.includes(TABLE_NAME)) {
      if (rows.length > 0) {
        await this.rebuild(rows);
      }
      return;
    }

    const table = await connection.openTable(TABLE_NAME);
    await table.delete(`documentId = '${escapeSql(documentId)}'`);

    if (rows.length > 0) {
      await table.add(rows);
    }
  }

  async deleteDocument(documentId: string): Promise<void> {
    const connection = await this.getConnection();
    const existingTables = await connection.tableNames();
    if (!existingTables.includes(TABLE_NAME)) {
      return;
    }

    const table = await connection.openTable(TABLE_NAME);
    await table.delete(`documentId = '${escapeSql(documentId)}'`);
  }

  async clear(): Promise<void> {
    const connection = await this.getConnection();
    const existingTables = await connection.tableNames();
    if (existingTables.includes(TABLE_NAME)) {
      await connection.dropTable(TABLE_NAME);
    }
    this.markReady("clear", false, "Vector index has been cleared.");
  }

  async search(vector: number[], limit: number): Promise<string[]> {
    if (vector.length === 0) {
      return [];
    }

    try {
      const connection = await this.getConnection();
      const existingTables = await connection.tableNames();
      if (!existingTables.includes(TABLE_NAME)) {
        this.markReady("search", false, "Vector index table does not exist.");
        return [];
      }

      const table = await connection.openTable(TABLE_NAME);
      const rows = await table
        .vectorSearch(vector)
        .select(["chunkId"])
        .limit(limit)
        .toArray();

      this.markReady("search", true);
      return rows
        .map((row) => String(row.chunkId ?? ""))
        .filter(Boolean);
    } catch (error) {
      this.markFailed("search", error);
      throw error;
    }
  }
}

export type { LanceChunkRow, LanceIndexStatus };
