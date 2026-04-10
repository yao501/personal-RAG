import { cosineSimilarity, embedTexts } from "../embed/localEmbedder";
import type { ChunkRecord, DocumentRecord, SearchResult } from "../../shared/types";
import { applyFullWorkflowRetrievalBias, injectSprint53aCandidateChunks } from "./fullWorkflowBias";
import { applySprint53cRetrievalBias } from "./sprint53cBias";
import { selectCandidateChunksFromVectors } from "./candidateChunks";
import { searchChunks } from "./searchIndex";

/** Matches `KnowledgeService.askQuestion` default top-k passed to `searchChunks`. */
export const DEFAULT_RETRIEVAL_LIMIT = 6;

/** Matches LanceDB `search` candidate count in `KnowledgeService`. */
export const VECTOR_SHORTLIST_MAX = 24;

function parseChunkEmbedding(chunk: ChunkRecord): number[] | null {
  if (!chunk.embedding) {
    return null;
  }
  try {
    const parsed = JSON.parse(chunk.embedding) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    return parsed as number[];
  } catch {
    return null;
  }
}

/**
 * In-memory stand-in for LanceDB vector recall: rank chunk ids by cosine
 * similarity to the query embedding (same model as the app when embeddings exist).
 */
export function rankChunkIdsByEmbeddingSimilarity(
  chunks: ChunkRecord[],
  queryEmbedding: number[] | null,
  limit: number
): string[] {
  if (!queryEmbedding || queryEmbedding.length === 0) {
    return [];
  }

  const scored = chunks
    .map((chunk) => {
      const vector = parseChunkEmbedding(chunk);
      if (!vector) {
        return null;
      }
      return { id: chunk.id, sim: cosineSimilarity(queryEmbedding, vector) };
    })
    .filter((item): item is { id: string; sim: number } => item !== null)
    .sort((left, right) => right.sim - left.sim)
    .slice(0, limit);

  return scored.map((item) => item.id);
}

/** Populate `chunk.embedding` JSON (same string shape as the app store) for eval/benchmarks. */
export async function hydrateChunkEmbeddingsForEval(chunks: ChunkRecord[]): Promise<ChunkRecord[]> {
  const need = chunks.filter((chunk) => !chunk.embedding);
  if (need.length === 0) {
    return chunks;
  }

  const texts = need.map((chunk) => [chunk.sectionPath, chunk.text].filter(Boolean).join("\n"));
  const vectors = await embedTexts(texts);
  let index = 0;
  return chunks.map((chunk) => {
    if (chunk.embedding) {
      return chunk;
    }
    const vector = vectors[index];
    index += 1;
    return {
      ...chunk,
      embedding: JSON.stringify(vector ?? [])
    };
  });
}

export interface RetrievalPipelineResult {
  results: SearchResult[];
  queryEmbedding: number[] | null;
  vectorChunkIds: string[];
  candidateChunks: ChunkRecord[];
}

/**
 * End-to-end retrieval aligned with the desktop path: query embedding → vector
 * shortlist → lexical merge → `searchChunks` with the same `limit` and embedding
 * signal as production (LanceDB replaced by in-memory similarity when ids are computed here).
 */
export interface RunRetrievalLikeDesktopOptions {
  /** Passed to `searchChunks` (default {@link DEFAULT_RETRIEVAL_LIMIT}). */
  limit?: number;
  /** When true (default), embed chunk text before vector shortlist. */
  hydrateEmbeddings?: boolean;
  /**
   * Sprint 5.3a/5.3b: when false, skip `applyFullWorkflowRetrievalBias` (ablation Group C).
   * Default true.
   */
  sprint53aRetrievalBias?: boolean;
  /**
   * Sprint 5.3a/5.3b: when false, skip `injectSprint53aCandidateChunks` (ablation Group B).
   * Default true.
   */
  sprint53aCandidateInject?: boolean;
  /** Sprint 5.3c：多卷手册路由 + 全流程噪声惩罚（默认 true）。 */
  sprint53cRetrievalBias?: boolean;
}

export async function runRetrievalLikeDesktop(
  question: string,
  documents: DocumentRecord[],
  chunks: ChunkRecord[],
  options: RunRetrievalLikeDesktopOptions = {}
): Promise<RetrievalPipelineResult> {
  const limit = options.limit ?? DEFAULT_RETRIEVAL_LIMIT;
  const hydrate = options.hydrateEmbeddings !== false;
  const useBias = options.sprint53aRetrievalBias !== false;
  const useInject = options.sprint53aCandidateInject !== false;
  const use53c = options.sprint53cRetrievalBias !== false;

  let working = chunks;
  if (hydrate) {
    try {
      working = await hydrateChunkEmbeddingsForEval(chunks);
    } catch {
      working = chunks;
    }
  }

  let queryEmbedding: number[] | null = null;
  try {
    const [vector] = await embedTexts([question]);
    queryEmbedding = vector ?? null;
  } catch {
    queryEmbedding = null;
  }

  const vectorChunkIds = rankChunkIdsByEmbeddingSimilarity(working, queryEmbedding, VECTOR_SHORTLIST_MAX);
  const candidateChunks = selectCandidateChunksFromVectors(question, documents, working, vectorChunkIds);
  let results = searchChunks(question, documents, candidateChunks, limit, queryEmbedding);
  if (useBias) {
    results = applyFullWorkflowRetrievalBias(question, results);
  }
  if (useInject) {
    results = injectSprint53aCandidateChunks(question, results, candidateChunks, documents, limit, working);
  }
  if (use53c) {
    results = applySprint53cRetrievalBias(question, results);
  }

  return {
    results,
    queryEmbedding,
    vectorChunkIds,
    candidateChunks
  };
}
