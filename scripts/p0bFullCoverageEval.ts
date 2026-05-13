/**
 * P0-B 全卷覆盖评测：手册5（图形编辑）+ 手册7（功能块）
 *
 * 分两组运行避免 OOM：
 *   Group A (M5-1~M5-4): 手册5专题 → 加载手册1-5
 *   Group B (M7-1~M7-6): 手册7专题 → 加载手册3,4,7
 *
 * Usage:
 *   PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册" \
 *   node --max-old-space-size=4096 \
 *   ./node_modules/.bin/vite-node scripts/p0bFullCoverageEval.ts
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

// ═══════════ Types ═══════════

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

// ═══════════ Judge Functions ═══════════

function need(cond: boolean, matched: string[], missed: string[], ok: string, bad: string) {
  cond ? matched.push(ok) : missed.push(bad);
}

/** 定义型 judge：检查 keywords 是否在答案中 */
function judgeDefinition(id: string, direct: string, full: string, keywords: string[]): JudgeResult {
  const t = `${direct}\n${full}`;
  const matched: string[] = [];
  const missed: string[] = [];
  const fail_modes: string[] = [];

  for (const kw of keywords) {
    need(t.includes(kw), matched, missed, `提到${kw}`, `未提及${kw}`);
  }

  // 额外检查：答案不能太空泛
  need(direct.length > 20 || full.length > 80, matched, missed, "有实质回答内容", "回答过于简短/空泛");

  const hit = matched.length;
  const total = matched.length + missed.length;
  const ratio = total > 0 ? hit / total : 0;

  if (ratio >= 0.8) return { verdict: "pass", score: 1.0, matched, missed, fail_modes, fail_stage_hint: null };
  if (ratio >= 0.5) return { verdict: "partial", score: 0.5, matched, missed, fail_modes, fail_stage_hint: "answer" };
  return { verdict: "fail", score: 0.0, matched, missed, fail_modes, fail_stage_hint: "retrieval" };
}

/** 操作条件型 judge：检查场景区分和条件说明 */
function judgeOperationCondition(id: string, direct: string, full: string, keywords: string[]): JudgeResult {
  const t = `${direct}\n${full}`;
  const matched: string[] = [];
  const missed: string[] = [];
  const fail_modes: string[] = [];

  for (const kw of keywords) {
    need(t.includes(kw), matched, missed, `提到${kw}`, `未提及${kw}`);
  }

  // 额外检查：是否有场景区分描述
  need(
    t.includes("场景") || t.includes("适用") || t.includes("用于") || t.includes("情况"),
    matched, missed, "有场景/条件描述", "缺少场景区分描述"
  );

  const hit = matched.length;
  const total = matched.length + missed.length;
  const ratio = total > 0 ? hit / total : 0;

  if (ratio >= 0.8) return { verdict: "pass", score: 1.0, matched, missed, fail_modes, fail_stage_hint: null };
  if (ratio >= 0.5) return { verdict: "partial", score: 0.5, matched, missed, fail_modes, fail_stage_hint: "answer" };
  return { verdict: "fail", score: 0.0, matched, missed, fail_modes, fail_stage_hint: "retrieval" };
}

/** 参数约束型 judge：检查参数条件和限制 */
function judgeParameterConstraint(id: string, direct: string, full: string, keywords: string[]): JudgeResult {
  const t = `${direct}\n${full}`;
  const matched: string[] = [];
  const missed: string[] = [];
  const fail_modes: string[] = [];

  for (const kw of keywords) {
    need(t.includes(kw), matched, missed, `提到${kw}`, `未提及${kw}`);
  }

  need(
    /上限|下限|范围|限制|约束|最大|最小/.test(t),
    matched, missed, "涉及参数范围/约束", "缺少参数范围约束描述"
  );

  const hit = matched.length;
  const total = matched.length + missed.length;
  const ratio = total > 0 ? hit / total : 0;

  if (ratio >= 0.8) return { verdict: "pass", score: 1.0, matched, missed, fail_modes, fail_stage_hint: null };
  if (ratio >= 0.5) return { verdict: "partial", score: 0.5, matched, missed, fail_modes, fail_stage_hint: "answer" };
  return { verdict: "fail", score: 0.0, matched, missed, fail_modes, fail_stage_hint: "retrieval" };
}

// ═══════════ Corpus Loading ═══════════

async function loadCorpus(dir: string, volumeFilter: RegExp): Promise<{
  documents: DocumentRecord[];
  chunks: ChunkRecord[];
}> {
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".pdf"))
    .map((d) => d.name)
    .filter((n) => volumeFilter.test(n))
    .sort();

  if (names.length === 0) {
    throw new Error(`未找到匹配 ${volumeFilter} 的 PDF：${dir}`);
  }

  console.log(`  加载 ${names.length} 卷: ${names.map(n => n.slice(24, 30)).join(", ")}`);

  const documents: DocumentRecord[] = [];
  const chunks: ChunkRecord[] = [];

  for (const name of names) {
    const abs = path.join(dir, name);
    const parsed = await parseDocument(abs);
    const docId = `v65-${name.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 56)}`;
    const title = name.replace(/\.pdf$/i, "");
    const docChunks = chunkText(docId, parsed.content, {
      chunkSize: 260,
      chunkOverlap: 60,
      documentTitle: title,
      pageSpans: parsed.pageSpans
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

// ═══════════ Single Question Run ═══════════

async function runOne(
  id: string, question: string,
  documents: DocumentRecord[], chunks: ChunkRecord[]
) {
  const topK = DEFAULT_RETRIEVAL_LIMIT;
  const { results: searchResults, vectorChunkIds, candidateChunks, queryRetrievalType } =
    await runRetrievalLikeDesktop(question, documents, chunks, {
      limit: topK,
      hydrateEmbeddings: true
    });
  const answer = answerQuestion(question, searchResults);
  const debug = buildRetrievalDebugPayload(
    question, vectorChunkIds, candidateChunks.length, searchResults, answer,
    { searchLimit: topK, vectorRecallBackend: "memory", runtime: "eval", queryRetrievalType }
  );
  return {
    direct_answer: answer.directAnswer,
    model_answer: answer.answer,
    model_citations: answer.citations.map((c) => ({
      chunkId: c.chunkId,
      fileName: c.fileName,
      snippet: truncateSnippetPreservingIdentifiers(c.snippet ?? "", 360)
    })),
    retrieval_debug: debug
  };
}

// ═══════════ Question Definitions ═══════════

interface QuestionDef {
  id: string;
  type: "定义型" | "参数约束型" | "操作条件型";
  question: string;
  keywords: string[];
}

const GROUP_A_M5: QuestionDef[] = [
  {
    id: "M5-1", type: "定义型",
    question: "MACS V6.5 图形编辑软件中，图形页面分为哪几类？每一类图形页面的用途和特点分别是什么？",
    keywords: ["图形页面", "流程图", "操作面板", "分类"]
  },
  {
    id: "M5-2", type: "定义型",
    question: "MACS V6.5 图形编辑软件提供了哪些符号库？MOT 系列符号库（MOT1/MOT2/MOT3/MOTD）和 VAL 系列符号库（VAL1/VAL2/VAL3）各有什么用途和区别？",
    keywords: ["符号库", "MOT", "VAL", "马达", "阀门"]
  },
  {
    id: "M5-3", type: "操作条件型",
    question: "MACS V6.5 图形编辑中，交互特性支持哪些响应事件类型？弹出操作面板、弹出窗口、模拟量值输入（键盘输入）等交互方式各适用于什么场景？如何设置触发条件？",
    keywords: ["交互特性", "响应事件", "弹出", "触发"]
  },
  {
    id: "M5-4", type: "定义型",
    question: "MACS V6.5 图形编辑软件中支持哪些 ActiveX 控件？海康威视视频控件（HKVideoCtrl Class）的用途是什么？如何在流程图中集成和配置视频控件？",
    keywords: ["ActiveX", "控件", "视频", "HKVideoCtrl"]
  }
];

const GROUP_B_M7: QuestionDef[] = [
  {
    id: "M7-1", type: "定义型",
    question: "MACS V6.5 功能块手册中，基本运算功能块包含哪些类型的功能块？ADD、SUB、MUL、DIV、SQRT 等基本运算块的输入输出有什么特点？",
    keywords: ["基本运算", "ADD", "SUB", "MUL", "DIV"]
  },
  {
    id: "M7-2", type: "参数约束型",
    question: "MACS V6.5 PID 功能块中，PVU/PVL 和 ENGU/ENGL 参数分别表示什么？它们之间的关系是什么？死区（Deadband）参数的作用和设置范围是什么？",
    keywords: ["PVU", "PVL", "ENGU", "ENGL", "PID"]
  },
  {
    id: "M7-3", type: "操作条件型",
    question: "MACS V6.5 PID 功能块的跟踪模式（Tracking）和自动模式（Auto）有什么区别？什么条件下 PID 会进入跟踪模式？跟踪模式下 PID 的输出值由什么决定？",
    keywords: ["跟踪", "自动", "PID", "输出"]
  },
  {
    id: "M7-4", type: "定义型",
    question: "MACS V6.5 高级运算功能块中，SWITCH（选择开关）、ORSEL（或选择）、MULDIV（乘除运算）、SUMMER_CTRL（累加器控制）分别有什么功能？各适用于什么场景？",
    keywords: ["SWITCH", "ORSEL", "MULDIV", "SUMMER"]
  },
  {
    id: "M7-5", type: "操作条件型",
    question: "MACS V6.5 功能块中，旁路（Bypass）功能的作用是什么？哪些功能块支持旁路功能？启用旁路后，功能块的输出值如何确定？旁路功能在调试和维护中有什么用途？",
    keywords: ["旁路", "Bypass", "功能块", "输出"]
  },
  {
    id: "M7-6", type: "定义型",
    question: "MACS V6.5 控制运算中，MOTCTRL（马达控制）和 VALCTRL（阀门控制）功能块各自的作用是什么？它们分别有哪些关键参数？如何配置电机或阀门的反馈信号？",
    keywords: ["MOTCTRL", "VALCTRL", "马达", "阀门"]
  }
];

function getJudge(def: QuestionDef): (direct: string, full: string) => JudgeResult {
  const kw = def.keywords;
  switch (def.type) {
    case "定义型": return (d, f) => judgeDefinition(def.id, d, f, kw);
    case "参数约束型": return (d, f) => judgeParameterConstraint(def.id, d, f, kw);
    case "操作条件型": return (d, f) => judgeOperationCondition(def.id, d, f, kw);
  }
}

// ═══════════ Main ═══════════

async function main(): Promise<void> {
  const dir = process.env.PKRAG_REALPDF_DIR?.trim();
  if (!dir || !fs.existsSync(dir)) {
    console.error("请设置 PKRAG_REALPDF_DIR");
    process.exit(1);
  }

  const resultsDir = path.join(repoRoot, "evals", "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);

  const allResults: Record<string, unknown>[] = [];

  // ═══════════ Phase A: 手册5专题 (134卷) ═══════════
  console.log(`\n${"█".repeat(60)}`);
  console.log(`█  Phase A: 手册5 图形编辑专题 (M5-1 ~ M5-4)`);
  console.log(`${"█".repeat(60)}`);

  // 仅加载手册5（图形编辑专题，不需要跨卷引用）
  const volFilterA = /^HOLLiAS_MACS_V6\.5用户手册5_.+\.pdf$/i;
  console.log("📖 加载语料（仅手册5）...");
  const corpusA = await loadCorpus(dir, volFilterA);
  console.log(`  共 ${corpusA.documents.length} 卷，${corpusA.chunks.length} chunks`);

  for (const def of GROUP_A_M5) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`🔍 ${def.id} [${def.type}]: ${def.question.slice(0, 80)}...`);
    console.log(`${"=".repeat(50)}`);

    const start = Date.now();
    const run = await runOne(def.id, def.question, corpusA.documents, corpusA.chunks);
    const elapsed = Date.now() - start;

    const judge = getJudge(def);
    const j = judge(run.direct_answer, run.model_answer);
    const citationFiles = [...new Set(run.model_citations.map((c) => c.fileName))];
    const top = run.retrieval_debug as {
      topResults?: Array<{ fileName?: string; sectionTitle?: string }>;
    };

    const result: Record<string, unknown> = {
      source_question_id: def.id,
      question: def.question,
      type: def.type,
      volume: "手册5_图形编辑",
      citation_file_names: citationFiles,
      primary_citation: citationFiles[0] ?? null,
      top_section_hints: top.topResults?.slice(0, 3).map((x) => ({
        file: x.fileName,
        section: x.sectionTitle
      })),
      direct_answer: run.direct_answer,
      model_answer: run.model_answer,
      model_citations: run.model_citations,
      retrieval_debug: run.retrieval_debug,
      judge_verdict: j.verdict,
      judge_score: j.score,
      judge_matched: j.matched,
      judge_missed: j.missed,
      judge_fail_modes: j.fail_modes,
      fail_stage_hint: j.fail_stage_hint,
      elapsed_ms: elapsed
    };
    allResults.push(result);

    const emoji = j.verdict === "pass" ? "✅" : j.verdict === "partial" ? "⚠️" : "❌";
    console.log(
      `  ${emoji} ${j.verdict.toUpperCase()} | +${j.matched.join(", ")} | -${j.missed.join(", ")} | ${(elapsed / 1000).toFixed(0)}s`
    );

    // 写单题结果
    const seq = String(GROUP_A_M5.findIndex((d) => d.id === def.id) + 1).padStart(2, "0");
    fs.writeFileSync(
      path.join(resultsDir, `p0b-full-coverage-run-${dateStr}-A${seq}.json`),
      JSON.stringify(result, null, 2), "utf-8"
    );
    if (global.gc) global.gc();
  }

  // ═══════════ Phase B: 手册7专题 (3,4,7卷) ═══════════
  console.log(`\n${"█".repeat(60)}`);
  console.log(`█  Phase B: 手册7 功能块专题 (M7-1 ~ M7-6)`);
  console.log(`${"█".repeat(60)}`);

  // 仅加载手册7（功能块专题，不需要跨卷引用）
  const volFilterB = /^HOLLiAS_MACS_V6\.5用户手册7_.+\.pdf$/i;
  console.log("📖 加载语料（仅手册7）...");
  const corpusB = await loadCorpus(dir, volFilterB);
  console.log(`  共 ${corpusB.documents.length} 卷，${corpusB.chunks.length} chunks`);

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
    const top = run.retrieval_debug as {
      topResults?: Array<{ fileName?: string; sectionTitle?: string }>;
    };

    const result: Record<string, unknown> = {
      source_question_id: def.id,
      question: def.question,
      type: def.type,
      volume: "手册7_功能块",
      citation_file_names: citationFiles,
      primary_citation: citationFiles[0] ?? null,
      top_section_hints: top.topResults?.slice(0, 3).map((x) => ({
        file: x.fileName,
        section: x.sectionTitle
      })),
      direct_answer: run.direct_answer,
      model_answer: run.model_answer,
      model_citations: run.model_citations,
      retrieval_debug: run.retrieval_debug,
      judge_verdict: j.verdict,
      judge_score: j.score,
      judge_matched: j.matched,
      judge_missed: j.missed,
      judge_fail_modes: j.fail_modes,
      fail_stage_hint: j.fail_stage_hint,
      elapsed_ms: elapsed
    };
    allResults.push(result);

    const emoji = j.verdict === "pass" ? "✅" : j.verdict === "partial" ? "⚠️" : "❌";
    console.log(
      `  ${emoji} ${j.verdict.toUpperCase()} | +${j.matched.join(", ")} | -${j.missed.join(", ")} | ${(elapsed / 1000).toFixed(0)}s`
    );

    const seq = String(GROUP_B_M7.findIndex((d) => d.id === def.id) + 1).padStart(2, "0");
    fs.writeFileSync(
      path.join(resultsDir, `p0b-full-coverage-run-${dateStr}-B${seq}.json`),
      JSON.stringify(result, null, 2), "utf-8"
    );
    if (global.gc) global.gc();
  }

  // ═══════════ Summary ═══════════
  const total = allResults.length;
  const pass = allResults.filter((r) => r.judge_verdict === "pass").length;
  const partial = allResults.filter((r) => r.judge_verdict === "partial").length;
  const fail = allResults.filter((r) => r.judge_verdict === "fail").length;
  const avgScore = allResults.reduce((s, r) => s + (r.judge_score as number), 0) / (total || 1);

  // 按类型分组
  const byType: Record<string, { pass: number; partial: number; fail: number; count: number; scores: number[] }> = {};
  for (const r of allResults) {
    const t = r.type as string;
    if (!byType[t]) byType[t] = { pass: 0, partial: 0, fail: 0, count: 0, scores: [] };
    byType[t].count++;
    byType[t].scores.push(r.judge_score as number);
    if (r.judge_verdict === "pass") byType[t].pass++;
    else if (r.judge_verdict === "partial") byType[t].partial++;
    else byType[t].fail++;
  }

  // 按卷分组
  const byVol: Record<string, { pass: number; partial: number; fail: number; count: number; scores: number[] }> = {};
  for (const r of allResults) {
    const v = r.volume as string;
    if (!byVol[v]) byVol[v] = { pass: 0, partial: 0, fail: 0, count: 0, scores: [] };
    byVol[v].count++;
    byVol[v].scores.push(r.judge_score as number);
    if (r.judge_verdict === "pass") byVol[v].pass++;
    else if (r.judge_verdict === "partial") byVol[v].partial++;
    else byVol[v].fail++;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 B线 全卷覆盖 Round 1 总结`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Pass: ${pass}/${total} | Partial: ${partial}/${total} | Fail: ${fail}/${total}`);
  console.log(`  平均分: ${avgScore.toFixed(2)}`);

  for (const [v, s] of Object.entries(byVol)) {
    const va = s.scores.reduce((a, b) => a + b, 0) / s.count;
    console.log(`  ${v}: P:${s.pass} Pa:${s.partial} F:${s.fail} | 均分 ${va.toFixed(2)}`);
  }
  for (const [t, s] of Object.entries(byType)) {
    const ta = s.scores.reduce((a, b) => a + b, 0) / s.count;
    console.log(`  ${t}: P:${s.pass} Pa:${s.partial} F:${s.fail} | 均分 ${ta.toFixed(2)}`);
  }

  // Write raw JSON
  const rawPath = path.join(resultsDir, `p0b-full-coverage-round1-${ts}.json`);
  fs.writeFileSync(rawPath, JSON.stringify(allResults, null, 2), "utf-8");
  console.log(`\n  Raw JSON → ${rawPath}`);

  // Write summary MD
  const summaryLines: string[] = [
    `# B线 全卷覆盖 Round 1 — 评测报告`,
    ``,
    `**日期**: ${now.toISOString()}`,
    `**知识库**: HOLLiAS MACS V6.5 用户手册（全7卷，分两阶段加载）`,
    `**Phase A**: 手册1-5（M5-1 ~ M5-4，图形编辑专题）`,
    `**Phase B**: 手册3,4,7（M7-1 ~ M7-6，功能块专题）`,
    `**轮次**: Round 1（首轮基线）`,
    ``,
    `## 总体结果`,
    ``,
    `| 指标 | 值 |`,
    `|------|-----|`,
    `| 总题数 | ${total} |`,
    `| Pass | ${pass} |`,
    `| Partial | ${partial} |`,
    `| Fail | ${fail} |`,
    `| 平均分 | ${avgScore.toFixed(2)} |`,
    ``,
  ];

  // 按卷组织详情
  for (const [vol, stats] of Object.entries(byVol)) {
    const va = stats.scores.reduce((a, b) => a + b, 0) / stats.count;
    summaryLines.push(`## ${vol}（均分 ${va.toFixed(2)}）`);
    summaryLines.push(``);
    summaryLines.push(`| ID | 类型 | 结果 | 分数 | 命中 | 遗漏 |`);
    summaryLines.push(`|----|------|------|------|------|------|`);
    const volResults = allResults.filter((r) => r.volume === vol);
    for (const r of volResults) {
      const emoji = r.judge_verdict === "pass" ? "✅" : r.judge_verdict === "partial" ? "⚠️" : "❌";
      summaryLines.push(`| ${r.source_question_id} | ${r.type} | ${emoji} ${r.judge_verdict} | ${r.judge_score} | ${(r.judge_matched as string[]).join("; ")} | ${(r.judge_missed as string[]).join("; ")} |`);
    }
    summaryLines.push(``);
  }

  summaryLines.push(`## 逐题分析`);
  summaryLines.push(``);
  for (const r of allResults) {
    summaryLines.push(`### ${r.source_question_id} — ${(r.judge_verdict as string).toUpperCase()} (${r.judge_score})`);
    summaryLines.push(``);
    summaryLines.push(`**类型**: ${r.type} | **卷**: ${r.volume}`);
    summaryLines.push(``);
    summaryLines.push(`**问法**: ${r.question}`);
    summaryLines.push(``);
    summaryLines.push(`**引用文件**: ${(r.citation_file_names as string[]).join(", ") || "(无)"}`);
    summaryLines.push(``);
    summaryLines.push(`**Top章节**: ${(r.top_section_hints as Array<{ file: string; section: string }>)
      ?.map((h) => `${h.file}: ${h.section}`).join("; ") || "无"}`);
    summaryLines.push(``);
    summaryLines.push(`**命中**: ${(r.judge_matched as string[]).join("; ") || "(空)"}`);
    summaryLines.push(``);
    summaryLines.push(`**遗漏**: ${(r.judge_missed as string[]).join("; ") || "(空)"}`);
    summaryLines.push(``);
    summaryLines.push(`**失败阶段**: ${r.fail_stage_hint || "N/A"}`);
    summaryLines.push(``);
    const da = (r.direct_answer as string).slice(0, 400);
    summaryLines.push(`**回答摘要**: ${da || "(空)"}...`);
    summaryLines.push(``);
    const ma = (r.model_answer as string).slice(0, 400);
    summaryLines.push(`**模型回答摘要**: ${ma || "(空)"}...`);
    summaryLines.push(``);
  }

  // 收口判定
  summaryLines.push(`## 收口判定`);
  summaryLines.push(``);
  const failsOnly = allResults.filter(r => (r.judge_verdict as string) !== "pass");
  const nonAnswer = failsOnly.filter(r => r.fail_stage_hint && r.fail_stage_hint !== "answer").length;
  summaryLines.push(`| 条件 | 状态 |`);
  summaryLines.push(`|------|------|`);
  summaryLines.push(`| 存在 fail/partial | ${failsOnly.length > 0 ? `是 (${failsOnly.length}题)` : "否"} |`);
  summaryLines.push(`| 非answer主因题数 | ${nonAnswer} |`);
  summaryLines.push(`| 手册5均分 | ${(byVol["手册5_图形编辑"]?.scores.reduce((a,b)=>a+b,0) ?? 0) / (byVol["手册5_图形编辑"]?.count || 1)} |`);
  summaryLines.push(`| 手册7均分 | ${(byVol["手册7_功能块"]?.scores.reduce((a,b)=>a+b,0) ?? 0) / (byVol["手册7_功能块"]?.count || 1)} |`);

  let conclusion = "";
  if (pass === total) {
    conclusion = "✅ **直接收口** — 首轮全绿。手册5+7全卷覆盖达标。";
  } else if (fail === 0 && partial > 0 && nonAnswer === 0) {
    conclusion = `⚠️ **可阶段性收口** — ${partial}/${total} partial，但全部为 answer 层主因。允许最小 answer patch 后复跑 1 轮。`;
  } else if (fail > 0) {
    conclusion = `❌ **存在失败** — ${fail} fail, ${nonAnswer} 非answer主因。需分析后决定下步。`;
  } else {
    conclusion = `⚠️ 混合状态 — 需人工评估。`;
  }
  summaryLines.push(`| **结论** | ${conclusion} |`);
  summaryLines.push(``);

  const summaryMd = summaryLines.join("\n");
  const summaryPath = path.join(resultsDir, `p0b-full-coverage-summary-${dateStr}-round1.md`);
  fs.writeFileSync(summaryPath, summaryMd, "utf-8");
  console.log(`  Summary MD → ${summaryPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
