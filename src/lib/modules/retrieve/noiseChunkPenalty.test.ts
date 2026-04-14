import { describe, expect, it } from "vitest";
import { searchChunks } from "./searchIndex";
import { isTocLikeText, isTableHeaderLikeText, isShortFieldNoiseText } from "./noiseChunkPenalty";
import type { ChunkRecord, DocumentRecord } from "../../shared/types";

function doc(id: string, fileName: string, title: string): DocumentRecord {
  return {
    id,
    filePath: `/tmp/${fileName}`,
    fileName,
    title,
    fileType: "pdf",
    content: "",
    importedAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    sourceCreatedAt: "2026-04-01T00:00:00.000Z",
    sourceUpdatedAt: "2026-04-01T00:00:00.000Z",
    chunkCount: 2
  };
}

function chunk(id: string, documentId: string, sectionTitle: string, text: string): ChunkRecord {
  return {
    id,
    documentId,
    text,
    chunkIndex: 0,
    startOffset: 0,
    endOffset: text.length,
    tokenCount: 20,
    sectionTitle,
    sectionPath: `手册 > ${sectionTitle}`,
    headingTrail: `手册 > ${sectionTitle}`
  };
}

describe("noiseChunkPenalty classifiers", () => {
  it("detects ToC-like text with dot leaders", () => {
    expect(isTocLikeText("目录\n第3章 基本运算 ..................................... 12")).toBe(true);
  });

  it("detects table-header-like text by header keywords", () => {
    expect(isTableHeaderLikeText("类型 项名 数据类型 描述 默认值 数据同步 掉电保护 参数对齐 强制 备注")).toBe(true);
  });

  it("detects short-field noise by short-line density", () => {
    const t = ["0.00", "否", "否", "请赋值为“副调点名.OVE”", "0.00", "否"].join("\n");
    expect(isShortFieldNoiseText(t)).toBe(true);
  });
});

describe("searchChunks ranking suppresses noise-like chunks", () => {
  it("Case A: ToC chunk does not outrank definition chunk", () => {
    const documents = [doc("d1", "manual7.pdf", "功能块")];
    const toc = chunk("toc", "d1", "1.1 文档更新", "目录\n第3章 基本运算 ..................................... 12");
    const definition = chunk(
      "def",
      "d1",
      "参数对齐",
      "参数对齐：该属性设为 TRUE 的参数，系统会将在线值和离线值进行对比并提示同步；若为 FALSE 则不进行值比较。"
    );

    const results = searchChunks("什么是参数对齐？ TRUE 还是 FALSE？", documents, [toc, definition], 2, null);
    expect(results[0]?.chunkId).toBe("def");
  });

  it("Case B/C/D: header-like chunk is penalized but true definition stays on top", () => {
    const documents = [doc("d1", "manual7.pdf", "功能块")];
    const header = chunk("hdr", "d1", "6.2.6.2 引脚", "类型 项名 数据类型 描述 默认值 数据同步 掉电保护 参数对齐 强制 备注");
    const definition = chunk(
      "def",
      "d1",
      "参数对齐",
      "参数对齐：该属性设为 TRUE 的参数，在下装时系统会将在线值与离线值进行对比；不一致会提示用户选择是否同步；若为 FALSE 则不进行值比较。"
    );

    const results = searchChunks("什么是参数对齐？", documents, [header, definition], 2, null);
    expect(results[0]?.chunkId).toBe("def");
    // It's ok if the header-like chunk gets filtered out entirely; the key is it must not take the top slot.
    expect(results.every((r) => r.chunkId !== "hdr") || results[0]?.chunkId !== "hdr").toBe(true);
  });
});

