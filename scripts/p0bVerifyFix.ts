/** P0-B 验证：修复后 A4 检索效果 */
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "../src/lib/modules/parse/parseDocument";
import { chunkText } from "../src/lib/modules/chunk/chunkText";
import { answerQuestion } from "../src/lib/modules/answer/answerQuestion";
import { runRetrievalLikeDesktop, DEFAULT_RETRIEVAL_LIMIT } from "../src/lib/modules/retrieve/retrievalPipeline";
import { truncateSnippetPreservingIdentifiers } from "../src/lib/modules/citation/snippetTruncate";

const dir = process.env.PKRAG_REALPDF_DIR!;

const names = fs.readdirSync(dir, { withFileTypes: true })
  .filter(d => d.isFile() && d.name.endsWith(".pdf"))
  .map(d => d.name)
  .filter(n => /手册[2-4]_/.test(n)).sort();

const docs: any[] = [];
const chs: any[] = [];

for (const name of names) {
  const parsed = await parseDocument(path.join(dir, name));
  const docChunks = chunkText(`${name.slice(0,40)}`, parsed.content, {
    chunkSize: 260, chunkOverlap: 60,
    documentTitle: name.replace(".pdf", ""),
    pageSpans: parsed.pageSpans
  });
  docs.push({
    id: name.slice(0,40), filePath: path.join(dir, name), fileName: name,
    title: name.replace(".pdf", ""), fileType: parsed.fileType,
    content: parsed.content, importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(), sourceCreatedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(), chunkCount: docChunks.length
  });
  chs.push(...docChunks);
}

const questions = [
  "MACS V6.5 的仿真功能和在线调试功能有什么区别？分别在哪本手册中说明？使用仿真前需要完成哪些前置步骤？",
  "在 HOLLiAS MACS V6.5 中，工程组态完成后，编译和下装的完整流程是怎样的？需要分别在哪些软件中进行编译操作？",
  "MACS V6.5 工程编译完成后，下装操作需要将文件下发到哪些目标站？"
];

const results: any[] = [];

for (const q of questions) {
  const { results: sr } = await runRetrievalLikeDesktop(q, docs, chs, {
    limit: DEFAULT_RETRIEVAL_LIMIT, hydrateEmbeddings: true
  });
  const answer = answerQuestion(q, sr);
  console.log(`\n=== Q: ${q.slice(0,60)}... ===`);
  console.log(`Answer: ${answer.directAnswer.slice(0,250)}`);
  console.log(`Citations (top3):`);
  sr.slice(0, 3).forEach((r, i) =>
    console.log(`  [${i}] ${r.fileName} | ${r.sectionTitle || "(none)"} | score=${r.score?.toFixed(1)} | "${r.snippet?.slice(0,80)}"`)
  );
}
