/**
 * 单题：仅跑 M7-6
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunkText } from "../src/lib/modules/chunk/chunkText";
import { parseDocument } from "../src/lib/modules/parse/parseDocument";
import { answerQuestion } from "../src/lib/modules/answer/answerQuestion";
import { buildRetrievalDebugPayload } from "../src/lib/modules/retrieve/retrievalDebug";
import { DEFAULT_RETRIEVAL_LIMIT, runRetrievalLikeDesktop } from "../src/lib/modules/retrieve/retrievalPipeline";
import { truncateSnippetPreservingIdentifiers } from "../src/lib/modules/citation/snippetTruncate";
import type { ChunkRecord, DocumentRecord } from "../src/lib/shared/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function need(c: boolean, m: string[], ms: string[], ok: string, bad: string) { c ? m.push(ok) : ms.push(bad); }

function judge(direct: string, full: string, keywords: string[]) {
  const t = `${direct}\n${full}`;
  const matched: string[] = [], missed: string[] = [];
  for (const kw of keywords) need(t.includes(kw), matched, missed, `提到${kw}`, `未提及${kw}`);
  need(direct.length > 20 || full.length > 80, matched, missed, "有实质回答内容", "回答过于简短/空泛");
  const r = matched.length / (matched.length + missed.length);
  return { verdict: r >= 0.8 ? "pass" : r >= 0.5 ? "partial" : "fail", score: r >= 0.8 ? 1 : r >= 0.5 ? 0.5 : 0, matched, missed };
}

async function main() {
  const dir = process.env.PKRAG_REALPDF_DIR?.trim();
  if (!dir) { console.error("PKRAG_REALPDF_DIR missing"); process.exit(1); }
  const resultsDir = path.join(repoRoot, "evals", "results");
  const dateStr = new Date().toISOString().slice(0, 10);

  const pdfName = "HOLLiAS_MACS_V6.5用户手册7_功能块.pdf";
  const abs = path.join(dir, pdfName);
  console.log(`📖 加载 ${pdfName}...`);
  const parsed = await parseDocument(abs);
  const docId = `v65-${pdfName.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 56)}`;
  const docChunks = chunkText(docId, parsed.content, { chunkSize: 260, chunkOverlap: 60, documentTitle: pdfName, pageSpans: parsed.pageSpans });
  const documents: DocumentRecord[] = [{ id: docId, filePath: abs, fileName: pdfName, title: pdfName, fileType: parsed.fileType, content: parsed.content, importedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sourceCreatedAt: new Date().toISOString(), sourceUpdatedAt: new Date().toISOString(), chunkCount: docChunks.length }];
  const chunks: ChunkRecord[] = [...docChunks];
  console.log(`  → ${chunks.length} chunks`);

  const def = { id: "M7-6", question: "MACS V6.5 控制运算中，MOTCTRL（马达控制）和 VALCTRL（阀门控制）功能块各自的作用是什么？它们分别有哪些关键参数？如何配置电机或阀门的反馈信号？", keywords: ["MOTCTRL", "VALCTRL", "马达", "阀门"] };

  console.log(`\n🔍 ${def.id}: ${def.question.slice(0,80)}...`);
  const start = Date.now();
  const { results } = await runRetrievalLikeDesktop(def.question, documents, chunks, { limit: DEFAULT_RETRIEVAL_LIMIT, hydrateEmbeddings: true });
  const answer = answerQuestion(def.question, results);
  const debug = buildRetrievalDebugPayload(def.question, [], 0, results, answer, { searchLimit: DEFAULT_RETRIEVAL_LIMIT, vectorRecallBackend: "memory", runtime: "eval", queryRetrievalType: "vector" });
  const elapsed = Date.now() - start;

  const j = judge(answer.directAnswer, answer.answer, def.keywords);
  const emoji = j.verdict === "pass" ? "✅" : j.verdict === "partial" ? "⚠️" : "❌";
  console.log(`  ${emoji} ${j.verdict.toUpperCase()} | +${j.matched.join(", ")} | -${j.missed.join(", ")} | ${(elapsed/1000).toFixed(0)}s`);

  const result = {
    source_question_id: def.id, question: def.question, type: "定义型", volume: "手册7_功能块",
    citation_file_names: [...new Set(answer.citations.map(c=>c.fileName))],
    top_section_hints: (debug as any).topResults?.slice(0,3).map((x:any)=>({file:x.fileName,section:x.sectionTitle})),
    direct_answer: answer.directAnswer, model_answer: answer.answer,
    model_citations: answer.citations.map(c=>({chunkId:c.chunkId,fileName:c.fileName,snippet:truncateSnippetPreservingIdentifiers(c.snippet??"",360)})),
    judge_verdict: j.verdict, judge_score: j.score, judge_matched: j.matched, judge_missed: j.missed,
    fail_stage_hint: j.verdict === "fail" ? "retrieval" : null, elapsed_ms: elapsed
  };

  fs.writeFileSync(path.join(resultsDir, `p0b-full-coverage-run-${dateStr}-B06.json`), JSON.stringify(result, null, 2), "utf-8");
  console.log("  → 已写入 B06.json");
}
main().catch(e => { console.error(e); process.exit(1); });
