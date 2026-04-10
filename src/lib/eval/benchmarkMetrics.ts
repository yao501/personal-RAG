import type { ChatAnswer, SearchResult } from "../shared/types";
import { isCautiousProceduralAnswer } from "../modules/answer/cautiousMarkers";
import type { BenchmarkCaseV1 } from "./benchmarkSchema";

export interface RetrievalMetrics {
  topK: number;
  /** Any expected doc token matched in top-k results. */
  docHit: boolean;
  /** Matched count / expected count (0 if no expected docs). */
  recallAtK: number;
  /** Which expected tokens matched (by index). */
  matchedExpectedIndices: number[];
}

export interface AnswerMetrics {
  refusalDetected: boolean;
  /** For mustRefuse cases: true if refusal matches expectation. */
  mustRefuseCorrect: boolean | null;
  /** Cautious procedural template (see `cautiousMarkers.ts`). */
  cautiousProcedural: boolean;
  /** Substrings from expectedFacts found in evidence/answer. */
  factsMatched: string[];
  factsMissing: string[];
  citationHit: boolean | null;
}

export type BenchFailureCategory =
  | "retrieval"
  | "facts"
  | "citation"
  | "refusal"
  | "unexpected_refusal"
  | "answer_mode"
  | "other";

export interface BenchmarkCaseEvalResult {
  case: BenchmarkCaseV1;
  results: SearchResult[];
  answer: ChatAnswer;
  retrieval: RetrievalMetrics;
  answerMetrics: AnswerMetrics;
  passed: boolean;
  failureReasons: string[];
  /** Set when `passed` is false; coarse bucket for triage. */
  failureCategory: BenchFailureCategory | null;
}

export function categorizeFailureReasons(reasons: string[]): BenchFailureCategory {
  const r = reasons.join(" ");
  if (r.includes("expectedAnswerMode") || r.includes("per expectedAnswerMode")) {
    return "answer_mode";
  }
  if (r.includes("Expected document not found")) {
    return "retrieval";
  }
  if (r.includes("Expected refusal-style")) {
    return "refusal";
  }
  if (r.includes("Missing expected facts")) {
    return "facts";
  }
  if (r.includes("Citation fileName")) {
    return "citation";
  }
  if (r.includes("Unexpected refusal")) {
    return "unexpected_refusal";
  }
  return "other";
}

export function summarizeFailureBuckets(results: BenchmarkCaseEvalResult[]): Record<BenchFailureCategory, number> {
  const empty: Record<BenchFailureCategory, number> = {
    retrieval: 0,
    facts: 0,
    citation: 0,
    refusal: 0,
    unexpected_refusal: 0,
    answer_mode: 0,
    other: 0
  };
  for (const row of results) {
    if (row.passed || !row.failureCategory) {
      continue;
    }
    empty[row.failureCategory] += 1;
  }
  return empty;
}

function normalizeMatchToken(token: string): string {
  return token.trim().toLowerCase();
}

function resultMatchesExpectedDoc(result: SearchResult, token: string): boolean {
  const t = normalizeMatchToken(token);
  if (!t) {
    return false;
  }
  const fileName = result.fileName.toLowerCase();
  const documentId = result.documentId.toLowerCase();
  return fileName === t || documentId === t || fileName.includes(t) || documentId.includes(t);
}

export function computeRetrievalMetrics(
  benchmarkCase: BenchmarkCaseV1,
  results: SearchResult[],
  topK: number
): RetrievalMetrics {
  const slice = results.slice(0, topK);
  const expected = benchmarkCase.expectedDocs.map((item) => item.trim()).filter(Boolean);
  if (expected.length === 0) {
    return {
      topK,
      docHit: true,
      recallAtK: 1,
      matchedExpectedIndices: []
    };
  }

  const matchedIndices: number[] = [];
  for (let index = 0; index < expected.length; index += 1) {
    const token = expected[index];
    if (!token) {
      continue;
    }
    const hit = slice.some((result) => resultMatchesExpectedDoc(result, token));
    if (hit) {
      matchedIndices.push(index);
    }
  }

  const recallAtK = matchedIndices.length / expected.length;
  return {
    topK,
    docHit: matchedIndices.length > 0,
    recallAtK,
    matchedExpectedIndices: matchedIndices
  };
}

export function detectRefusal(answer: ChatAnswer): boolean {
  if (answer.citations.length > 0) {
    return false;
  }
  const direct = answer.directAnswer;
  return (
    /could not find grounded evidence/i.test(direct) ||
    /没有找到足够可靠的依据/i.test(direct) ||
    /I could not find grounded evidence/i.test(direct)
  );
}

function combinedEvidenceText(results: SearchResult[], limit: number): string {
  return results
    .slice(0, limit)
    .map((result) => [result.snippet, result.evidenceText ?? "", result.text].join("\n"))
    .join("\n")
    .toLowerCase();
}

export function computeAnswerMetrics(
  benchmarkCase: BenchmarkCaseV1,
  results: SearchResult[],
  answer: ChatAnswer
): AnswerMetrics {
  const refusalDetected = detectRefusal(answer);
  const mustRefuseCorrect: boolean | null = benchmarkCase.mustRefuse ? refusalDetected : null;
  const cautiousProcedural = isCautiousProceduralAnswer(answer);

  const facts = benchmarkCase.expectedFacts ?? [];
  const haystack = `${combinedEvidenceText(results, 5)}\n${answer.directAnswer}`.toLowerCase();
  const factsMatched: string[] = [];
  const factsMissing: string[] = [];
  for (const fact of facts) {
    const normalized = fact.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    if (haystack.includes(normalized)) {
      factsMatched.push(fact);
    } else {
      factsMissing.push(fact);
    }
  }

  let citationHit: boolean | null = null;
  const expectedCitations = benchmarkCase.expectedCitations;
  if (expectedCitations?.fileNameIncludes && expectedCitations.fileNameIncludes.length > 0) {
    const names = answer.citations.map((citation) => citation.fileName.toLowerCase());
    citationHit = expectedCitations.fileNameIncludes.some((needle) =>
      names.some((name) => name.includes(needle.toLowerCase()))
    );
  }

  return {
    refusalDetected,
    mustRefuseCorrect,
    cautiousProcedural,
    factsMatched,
    factsMissing,
    citationHit
  };
}

export function evaluateBenchmarkCase(
  benchmarkCase: BenchmarkCaseV1,
  results: SearchResult[],
  answer: ChatAnswer,
  topK: number
): BenchmarkCaseEvalResult {
  const retrieval = computeRetrievalMetrics(benchmarkCase, results, topK);
  const answerMetrics = computeAnswerMetrics(benchmarkCase, results, answer);
  const failureReasons: string[] = [];

  if (benchmarkCase.mustRefuse) {
    if (!answerMetrics.refusalDetected) {
      failureReasons.push("Expected refusal-style answer (no grounded citations / refusal template).");
    }
  } else {
    if (!retrieval.docHit) {
      failureReasons.push("Expected document not found in top-k retrieval.");
    }
    if (benchmarkCase.expectedFacts && benchmarkCase.expectedFacts.length > 0 && answerMetrics.factsMissing.length > 0) {
      failureReasons.push(`Missing expected facts: ${answerMetrics.factsMissing.join("; ")}`);
    }
    if (benchmarkCase.expectedCitations?.fileNameIncludes && benchmarkCase.expectedCitations.fileNameIncludes.length > 0) {
      if (answerMetrics.citationHit === false) {
        failureReasons.push("Citation fileName expectation not met.");
      }
    }
    const mode = benchmarkCase.expectedAnswerMode;
    if (!(mode === "grounded")) {
      if (answerMetrics.refusalDetected) {
        failureReasons.push("Unexpected refusal-style answer for a non-mustRefuse case.");
      }
    }
  }

  if (benchmarkCase.expectedAnswerMode && !benchmarkCase.mustRefuse) {
    const mode = benchmarkCase.expectedAnswerMode;
    if (mode === "grounded") {
      if (answerMetrics.refusalDetected) {
        failureReasons.push("Expected grounded synthesis (unexpected refusal per expectedAnswerMode).");
      }
      if (answerMetrics.cautiousProcedural) {
        failureReasons.push("Expected grounded synthesis (unexpected cautious procedural per expectedAnswerMode).");
      }
    }
    if (mode === "cautious") {
      if (!answerMetrics.cautiousProcedural) {
        failureReasons.push("Expected cautious procedural answer (expectedAnswerMode).");
      }
    }
    if (mode === "refusal") {
      if (!answerMetrics.refusalDetected) {
        failureReasons.push("Expected refusal-style answer (expectedAnswerMode).");
      }
    }
  }

  const passed = failureReasons.length === 0;

  return {
    case: benchmarkCase,
    results,
    answer,
    retrieval,
    answerMetrics,
    passed,
    failureReasons,
    failureCategory: passed ? null : categorizeFailureReasons(failureReasons)
  };
}

export function summarizeBenchmarkResults(results: BenchmarkCaseEvalResult[]): {
  total: number;
  passed: number;
  failed: number;
  meanRecallAtK: number;
  docHitRate: number;
  mustRefuseCases: number;
  mustRefuseCorrect: number;
} {
  const total = results.length;
  const passed = results.filter((item) => item.passed).length;
  const withDocs = results.filter((item) => item.case.expectedDocs.length > 0);
  const meanRecallAtK =
    withDocs.length === 0 ? 1 : withDocs.reduce((sum, item) => sum + item.retrieval.recallAtK, 0) / withDocs.length;
  const docHitRate = withDocs.length === 0 ? 1 : withDocs.filter((item) => item.retrieval.docHit).length / withDocs.length;

  const mustRefuseCases = results.filter((item) => item.case.mustRefuse);
  const mustRefuseCorrect = mustRefuseCases.filter((item) => item.answerMetrics.mustRefuseCorrect === true).length;

  return {
    total,
    passed,
    failed: total - passed,
    meanRecallAtK,
    docHitRate,
    mustRefuseCases: mustRefuseCases.length,
    mustRefuseCorrect
  };
}
