import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { redactAbsolutePath, summarizeDocumentForBundle, summarizeQueryLogsForBundle } from "./bundlePrivacy";
import type { DocumentRecord, QueryLogRecord } from "../../shared/types";

describe("bundlePrivacy", () => {
  it("redacts home prefix when anonymize is true", () => {
    const p = path.join(os.homedir(), "Documents", "foo", "bar.txt");
    expect(redactAbsolutePath(p, true)).toBe(`~/Documents/foo/bar.txt`);
  });

  it("redacts arbitrary macOS user folder segment when anonymize is true", () => {
    const p = "/Users/not-the-current-user/project/file.txt";
    expect(redactAbsolutePath(p, true)).toBe("/Users/[USER]/project/file.txt");
  });

  it("leaves path unchanged when anonymize is false", () => {
    const p = "/Users/alice/Documents/foo.txt";
    expect(redactAbsolutePath(p, false)).toBe(p);
  });

  it("summarizes documents without content fields", () => {
    const document: DocumentRecord = {
      id: "d1",
      filePath: "/Users/me/doc.pdf",
      fileName: "doc.pdf",
      title: "T",
      fileType: "pdf",
      content: "SECRET BODY",
      importedAt: "2020-01-01",
      updatedAt: "2020-01-02",
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      indexConfigSignature: "{}",
      chunkCount: 3
    };
    const summary = summarizeDocumentForBundle(document, true);
    expect(summary).not.toHaveProperty("content");
    expect(String(summary.filePath)).toContain("[USER]");
  });

  it("redacts query log previews when anonymize is true", () => {
    const log: QueryLogRecord = {
      id: "q1",
      sessionId: "s1",
      question: "secret question",
      answer: {
        answer: "",
        directAnswer: "",
        supportingPoints: [],
        sourceDocumentCount: 0,
        basedOnSingleDocument: true,
        citations: []
      },
      citations: [],
      topResults: [],
      createdAt: "2020-01-01",
      feedbackStatus: "pending",
      feedbackNote: null
    };
    const rows = summarizeQueryLogsForBundle([log], true) as Array<{ questionPreview: string; sessionId: string }>;
    expect(rows[0].questionPreview).toBe("[REDACTED]");
    expect(rows[0].sessionId).toBe("[REDACTED]");
  });
});
