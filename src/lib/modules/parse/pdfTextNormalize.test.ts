import { describe, expect, it } from "vitest";
import { normalizePdfTechnicalTokens } from "./pdfTextNormalize";

describe("normalizePdfTechnicalTokens", () => {
  it("normalizes fullwidth TRUE/FALSE", () => {
    expect(normalizePdfTechnicalTokens("参数为ＴＲＵＥ时")).toContain("TRUE");
    expect(normalizePdfTechnicalTokens("ＦＡＬＳＥ 时")).toContain("FALSE");
  });
});
