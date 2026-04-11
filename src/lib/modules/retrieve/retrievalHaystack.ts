import type { ChunkRecord } from "../../shared/types";

/**
 * Text used for lexical tokenization and phrase matching on a chunk, so keywords
 * that only appear in the section heading (common for PDFs where the heading is
 * stored in `sectionTitle` but not repeated in `text`) still contribute to TF/IDF
 * and reranking.
 *
 * **Order (fixed):** `sectionTitle` → `sectionPath` → `text`
 * - Headings are first so tokens from titles participate in the same tokenize()
 *   pass as body tokens for `searchChunks` lexical scoring.
 * - `sectionPath` carries hierarchy cues (e.g. chapter > section) before body.
 *
 * Document-level fields (`document.title`, `fileName`) are *not* included here;
 * use `getChunkContext` in `searchIndex.ts` when the full document + chunk
 * context is needed for semantic overlap and penalties.
 */
export function retrievalHaystack(chunk: ChunkRecord): string {
  return [chunk.sectionTitle, chunk.sectionPath, chunk.text].filter(Boolean).join("\n");
}
