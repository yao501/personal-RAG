import { parseDocument } from "../src/lib/modules/parse/parseDocument";
import { chunkText } from "../src/lib/modules/chunk/chunkText";
import { searchChunks } from "../src/lib/modules/retrieve/searchIndex";
import type { DocumentRecord } from "../src/lib/shared/types";

const filePath = process.argv[2];
const inspectTerm = process.argv[3];

if (!filePath) {
  console.error("Usage: vite-node scripts/inspectSample.ts <pdf-path>");
  process.exit(1);
}

const parsed = await parseDocument(filePath);
const title = filePath.split("/").at(-1)?.replace(/\.pdf$/i, "") ?? "sample";
const chunks = chunkText("sample-doc", parsed.content, {
  chunkSize: 180,
  chunkOverlap: 40,
  documentTitle: title,
  pageSpans: parsed.pageSpans
});

const document: DocumentRecord = {
  id: "sample-doc",
  filePath,
  fileName: filePath.split("/").at(-1) ?? "sample.pdf",
  title,
  fileType: parsed.fileType,
  content: parsed.content,
  importedAt: new Date("2026-04-09").toISOString(),
  updatedAt: new Date("2026-04-09").toISOString(),
  sourceCreatedAt: new Date("2024-07-31").toISOString(),
  sourceUpdatedAt: new Date("2024-07-31").toISOString(),
  chunkCount: chunks.length
};

const questions = [
  "如何与Macs6系统进行OPC通讯？",
  "如何取消U盘禁用？",
  "通讯站有什么作用？"
];

console.log(`Chunk count: ${chunks.length}`);
if (inspectTerm) {
  console.log(`\n=== Matching chunks for: ${inspectTerm} ===`);
  for (const chunk of chunks.filter((item) => item.text.includes(inspectTerm) || (item.sectionPath ?? "").includes(inspectTerm)).slice(0, 10)) {
    console.log(JSON.stringify({
      chunkIndex: chunk.chunkIndex,
      sectionTitle: chunk.sectionTitle,
      sectionPath: chunk.sectionPath,
      locatorLabel: chunk.locatorLabel,
      text: chunk.text.slice(0, 500)
    }, null, 2));
  }
}

for (const question of questions) {
  const results = searchChunks(question, [document], chunks, 5);
  console.log(`\n=== ${question} ===`);
  for (const result of results.slice(0, 3)) {
    console.log(JSON.stringify({
      sectionTitle: result.sectionTitle,
      sectionPath: result.sectionPath,
      locatorLabel: result.locatorLabel,
      snippet: result.snippet,
      evidenceText: result.evidenceText,
      score: Number(result.score.toFixed(3))
    }, null, 2));
  }
}
