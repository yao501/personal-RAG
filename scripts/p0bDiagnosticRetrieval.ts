/** P0-B 检索诊断：仿真关键词检索质量 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "../src/lib/modules/parse/parseDocument";
import { chunkText } from "../src/lib/modules/chunk/chunkText";
import { runRetrievalLikeDesktop } from "../src/lib/modules/retrieve/retrievalPipeline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = process.env.PKRAG_REALPDF_DIR!;

// 只加载手册3/4
const names = fs.readdirSync(dir, { withFileTypes: true })
  .filter(d => d.isFile() && d.name.endsWith(".pdf"))
  .map(d => d.name)
  .filter(n => /手册[34]_/.test(n)).sort();

const docs: any[] = [];
const chs: any[] = [];

for (const name of names) {
  const parsed = await parseDocument(path.join(dir, name));
  const docId = name.slice(0, 40);
  const docChunks = chunkText(docId, parsed.content, {
    chunkSize: 260, chunkOverlap: 60,
    documentTitle: name.replace(".pdf", ""),
    pageSpans: parsed.pageSpans
  });
  docs.push({
    id: docId, filePath: path.join(dir, name), fileName: name, title: name.replace(".pdf", ""),
    fileType: parsed.fileType, content: parsed.content,
    importedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    sourceCreatedAt: new Date().toISOString(), sourceUpdatedAt: new Date().toISOString(),
    chunkCount: docChunks.length
  });
  chs.push(...docChunks);
}

const q = "MACS V6.5 的仿真功能和在线调试功能有什么区别？分别在哪本手册中说明？使用仿真前需要完成哪些前置步骤？";
const q2 = "MACS V6.5 如何进行仿真？"; // 简化问法

console.log("=== 原问法 ===");
await runAndPrint(q, docs, chs);

console.log("\n=== 简化问法 ===");
await runAndPrint(q2, docs, chs);

async function runAndPrint(question: string, documents: any[], chunks: any[]) {
  const { results } = await runRetrievalLikeDesktop(question, documents, chunks, { limit: 10, hydrateEmbeddings: true });
  results.slice(0, 5).forEach((r, i) => {
    console.log(`\n[${i}] doc=${r.fileName} | section=${r.sectionTitle} | score=${r.score?.toFixed(2)}`);
    console.log(`  snippet: ${(r.snippet || "").slice(0, 120)}`);
  });
}
