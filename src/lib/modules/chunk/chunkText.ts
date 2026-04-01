import type { ChunkRecord } from "../../shared/types";
import { createStableId } from "../core/id";

export interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
}

export function chunkText(
  documentId: string,
  text: string,
  options: ChunkOptions
): ChunkRecord[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const words = normalized.split(/\s+/);
  const chunks: ChunkRecord[] = [];
  let cursor = 0;
  let chunkIndex = 0;
  let searchOffset = 0;

  while (cursor < words.length) {
    const slice = words.slice(cursor, cursor + options.chunkSize);
    const chunkTextValue = slice.join(" ");
    const matchedOffset = normalized.indexOf(chunkTextValue, searchOffset);
    const startOffset = matchedOffset >= 0 ? matchedOffset : searchOffset;
    const endOffset = startOffset + chunkTextValue.length;

    chunks.push({
      id: createStableId(`${documentId}:${chunkIndex}:${chunkTextValue}`),
      documentId,
      text: chunkTextValue,
      chunkIndex,
      startOffset,
      endOffset,
      tokenCount: slice.length
    });

    searchOffset = Math.max(searchOffset, startOffset + 1);

    if (cursor + options.chunkSize >= words.length) {
      break;
    }

    cursor += Math.max(1, options.chunkSize - options.chunkOverlap);
    chunkIndex += 1;
  }

  return chunks;
}
