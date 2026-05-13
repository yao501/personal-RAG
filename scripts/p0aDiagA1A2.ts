/**
 * P0-A A1/A2 专项诊断脚本
 *
 * 对编译(A1)和下装(A2)两个跨卷问题执行逐层检索诊断，
 * dump top-5 chunk 完整信息 + 预期源对照 + 根因判断。
 *
 * Usage:
 *   PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册" \
 *   node --max-old-space-size=3072 \
 *   ./node_modules/.bin/vite-node scripts/p0aDiagA1A2.ts
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
import type { ChunkRecord, DocumentRecord, SearchResult } from "../src/lib/shared/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// ═══════════ 诊断问题 ═══════════

const A1_QUESTION = "在 HOLLiAS MACS V6.5 中，工程组态完成后，编译和下装的完整流程是怎样的？需要分别在哪些软件中进行编译操作？";
const A2_QUESTION = "MACS V6.5 工程编译完成后，下装操作需要将文件下发到哪些目标站？控制器的下装和工程总控的下装各有什么不同？";

// 预期源章节
const A1_EXPECTED = [
  { fileName: "手册3_工程总控", chapter: "Ch5 编译" },
  { fileName: "手册4_算法组态", chapter: "Ch9 编译" }
];
const A2_EXPECTED = [
  { fileName: "手册3_工程总控", chapter: "Ch6 下装" },
  { fileName: "手册4_算法组态", chapter: "Ch10 下装" }
];

// ═══════════ Helpers ═══════════

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "…";
}

function extractChapterHint(sectionPath: string | null): string {
  if (!sectionPath) return "(无)";
  const m = sectionPath.match(/(?:第)?(\d{1,3}(?:\.\d{1,2})?)\s*(?:章|Ch|Chapter)?/i);
  return m ? `Ch${m[1]}` : sectionPath.split(" > ").slice(0, 2).join(" > ");
}

function chunkMatchesExpected(
  chunk: SearchResult,
  expected: Array<{ fileName: string; chapter: string }>
): { matched: boolean; expectedIdx: number } {
  const fn = chunk.fileName ?? "";
  const sp = chunk.sectionPath ?? "";
  const st = chunk.sectionTitle ?? "";
  const bundle = `${fn} ${sp} ${st}`;

  for (let i = 0; i < expected.length; i++) {
    const exp = expected[i];
    // Check if fileName contains the manual number keyword
    const manualMatch = exp.fileName.match(/手册(\d+)/);
    if (manualMatch) {
      const manualNum = manualMatch[1]; // "3" or "4"
      if (!fn.includes(`手册${manualNum}`)) continue;
    }
    // Check if chapter matches
    const chMatch = exp.chapter.match(/^Ch(\d+)/i);
    if (chMatch) {
      const chNum = chMatch[1]; // "5", "6", "9", "10"
      // Look for chapter patterns in sectionPath or sectionTitle
      if (
        bundle.includes(`第${chNum}章`) ||
        bundle.includes(`Chapter ${chNum}`) ||
        new RegExp(`Ch${chNum}\\b`, "i").test(bundle) ||
        new RegExp(`第\\s*${chNum}\\s*章`).test(bundle)
      ) {
        return { matched: true, expectedIdx: i };
      }
    }
  }
  return { matched: false, expectedIdx: -1 };
}

// ═══════════ 语料加载 (手册2+3+4+6，4卷) ═══════════

async function loadCorpus(dir: string): Promise<{
  documents: DocumentRecord[];
  chunks: ChunkRecord[];
}> {
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".pdf"))
    .map((d) => d.name)
    .filter((n) => /^HOLLiAS_MACS_V6\.5用户手册[2346]_.+\.pdf$/i.test(n))
    .sort();

  if (names.length === 0) {
    throw new Error(`未找到手册2/3/4/6：${dir}`);
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

// ═══════════ 单题诊断 ═══════════

interface DiagResult {
  questionId: string;
  question: string;
  expectedSources: Array<{ fileName: string; chapter: string }>;
  top5: Array<{
    rank: number;
    sectionPath: string;
    sectionTitle: string;
    score: number;
    lexicalScore: number;
    semanticScore: number;
    rerankScore: number;
    qualityScore: number;
    evidenceText200: string;
    fileName: string;
    chunkId: string;
    matchesExpected: boolean;
    expectedMatch: string;
  }>;
  answerDirect: string;
  answerFull: string;
  answerCitations: Array<{ chunkId: string; fileName: string }>;
  rootCause: {
    level: "answer/ranking" | "parse/chunk";
    verdict: string;
    detail: string;
  };
  expectedChunksInTopK: boolean;
  expectedChunksInTop10: boolean;
  correctManualHits: string[];
  missingManuals: string[];
}

async function diagnoseOne(
  id: string,
  question: string,
  expectedSources: Array<{ fileName: string; chapter: string }>,
  documents: DocumentRecord[],
  chunks: ChunkRecord[]
): Promise<DiagResult> {
  const topK = DEFAULT_RETRIEVAL_LIMIT;

  // Run full retrieval pipeline (with all P0-B + sprint53c biases enabled)
  const { results: searchResults, vectorChunkIds, candidateChunks, queryRetrievalType } =
    await runRetrievalLikeDesktop(question, documents, chunks, {
      limit: topK,
      hydrateEmbeddings: true,
      sprint53aRetrievalBias: true,
      sprint53aCandidateInject: true,
      sprint53cRetrievalBias: true
    });

  // Get answer
  const answer = answerQuestion(question, searchResults);

  // Build top-5 dump
  const top5 = searchResults.slice(0, 5).map((r, i) => {
    const match = chunkMatchesExpected(r, expectedSources);
    return {
      rank: i + 1,
      sectionPath: r.sectionPath ?? "(无)",
      sectionTitle: r.sectionTitle ?? "(无)",
      score: r.score,
      lexicalScore: r.lexicalScore,
      semanticScore: r.semanticScore,
      rerankScore: r.rerankScore,
      qualityScore: r.qualityScore,
      evidenceText200: truncate(r.evidenceText ?? r.snippet ?? "", 200),
      fileName: r.fileName ?? "(无)",
      chunkId: r.chunkId,
      matchesExpected: match.matched,
      expectedMatch: match.matched ? expectedSources[match.expectedIdx].chapter : "(无)"
    };
  });

  // Check if expected chapters appear in top-K or top-10
  const expectedChaptersInTopK = top5.some((r) => r.matchesExpected);

  // Also scan wider pool (up to 12 candidates) for expected chapters
  const widerPool = searchResults.slice(5, 12);
  const expectedChaptersInTop10 = expectedChaptersInTopK ||
    widerPool.some((r) => chunkMatchesExpected(r, expectedSources).matched);

  // Check which manuals have correct chapter hits anywhere in results
  const correctManualHits: string[] = [];
  const missingManuals: string[] = [];
  for (const exp of expectedSources) {
    const found = searchResults.some((r) => {
      const m = chunkMatchesExpected(r, [exp]);
      return m.matched;
    });
    if (found) {
      correctManualHits.push(`${exp.fileName} > ${exp.chapter}`);
    } else {
      // Also check if at least this manual appears at all
      const manualInResults = searchResults.some((r) => {
        const manualMatch = exp.fileName.match(/手册(\d+)/);
        if (!manualMatch) return false;
        return (r.fileName ?? "").includes(`手册${manualMatch[1]}`);
      });
      missingManuals.push(
        manualInResults
          ? `${exp.fileName} > ${exp.chapter} (手册在top中但章节不对)`
          : `${exp.fileName} > ${exp.chapter} (手册完全未命中)`
      );
    }
  }

  // Root cause analysis
  let rootLevel: "answer/ranking" | "parse/chunk";
  let rootVerdict: string;
  let rootDetail: string;

  if (expectedChaptersInTop10) {
    rootLevel = "answer/ranking";
    if (expectedChaptersInTopK) {
      rootVerdict = "可小修 — 正确章节已在top-K中，answer/ranking层微调即可";
    } else {
      rootVerdict = "可小修 — 正确章节在top-10中但不在top-K，ranking微调可改善";
    }
    rootDetail = expectedChaptersInTopK
      ? `正确章节的 chunk 已在 top-${topK} 中，问题在于 answer 层未充分展开或 ranking 排序不够靠前。可通过调整 answer 模板或微调 ranking 权重改善。`
      : `正确章节的 chunk 在 top-6~10 范围内，但未进入 top-${topK}。ranking 信号调整(如章节boost权重)可将正确章节推入 top-K。`;
  } else {
    rootLevel = "parse/chunk";
    rootVerdict = "已知限制 — 正确章节的 chunk 不在 top-10 中，parse/chunk 层存在问题";
    rootDetail = `预期章节(${expectedSources.map((e) => e.chapter).join(", ")})的 chunk 完全未进入检索 top-10。可能原因：(1) PDF 解析时章节标题识别失败，(2) chunk 切分边界导致关键内容被切碎，(3) 章节路径标记在解析/切分时丢失。需检查对应手册的 PDF 解析质量。`;
  }

  return {
    questionId: id,
    question,
    expectedSources,
    top5,
    answerDirect: answer.directAnswer,
    answerFull: answer.answer,
    answerCitations: answer.citations.map((c) => ({
      chunkId: c.chunkId,
      fileName: c.fileName ?? "(无)"
    })),
    rootCause: {
      level: rootLevel,
      verdict: rootVerdict,
      detail: rootDetail
    },
    expectedChunksInTopK: expectedChaptersInTopK,
    expectedChunksInTop10: expectedChaptersInTop10,
    correctManualHits,
    missingManuals
  };
}

// ═══════════ Report Generation ═══════════

function generateReport(
  results: DiagResult[],
  timestamp: string,
  docCount: number,
  chunkCount: number
): string {
  const lines: string[] = [];

  lines.push(`# P0-A A1/A2 专项诊断报告`);
  lines.push(``);
  lines.push(`**生成时间**: ${timestamp}`);
  lines.push(`**知识库**: HOLLiAS MACS V6.5 用户手册（4卷：手册2+3+4+6）`);
  lines.push(`**文档数**: ${docCount} 卷 | **Chunk 数**: ${chunkCount}`);
  lines.push(`**代码基线**: P0-B 治理（5项改动）+ 支线B answer patch`);
  lines.push(`**检索参数**: chunkSize=260, chunkOverlap=60, topK=${DEFAULT_RETRIEVAL_LIMIT}`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // Summary table
  lines.push(`## 诊断摘要`);
  lines.push(``);
  lines.push(`| 题号 | 正确章节在top-K | 正确章节在top-10 | 根因层 | 判定 |`);
  lines.push(`|------|:---------------:|:----------------:|--------|------|`);
  for (const r of results) {
    lines.push(
      `| ${r.questionId} | ${r.expectedChunksInTopK ? "✅" : "❌"} | ${r.expectedChunksInTop10 ? "✅" : "❌"} | ${r.rootCause.level} | ${r.rootCause.verdict} |`
    );
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // Per-question detail
  for (const r of results) {
    lines.push(`## ${r.questionId} 详细诊断`);
    lines.push(``);
    lines.push(`**问法**: ${r.question}`);
    lines.push(``);

    // Expected sources
    lines.push(`### 预期源`);
    lines.push(``);
    for (const exp of r.expectedSources) {
      lines.push(`- 📗 **${exp.fileName}** → \`${exp.chapter}\``);
    }
    lines.push(``);

    // Top-5 chunk dump
    lines.push(`### Top-5 Chunk 详细信息`);
    lines.push(``);
    for (const chunk of r.top5) {
      const expectedBadge = chunk.matchesExpected ? " 🎯 **预期源命中!**" : "";
      lines.push(`#### #${chunk.rank}${expectedBadge}`);
      lines.push(``);
      lines.push(`| 字段 | 值 |`);
      lines.push(`|------|-----|`);
      lines.push(`| **score** | ${chunk.score.toFixed(4)} |`);
      lines.push(`| **lexicalScore** | ${chunk.lexicalScore.toFixed(4)} |`);
      lines.push(`| **semanticScore** | ${chunk.semanticScore.toFixed(4)} |`);
      lines.push(`| **rerankScore** | ${chunk.rerankScore.toFixed(4)} |`);
      lines.push(`| **qualityScore** | ${chunk.qualityScore.toFixed(4)} |`);
      lines.push(`| **fileName** | \`${chunk.fileName}\` |`);
      lines.push(`| **sectionPath** | \`${chunk.sectionPath}\` |`);
      lines.push(`| **sectionTitle** | \`${chunk.sectionTitle}\` |`);
      lines.push(`| **evidenceText(前200字)** | ${chunk.evidenceText200} |`);
      lines.push(`| **chunkId** | \`${chunk.chunkId}\` |`);
      lines.push(``);
    }

    // Expected source match analysis
    lines.push(`### 预期源对照`);
    lines.push(``);
    lines.push(`| 预期源 | 状态 | 说明 |`);
    lines.push(`|--------|:----:|------|`);
    for (const hit of r.correctManualHits) {
      lines.push(`| ${hit} | ✅ 命中 | 正确章节 chunk 出现在检索结果中 |`);
    }
    for (const miss of r.missingManuals) {
      lines.push(`| ${miss} | ❌ 未命中 | — |`);
    }
    lines.push(``);

    // Answer output
    lines.push(`### answerQuestion 输出`);
    lines.push(``);
    lines.push(`**Direct Answer**:`);
    lines.push(``);
    lines.push(`> ${r.answerDirect.replace(/\n/g, "\n> ")}`);
    lines.push(``);
    lines.push(`**引用 Chunk**:`);
    for (const cit of r.answerCitations) {
      lines.push(`- \`${cit.chunkId}\` → ${cit.fileName}`);
    }
    lines.push(``);

    // Root cause
    lines.push(`### 根因分析`);
    lines.push(``);
    lines.push(`| 项目 | 判定 |`);
    lines.push(`|------|------|`);
    lines.push(`| **根因层** | \`${r.rootCause.level}\` |`);
    lines.push(`| **正确章节在top-K** | ${r.expectedChunksInTopK ? "✅ 是" : "❌ 否"} |`);
    lines.push(`| **正确章节在top-10** | ${r.expectedChunksInTop10 ? "✅ 是" : "❌ 否"} |`);
    lines.push(``);
    lines.push(`**详细说明**: ${r.rootCause.detail}`);
    lines.push(``);

    // Recommendation
    lines.push(`### 建议动作`);
    lines.push(``);
    if (r.rootCause.level === "answer/ranking") {
      lines.push(`- [ ] 检查 answer 层是否已提取正确章节中的关键步骤`);
      lines.push(`- [ ] 若排名偏后，调整 searchIndex 中章节 boost 权重`);
      lines.push(`- [ ] 考虑为「编译流程」「下装对象」类问题增加针对性 answer patch`);
    } else {
      lines.push(`- [ ] 检查对应手册 PDF 的章节解析质量（sectionPath 是否正确标注）`);
      lines.push(`- [ ] 审查 chunk 切分是否导致关键步骤被切断`);
      lines.push(`- [ ] 登记为 parse/chunk 层已知限制，等待基础设施升级`);
    }
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  // Overall conclusion
  lines.push(`## 总结`);
  lines.push(``);
  const answerRankingIssues = results.filter((r) => r.rootCause.level === "answer/ranking").length;
  const parseChunkIssues = results.filter((r) => r.rootCause.level === "parse/chunk").length;
  lines.push(`- **answer/ranking 层问题**: ${answerRankingIssues}/${results.length} 题 — 可小修`);
  lines.push(`- **parse/chunk 层问题**: ${parseChunkIssues}/${results.length} 题 — 已知限制`);
  lines.push(``);

  return lines.join("\n");
}

// ═══════════ Evolution Log Entry ═══════════

function generateEvolutionLogEntry(results: DiagResult[], timestamp: string): string {
  const lines: string[] = [];
  lines.push(``);
  lines.push(`## ${timestamp.slice(0, 10)} A1/A2 专项诊断`);
  lines.push(``);

  lines.push(`### 诊断设置`);
  lines.push(`- 知识库：手册2+3+4+6（4卷）`);
  lines.push(`- 代码基线：P0-B 治理 5项改动 + 支线B answer patch`);
  lines.push(`- 检索参数：chunkSize=260, chunkOverlap=60, topK=${DEFAULT_RETRIEVAL_LIMIT}`);
  lines.push(``);

  lines.push(`### 结果`);
  lines.push(``);
  lines.push(`| 题号 | 正确章节在top-K | 正确章节在top-10 | 根因层 | 判定 |`);
  lines.push(`|------|:---------------:|:----------------:|--------|------|`);
  for (const r of results) {
    lines.push(
      `| ${r.questionId} | ${r.expectedChunksInTopK ? "✅" : "❌"} | ${r.expectedChunksInTop10 ? "✅" : "❌"} | ${r.rootCause.level} | ${r.rootCause.verdict} |`
    );
  }
  lines.push(``);

  for (const r of results) {
    lines.push(`#### ${r.questionId}`);
    lines.push(`- **预期源**: ${r.expectedSources.map((e) => `${e.fileName} > ${e.chapter}`).join(", ")}`);
    lines.push(`- **Top-1 章节**: ${r.top5[0]?.sectionPath ?? "(无)"} (score=${r.top5[0]?.score.toFixed(4) ?? "N/A"})`);
    lines.push(`- **预期源命中**: ${r.correctManualHits.join("; ") || "(无)"}`);
    lines.push(`- **预期源遗漏**: ${r.missingManuals.join("; ") || "(无)"}`);
    lines.push(`- **根因**: ${r.rootCause.level} — ${r.rootCause.verdict}`);
    lines.push(``);
  }

  const answerRankingIssues = results.filter((r) => r.rootCause.level === "answer/ranking").length;
  const parseChunkIssues = results.filter((r) => r.rootCause.level === "parse/chunk").length;
  lines.push(`### 结论`);
  lines.push(`- answer/ranking 层可修: ${answerRankingIssues}/${results.length}`);
  lines.push(`- parse/chunk 层已知限制: ${parseChunkIssues}/${results.length}`);
  lines.push(``);

  return lines.join("\n");
}

// ═══════════ Main ═══════════

async function main(): Promise<void> {
  const dir = process.env.PKRAG_REALPDF_DIR?.trim();
  if (!dir || !fs.existsSync(dir)) {
    console.error("请设置 PKRAG_REALPDF_DIR 环境变量指向 PDF 目录");
    process.exit(1);
  }

  const resultsDir = path.join(repoRoot, "evals", "results");
  fs.mkdirSync(resultsDir, { recursive: true });

  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dateStr = now.toISOString().slice(0, 10);

  console.log("📖 加载语料 (手册2+3+4+6)...");
  const { documents, chunks } = await loadCorpus(dir);
  console.log(`  共 ${documents.length} 卷，${chunks.length} chunks\n`);

  // ── A1 诊断 ──
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔍 A1 诊断: ${A1_QUESTION.slice(0, 60)}...`);
  console.log(`${"=".repeat(60)}`);
  const a1Result = await diagnoseOne("A1", A1_QUESTION, A1_EXPECTED, documents, chunks);
  console.log(`  根因层: ${a1Result.rootCause.level}`);
  console.log(`  判定: ${a1Result.rootCause.verdict}`);
  console.log(`  正确章节在top-K: ${a1Result.expectedChunksInTopK}`);
  console.log(`  正确章节在top-10: ${a1Result.expectedChunksInTop10}`);
  console.log(`  命中: ${a1Result.correctManualHits.join("; ") || "(无)"}`);
  console.log(`  遗漏: ${a1Result.missingManuals.join("; ") || "(无)"}`);

  // ── A2 诊断 ──
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔍 A2 诊断: ${A2_QUESTION.slice(0, 60)}...`);
  console.log(`${"=".repeat(60)}`);
  const a2Result = await diagnoseOne("A2", A2_QUESTION, A2_EXPECTED, documents, chunks);
  console.log(`  根因层: ${a2Result.rootCause.level}`);
  console.log(`  判定: ${a2Result.rootCause.verdict}`);
  console.log(`  正确章节在top-K: ${a2Result.expectedChunksInTopK}`);
  console.log(`  正确章节在top-10: ${a2Result.expectedChunksInTop10}`);
  console.log(`  命中: ${a2Result.correctManualHits.join("; ") || "(无)"}`);
  console.log(`  遗漏: ${a2Result.missingManuals.join("; ") || "(无)"}`);

  const results: DiagResult[] = [a1Result, a2Result];

  // ── 输出报告 ──
  const reportPath = path.join(resultsDir, `p0a-a1a2-diag-${ts}.md`);
  const reportContent = generateReport(results, now.toISOString(), documents.length, chunks.length);
  fs.writeFileSync(reportPath, reportContent, "utf-8");
  console.log(`\n📄 诊断报告已写入: ${reportPath}`);

  // 同时写一份 JSON 结果
  const jsonPath = path.join(resultsDir, `p0a-a1a2-diag-${ts}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2), "utf-8");
  console.log(`📄 JSON 结果已写入: ${jsonPath}`);

  // ── 更新演进日志 ──
  const evolutionLogPath = path.join(repoRoot, "memory", "RAG_EVOLUTION_LOG.md");
  const logEntry = generateEvolutionLogEntry(results, now.toISOString());
  fs.appendFileSync(evolutionLogPath, logEntry, "utf-8");
  console.log(`📝 演进日志已更新: ${evolutionLogPath}`);

  // ── 终判 ──
  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 诊断完成`);
  console.log(`${"=".repeat(60)}`);
  for (const r of results) {
    const emoji = r.rootCause.level === "answer/ranking" ? "🟡" : "🔴";
    console.log(`  ${emoji} ${r.questionId}: ${r.rootCause.level} — ${r.rootCause.verdict}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
