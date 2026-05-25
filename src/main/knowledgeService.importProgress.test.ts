import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createStableId } from "../lib/modules/core/id";
import type { ChunkRecord, DocumentRecord, LibraryTaskProgress } from "../lib/shared/types";
import { KnowledgeService } from "./knowledgeService";
import { getRecentVectorIndexEvents } from "./diagnosticsBuffer";
import type { AppStore } from "./store";

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.0.0-test",
    getPath: () => "/tmp/pkrag-test-user-data"
  },
  shell: {
    openPath: vi.fn(),
    openExternal: vi.fn()
  }
}));

describe("KnowledgeService task progress diagnostics", () => {
  it("keeps skipped and failed counts separate in final task progress", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pkrag-import-progress-"));
    const unchangedPath = path.join(dir, "unchanged.md");
    const missingPath = path.join(dir, "missing.md");
    await fs.writeFile(unchangedPath, "# Existing\n\nContent", "utf8");

    const stats = await fs.stat(unchangedPath);
    const documentId = createStableId(unchangedPath);
    const sourceUpdatedAt = new Date(stats.mtimeMs).toISOString();
    const indexConfigSignature = JSON.stringify({
      chunkSize: 180,
      chunkOverlap: 40,
      parserVersion: 2
    });
    const existingDocument: DocumentRecord = {
      id: documentId,
      filePath: unchangedPath,
      fileName: "unchanged.md",
      title: "Existing",
      fileType: "md",
      content: "# Existing\n\nContent",
      importedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      sourceCreatedAt: new Date(stats.birthtimeMs).toISOString(),
      sourceUpdatedAt,
      indexConfigSignature,
      chunkCount: 1
    };
    const existingChunk: ChunkRecord = {
      id: "chunk-1",
      documentId,
      text: "Content",
      chunkIndex: 0,
      startOffset: 0,
      endOffset: 7,
      tokenCount: 1,
      sectionTitle: null,
      sectionPath: null,
      headingTrail: null,
      embedding: "[0.1]"
    };
    const store: Pick<AppStore, "getSettings" | "getDocument" | "listChunks" | "listDocuments"> = {
      getSettings: () => ({ libraryPath: null, chunkSize: 180, chunkOverlap: 40 }),
      getDocument: (id: string) => (id === documentId ? existingDocument : null),
      listChunks: (id?: string) => (id === documentId || !id ? [existingChunk] : []),
      listDocuments: () => [existingDocument]
    };
    const service = new KnowledgeService(store as AppStore);
    (service as unknown as { lanceIndex: { rebuild: () => Promise<void> } }).lanceIndex = { rebuild: async () => {} };

    const progress: LibraryTaskProgress[] = [];
    const result = await service.importFiles([unchangedPath, missingPath], (item) => progress.push(item));
    const completed = progress.at(-1);

    expect(result.skippedDetails.map((item) => item.disposition)).toEqual(["skipped", "failed"]);
    expect(result.skippedDetails.map((item) => item.repairAction)).toEqual(["run_reindex", "reselect_file"]);
    expect(completed).toMatchObject({
      phase: "completed",
      message: "导入完成：成功 0，跳过 1，失败 1",
      succeeded: 0,
      skipped: 1,
      failed: 1
    });
  });

  it("emits a structured import preflight summary before parsing candidates", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pkrag-import-preflight-"));
    const filePath = path.join(dir, "source.md");
    const unsupportedPath = path.join(dir, "table.csv");
    await fs.writeFile(filePath, "# Source\n\nContent to import.", "utf8");
    await fs.writeFile(unsupportedPath, "a,b\n1,2", "utf8");

    let documents: DocumentRecord[] = [];
    let chunks: ChunkRecord[] = [];
    const store: Partial<AppStore> = {
      getSettings: () => ({ libraryPath: null, chunkSize: 180, chunkOverlap: 40 }),
      getDocument: () => null,
      listChunks: () => chunks,
      listDocuments: () => documents,
      upsertDocument: (document: DocumentRecord, nextChunks: ChunkRecord[]) => {
        documents = [document];
        chunks = nextChunks;
      }
    };
    const service = new KnowledgeService(store as AppStore);
    (service as unknown as { lanceIndex: { rebuild: () => Promise<void> } }).lanceIndex = { rebuild: async () => {} };

    const progress: LibraryTaskProgress[] = [];
    const result = await service.importFiles([filePath, filePath, unsupportedPath], (item) => progress.push(item));
    const preflightEvent = progress.find((item) => item.preflightSummary);

    expect(result.imported).toHaveLength(1);
    expect(result.preflightSummary).toMatchObject({
      totalFiles: 3,
      candidateFiles: 1,
      skippedFiles: 1,
      failedFiles: 1,
      duplicateSelections: 1,
      unsupportedFiles: 1,
      markdownFiles: 1
    });
    expect(preflightEvent).toMatchObject({
      phase: "preparing",
      message: "预检完成：将导入 1，跳过 1，失败 1，PDF 0",
      preflightSummary: result.preflightSummary
    });
    expect(result.skippedDetails.map((item) => item.code)).toEqual([
      "duplicate_selection_skipped",
      "unsupported_file_type"
    ]);
    expect(result.skippedDetails.map((item) => item.repairAction)).toEqual([
      "none",
      "convert_to_supported_type"
    ]);
  });

  it("reindexes unchanged documents when any existing chunk is missing an embedding", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pkrag-reindex-missing-embedding-"));
    const filePath = path.join(dir, "source.md");
    await fs.writeFile(filePath, "# Source\n\nContent to rebuild for embeddings.", "utf8");

    const stats = await fs.stat(filePath);
    const documentId = createStableId(filePath);
    const sourceUpdatedAt = new Date(stats.mtimeMs).toISOString();
    const indexConfigSignature = JSON.stringify({
      chunkSize: 180,
      chunkOverlap: 40,
      parserVersion: 2
    });
    let documents: DocumentRecord[] = [
      {
        id: documentId,
        filePath,
        fileName: "source.md",
        title: "Source",
        fileType: "md",
        content: "# Source\n\nOld content",
        importedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        sourceCreatedAt: new Date(stats.birthtimeMs).toISOString(),
        sourceUpdatedAt,
        indexConfigSignature,
        chunkCount: 2
      }
    ];
    let chunks: ChunkRecord[] = [
      {
        id: "chunk-1",
        documentId,
        text: "Content",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 7,
        tokenCount: 1,
        sectionTitle: null,
        sectionPath: null,
        headingTrail: null,
        embedding: "[0.1]"
      },
      {
        id: "chunk-2",
        documentId,
        text: "Missing embedding",
        chunkIndex: 1,
        startOffset: 8,
        endOffset: 25,
        tokenCount: 2,
        sectionTitle: null,
        sectionPath: null,
        headingTrail: null,
        embedding: null
      }
    ];
    let upsertCount = 0;
    const store: Partial<AppStore> = {
      getSettings: () => ({ libraryPath: null, chunkSize: 180, chunkOverlap: 40 }),
      listDocuments: () => documents,
      listChunks: (id?: string) => (id ? chunks.filter((chunk) => chunk.documentId === id) : chunks),
      upsertDocument: (document: DocumentRecord, nextChunks: ChunkRecord[]) => {
        upsertCount += 1;
        documents = [document];
        chunks = nextChunks;
      },
      getLibraryStats: () => ({ documentCount: documents.length, chunkCount: chunks.length }),
      listChatSessions: () => [],
      getDatabasePath: () => path.join(dir, "app.db"),
      getDatabasePragmas: () => ({ user_version: 3, journal_mode: "wal", page_size: 4096 }),
      getMigrationReport: () => ({
        currentSchemaVersion: 3,
        databaseUserVersionBefore: 3,
        databaseUserVersionAfter: 3,
        migrationNeeded: false,
        migrationApplied: false,
        backupCreated: false,
        backupPath: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:00.000Z",
        error: null
      })
    };
    const service = new KnowledgeService(store as AppStore);
    (service as unknown as { lanceIndex: { rebuild: () => Promise<void> } }).lanceIndex = { rebuild: async () => {} };

    const progress: LibraryTaskProgress[] = [];
    await service.reindexDocuments([documentId], (item) => progress.push(item));

    expect(upsertCount).toBe(1);
    expect(progress.some((item) => item.message.includes("跳过未变化文档"))).toBe(false);
    expect(progress.at(-1)).toMatchObject({
      phase: "completed",
      succeeded: 1,
      skipped: 0,
      failed: 0
    });
  });

  it("surfaces missing-source reindex failures as structured task issues", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pkrag-reindex-progress-"));
    const missingPath = path.join(dir, "deleted.md");
    const document: DocumentRecord = {
      id: "doc-missing",
      filePath: missingPath,
      fileName: "deleted.md",
      title: "Deleted",
      fileType: "md",
      content: "# Deleted\n\nOld content",
      importedAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      sourceCreatedAt: "2026-01-01T00:00:00.000Z",
      sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
      indexConfigSignature: JSON.stringify({
        chunkSize: 180,
        chunkOverlap: 40,
        parserVersion: 2
      }),
      chunkCount: 1
    };
    const store: Partial<AppStore> = {
      getSettings: () => ({ libraryPath: null, chunkSize: 180, chunkOverlap: 40 }),
      listDocuments: () => [document],
      listChunks: () => [],
      getLibraryStats: () => ({ documentCount: 1, chunkCount: 0 }),
      listChatSessions: () => [],
      getDatabasePath: () => path.join(dir, "app.db"),
      getDatabasePragmas: () => ({ user_version: 3, journal_mode: "wal", page_size: 4096 }),
      getMigrationReport: () => ({
        currentSchemaVersion: 3,
        databaseUserVersionBefore: 3,
        databaseUserVersionAfter: 3,
        migrationNeeded: false,
        migrationApplied: false,
        backupCreated: false,
        backupPath: null,
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:00.000Z",
        error: null
      })
    };
    const service = new KnowledgeService(store as AppStore);
    (service as unknown as { lanceIndex: { rebuild: () => Promise<void> } }).lanceIndex = { rebuild: async () => {} };

    const progress: LibraryTaskProgress[] = [];
    await service.reindexLibrary((item) => progress.push(item));

    const issueEvent = progress.find((item) => item.issue?.code === "file_not_found");
    expect(issueEvent).toMatchObject({
      kind: "reindex",
      phase: "failed",
      failed: 1,
      issue: {
        disposition: "failed",
        code: "file_not_found",
        stage: "preflight",
        filePath: missingPath,
        retryable: false
      }
    });
    expect(progress.at(-1)).toMatchObject({
      phase: "completed",
      message: "重建索引完成：更新 0，跳过 0，失败 1",
      failed: 1
    });
  });

  it("records vector index rebuild failures while completing the import with lexical fallback", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pkrag-vector-index-progress-"));
    const filePath = path.join(dir, "source.md");
    await fs.writeFile(filePath, "# Source\n\nUseful content for indexing.", "utf8");

    let documents: DocumentRecord[] = [];
    let chunks: ChunkRecord[] = [];
    const store: Partial<AppStore> = {
      getSettings: () => ({ libraryPath: null, chunkSize: 180, chunkOverlap: 40 }),
      getDocument: () => null,
      listDocuments: () => documents,
      listChunks: () => chunks,
      upsertDocument: (document: DocumentRecord, nextChunks: ChunkRecord[]) => {
        documents = [document];
        chunks = nextChunks.map((chunk) => ({ ...chunk, embedding: "[0.1]" }));
      }
    };
    const service = new KnowledgeService(store as AppStore);
    (service as unknown as { lanceIndex: { rebuild: () => Promise<void>; getStatus: () => unknown } }).lanceIndex = {
      rebuild: async () => {
        throw new Error("simulated vector index failure");
      },
      getStatus: () => ({
        available: false,
        tableReady: false,
        reason: "simulated vector index failure",
        lastErrorAt: "2026-01-01T00:00:00.000Z",
        lastOperation: "rebuild"
      })
    };

    const result = await service.importFiles([filePath]);
    const lastVectorEvent = getRecentVectorIndexEvents().at(-1);

    expect(result.imported).toHaveLength(1);
    expect(lastVectorEvent).toMatchObject({
      operation: "rebuild",
      ok: false,
      message: "simulated vector index failure"
    });
  });

  it("reports empty parsed content as a structured import issue", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pkrag-empty-import-"));
    const filePath = path.join(dir, "empty.md");
    await fs.writeFile(filePath, "   \n\n", "utf8");

    const store: Partial<AppStore> = {
      getSettings: () => ({ libraryPath: null, chunkSize: 180, chunkOverlap: 40 }),
      getDocument: () => null,
      listChunks: () => [],
      listDocuments: () => []
    };
    const service = new KnowledgeService(store as AppStore);
    (service as unknown as { lanceIndex: { rebuild: () => Promise<void> } }).lanceIndex = { rebuild: async () => {} };

    const progress: LibraryTaskProgress[] = [];
    const result = await service.importFiles([filePath], (item) => progress.push(item));

    expect(result.imported).toHaveLength(0);
    expect(result.skippedDetails[0]).toMatchObject({
      disposition: "failed",
      code: "empty_content",
      stage: "parsing",
      retryable: false,
      repairAction: "run_ocr_then_reimport"
    });
    expect(progress.find((item) => item.issue?.code === "empty_content")).toMatchObject({
      phase: "failed",
      failed: 1
    });
  });

  it("reports storage write failures as structured import issues", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pkrag-storage-import-"));
    const filePath = path.join(dir, "source.md");
    await fs.writeFile(filePath, "# Source\n\nContent to persist.", "utf8");

    const store: Partial<AppStore> = {
      getSettings: () => ({ libraryPath: null, chunkSize: 180, chunkOverlap: 40 }),
      getDocument: () => null,
      listChunks: () => [],
      listDocuments: () => [],
      upsertDocument: () => {
        throw new Error("sqlite constraint failed");
      }
    };
    const service = new KnowledgeService(store as AppStore);
    (service as unknown as { lanceIndex: { rebuild: () => Promise<void> } }).lanceIndex = { rebuild: async () => {} };

    const progress: LibraryTaskProgress[] = [];
    const result = await service.importFiles([filePath], (item) => progress.push(item));

    expect(result.imported).toHaveLength(0);
    expect(result.skippedDetails[0]).toMatchObject({
      disposition: "failed",
      code: "sqlite_write_failed",
      stage: "storage",
      retryable: true,
      repairAction: "export_support_bundle"
    });
    expect(progress.at(-1)).toMatchObject({
      phase: "completed",
      failed: 1
    });
  });
});
