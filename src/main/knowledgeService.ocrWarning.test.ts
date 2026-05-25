import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AppStore } from "./store";
import type { ChunkRecord, DocumentRecord, LibraryTaskProgress } from "../lib/shared/types";
import { KnowledgeService } from "./knowledgeService";

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

vi.mock("../lib/modules/embed/localEmbedder", () => ({
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  getEmbeddingStatus: () => ({ available: true, reason: null })
}));

vi.mock("../lib/modules/parse/parseDocument", () => ({
  parseDocument: vi.fn(async () => ({
    fileType: "pdf",
    content: "少量文本",
    pageSpans: [
      { pageNumber: 1, startOffset: 0, endOffset: 2 },
      { pageNumber: 2, startOffset: 2, endOffset: 4 },
      { pageNumber: 3, startOffset: 4, endOffset: 4 }
    ]
  }))
}));

describe("KnowledgeService OCR diagnostics", () => {
  it("imports low-text-density PDFs while surfacing an OCR warning issue", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pkrag-ocr-warning-"));
    const filePath = path.join(dir, "scan.pdf");
    await fs.writeFile(filePath, "mock pdf bytes", "utf8");

    let documents: DocumentRecord[] = [];
    let chunks: ChunkRecord[] = [];
    const store: Partial<AppStore> = {
      getSettings: () => ({ libraryPath: null, chunkSize: 180, chunkOverlap: 40 }),
      getDocument: () => null,
      listDocuments: () => documents,
      listChunks: () => chunks,
      upsertDocument: (document: DocumentRecord, nextChunks: ChunkRecord[]) => {
        documents = [document];
        chunks = nextChunks;
      }
    };
    const service = new KnowledgeService(store as AppStore);
    (service as unknown as { lanceIndex: { rebuild: () => Promise<void> } }).lanceIndex = { rebuild: async () => {} };

    const progress: LibraryTaskProgress[] = [];
    const result = await service.importFiles([filePath], (item) => progress.push(item));

    expect(result.imported).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.skippedDetails).toHaveLength(1);
    expect(result.skippedDetails[0]).toMatchObject({
      disposition: "warning",
      code: "pdf_ocr_recommended",
      stage: "parsing",
      filePath,
      retryable: false
    });
    expect(result.imported[0].ingestionQuality).toMatchObject({
      ocrRecommended: true,
      ocrConfidence: "strong"
    });
    expect(progress.find((item) => item.issue?.code === "pdf_ocr_recommended")).toMatchObject({
      phase: "saving",
      issue: {
        disposition: "warning"
      }
    });
    expect(progress.at(-1)?.message).toContain("提示 1");
  });
});
