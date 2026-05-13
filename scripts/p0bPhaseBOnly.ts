/**
 * 临时脚本：仅跑 Phase B (手册7 功能块 M7-2 ~ M7-6)
 * 复用 p0bFullCoverageEval.ts 的 judge 和 runOne 逻辑
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunkText } from "../src/lib/modules/chunk/chunkText";
import { parseDocument } from "../src/lib/modules/parse/parseDocument";
import { answerQuestion } from "../src/lib/modules/answer/answerQuestion";
import { buildRetrievalDebugPayload } from "../src/lib/modules/retrieve/retrievalDebug";
import {
  DEFAULT_RETRIEVAL_LIMIT,
  runRetrievalLikeDesktop
} from "../src/lib/modules/retrieve/retrievalPipeline";
import { truncateSnippetPreservingIdentifiers } from "../src/lib/modules/citation/snippetTruncate";
import type { ChunkRecord, DocumentRecord } from "../src/lib/shared/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

type JudgeVerdict = "pass" | "partial" | "fail";
type FailStage = "retrieval" | "ranking" | "chunk" | "parse_normalize" | "answer" | "rule_check";

interface JudgeResult {
  verdict: JudgeVerdict;
  score: number;
  matched: string[];
  missed: string[];
  fail_modes: string[];
  fail_stage_hint: FailStage | null;
}

function need(cond: boolean, matched: string[], missed: string[], ok: string, bad: string) {
  cond ? matched.push(ok) : missed.push(bad);
}

function judgeDefinition(id: string, direct: string, full: string, keywords: string[]): JudgeResult {
  const t = `${direct}\n${full}`;
  const matched: string[] = [];
  const missed: string[] = [];
  const fail_modes: string[] = [];
  for (const kw of keywords) need(t.includes(kw), matched, missed, `提到${kw}`, `未提及${kw}`);
  need(direct.length > 20 || full.length > 80, matched, missed, "有实质回答内容", "回答过于简短/空泛");
  const hit = matched.length, total = matched.length + missed.length;
  const ratio = total > 0 ? hit / total : 0;
  if (ratio >= 0.8) return { verdict: "pass", score: 1.0, matched, missed, fail_modes, fail_stage_hint: null };
  if (ratio >= 0.5) return { verdict: "partial", score: 0.5, matched, missed, fail_modes, fail_stage_hint: "answer" };
  return { verdict: "fail", score: 0.0, matched, missed, fail_modes, fail_stage_hint: "retrieval" };
}

function judgeOperationCondition(id: string, direct: string, full: string, keywords: string[]): JudgeResult {
  const t = `${direct}\n${full}`;
  const matched: string[] = [];
  const missed: string[] = [];
  const fail_modes: string[] = [];
  for (const kw of keywords) need(t.includes(kw), matched, missed, `提到${kw}`, `未提及${kw}`);
  need(t.includes("场景") || t.includes("适用") || t.includes("用于") || t.includes("情况"), matched, missed, "有场景/条件描述", "缺少场景区分描述");
  const hit = matched.length, total = matched.length + missed.length;
  const ratio = total > 0 ? hit / total : 0;
  if (ratio >= 0.8) return { verdict: "pass", score: 1.0, matched, missed, fail_modes, fail_stage_hint: null };
  if (ratio >= 0.5) return { verdict: "partial", score: 0.5, matched, missed, fail_modes, fail_stage_hint: "answer" };
  return { verdict: "fail", score: 0.0, matched, missed, fail_modes, fail_stage_hint: "retrieval" };
}

function judgeParameterConstraint(id: string, direct: string, full: string, keywords: string[]): JudgeResult {
  const t = `${direct}\n${full}`;
  const matched: string[] = [];
  const missed: string[] = [];
  const fail_modes: string[] = [];
  for (const kw of keywords) need(t.includes(kw), matched, missed, `提到${kw}`, `未提及${kw}`);
  need(/上限|下限|范围|限制|约束|最大|最小/.test(t), matched, missed, "涉及参数范围/约束", "缺少参数范围约束描述");
  const hit = matched.length, total = matched.length + missed.length;
  const ratio = total > 0 ? hit / total : 0;
  if (ratio >= 0.8) return { verdict: "pass", score: 1.0, matched, missed, fail_modes, fail_stage_hint: null };
  if (ratio >= 0.5) return { verdict: "partial", score: 0.5, matched, missed, fail_modes, fail_stage_hint: "answer" };
  return { verdict: "fail", score: 0.0, matched, missed, fail_modes, fail_stage_hint: "retrieval" };
}

async function loadCorpus(dir: string, volumeFilter: RegExp) {
  const names = fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".pdf"))
    .map((d) => d.name)
    .filter((n) => volumeFilter.test(n))
    .sort();
  if (names.length === 0) throw new Error(`未找到匹配的 PDF：${dir}`);
  console.log(`  加载 ${names.length} 卷: ${names.join(", ")}`);
  const documents: DocumentRecord[] = [];
  const chunks: ChunkRecord[] = [];
  for (const name of names) {
    const abs = path.join(dir, name);
    const parsed = await parseDocument(abs);
    const docId = `v65-${name.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 56)}`;
    const title = name.replace(/\.pdf$/i, "");
    const docChunks = chunkText(docId, parsed.content, {
      chunkSize: 260, chunkOverlap: 60, documentTitle: title, pageSpans: parsed.pageSpans
    });
    documents.push({
      id: docId, filePath: abs, fileName: name, title,
      fileType: parsed.fileType, content: parsed.content,
      importedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      sourceCreatedAt: new Date().toISOString(), sourceUpdatedAt: new Date().toISOString(),
      chunkCount: docChunks.length
    });
    chunks.push(...docChunks);
    console.log(`    → ${docChunks.length} chunks`);
  }
  return { documents, chunks };
}

async function runOne(id: string, question: string, documents: DocumentRecord[], chunks: ChunkRecord[]) {
  const topK = DEFAULT_RETRIEVAL_LIMIT;
  const { results: searchResults, vectorChunkIds, candidateChunks, queryRetrievalType } =
    await runRetrievalLikeDesktop(question, documents, chunks, { limit: topK, hydrateEmbeddings: true });
  const answer = answerQuestion(question, searchResults);
  const debug = buildRetrievalDebugPayload(
    question, vectorChunkIds, candidateChunks.length, searchResults, answer,
    { searchLimit: topK, vectorRecallBackend: "memory", runtime: "eval", queryRetrievalType }
  );
  return {
    direct_answer: answer.directAnswer,
    model_answer: answer.answer,
    model_citations: answer.citations.map((c) => ({
      chunkId: c.chunkId, fileName: c.fileName,
      snippet: truncateSnippetPreservingIdentifiers(c.snippet ?? "", 360)
    })),
    retrieval_debug: debug
  };
}

// 手册7 6题 (从 M7-2 开始，M7-1 已跑)
const GROUP_B_M7 = [
  { id: "M7-2", type: "参数约束型" as const,
    question: "MACS V6.5 PID 功能块中，PVU/PVL 和 ENGU/ENGL 参数分别表示什么？它们之间的关系是什么？死区（Deadband）参数的作用和设置范围是什么？",
    keywords: ["PVU", "PVL", "ENGU", "ENGL", "PID"] },
  { id: "M7-3", type: "操作条件型" as const,
    question: "MACS V6.5 PID 功能块的跟踪模式（Tracking）和自动模式（Auto）有什么区别？什么条件下 PID 会进入跟踪模式？跟踪模式下 PID 的输出值由什么决定？",
    keywords: ["跟踪", "自动", "PID", "输出"] },
  { id: "M7-4", type: "定义型" as const,
    question: "MACS V6.5 高级运算功能块中，SWITCH（选择开关）、ORSEL（或选择）、MULDIV（乘除运算）、SUMMER_CTRL（累加器控制）分别有什么功能？各适用于什么场景？",
    keywords: ["SWITCH", "ORSEL", "MULDIV", "SUMMER"] },
  { id: "M7-5", type: "操作条件型" as const,
    question: "MACS V6.5 功能块中，旁路（Bypass）功能的作用是什么？哪些功能块支持旁路功能？启用旁路后，功能块的输出值如何确定？旁路功能在调试和维护中有什么用途？",
    keywords: ["旁路", "Bypass", "功能块", "输出"] },
  { id: "M7-6", type: "定义型" as const,
    question: "MACS V6.5 控制运算中，MOTCTRL（马达控制）和 VALCTRL（阀门控制）功能块各自的作用是什么？它们分别有哪些关键参数？如何配置电机或阀门的反馈信号？",
    keywords: ["MOTCTRL", "VALCTRL", "马达", "阀门"] },
];

function getJudge(def: typeof GROUP_B_M7[0]): (direct: string, full: string) => JudgeResult {
  const kw = def.keywords;
  switch (def.type) {
    case "定义型": return (d, f) => judgeDefinition(def.id, d, f, kw);
    case "参数约束型": return (d, f) => judgeParameterConstraint(def.id, d, f, kw);
    case "操作条件型": return (d, f) => judgeOperationCondition(def.id, d, f, kw);
  }
}

async function main() {
  const dir = process.env.PKRAG_REALPDF_DIR?.trim();
  if (!dir || !fs.existsSync(dir)) { console.error("请设置 PKRAG_REALPDF_DIR"); process.exit(1); }

  const resultsDir = path.join(repoRoot, "evals", "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  console.log(`\n${"█".repeat(60)}`);
  console.log(`█  Phase B 补跑: 手册7 功能块专题 (M7-2 ~ M7-6)`);
  console.log(`${"█".repeat(60)}`);

  const volFilterB = /^HOLLiAS_MACS_V6\.5用户手册7_.+\.pdf$/i;
  console.log("📖 加载语料（仅手册7）...");
  const corpusB = await loadCorpus(dir, volFilterB);
  console.log(`  共 ${corpusB.documents.length} 卷，${corpusB.chunks.length} chunks`);

  const allResults: Record<string, unknown>[] = [];

  for (const def of GROUP_B_M7) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`🔍 ${def.id} [${def.type}]: ${def.question.slice(0, 80)}...`);
    console.log(`${"=".repeat(50)}`);

    const start = Date.now();
    const run = await runOne(def.id, def.question, corpusB.documents, corpusB.chunks);
    const elapsed = Date.now() - start;

    const judge = getJudge(def);
    const j = judge(run.direct_answer, run.model_answer);
    const citationFiles = [...new Set(run.model_citations.map((c) => c.fileName))];
    const top = run.retrieval_debug as { topResults?: Array<{ fileName?: string; sectionTitle?: string }> };

    const result: Record<string, unknown> = {
      source_question_id: def.id, question: def.question, type: def.type,
      volume: "手册7_功能块",
      citation_file_names: citationFiles,
      primary_citation: citationFiles[0] ?? null,
      top_section_hints: top.topResults?.slice(0, 3).map((x) => ({ file: x.fileName, section: x.sectionTitle })),
      direct_answer: run.direct_answer, model_answer: run.model_answer,
      model_citations: run.model_citations, retrieval_debug: run.retrieval_debug,
      judge_verdict: j.verdict, judge_score: j.score,
      judge_matched: j.matched, judge_missed: j.missed,
      judge_fail_modes: j.fail_modes, fail_stage_hint: j.fail_stage_hint, elapsed_ms: elapsed
    };
    allResults.push(result);

    const emoji = j.verdict === "pass" ? "✅" : j.verdict === "partial" ? "⚠️" : "❌";
    console.log(`  ${emoji} ${j.verdict.toUpperCase()} | +${j.matched.join(", ")} | -${j.missed.join(", ")} | ${(elapsed / 1000).toFixed(0)}s`);

    const seq = String(GROUP_B_M7.findIndex((d) => d.id === def.id) + 2).padStart(2, "0");
    fs.writeFileSync(path.join(resultsDir, `p0b-full-coverage-run-${dateStr}-B${seq}.json`), JSON.stringify(result, null, 2), "utf-8");
    if (global.gc) global.gc();
  }

  // Quick summary
  const pass = allResults.filter(r => r.judge_verdict === "pass").length;
  const partial = allResults.filter(r => r.judge_verdict === "partial").length;
  const fail = allResults.filter(r => r.judge_verdict === "fail").length;
  const avg = allResults.reduce((s, r) => s + (r.judge_score as number), 0) / allResults.length;
  console.log(`\n📊 Phase B (M7-2~M7-6): P:${pass} Pa:${partial} F:${fail} | 均分 ${avg.toFixed(2)}`);

  // Append to summary file
  const summaryPath = path.join(resultsDir, `p0b-phaseb-bge-m3-${dateStr}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(allResults, null, 2), "utf-8");
  console.log(`  → ${summaryPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
