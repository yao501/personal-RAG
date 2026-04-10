import { describe, expect, it } from "vitest";
import { selectCandidateChunksFromVectors } from "./candidateChunks";
import type { ChunkRecord, DocumentRecord } from "../../shared/types";

const doc: DocumentRecord = {
  id: "d1",
  filePath: "/x/a.md",
  fileName: "a.md",
  title: "T",
  fileType: "md",
  content: "c",
  importedAt: "2026-01-01",
  updatedAt: "2026-01-01",
  sourceCreatedAt: null,
  sourceUpdatedAt: null,
  chunkCount: 2
};

function chunk(id: string, text: string): ChunkRecord {
  return {
    id,
    documentId: "d1",
    chunkIndex: 0,
    startOffset: 0,
    endOffset: text.length,
    tokenCount: 1,
    text,
    sectionTitle: null,
    sectionPath: null,
    headingTrail: null,
    embedding: null
  };
}

describe("selectCandidateChunksFromVectors", () => {
  it("returns all chunks when the vector list is empty", () => {
    const chunks = [chunk("c1", "alpha beta"), chunk("c2", "gamma")];
    expect(selectCandidateChunksFromVectors("alpha query", [doc], chunks, [])).toEqual(chunks);
  });

  it("merges vector ids with lexical fallback tokens", () => {
    const chunks = [chunk("v1", "only vector hit"), chunk("lex", "query term here")];
    const out = selectCandidateChunksFromVectors("query term", [doc], chunks, ["v1"]);
    expect(out.map((c) => c.id).sort()).toEqual(["lex", "v1"].sort());
  });
});
