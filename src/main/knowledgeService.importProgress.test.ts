import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createStableId } from "../lib/modules/core/id";
import type { ChunkRecord, DocumentRecord, LibraryTaskProgress } from "../lib/shared/types";
import { KnowledgeService } from "./knowledgeService";
import type { AppStore } from "./store";

describe("KnowledgeService.importFiles progress diagnostics", () => {
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
    expect(completed).toMatchObject({
      phase: "completed",
      succeeded: 0,
      skipped: 1,
      failed: 1
    });
  });
});
