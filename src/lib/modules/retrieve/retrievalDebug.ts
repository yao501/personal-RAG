import type { AnswerEvidenceMode, AnswerEvidenceReasonCode, ChatAnswer, SearchResult } from "../../shared/types";
import { isCautiousProceduralAnswer } from "../answer/cautiousMarkers";
import { detectQueryIntent } from "./queryIntent";
import { expandQueryTokens } from "./queryFeatures";
import type { QueryRetrievalType } from "./queryRetrievalType";
import { resolveQueryRetrievalType } from "./queryRetrievalType";

/** Bump when JSON shape changes (for log parsers). v5 adds candidate/result selection reason summaries. */
export const RETRIEVAL_DEBUG_PAYLOAD_SCHEMA_VERSION = 5;

export type VectorRecallBackend = "lancedb" | "memory";
export type RetrievalDebugRuntime = "desktop" | "eval";

export interface RetrievalDebugBuildOptions {
  searchLimit?: number;
  vectorRecallBackend?: VectorRecallBackend;
  runtime?: RetrievalDebugRuntime;
  /** When set (e.g. from `runRetrievalLikeDesktop`), must match pipeline bias input. */
  queryRetrievalType?: QueryRetrievalType;
  /** Optional selected candidate ids from the vector+lexical merge stage. */
  candidateChunkIds?: string[];
}

export interface RetrievalDebugPayload {
  schemaVersion: typeof RETRIEVAL_DEBUG_PAYLOAD_SCHEMA_VERSION;
  kind: "pkrag.retrieval";
  question: string;
  /** Desktop uses LanceDB ANN; eval runner uses in-memory cosine on chunk embeddings (see docs/EVAL_GUIDE.md). */
  vectorRecallBackend: VectorRecallBackend;
  /** Where the log line was emitted. */
  runtime: RetrievalDebugRuntime;
  /** Same token union as `searchChunks` uses (intent + expansions). */
  effectiveQueryTokens: string[];
  /** Extra tokens from `expandQueryTokens` only (subset of effective union). */
  expandedTokens: string[];
  intentPrimary: string;
  intentWantsSteps: boolean;
  /** Coarse retrieval bucket for bias + logs (P0-B B1). */
  queryRetrievalType: QueryRetrievalType;
  vectorShortlistCount: number;
  candidateChunkCount: number;
  candidateSelection?: {
    mode: "all_chunks_no_vector" | "hybrid_vector_lexical" | "hybrid_vector_only_or_unknown";
    vectorRecallCount: number;
    candidateChunkCount: number;
    lexicalFallbackCount: number | null;
    candidateCoverageRatio: number | null;
  };
  /** `searchChunks` limit (desktop default 6). */
  searchTopK: number;
  topResults: Array<{
    chunkId: string;
    fileName: string;
    score: number;
    lexicalScore: number;
    semanticScore: number;
    rerankScore: number;
    qualityScore: number;
    sectionTitle: string | null;
    vectorHit: boolean;
    selectionReasons: string[];
    citationStatus: "cited" | "not_cited";
    notCitedReason: string | null;
  }>;
  answerCitationChunkIds: string[];
  answerFlags: {
    refusal: boolean;
    cautiousProcedural: boolean;
  };
  evidenceDecision?: {
    mode: AnswerEvidenceMode;
    reasonCode: AnswerEvidenceReasonCode;
    reason: string;
    citedChunkCount: number;
    sourceDocumentCount: number;
  };
}

function buildCandidateSelectionSummary(
  vectorChunkIds: string[],
  candidateChunkCount: number,
  candidateChunkIds?: string[]
): RetrievalDebugPayload["candidateSelection"] {
  if (vectorChunkIds.length === 0) {
    return {
      mode: "all_chunks_no_vector",
      vectorRecallCount: 0,
      candidateChunkCount,
      lexicalFallbackCount: candidateChunkCount,
      candidateCoverageRatio: candidateChunkIds ? 1 : null
    };
  }

  if (!candidateChunkIds) {
    return {
      mode: "hybrid_vector_only_or_unknown",
      vectorRecallCount: vectorChunkIds.length,
      candidateChunkCount,
      lexicalFallbackCount: null,
      candidateCoverageRatio: null
    };
  }

  const vectorSet = new Set(vectorChunkIds);
  const vectorCandidateCount = candidateChunkIds.filter((id) => vectorSet.has(id)).length;
  const lexicalFallbackCount = Math.max(0, candidateChunkIds.length - vectorCandidateCount);

  return {
    mode: lexicalFallbackCount > 0 ? "hybrid_vector_lexical" : "hybrid_vector_only_or_unknown",
    vectorRecallCount: vectorChunkIds.length,
    candidateChunkCount,
    lexicalFallbackCount,
    candidateCoverageRatio: vectorChunkIds.length > 0 ? vectorCandidateCount / vectorChunkIds.length : null
  };
}

function buildTopResultSelectionReasons(
  result: SearchResult,
  vectorHit: boolean,
  cited: boolean,
  answer: ChatAnswer
): { selectionReasons: string[]; citationStatus: "cited" | "not_cited"; notCitedReason: string | null } {
  const reasons: string[] = [];
  if (vectorHit) reasons.push("vector_shortlist_hit");
  if (result.lexicalScore >= 2.0) reasons.push("strong_lexical_match");
  if (result.semanticScore >= 0.55) reasons.push("semantic_match");
  if (result.rerankScore >= 1.0) reasons.push("rerank_signal");
  if (result.qualityScore >= 1.0) reasons.push("high_quality_chunk");
  if (result.qualityScore < 0) reasons.push("low_quality_penalty");
  if (result.sectionTitle || result.sectionPath) reasons.push("section_metadata_present");
  if (result.evidenceText && result.evidenceText.trim().length > 0) reasons.push("sentence_evidence_selected");
  if (cited) reasons.push("selected_for_citation");

  let notCitedReason: string | null = null;
  if (!cited) {
    if (answer.citations.length === 0) {
      notCitedReason = "answer_refused_or_no_citations";
    } else if (result.score < Math.max(0, answer.citations[0]?.score ?? 0) * 0.72) {
      notCitedReason = "lower_score_than_selected_evidence";
    } else {
      notCitedReason = "not_selected_by_answer_evidence_filter";
    }
  }

  return {
    selectionReasons: reasons,
    citationStatus: cited ? "cited" : "not_cited",
    notCitedReason
  };
}

function detectRefusalAnswer(answer: ChatAnswer): boolean {
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

export function buildQueryRetrievalDebugHints(
  question: string,
  queryRetrievalTypeOverride?: QueryRetrievalType
): {
  effectiveQueryTokens: string[];
  expandedTokens: string[];
  intentPrimary: string;
  intentWantsSteps: boolean;
  queryRetrievalType: QueryRetrievalType;
} {
  const intent = detectQueryIntent(question);
  const expanded = expandQueryTokens(question, intent);
  const effectiveQueryTokens = [...new Set([...intent.queryTokens, ...expanded])];
  return {
    effectiveQueryTokens,
    expandedTokens: expanded,
    intentPrimary: intent.primary,
    intentWantsSteps: intent.wantsSteps,
    queryRetrievalType: queryRetrievalTypeOverride ?? resolveQueryRetrievalType(question)
  };
}

export function buildRetrievalDebugPayload(
  question: string,
  vectorChunkIds: string[],
  candidateChunkCount: number,
  results: SearchResult[],
  answer: ChatAnswer,
  options?: RetrievalDebugBuildOptions
): RetrievalDebugPayload {
  const searchLimit = options?.searchLimit ?? 6;
  const vectorRecallBackend = options?.vectorRecallBackend ?? "lancedb";
  const runtime = options?.runtime ?? "desktop";
  const hints = buildQueryRetrievalDebugHints(question, options?.queryRetrievalType);
  const vectorSet = new Set(vectorChunkIds);
  const citedSet = new Set(answer.citations.map((citation) => citation.chunkId));
  return {
    schemaVersion: RETRIEVAL_DEBUG_PAYLOAD_SCHEMA_VERSION,
    kind: "pkrag.retrieval",
    question,
    vectorRecallBackend,
    runtime,
    vectorShortlistCount: vectorChunkIds.length,
    candidateChunkCount,
    candidateSelection: buildCandidateSelectionSummary(vectorChunkIds, candidateChunkCount, options?.candidateChunkIds),
    searchTopK: searchLimit,
    topResults: results.slice(0, searchLimit).map((result) => {
      const vectorHit = vectorSet.has(result.chunkId);
      const cited = citedSet.has(result.chunkId);
      const reasonSummary = buildTopResultSelectionReasons(result, vectorHit, cited, answer);
      return {
        chunkId: result.chunkId,
        fileName: result.fileName,
        score: result.score,
        lexicalScore: result.lexicalScore,
        semanticScore: result.semanticScore,
        rerankScore: result.rerankScore,
        qualityScore: result.qualityScore,
        sectionTitle: result.sectionTitle,
        vectorHit,
        ...reasonSummary
      };
    }),
    answerCitationChunkIds: answer.citations.map((citation) => citation.chunkId),
    answerFlags: {
      refusal: detectRefusalAnswer(answer),
      cautiousProcedural: isCautiousProceduralAnswer(answer)
    },
    ...(answer.evidenceDecision
      ? {
          evidenceDecision: {
            mode: answer.evidenceDecision.mode,
            reasonCode: answer.evidenceDecision.reasonCode,
            reason: answer.evidenceDecision.reason,
            citedChunkCount: answer.evidenceDecision.signals.citedChunkCount,
            sourceDocumentCount: answer.evidenceDecision.signals.sourceDocumentCount
          }
        }
      : {}),
    ...hints
  };
}
