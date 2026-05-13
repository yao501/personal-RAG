/**
 * P0-A 支线A Round 1 续：A3/A4 精简版（仅3卷核心）
 *
 * Usage:
 *   PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册" \
 *   node --max-old-space-size=3072 \
 *   ./node_modules/.bin/vite-node scripts/p0aCrossVolumeA3A4.ts
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

function judgeCrossVolume(id: string, direct: string, full: string) {
  const t = `${direct}\n${full}`;
  const matched: string[] = [], missed: string[] = [], fail_modes: string[] = [];
  const need = (c: boolean, ok: string, bad: string) => c ? matched.push(ok) : missed.push(bad);

  switch (id) {
    case "A3":
      need(/组态|工程/.test(t), "包含组态/工程阶段", "遗漏组态/工程阶段");
      need(/编译/.test(t), "包含编译阶段", "遗漏编译阶段");
      need(/下装/.test(t), "包含下装阶段", "遗漏下装阶段");
      need(/运行|在线|调试|操作/.test(t), "包含运行/调试阶段", "遗漏运行/调试阶段");
      need(/先.*后|然后|接着|最后|步骤|流程|顺序|阶段/.test(t), "有步骤顺序描述", "缺少步骤顺序感");
      break;
    case "A4":
      need(/仿真/.test(t), "提到仿真", "未提及仿真");
      need(/调试|在线/.test(t), "提到调试", "未提及调试");
      need(/编译|下装/.test(t), "提及仿真前置步骤", "未提及仿真前置步骤");
      if (t.includes("仿真") && t.includes("调试")) matched.push("包含仿真和调试区分");
      else missed.push("仿真和调试描述不完整");
      break;
  }
  if (/当前检索到的资料仅包含概述性内容|未形成可逐步执行的完整操作说明/.test(t)) fail_modes.push("cautious_overview_shell");

  let verdict: "pass" | "partial" | "fail";
  if (missed.length === 0) verdict = fail_modes.length > 0 ? "partial" : "pass";
  else if (missed.length <= 2) verdict = "partial";
  else verdict = "fail";

  let failStage: string | null = null;
  if (verdict !== "pass" && missed.length > 0) {
    const core = ["编译", "下装", "组态", "仿真", "调试", "工程总控", "控制器"];
    failStage = missed.filter(m => core.some(c => m.includes(c))).length >= 2 ? "retrieval" : "answer";
  }
  return { verdict, score: verdict === "pass" ? 1 : verdict === "partial" ? 0.5 : 0, matched, missed, fail_modes, fail_stage_hint: failStage };
}

async function run(id: string, q: string, dir: string) {
  // 仅加载3卷核心（手册2/3/4）
  const names = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.toLowerCase().endsWith(".pdf"))
    .map(d => d.name)
    .filter(n => /^HOLLiAS_MACS_V6\.5用户手册[2-4]_.+\.pdf$/i.test(n)).sort();

  const docs: DocumentRecord[] = [];
  const chs: ChunkRecord[] = [];
  for (const name of names) {
    const abs = path.join(dir, name);
    console.log(`  解析 ${name}...`);
    const parsed = await parseDocument(abs);
    const docId = `v65-${name.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 56)}`;
    const docChunks = chunkText(docId, parsed.content, { chunkSize: 260, chunkOverlap: 60, documentTitle: name.replace(/\.pdf$/i, ""), pageSpans: parsed.pageSpans });
    docs.push({ id: docId, filePath: abs, fileName: name, title: name.replace(/\.pdf$/i, ""), fileType: parsed.fileType, content: parsed.content, importedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sourceCreatedAt: new Date().toISOString(), sourceUpdatedAt: new Date().toISOString(), chunkCount: docChunks.length });
    chs.push(...docChunks);
    console.log(`    → ${docChunks.length} chunks`);
  }
  console.log(`  共 ${docs.length} 卷，${chs.length} chunks`);

  const start = Date.now();
  const { results: sr, vectorChunkIds, candidateChunks, queryRetrievalType } =
    await runRetrievalLikeDesktop(q, docs, chs, { limit: DEFAULT_RETRIEVAL_LIMIT, hydrateEmbeddings: true });
  const answer = answerQuestion(q, sr);
  const debug = buildRetrievalDebugPayload(q, vectorChunkIds, candidateChunks.length, sr, answer, { searchLimit: DEFAULT_RETRIEVAL_LIMIT, vectorRecallBackend: "memory", runtime: "eval", queryRetrievalType });
  const elapsed = Date.now() - start;

  const citationFiles = [...new Set(answer.citations.map(c => c.fileName))];
  const top = debug as any;
  const j = judgeCrossVolume(id, answer.directAnswer, answer.answer);

  const result = {
    source_question_id: id, question: q,
    citation_file_names: citationFiles,
    primary_citation: citationFiles[0] ?? null,
    top_section_hints: top.topResults?.slice(0, 3).map((x: any) => ({ file: x.fileName, section: x.sectionTitle })),
    direct_answer: answer.directAnswer,
    model_answer: answer.answer,
    model_citations: answer.citations.map(c => ({ chunkId: c.chunkId, fileName: c.fileName, snippet: truncateSnippetPreservingIdentifiers(c.snippet ?? "", 360) })),
    retrieval_debug: debug,
    judge_verdict: j.verdict, judge_score: j.score,
    judge_matched: j.matched, judge_missed: j.missed,
    judge_fail_modes: j.fail_modes, fail_stage_hint: j.fail_stage_hint, elapsed_ms: elapsed
  };

  const emoji = j.verdict === "pass" ? "✅" : j.verdict === "partial" ? "⚠️" : "❌";
  console.log(`  ${emoji} ${j.verdict.toUpperCase()} | +${j.matched.join(", ")} | -${j.missed.join(", ")} | ${(elapsed/1000).toFixed(0)}s`);
  return result;
}

async function main() {
  const dir = process.env.PKRAG_REALPDF_DIR?.trim();
  if (!dir || !fs.existsSync(dir)) { console.error("PKRAG_REALPDF_DIR missing"); process.exit(1); }

  const resultsDir = path.join(repoRoot, "evals", "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);

  const tasks: [string, string][] = [
    ["A3", "从新建工程到最终在线运行，MACS V6.5 工程组态的完整操作顺序是什么？编译、下装、调试分别在哪个阶段执行？"],
    ["A4", "MACS V6.5 的仿真功能和在线调试功能有什么区别？分别在哪本手册中说明？使用仿真前需要完成哪些前置步骤？"]
  ];

  for (let i = 0; i < tasks.length; i++) {
    const [id, q] = tasks[i];
    console.log(`\n${"=".repeat(50)}`);
    console.log(`🔍 P0-A ${id}: ${q.slice(0,50)}...`);
    console.log(`${"=".repeat(50)}`);
    console.log("📖 加载语料（核心3卷）...");
    const r = await run(id, q, dir);
    const seq = String(i + 3).padStart(3, "0");
    fs.writeFileSync(path.join(resultsDir, `p0a-cross-volume-run-${dateStr}-A${seq}.json`), JSON.stringify(r, null, 2), "utf-8");
  }

  // Summary
  const allFiles = fs.readdirSync(resultsDir).filter(f => f.startsWith("p0a-cross-volume-run-2026-")).sort();
  const all = allFiles.map(f => JSON.parse(fs.readFileSync(path.join(resultsDir, f), "utf-8")));
  const t = all.length, p = all.filter((r: any) => r.judge_verdict === "pass").length;
  const pa = all.filter((r: any) => r.judge_verdict === "partial").length;
  const f = all.filter((r: any) => r.judge_verdict === "fail").length;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 P0-A 支线A Round 1 总计`);
  console.log(`${"=".repeat(60)}`);
  all.forEach((r: any) => console.log(`  ${r.source_question_id}: ${r.judge_verdict.toUpperCase()} [${r.judge_score}]`));
  console.log(`  Pass:${p} Partial:${pa} Fail:${f}`);
}

main().catch(e => { console.error(e); process.exit(1); });
