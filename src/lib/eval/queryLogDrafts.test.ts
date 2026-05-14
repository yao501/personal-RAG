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
      retrievalDebug: null,
      createdAt: "2026-04-09T00:00:00.000Z",
      feedbackStatus: "benchmark_candidate",
      feedbackNote: null
    };

    const draft = buildEvalCaseDraft(log);

    expect(draft?.sourceLogId).toBe("log-1");
    expect(draft?.category).toBe("definition");
    expect(draft?.answerMode).toBe("grounded");
    expect(draft?.mustRefuse).toBe(false);
    expect(draft?.expectation.fileNameIncludes).toBe("施工方案.docx");
    expect(draft?.expectation.sectionPathIncludes).toEqual(["3 项目背景与现状"]);
    expect(draft?.expectation.evidenceIncludes?.[0]).toContain("采集周期为1秒/次");
  });

  it("renders a copyable benchmark v1 case draft block", () => {
    const rendered = renderEvalCaseDraft({
      id: "sampling-interval",
      sourceLogId: "log-1",
      category: "definition",
      answerMode: "grounded",
      question: "采集周期是多少？",
      mustRefuse: false,
      expectation: {
        topK: 2,
        fileNameIncludes: "施工方案.docx",
        sectionPathIncludes: ["3 项目背景与现状"],
        evidenceIncludes: ["采集周期为1秒/次"]
      }
    });
    const parsed = JSON.parse(rendered);

    expect(parsed).toMatchObject({
      id: "sampling-interval",
      sourceType: "sanitized",
      expectedAnswerMode: "grounded",
      intentGroup: "definition",
      question: "采集周期是多少？",
      expectedDocs: ["施工方案.docx"],
      expectedFacts: ["采集周期为1秒/次"],
      expectedCitations: {
        fileNameIncludes: ["施工方案.docx"]
      },
      mustRefuse: false
    });
  });

  it("builds a must-refuse draft from a refusal query log without citations", () => {
    const log: QueryLogRecord = {
      id: "log-refusal",
      sessionId: "session-1",
      question: "系统管理员密码是什么？",
      answer: {
        answer: "",
        directAnswer: "I could not find grounded evidence for that question in the current library. Try importing more files or rephrasing the question.",
        supportingPoints: [],
        sourceDocumentCount: 0,
        basedOnSingleDocument: false,
        citations: []
      },
      citations: [],
      topResults: [],
      retrievalDebug: null,
      createdAt: "2026-04-09T00:00:00.000Z",
      feedbackStatus: "benchmark_candidate",
      feedbackNote: null
    };

    const draft = buildEvalCaseDraft(log);
    const rendered = renderEvalCaseDraft(draft!);
    const parsed = JSON.parse(rendered);

    expect(draft?.answerMode).toBe("refusal");
    expect(parsed).toMatchObject({
      expectedAnswerMode: "refusal",
      expectedDocs: [],
      mustRefuse: true
    });
  });
});
