import { describe, expect, it } from "vitest";
import { applySprint53cRetrievalBias } from "./sprint53cBias";
import {
  computeSourcePriorDelta,
  shouldApplySourcePrior,
  rescoreBySourcePrior,
  SOURCE_PRIOR_ENABLED_MIN_DOCUMENTS
} from "./sourcePrior";
import type { SearchResult } from "../../shared/types";

const FN_INSTALL = "HOLLiAS_MACS_V6.5用户手册1_软件安装.pdf";
const FN_QUICK = "HOLLiAS_MACS_V6.5用户手册2_快速入门.pdf";
const FN_GRAPHICS = "HOLLiAS_MACS_V6.5用户手册5_图形编辑.pdf";
const FN_ENG = "HOLLiAS_MACS_V6.5用户手册3_工程总控.pdf";
const FN_FB = "HOLLiAS_MACS_V6.5用户手册7_功能块.pdf";

function base(overrides: Partial<SearchResult>): SearchResult {
  return {
    documentId: "d",
    fileName: "x.pdf",
    documentTitle: "T",
    chunkId: "c",
    snippet: "",
    evidenceText: "",
    fullText: "",
    score: 1,
    chunkIndex: 0,
    sectionTitle: "S",
    sectionPath: "P > S",
    sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
    importedAt: "2026-01-01T00:00:00.000Z",
    text: "",
    lexicalScore: 1,
    semanticScore: 1,
    freshnessScore: 0.5,
    rerankScore: 1,
    qualityScore: 1,
    ...overrides
  };
}

describe("shouldApplySourcePrior", () => {
  it(`enables only when documentCount >= ${SOURCE_PRIOR_ENABLED_MIN_DOCUMENTS}`, () => {
    expect(shouldApplySourcePrior(1)).toBe(false);
    expect(shouldApplySourcePrior(2)).toBe(true);
  });
});

describe("B2 source prior (multi-volume)", () => {
  /**
   * Case A：全流程类 — 图形分册原始分最高时，先验后安装/快速入门应压过图形噪声分册。
   */
  it("Case A: procedural_full_flow boosts install/quickstart over graphics", () => {
    const q = "从安装到投运完整步骤是什么？";
    const graphicsHigh = base({
      chunkId: "g",
      fileName: FN_GRAPHICS,
      score: 100,
      text: "流程图配色与图层管理说明。",
      sectionTitle: "图形"
    });
    const install = base({
      chunkId: "i",
      fileName: FN_INSTALL,
      score: 82,
      text: "安装向导与步骤。",
      sectionTitle: "安装"
    });
    const quick = base({
      chunkId: "q",
      fileName: FN_QUICK,
      score: 81,
      text: "入门指引。",
      sectionTitle: "入门"
    });

    const before = [graphicsHigh, install, quick];
    const out = applySprint53cRetrievalBias(q, before, "procedural_full_flow", { documentCount: 3 });

    expect(out[0]?.chunkId).toBe("i");
    expect(out[0]?.fileName).toContain("软件安装");
    expect(out.map((r) => r.chunkId)).not.toEqual(["g", "i", "q"]);
  });

  /**
   * Case B：定义类 — 功能块分册应优先于工程总控（同 multi-doc）。
   */
  it("Case B: definition prefers function_block family over engineering", () => {
    const q = "参数对齐 该属性设为 TRUE 还是 FALSE？";
    const eng = base({
      chunkId: "e",
      fileName: FN_ENG,
      score: 72,
      text: "工程总控概述。",
      sectionTitle: "概述"
    });
    const fb = base({
      chunkId: "f",
      fileName: FN_FB,
      score: 71.5,
      text: "功能块参数说明。",
      sectionTitle: "参数"
    });

    const out = applySprint53cRetrievalBias(q, [eng, fb], "definition", { documentCount: 2 });
    expect(out[0]?.chunkId).toBe("f");
  });

  /**
   * Case C：default + 多卷 — 无强先验，不应对排序做大幅改写（仅极小弱提示或 0）。
   */
  it("Case C: default query type keeps conservative ordering", () => {
    const q = "今天天气如何";
    const a = base({ chunkId: "a", fileName: FN_INSTALL, score: 100, text: "x" });
    const b = base({ chunkId: "b", fileName: FN_GRAPHICS, score: 99, text: "y" });
    const before = [a, b];
    const out = applySprint53cRetrievalBias(q, before, "default", { documentCount: 3 });
    expect(out[0]?.chunkId).toBe("a");
    expect(out[1]?.chunkId).toBe("b");
  });

  it("single-document library skips source prior deltas", () => {
    const r = base({ fileName: FN_INSTALL, score: 10 });
    expect(computeSourcePriorDelta(r, "procedural_full_flow", 1, "全流程步骤")).toBe(0);
  });
});

describe("rescoreBySourcePrior", () => {
  it("reorders by summed score with prior", () => {
    const rows = [
      base({ chunkId: "1", fileName: FN_GRAPHICS, score: 50, text: "无链信号" }),
      base({ chunkId: "2", fileName: FN_INSTALL, score: 40, text: "步骤" })
    ];
    const out = rescoreBySourcePrior(rows, "procedural_full_flow", 2, "主链路依次");
    expect(out[0]?.chunkId).toBe("2");
  });
});
