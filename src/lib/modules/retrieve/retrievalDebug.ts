import type { ChatAnswer, SearchResult } from "../../shared/types";

export interface RetrievalDebugPayload {
  kind: "pkrag.retrieval";
  question: string;
  vectorShortlistCount: number;
  candidateChunkCount: number;
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
}

export function buildRetrievalDebugPayload(
  question: string,
  vectorChunkIds: string[],
  candidateChunkCount: number,
  results: SearchResult[],
  answer: ChatAnswer
): RetrievalDebugPayload {
  return {
    kind: "pkrag.retrieval",
    question,
    vectorShortlistCount: vectorChunkIds.length,
    candidateChunkCount,
    topResults: results.slice(0, 12).map((result) => ({
      chunkId: result.chunkId,
      fileName: result.fileName,
      score: result.score,
      lexicalScore: result.lexicalScore,
      semanticScore: result.semanticScore,
      rerankScore: result.rerankScore,
      qualityScore: result.qualityScore,
      sectionTitle: result.sectionTitle
    })),
    answerCitationChunkIds: answer.citations.map((citation) => citation.chunkId)
  };
}
