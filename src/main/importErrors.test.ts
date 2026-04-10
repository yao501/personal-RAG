import { describe, expect, it } from "vitest";
import { createImportError, normalizeImportError, toImportIssueDetail } from "./importErrors";

describe("importErrors", () => {
  it("normalizes common filesystem errors", () => {
    const error = Object.assign(new Error("missing"), { code: "ENOENT" });
    const normalized = normalizeImportError(error, "/tmp/a.pdf", "preflight");
    expect(normalized.code).toBe("file_not_found");
    expect(normalized.stage).toBe("preflight");
    expect(normalized.retryable).toBe(false);
  });

  it("preserves explicitly created import errors", () => {
    const created = createImportError({
      code: "empty_content",
      stage: "parsing",
      message: "empty",
      retryable: false
    });
    expect(normalizeImportError(created, "/tmp/a.pdf", "unknown")).toBe(created);
  });

  it("converts normalized errors to issue details", () => {
    const detail = toImportIssueDetail(
      "/tmp/a.pdf",
      "failed",
      createImportError({
        code: "chunk_failed",
        stage: "chunking",
        message: "chunk failed",
        suggestion: "adjust chunk settings",
        retryable: true
      })
    );

    expect(detail).toMatchObject({
      filePath: "/tmp/a.pdf",
      disposition: "failed",
      code: "chunk_failed",
      stage: "chunking",
      reason: "chunk failed",
      retryable: true
    });
  });

  it("maps embedding and vector-index errors into stable codes", () => {
    expect(normalizeImportError(new Error("embedding model unavailable"), "/tmp/a.pdf", "unknown").code).toBe("embedding_failed");
    expect(normalizeImportError(new Error("lance vector index rebuild failed"), "/tmp/a.pdf", "unknown").code).toBe("vector_index_failed");
  });
});
