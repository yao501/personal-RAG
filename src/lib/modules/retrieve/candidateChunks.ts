import type { ChunkRecord, DocumentRecord } from "../../shared/types";
import { tokenize } from "./tokenize";

/**
 * Merges LanceDB (or in-memory) vector recall with a lexical fallback so hybrid
 * retrieval does not miss obvious keyword hits. Same behavior as the desktop app.
 */
export function selectCandidateChunksFromVectors(
  question: string,
  documents: DocumentRecord[],
  chunks: ChunkRecord[],
  vectorChunkIds: string[]
): ChunkRecord[] {
  if (vectorChunkIds.length === 0) {
    return chunks;
  }

  const documentMap = new Map(documents.map((document) => [document.id, document]));
  const vectorSet = new Set(vectorChunkIds);
  const queryTokens = tokenize(question).filter((token) => token.length >= 2);
  const lexicalFallback = chunks.filter((chunk) => {
    const document = documentMap.get(chunk.documentId);
    const haystack = [document?.title, document?.fileName, chunk.sectionTitle, chunk.sectionPath, chunk.text]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    const matched = queryTokens.filter((token) => haystack.includes(token.toLowerCase())).length;
    return matched >= Math.min(2, queryTokens.length);
  });

  const candidateIds = new Set([...vectorChunkIds, ...lexicalFallback.map((chunk) => chunk.id)]);
  const candidates = chunks.filter((chunk) => candidateIds.has(chunk.id));
  return candidates.length > 0 ? candidates : chunks;
}
