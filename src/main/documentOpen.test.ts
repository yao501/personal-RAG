import { describe, expect, it } from "vitest";
import { buildDocumentOpenTarget, shouldUseExternalDocumentOpenTarget } from "./documentOpen";

describe("buildDocumentOpenTarget", () => {
  it("keeps non-pdf files as plain paths", () => {
    expect(buildDocumentOpenTarget("/tmp/notes.md", 4)).toBe("/tmp/notes.md");
  });

  it("adds a page fragment for pdf files", () => {
    expect(buildDocumentOpenTarget("/tmp/manual.pdf", 7)).toBe("file:///tmp/manual.pdf#page=7");
  });

  it("normalizes spaces and ignores invalid page values", () => {
    expect(buildDocumentOpenTarget("/tmp/User Manual.pdf", 0)).toBe("/tmp/User Manual.pdf");
    expect(buildDocumentOpenTarget("/tmp/User Manual.pdf", 3.8)).toBe("file:///tmp/User%20Manual.pdf#page=3");
  });

  it("only uses external open for safe file urls", () => {
    expect(shouldUseExternalDocumentOpenTarget("file:///tmp/manual.pdf#page=2")).toBe(true);
    expect(shouldUseExternalDocumentOpenTarget("https://example.com/manual.pdf")).toBe(false);
  });
});
