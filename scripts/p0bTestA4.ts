/** P0-B: test A4 answer with debug logging */
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "../src/lib/modules/parse/parseDocument";
import { chunkText } from "../src/lib/modules/chunk/chunkText";
import { answerQuestion } from "../src/lib/modules/answer/answerQuestion";
import { runRetrievalLikeDesktop } from "../src/lib/modules/retrieve/retrievalPipeline";

const dir = process.env.PKRAG_REALPDF_DIR!;
const names = fs.readdirSync(dir, { withFileTypes: true })
  .filter(d => d.isFile() && d.name.endsWith(".pdf"))
  .map(d => d.name).filter(n => /手册[34]_/.test(n)).sort();

const docs: any[] = []; const chs: any[] = [];
for (const name of names) {
  const parsed = await parseDocument(path.join(dir, name));
  const dc = chunkText(name.slice(0,40), parsed.content, { chunkSize:260, chunkOverlap:60, documentTitle:name.replace(".pdf",""), pageSpans:parsed.pageSpans });
  docs.push({ id:name.slice(0,40), filePath:path.join(dir,name), fileName:name, title:name.replace(".pdf",""), fileType:parsed.fileType, content:parsed.content, importedAt:new Date().toISOString(), updatedAt:new Date().toISOString(), sourceCreatedAt:new Date().toISOString(), sourceUpdatedAt:new Date().toISOString(), chunkCount:dc.length });
  chs.push(...dc);
}

const q = "MACS V6.5 的仿真功能和在线调试功能有什么区别？分别在哪本手册中说明？使用仿真前需要完成哪些前置步骤？";
const { results } = await runRetrievalLikeDesktop(q, docs, chs, { limit:5, hydrateEmbeddings:true });

console.log("top-3 sectionTitles:", results.slice(0,3).map(r => r.sectionTitle));
console.log("top-3 qualityScores:", results.slice(0,3).map(r => r.qualityScore?.toFixed(2)));

const answer = answerQuestion(q, results);
console.log("\n=== ANSWER ===");
console.log("directAnswer:", answer.directAnswer.slice(0, 500));
console.log("sourceDocCount:", answer.sourceDocumentCount);
console.log("citations:", answer.citations.length);
