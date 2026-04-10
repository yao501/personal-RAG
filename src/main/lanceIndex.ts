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

const TABLE_NAME = "knowledge_chunks";

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export class LanceIndex {
  private connectionPromise: Promise<lancedb.Connection> | null = null;

  private async getConnection(): Promise<lancedb.Connection> {
    if (!this.connectionPromise) {
      const dbPath = path.join(app.getPath("userData"), "lancedb");
      this.connectionPromise = lancedb.connect(dbPath);
    }

    return this.connectionPromise;
  }

  async rebuild(rows: LanceChunkRow[]): Promise<void> {
    const connection = await this.getConnection();
    const existingTables = await connection.tableNames();

    if (rows.length === 0) {
      if (existingTables.includes(TABLE_NAME)) {
        await connection.dropTable(TABLE_NAME);
      }
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
  }

  async search(vector: number[], limit: number): Promise<string[]> {
    if (vector.length === 0) {
      return [];
    }

    const connection = await this.getConnection();
    const existingTables = await connection.tableNames();
    if (!existingTables.includes(TABLE_NAME)) {
      return [];
    }

    const table = await connection.openTable(TABLE_NAME);
    const rows = await table
      .vectorSearch(vector)
      .select(["chunkId"])
      .limit(limit)
      .toArray();

    return rows
      .map((row) => String(row.chunkId ?? ""))
      .filter(Boolean);
  }
}

export type { LanceChunkRow };
