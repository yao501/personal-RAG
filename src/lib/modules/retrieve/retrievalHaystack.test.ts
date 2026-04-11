import { describe, expect, it } from "vitest";
import { retrievalHaystack } from "./retrievalHaystack";
import type { ChunkRecord } from "../../shared/types";

function baseChunk(overrides: Partial<ChunkRecord>): ChunkRecord {
  return {
    id: "c1",
    documentId: "d1",
    text: "",
    chunkIndex: 0,
    startOffset: 0,
    endOffset: 0,
    tokenCount: 0,
    sectionTitle: null,
    sectionPath: null,
    headingTrail: null,
    ...overrides
  };
}

describe("retrievalHaystack", () => {
  it("concatenates sectionTitle, sectionPath, then text in fixed order", () => {
    const chunk = baseChunk({
      sectionTitle: "Title A",
      sectionPath: "Doc > Title A",
      text: "Body B"
    });
    expect(retrievalHaystack(chunk)).toBe("Title A\nDoc > Title A\nBody B");
  });

  it("omits null heading fields without extra newlines", () => {
    const chunk = baseChunk({
      text: "Only body"
    });
    expect(retrievalHaystack(chunk)).toBe("Only body");
  });
});
