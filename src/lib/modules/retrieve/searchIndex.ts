import type { ChunkRecord, DocumentRecord, SearchResult } from "../../shared/types";
import { tokenize } from "./tokenize";

function termFrequency(tokens: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}

export function searchChunks(
  query: string,
  documents: DocumentRecord[],
  chunks: ChunkRecord[],
  limit = 6
): SearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) {
    return [];
  }

  const chunkTokens = chunks.map((chunk) => tokenize(chunk.text));
  const documentFrequency = new Map<string, number>();

  for (const tokens of chunkTokens) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const totalChunks = Math.max(1, chunks.length);

  return chunks
    .map((chunk, index) => {
      const doc = documents.find((item) => item.id === chunk.documentId);
      if (!doc) {
        return null;
      }

      const tokens = chunkTokens[index];
      const frequencies = termFrequency(tokens);
      let score = 0;

      for (const token of queryTokens) {
        const tf = frequencies.get(token) ?? 0;
        const df = documentFrequency.get(token) ?? 0;
        const idf = Math.log(1 + totalChunks / (1 + df));
        score += tf * idf;
      }

      if (chunk.text.toLowerCase().includes(query.toLowerCase())) {
        score += 1.5;
      }

      if (score <= 0) {
        return null;
      }

      return {
        documentId: chunk.documentId,
        fileName: doc.fileName,
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        snippet: chunk.text.slice(0, 220),
        score,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset
      };
    })
    .filter((item): item is SearchResult => item !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ startOffset: _startOffset, endOffset: _endOffset, ...result }) => result);
}

