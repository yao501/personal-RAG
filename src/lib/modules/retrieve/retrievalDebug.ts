import type { ChatAnswer, SearchResult } from "../../shared/types";
import { isCautiousProceduralAnswer } from "../answer/cautiousMarkers";
import { detectQueryIntent } from "./queryIntent";
import { expandQueryTokens } from "./queryFeatures";

/** Bump when JSON shape changes (for log parsers). */
export const RETRIEVAL_DEBUG_PAYLOAD_SCHEMA_VERSION = 1;

export interface RetrievalDebugPayload {
  schemaVersion: typeof RETRIEVAL_DEBUG_PAYLOAD_SCHEMA_VERSION;
  kind: "pkrag.retrieval";
  question: string;
  /** Same token union as `searchChunks` uses (intent + expansions). */
  effectiveQueryTokens: string[];
  /** Extra tokens from `expandQueryTokens` only (subset of effective union). */
  expandedTokens: string[];
  intentPrimary: string;
  intentWantsSteps: boolean;
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

export function buildQueryRetrievalDebugHints(question: string): {
  effectiveQueryTokens: string[];
  expandedTokens: string[];
  intentPrimary: string;
  intentWantsSteps: boolean;
} {
  const intent = detectQueryIntent(question);
  const expanded = expandQueryTokens(question, intent);
  const effectiveQueryTokens = [...new Set([...intent.queryTokens, ...expanded])];
  return {
    effectiveQueryTokens,
    expandedTokens: expanded,
    intentPrimary: intent.primary,
    intentWantsSteps: intent.wantsSteps
  };
}

export function buildRetrievalDebugPayload(
  question: string,
  vectorChunkIds: string[],
  candidateChunkCount: number,
  results: SearchResult[],
  answer: ChatAnswer,
  searchLimit = 6
): RetrievalDebugPayload {
  const hints = buildQueryRetrievalDebugHints(question);
  return {
    schemaVersion: RETRIEVAL_DEBUG_PAYLOAD_SCHEMA_VERSION,
    kind: "pkrag.retrieval",
    question,
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
