import fs from "node:fs";
import path from "node:path";
import { chunkText } from "../src/lib/modules/chunk/chunkText";
import { parseDocument } from "../src/lib/modules/parse/parseDocument";
import { searchChunks } from "../src/lib/modules/retrieve/searchIndex";
import type { DocumentRecord, SupportedFileType } from "../src/lib/shared/types";

const filePath = process.argv[2];
const query = process.argv[3] ?? "";

if (!filePath) {
  console.error("Usage: vite-node scripts/previewChunks.ts <file-path> [query]");
  process.exit(1);
}

async function loadDocument(file: string): Promise<{ fileType: SupportedFileType; content: string }> {
  const extension = path.extname(file).toLowerCase();
  if (!extension) {
    return {
      fileType: "txt",
      content: fs.readFileSync(file, "utf8")
    };
  }

  return parseDocument(file);
}

const parsed = await loadDocument(filePath);
const title = path.basename(filePath, path.extname(filePath)) || path.basename(filePath);
const chunks = chunkText("preview-doc", parsed.content, {
  chunkSize: 180,
  chunkOverlap: 40,
  documentTitle: title,
  pageSpans: parsed.pageSpans
});

console.log(`File type: ${parsed.fileType}`);
console.log(`Chunk count: ${chunks.length}`);

for (const chunk of chunks.slice(0, 12)) {
  console.log("\n---");
  console.log(JSON.stringify({
    chunkIndex: chunk.chunkIndex,
    sectionTitle: chunk.sectionTitle,
    sectionPath: chunk.sectionPath,
    locatorLabel: chunk.locatorLabel,
    text: chunk.text.slice(0, 320)
  }, null, 2));
}

if (query) {
  const document: DocumentRecord = {
    id: "preview-doc",
    filePath,
    fileName: path.basename(filePath),
    title,
    fileType: parsed.fileType,
    content: parsed.content,
    importedAt: new Date("2026-04-09").toISOString(),
    updatedAt: new Date("2026-04-09").toISOString(),
    sourceCreatedAt: new Date("2026-04-09").toISOString(),
    sourceUpdatedAt: new Date("2026-04-09").toISOString(),
    chunkCount: chunks.length
  };

  const results = searchChunks(query, [document], chunks, 5);
  console.log(`\n=== Query: ${query} ===`);
  for (const result of results.slice(0, 5)) {
    console.log(JSON.stringify({
      sectionTitle: result.sectionTitle,
      sectionPath: result.sectionPath,
      locatorLabel: result.locatorLabel,
      evidenceText: result.evidenceText,
      snippet: result.snippet,
      score: Number(result.score.toFixed(3))
    }, null, 2));
  }
}
