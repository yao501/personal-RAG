import { describe, expect, it } from "vitest";
import { isAbsoluteLocalPath, isAllowedAppNavigation, isAllowedExternalOpenTarget } from "./security";

describe("security helpers", () => {
  it("allows file navigation and local dev server navigation only", () => {
    expect(isAllowedAppNavigation("file:///tmp/index.html")).toBe(true);
    expect(isAllowedAppNavigation("http://localhost:5173/chat", "http://localhost:5173")).toBe(true);
    expect(isAllowedAppNavigation("https://example.com", "http://localhost:5173")).toBe(false);
  });

  it("only allows file-based external open targets", () => {
    expect(isAllowedExternalOpenTarget("file:///tmp/manual.pdf#page=3")).toBe(true);
    expect(isAllowedExternalOpenTarget("https://example.com")).toBe(false);
  });

  it("detects absolute local paths", () => {
    expect(isAbsoluteLocalPath("/tmp/file.txt")).toBe(true);
    expect(isAbsoluteLocalPath("relative/file.txt")).toBe(false);
  });
});
