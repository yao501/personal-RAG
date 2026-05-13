/**
 * P0-A Round 2 partial re-run: N7, N8, N9 only
 * Based on p0aNewTypesEval.ts patterns
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
const resultsDir = path.join(repoRoot, "evals", "results");

const ONLY_IDS = new Set(["N7", "N8", "N9"]);

const QUESTIONS: [string, string][] = [
  ["N7", "MACS V6.5 中，什么情况下需要进行全编译？全编译和增量编译各适用于什么场景？触发全编译的条件有哪些？"],
  ["N8", "MACS V6.5 增量编译的前提条件是什么？修改了哪些内容时会触发增量编译而不是全编译？增量编译相比全编译有什么优势和限制？"],
  ["N9", "MACS V6.5 中，在线修改值和下装修改各适用于什么场景？如果在运行过程中修改了在线值，之后进行下装操作时这些在线值会怎样？参数对齐功能在这个场景中起什么作用？"],
];

const PDF_DIR = process.env.PKRAG_REALPDF_DIR;
if (!PDF_DIR) { console.error("请设置 PKRAG_REALPDF_DIR"); process.exit(1); }

type JudgeResult = { verdict: string; score: number; matched: string[]; missed: string[]; fail_modes: string[] };

function judgeN7(answer: string, refs: string[]): JudgeResult {
  const matched: string[] = [];
  const missed: string[] = [];
  if (/全编译|FULL_COMPILE/.test(answer)) matched.push("提到全编译");
  else missed.push("未提及全编译");
  if (/增量编译|ADD_COMPILE/.test(answer)) matched.push("提到增量编译");
  else missed.push("未提及增量编译");
  if (/首次|增删|硬件|系统异常|场景|适用/.test(answer)) matched.push("描述适用场景");
  else missed.push("场景描述不充分");
  if (/条件|触发|情况/.test(answer)) matched.push("涉及触发条件");
  else missed.push("触发条件不充分");
  const score = matched.length / Math.max(1, matched.length + missed.length);
  return { verdict: score >= 0.8 ? "pass" : score >= 0.5 ? "partial" : "fail", score, matched, missed, fail_modes: [] };
}

function judgeN8(answer: string, refs: string[]): JudgeResult {
  const matched: string[] = [];
  const missed: string[] = [];
  if (/增量编译|ADD_COMPILE/.test(answer)) matched.push("提到增量编译");
  else missed.push("未提及增量编译");
  if (/前提|条件|正常|无异常|系统异常/.test(answer)) matched.push("涉及前提条件");
  else missed.push("未提前提条件");
  if (/触发|修改|变更|什么.*触发/.test(answer)) matched.push("涉及触发场景");
  else missed.push("未涉及触发场景");
  if (/优势|优势|速度快|效率|限制|不能|无法/.test(answer)) matched.push("涉及优势/限制");
  else missed.push("未涉及优势/限制");
  const score = matched.length / Math.max(1, matched.length + missed.length);
  return { verdict: score >= 0.8 ? "pass" : score >= 0.5 ? "partial" : "fail", score, matched, missed, fail_modes: [] };
}

function judgeN9(answer: string, refs: string[]): JudgeResult {
  const matched: string[] = [];
  const missed: string[] = [];
  if (/在线修改|在线值/.test(answer)) matched.push("提到在线修改");
  else missed.push("未提及在线修改值");
  if (/下装修改|下装/.test(answer)) matched.push("提到下装修改");
  else missed.push("未提及下装修改");
  if (/场景|适用|调试|临时|永久|停机|重启/.test(answer)) matched.push("涉及场景区分");
  else missed.push("缺少场景区分");
  if (/参数对齐/.test(answer)) matched.push("涉及参数对齐作用");
  else missed.push("未提参数对齐");
  const score = matched.length / Math.max(1, matched.length + missed.length);
  return { verdict: score >= 0.8 ? "pass" : score >= 0.5 ? "partial" : "fail", score, matched, missed, fail_modes: [] };
}

const JUDGE_FN: Record<string, (answer: string, refs: string[]) => JudgeResult> = {
  N7: judgeN7, N8: judgeN8, N9: judgeN9,
};

async function loadCorpus(dir: string): Promise<{ documents: DocumentRecord[]; chunks: ChunkRecord[] }> {
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".pdf"))
    .map((d) => d.name)
    .filter((n) => /^HOLLiAS_MACS_V6\.5用户手册[1-46]_.+\.pdf$/i.test(n))
    .sort();
  if (names.length === 0) throw new Error(`未找到文件：${dir}`);
  const documents: DocumentRecord[] = [];
  const chunks: ChunkRecord[] = [];
  for (const name of names) {
    const abs = path.join(dir, name);
    console.log(`  解析 ${name}...`);
    const parsed = await parseDocument(abs);
    const docId = `v65-${name.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 56)}`;
    const title = name.replace(/\.pdf$/i, "");
    const docChunks = chunkText(docId, parsed.content, {
      chunkSize: 260,
      chunkOverlap: 60,
      documentTitle: title,
      pageSpans: parsed.pageSpans,
    });
    documents.push({
      id: docId, filePath: abs, fileName: name, title,
      fileType: parsed.fileType, content: parsed.content,
      importedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      sourceCreatedAt: new Date().toISOString(), sourceUpdatedAt: new Date().toISOString(),
      chunkCount: docChunks.length,
    });
    chunks.push(...docChunks);
    console.log(`    → ${docChunks.length} chunks`);
  }
  return { documents, chunks };
}

async function runOne(id: string, question: string, documents: DocumentRecord[], chunks: ChunkRecord[]) {
  const start = Date.now();
  const topK = DEFAULT_RETRIEVAL_LIMIT;
  const { results: searchResults, vectorChunkIds, candidateChunks, queryRetrievalType } =
    await runRetrievalLikeDesktop(question, documents, chunks, { limit: topK, hydrateEmbeddings: true });
  const answer = answerQuestion(question, searchResults);
  const debug = buildRetrievalDebugPayload(
    question, vectorChunkIds, candidateChunks.length, searchResults, answer,
    { searchLimit: topK, vectorRecallBackend: "memory", runtime: "eval", queryRetrievalType },
  );
  const citationFiles = [...new Set(answer.citations.map((c: any) => c.fileName).filter(Boolean))];
  const primaryCitation = citationFiles[0] || null;
  const allRefs = searchResults.map((r) => `${r.documentTitle ?? ""} ${r.sectionTitle ?? ""} ${r.sectionPath ?? ""}`);
  const judgeFn = JUDGE_FN[id];
  const judge = judgeFn ? judgeFn(answer.directAnswer || answer.answer, allRefs) : { verdict: "unknown", score: 0, matched: [], missed: [], fail_modes: [] };
  const elapsed = Date.now() - start;
  const result = {
    source_question_id: id, question,
    citation_file_names: citationFiles, primary_citation: primaryCitation,
    top_section_hints: searchResults.slice(0, 3).map((r) => ({ file: r.fileName, section: r.sectionTitle })),
    direct_answer: answer.directAnswer, model_answer: answer.answer,
    model_citations: answer.citations.map((c: any) => ({
      chunkId: c.chunkId, fileName: c.fileName,
      snippet: c.snippet ? truncateSnippetPreservingIdentifiers(c.snippet, 500) : undefined,
    })),
    retrieval_debug: debug,
    judge_verdict: judge.verdict, judge_score: judge.score,
    judge_matched: judge.matched, judge_missed: judge.missed,
    judge_fail_modes: judge.fail_modes,
    fail_stage_hint: judge.verdict !== "pass" ? "answer" : undefined,
    elapsed_ms: elapsed,
  };
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = path.join(resultsDir, `p0a-new-types-run-${ts}-${id}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf-8");
  const emoji = judge.verdict === "pass" ? "✅ PASS" : judge.verdict === "partial" ? "⚠️ PARTIAL" : "❌ FAIL";
  console.log(`  ${emoji} | +${judge.matched.join(", ")} | -${judge.missed.join(", ")} | ${Math.round(elapsed / 1000)}s`);
  return result;
}

async function main() {
  if (!PDF_DIR) return;
  console.log("📖 加载语料...");
  const { documents, chunks } = await loadCorpus(PDF_DIR);
  console.log(`  共 ${documents.length} 卷，${chunks.length} chunks`);
  const results: any[] = [];
  for (const [id, q] of QUESTIONS) {
    console.log(`\n🔍 ${id}: ${q.slice(0, 60)}...`);
    if (global.gc) global.gc();
    const r = await runOne(id, q, documents, chunks);
    results.push(r);
  }
  const pass = results.filter((r: any) => r.judge_verdict === "pass").length;
  const partial = results.filter((r: any) => r.judge_verdict === "partial").length;
  const fail = results.filter((r: any) => r.judge_verdict === "fail").length;
  const avg = results.reduce((s: number, r: any) => s + r.judge_score, 0) / results.length;
  console.log(`\n📊 N7-N9 子集: Pass:${pass} Partial:${partial} Fail:${fail} 均分:${avg.toFixed(2)}`);
}

main().catch(console.error);
