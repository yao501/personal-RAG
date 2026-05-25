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
      schemaVersion: 2,
      mode: "external_preprocess",
      automaticOcrEnabled: false,
      supportedFileTypes: ["pdf"],
      strongTextDensityThreshold: 25,
      possibleTextDensityThreshold: 80,
      textDensityUnit: "non_whitespace_characters_per_page"
    });
  });

  it("keeps bundled OCR behind explicit enterprise acceptance criteria", () => {
    const snapshot = getOcrPolicySnapshot();
    const criteriaById = new Map(snapshot.bundledOcrAcceptanceCriteria.map((criterion) => [criterion.id, criterion]));

    expect(snapshot.automaticOcrEnabled).toBe(false);
    expect(criteriaById.get("offline_only_execution")).toMatchObject({
      status: "required_before_enablement",
      releaseGate: true
    });
    expect(criteriaById.get("citation_traceability")?.validation).toContain("product RAG gates");
    expect(snapshot.bundledOcrAcceptanceCriteria.filter((criterion) => criterion.releaseGate)).toHaveLength(6);
  });
});
