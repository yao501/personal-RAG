import { describe, expect, it } from "vitest";
import { classifyPdfTextDensityForOcr, getOcrPolicySnapshot } from "./ocrPolicy";

describe("ocrPolicy", () => {
  it("classifies PDF text density into OCR recommendation levels", () => {
    expect(classifyPdfTextDensityForOcr(null)).toBe("none");
    expect(classifyPdfTextDensityForOcr(24.9)).toBe("strong");
    expect(classifyPdfTextDensityForOcr(25)).toBe("possible");
    expect(classifyPdfTextDensityForOcr(79.9)).toBe("possible");
    expect(classifyPdfTextDensityForOcr(80)).toBe("none");
  });

  it("documents the current enterprise OCR policy as external preprocessing", () => {
    expect(getOcrPolicySnapshot()).toMatchObject({
      schemaVersion: 1,
      mode: "external_preprocess",
      automaticOcrEnabled: false,
      supportedFileTypes: ["pdf"],
      strongTextDensityThreshold: 25,
      possibleTextDensityThreshold: 80,
      textDensityUnit: "non_whitespace_characters_per_page"
    });
  });
});
