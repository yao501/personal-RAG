import { describe, expect, it } from "vitest";
import { searchChunks } from "./searchIndex";
import type { ChunkRecord, DocumentRecord } from "../../shared/types";

describe("searchChunks", () => {
  it("returns the most relevant chunk first", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/notes.md",
        fileName: "notes.md",
        fileType: "md",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 2
      }
    ];

    const chunks: ChunkRecord[] = [
      {
        id: "chunk-1",
        documentId: "doc-1",
        text: "SQLite stores metadata for imported files and chunks.",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 53,
        tokenCount: 8
      },
      {
        id: "chunk-2",
        documentId: "doc-1",
        text: "The UI shows citations for grounded answers in chat.",
        chunkIndex: 1,
        startOffset: 54,
        endOffset: 106,
        tokenCount: 10
      }
    ];

    const results = searchChunks("citations in chat", documents, chunks, 2);

    expect(results[0]?.chunkId).toBe("chunk-2");
  });
});

