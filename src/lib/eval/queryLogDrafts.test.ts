import { describe, expect, it } from "vitest";
import { buildEvalCaseDraft, renderEvalCaseDraft } from "./queryLogDrafts";
import type { QueryLogRecord } from "../shared/types";

describe("queryLogDrafts", () => {
  it("builds an eval draft from the first citation of a benchmark-candidate query log", () => {
    const log: QueryLogRecord = {
      id: "log-1",
      sessionId: "session-1",
      question: "采集周期是多少？",
      answer: {
        answer: "",
        directAnswer: "采集周期为1秒/次。",
        supportingPoints: [],
        sourceDocumentCount: 1,
        basedOnSingleDocument: true,
        citations: []
      },
      citations: [
        {
          documentId: "doc-1",
          fileName: "施工方案.docx",
          documentTitle: "施工方案",
          chunkId: "chunk-1",
          snippet: "采集周期为1秒/次，采集方式为只读。",
          evidenceText: "采集周期为1秒/次，采集方式为只读。",
          fullText: "采集周期为1秒/次，采集方式为只读。",
          score: 3,
          chunkIndex: 0,
          sectionTitle: "项目背景",
          sectionPath: "3 项目背景与现状",
          locatorLabel: "para 6",
          sourceUpdatedAt: null,
          importedAt: "2026-04-09T00:00:00.000Z"
        }
      ],
      topResults: [],
      createdAt: "2026-04-09T00:00:00.000Z",
      feedbackStatus: "benchmark_candidate",
      feedbackNote: null
    };

    const draft = buildEvalCaseDraft(log);

    expect(draft?.sourceLogId).toBe("log-1");
    expect(draft?.category).toBe("definition");
    expect(draft?.expectation.fileNameIncludes).toBe("施工方案.docx");
    expect(draft?.expectation.sectionPathIncludes).toEqual(["3 项目背景与现状"]);
    expect(draft?.expectation.evidenceIncludes?.[0]).toContain("采集周期为1秒/次");
  });

  it("renders a copyable eval-case draft block", () => {
    const rendered = renderEvalCaseDraft({
      id: "sampling-interval",
      sourceLogId: "log-1",
      category: "definition",
      question: "采集周期是多少？",
      expectation: {
        topK: 2,
        fileNameIncludes: "施工方案.docx",
        sectionPathIncludes: ["3 项目背景与现状"],
        evidenceIncludes: ["采集周期为1秒/次"]
      }
    });

    expect(rendered).toContain('id: "sampling-interval"');
    expect(rendered).toContain('fileNameIncludes: "施工方案.docx"');
    expect(rendered).toContain('evidenceIncludes: ["采集周期为1秒/次"]');
  });
});
