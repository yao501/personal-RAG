/**
 * P0-A 支线A Round 1：跨分册主链评测 — 轻量版（逐题运行，节省内存）
 *
 * Usage:
 *   PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册" \
 *   node --max-old-space-size=3072 \
 *   ./node_modules/.bin/vite-node scripts/p0aCrossVolumeEval.ts
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

// ═══════════ Judge ═══════════

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

function judgeCrossVolume(id: string, direct: string, full: string): JudgeResult {
  const t = `${direct}\n${full}`;
  const matched: string[] = [];
  const missed: string[] = [];
  const fail_modes: string[] = [];
  const need = (cond: boolean, ok: string, bad: string) =>
    cond ? matched.push(ok) : missed.push(bad);

  switch (id) {
    case "A1":
      need(/编译/.test(t), "提到编译", "未提及编译");
      need(
        /工程总控/.test(t) || /AutoThink/.test(t) || /控制器/.test(t),
        "区分工程总控/控制器编译",
        "未区分工程总控与控制器编译"
      );
      need(
        /算法组态|控制站|控制器算法/.test(t),
        "涉及控制器算法侧",
        "遗漏控制器算法编译侧"
      );
      need(
        /编译设置|全编译|增量编译|FULL_COMPILE|ADD_COMPILE/.test(t),
        "涉及编译操作方式",
        "编译操作细节不足"
      );
      break;
    case "A2":
      need(/下装/.test(t), "提到下装", "未提及下装");
      need(
        /历史站|操作员站|操作站|报表/.test(t),
        "涉及工程总控下装目标站",
        "未提及工程总控下装目标站"
      );
      need(
        /控制器|控制站/.test(t),
        "区分控制器下装",
        "未区分控制器下装"
      );
      need(
        /编译.*文件|下装文件|数据生效/.test(t),
        "涉及下装文件/数据生效",
        "下装文件/数据生效说明不足"
      );
      break;
    case "A3":
      need(/组态|工程/.test(t), "包含组态/工程阶段", "遗漏组态/工程阶段");
      need(/编译/.test(t), "包含编译阶段", "遗漏编译阶段");
      need(/下装/.test(t), "包含下装阶段", "遗漏下装阶段");
      need(/运行|在线|调试|操作/.test(t), "包含运行/调试阶段", "遗漏运行/调试阶段");
      need(
        /先.*后|然后|接着|最后|步骤|流程|顺序|阶段/.test(t),
        "有步骤顺序描述",
        "缺少步骤顺序感"
      );
      break;
    case "A4":
      need(/仿真/.test(t), "提到仿真", "未提及仿真");
      need(/调试|在线/.test(t), "提到调试", "未提及调试");
      need(
        /编译|下装/.test(t),
        "提及仿真前置步骤",
        "未提及仿真前置步骤"
      );
      if (t.includes("仿真") && t.includes("调试")) {
        matched.push("包含仿真和调试区分");
      } else {
        missed.push("仿真和调试描述不完整");
      }
      break;
  }

  if (/当前检索到的资料仅包含概述性内容|未形成可逐步执行的完整操作说明/.test(t)) {
    fail_modes.push("cautious_overview_shell");
  }

  let verdict: JudgeVerdict;
  if (missed.length === 0) {
    verdict = fail_modes.length > 0 ? "partial" : "pass";
  } else if (missed.length <= 2) {
    verdict = "partial";
  } else {
    verdict = "fail";
  }

  let failStage: FailStage | null = null;
  if (verdict !== "pass" && missed.length > 0) {
    const coreTerms = ["编译", "下装", "组态", "仿真", "调试", "工程总控", "控制器"];
    const missedCore = missed.filter((m) =>
      coreTerms.some((ct) => m.includes(ct))
    );
    failStage = missedCore.length >= 2 ? "retrieval" : "answer";
  }
  const score = verdict === "pass" ? 1.0 : verdict === "partial" ? 0.5 : 0.0;
  return { verdict, score, matched, missed, fail_modes, fail_stage_hint: failStage };
}

// ═══════════ 精简语料加载（仅5卷，跳过功能块手册7+硬件手册1） ═══════════

async function loadCorpus(dir: string): Promise<{
  documents: DocumentRecord[];
  chunks: ChunkRecord[];
}> {
  // 精选5卷：手册2~6（软件安装/快速入门/工程总控/算法组态/图形编辑/现场操作）
  // 跳过手册7（功能块，2792 chunks，与主链评测无直接关系）
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".pdf"))
    .map((d) => d.name)
    .filter((n) => /^HOLLiAS_MACS_V6\.5用户手册[1-6]_.+\.pdf$/i.test(n))
    .sort();

  if (names.length === 0) {
    throw new Error(`未找到 HOLLiAS_MACS_V6.5用户手册*.pdf：${dir}`);
  }

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

// ═══════════ 单题跑 ═══════════

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

  const questions: [string, string][] = [
    ["A1", "在 HOLLiAS MACS V6.5 中，工程组态完成后，编译和下装的完整流程是怎样的？需要分别在哪些软件中进行编译操作？"],
    ["A2", "MACS V6.5 工程编译完成后，下装操作需要将文件下发到哪些目标站？控制器的下装和工程总控的下装各有什么不同？"],
    ["A3", "从新建工程到最终在线运行，MACS V6.5 工程组态的完整操作顺序是什么？编译、下装、调试分别在哪个阶段执行？"],
    ["A4", "MACS V6.5 的仿真功能和在线调试功能有什么区别？分别在哪本手册中说明？使用仿真前需要完成哪些前置步骤？"]
  ];

  const allResults: Record<string, unknown>[] = [];

  // 逐题处理：每轮重新加载语料，跑完一题立即写结果释放内存
  for (const [id, q] of questions) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`🔍 P0-A ${id}: ${q.slice(0, 60)}...`);
    console.log(`${"=".repeat(50)}`);

    console.log("📖 加载语料...");
    let docs: DocumentRecord[], chs: ChunkRecord[];
    try {
      const corpus = await loadCorpus(dir);
      docs = corpus.documents; chs = corpus.chunks;
      console.log(`  共 ${docs.length} 卷，${chs.length} chunks`);
    } catch (e: any) {
      console.error(`  加载失败: ${e.message}`);
      continue;
    }

    console.log(`🔎 检索+回答...`);
    const start = Date.now();
    let run: Awaited<ReturnType<typeof runOne>>;
    try {
      run = await runOne(id, q, docs, chs);
    } catch (e: any) {
      console.error(`  运行失败: ${e.message}`);
      continue;
    }
    const elapsed = Date.now() - start;

    const j = judgeCrossVolume(id, run.direct_answer, run.model_answer);
    const citationFiles = [...new Set(run.model_citations.map((c) => c.fileName))];
    const top = run.retrieval_debug as {
      topResults?: Array<{ fileName?: string; sectionTitle?: string }>;
    };

    const result: Record<string, unknown> = {
      source_question_id: id,
      question: q,
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

    // 立即写中间结果
    const seq = String(questions.findIndex(([iid]) => iid === id) + 1).padStart(3, "0");
    fs.writeFileSync(
      path.join(resultsDir, `p0a-cross-volume-run-${dateStr}-A${seq}.json`),
      JSON.stringify(result, null, 2), "utf-8"
    );

    // 释放引用
    docs = null as any;
    chs = null as any;
    if (global.gc) global.gc();
  }

  // ── 总结 ──
  const total = allResults.length;
  const pass = allResults.filter((r) => r.judge_verdict === "pass").length;
  const partial = allResults.filter((r) => r.judge_verdict === "partial").length;
  const fail = allResults.filter((r) => r.judge_verdict === "fail").length;
  const avgScore = allResults.reduce((s, r) => s + (r.judge_score as number), 0) / (total || 1);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 P0-A 支线A Round 1 总结`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Pass: ${pass}/${total} | Partial: ${partial}/${total} | Fail: ${fail}/${total}`);
  console.log(`  平均分: ${avgScore.toFixed(2)}`);

  const summaryMd = [
    `# P0-A 支线A Round 1：跨分册主链 — 评测报告`,
    ``,
    `**日期**: ${now.toISOString()}`,
    `**知识库**: HOLLiAS MACS V6.5 用户手册（精简5卷）`,
    `**轮次**: Round 1（首轮基线）`,
    ``,
    `| 指标 | 值 |`,
    `|------|-----|`,
    `| 总题数 | ${total} | Pass | ${pass} | Partial | ${partial} | Fail | ${fail} | 平均分 | ${avgScore.toFixed(2)} |`,
    ``,
    ...allResults.map((r) =>
      `### ${r.source_question_id} — ${(r.judge_verdict as string).toUpperCase()} (${r.judge_score})\n` +
      `**问法**: ${r.question}\n` +
      `**引用文件**: ${(r.citation_file_names as string[]).join(", ") || "(无)"}\n` +
      `**Top章节**: ` +
      ((r.top_section_hints as Array<{ file: string; section: string }>)?.map((h) => `${h.file}: ${h.section}`).join("; ") || "无") + `\n` +
      `**命中**: ${(r.judge_matched as string[]).join("; ") || "(空)"}\n` +
      `**遗漏**: ${(r.judge_missed as string[]).join("; ") || "(空)"}\n` +
      `**失败阶段**: ${r.fail_stage_hint || "N/A"}\n` +
      `**回答摘要**: ${(r.direct_answer as string).slice(0, 250)}...\n\n`
    ),
    `## 首轮结论`,
    fail > 0
      ? `❌ ${fail}/${total} fail。主因分析见上文。`
      : partial > 0
        ? `⚠️ ${partial}/${total} partial。主因偏向 answer 层细节不足。`
        : `✅ 首轮全绿。建议直接收口。`
  ].join("\n");

  const seq = "final";
  fs.writeFileSync(path.join(resultsDir, `p0a-cross-volume-summary-${dateStr}-round1.md`), summaryMd, "utf-8");

  // 9问检查
  console.log("\n📋 强制收口检查:");
  const failsOnly = allResults.filter(r => (r.judge_verdict as string) !== "pass");
  const nonAnswer = failsOnly.filter(r => r.fail_stage_hint && r.fail_stage_hint !== "answer").length;
  console.log(`  存在 fail/partial: ${failsOnly.length > 0 ? "是" : "否"}`);
  console.log(`  非answer主因题数: ${nonAnswer}`);
  console.log(`  P0-B触发: ${nonAnswer >= 2 ? "是 ⚠️" : "否"}`);
  console.log(`  下一轮建议: ${fail > 0 || nonAnswer >= 2 ? "需深度分析后决定" : partial > 0 ? "可考虑最小answer patch后复跑" : "直接收口"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
