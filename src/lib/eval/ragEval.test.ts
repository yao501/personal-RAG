import { describe, expect, it } from "vitest";
import { evaluateCase, summarizeCaseResults, type EvalCase } from "./ragEval";
import type { SearchResult } from "../shared/types";

function makeResult(overrides: Partial<SearchResult>): SearchResult {
  return {
    documentId: "doc",
    fileName: "manual.pdf",
    documentTitle: "Manual",
    chunkId: "chunk",
    snippet: "snippet",
    evidenceText: "evidence",
    fullText: "fullText",
    score: 1,
    chunkIndex: 0,
    sectionTitle: "Section",
    sectionPath: "Manual > Section",
    sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
    importedAt: "2026-01-01T00:00:00.000Z",
    text: "text",
    lexicalScore: 1,
    semanticScore: 1,
    freshnessScore: 0.5,
    rerankScore: 1,
    qualityScore: 1,
    ...overrides
  };
}

describe("ragEval", () => {
  it("passes when any expectation matches within topK", () => {
    const evalCase: EvalCase = {
      id: "role-1",
      category: "role",
      question: "通讯站有什么作用？",
      expectations: [
        {
          topK: 2,
          sectionPathIncludes: ["系统组成"],
          evidenceIncludes: ["用于安装和运行 OPC 通讯软件"]
        }
      ]
    };

    const result = evaluateCase(evalCase, [
      makeResult({ chunkId: "1", sectionPath: "Manual > 安装步骤", evidenceText: "单击下一步继续安装。" }),
      makeResult({ chunkId: "2", sectionPath: "Manual > 系统组成", evidenceText: "通讯站用于安装和运行 OPC 通讯软件。" })
    ]);

    expect(result.passed).toBe(true);
    expect(result.matchedRank).toBe(2);
  });

  it("summarizes pass rate by category", () => {
    const evalCase: EvalCase = {
      id: "proc-1",
      category: "procedure",
      question: "如何连接 OPC 服务器？",
      expectations: [{ evidenceIncludes: ["连接 OPC 服务器"] }]
    };

    const summary = summarizeCaseResults([
      evaluateCase(evalCase, [makeResult({ evidenceText: "连接 OPC 服务器。" })]),
      evaluateCase({ ...evalCase, id: "proc-2" }, [makeResult({ evidenceText: "无关内容" })])
    ]);

    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.byCategory[0]?.category).toBe("procedure");
  });
});
