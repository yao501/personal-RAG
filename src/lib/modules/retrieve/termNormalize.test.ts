import { describe, expect, it } from "vitest";
import { normalizeForLexicalMatch } from "./termNormalize";
import { searchChunks } from "./searchIndex";
import type { ChunkRecord, DocumentRecord } from "../../shared/types";

describe("normalizeForLexicalMatch (B5 whitelist)", () => {
  it("canonicalizes TRUE/FALSE variants and adds enable/disable expansion tokens", () => {
    const out = normalizeForLexicalMatch("启用时为 true；禁用时为 False。");
    expect(out).toContain("TRUE");
    expect(out).toContain("FALSE");
    // Keep original content; expansions are appended, not replacing everything.
    expect(out).toContain("启用");
    expect(out).toContain("禁用");
  });

  it("adds parameter-alignment related hints only when cue exists", () => {
    expect(normalizeForLexicalMatch("参数对齐")).toMatch(/在线值|离线值|值比较|同步/);
    expect(normalizeForLexicalMatch("不相关文本")).not.toMatch(/在线值|离线值|值比较|同步/);
  });
});

describe("searchChunks uses B5 normalization for lexical matching", () => {
  it("matches 参数对齐 passage even if query uses 在线/离线/同步 wording", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/manual.pdf",
        fileName: "HOLLiAS_MACS_V6.5用户手册7_功能块.pdf",
        title: "功能块",
        fileType: "pdf",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 1
      }
    ];

    const chunks: ChunkRecord[] = [
      {
        id: "align",
        documentId: "doc-1",
        text: "参数对齐：该属性设为 TRUE 的参数，在工程下装时系统会提示用户选择是否进行同步。",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 48,
        tokenCount: 24,
        sectionTitle: "参数对齐",
        sectionPath: "功能块 > 参数对齐",
        headingTrail: "功能块 > 参数对齐"
      }
    ];

    const results = searchChunks("在线值 离线值 值比较 同步提示", documents, chunks, 3, null);
    expect(results[0]?.chunkId).toBe("align");
    expect(results[0]?.lexicalScore).toBeGreaterThan(0);
  });

  it("bridges enable/disable wording to TRUE/FALSE tokens", () => {
    const documents: DocumentRecord[] = [
      {
        id: "doc-1",
        filePath: "/tmp/manual.pdf",
        fileName: "HOLLiAS_MACS_V6.5用户手册7_功能块.pdf",
        title: "功能块",
        fileType: "pdf",
        content: "",
        importedAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-01T00:00:00.000Z",
        sourceCreatedAt: "2026-04-01T00:00:00.000Z",
        sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
        chunkCount: 1
      }
    ];

    const chunks: ChunkRecord[] = [
      {
        id: "bool",
        documentId: "doc-1",
        text: "当该属性设为 TRUE 时执行比较；若为 FALSE，则不执行。",
        chunkIndex: 0,
        startOffset: 0,
        endOffset: 30,
        tokenCount: 18,
        sectionTitle: "布尔属性",
        sectionPath: "功能块 > 布尔属性",
        headingTrail: "功能块 > 布尔属性"
      }
    ];

    const results = searchChunks("如何启用或禁用该属性的比较？", documents, chunks, 3, null);
    expect(results[0]?.chunkId).toBe("bool");
    expect(results[0]?.lexicalScore).toBeGreaterThan(0);
  });
});

