import type { SupportedFileType } from "../shared/types";

/** Version 1 benchmark file (JSON). See docs/EVAL_GUIDE.md */
export interface BenchmarkDocumentRefV1 {
  id: string;
  /** Path relative to repository root (or cwd when running eval). */
  path: string;
  title?: string;
  parserHint?: SupportedFileType;
}

export interface BenchmarkExpectedCitationsV1 {
  /** At least one citation fileName must include one of these substrings (case-insensitive). */
  fileNameIncludes?: string[];
}

export type BenchmarkSourceTypeV1 = "fixture" | "sanitized";

/** Expected answer shape for regression tracking (optional; does not replace `mustRefuse`). */
export type BenchmarkExpectedAnswerModeV1 = "grounded" | "cautious" | "refusal";

export interface BenchmarkCaseV1 {
  id: string;
  question: string;
  /**
   * Expected source documents: match by exact `fileName`, exact `documentId`, or basename substring.
   * Empty array with `mustRefuse: true` means no document should be confidently retrieved.
   */
  expectedDocs: string[];
  /** Optional phrases that should appear in top retrieval evidence/snippets or direct answer (case-insensitive). */
  expectedFacts?: string[];
  expectedCitations?: BenchmarkExpectedCitationsV1;
  mustRefuse: boolean;
  /** Optional label to group near-equivalent phrasings for reports (e.g. `import-procedure`). */
  intentGroup?: string;
  /** Provenance hint for humans (default: treat as in-repo fixture). */
  sourceType?: BenchmarkSourceTypeV1;
  /**
   * Optional regression expectation: `grounded` = non-refusal, non-cautious synthesis;
   * `cautious` = cautious procedural template; `refusal` = refusal template (often redundant with `mustRefuse`).
   */
  expectedAnswerMode?: BenchmarkExpectedAnswerModeV1;
  notes?: string;
}

export interface BenchmarkFileV1 {
  schemaVersion: 1;
  id: string;
  description?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  /** Top-k for retrieval metrics and for answer pipeline input. Default 6 (same as desktop `searchChunks` limit). */
  retrievalTopK?: number;
  /**
   * When true (default), benchmark runner embeds chunk text like the desktop path so vector
   * shortlist + hybrid scoring align with production. Set false for a faster lexical-only smoke.
   */
  embeddingHydration?: boolean;
  documents: BenchmarkDocumentRefV1[];
  cases: BenchmarkCaseV1[];
}

export function isBenchmarkFileV1(value: unknown): value is BenchmarkFileV1 {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.schemaVersion === 1 && typeof record.id === "string" && Array.isArray(record.documents) && Array.isArray(record.cases);
}
