import type { ChatAnswer, SearchResult } from "../../shared/types";
import { isCautiousProceduralAnswer } from "../answer/cautiousMarkers";
import { detectQueryIntent } from "./queryIntent";
import { expandQueryTokens } from "./queryFeatures";
import type { QueryRetrievalType } from "./queryRetrievalType";
import { resolveQueryRetrievalType } from "./queryRetrievalType";

/** Bump when JSON shape changes (for log parsers). v3 adds `queryRetrievalType` (P0-B). */
export const RETRIEVAL_DEBUG_PAYLOAD_SCHEMA_VERSION = 3;

export type VectorRecallBackend = "lancedb" | "memory";
export type RetrievalDebugRuntime = "desktop" | "eval";

export interface RetrievalDebugBuildOptions {
  searchLimit?: number;
  vectorRecallBackend?: VectorRecallBackend;
  runtime?: RetrievalDebugRuntime;
  /** When set (e.g. from `runRetrievalLikeDesktop`), must match pipeline bias input. */
  queryRetrievalType?: QueryRetrievalType;
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
  }>;
  answerCitationChunkIds: string[];
  answerFlags: {
    refusal: boolean;
    cautiousProcedural: boolean;
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
  return {
    schemaVersion: RETRIEVAL_DEBUG_PAYLOAD_SCHEMA_VERSION,
    kind: "pkrag.retrieval",
    question,
    vectorRecallBackend,
    runtime,
    vectorShortlistCount: vectorChunkIds.length,
    candidateChunkCount,
    searchTopK: searchLimit,
    topResults: results.slice(0, searchLimit).map((result) => ({
      chunkId: result.chunkId,
      fileName: result.fileName,
      score: result.score,
      lexicalScore: result.lexicalScore,
      semanticScore: result.semanticScore,
      rerankScore: result.rerankScore,
      qualityScore: result.qualityScore,
      sectionTitle: result.sectionTitle
    })),
    answerCitationChunkIds: answer.citations.map((citation) => citation.chunkId),
    answerFlags: {
      refusal: detectRefusalAnswer(answer),
      cautiousProcedural: isCautiousProceduralAnswer(answer)
    },
    ...hints
  };
}
