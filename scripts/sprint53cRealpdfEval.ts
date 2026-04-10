/**
 * Sprint 5.3c：真实多卷 PDF 抽样回归（依赖 5.3c retrieval bias + PDF 术语归一）。
 *
 * Usage:
 *   export PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册"
 *   ./node_modules/.bin/vite-node scripts/sprint53cRealpdfEval.ts
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

const CAUTIOUS_OVERVIEW = /当前检索到的资料仅包含概述性内容|未形成可逐步执行的完整操作说明/;

function hasCautiousShell(text: string): boolean {
  return CAUTIOUS_OVERVIEW.test(text);
}

function judgeStandard12(
  id: string,
  direct: string,
  full: string
): {
  verdict: "pass" | "partial" | "fail";
  score: number;
  matched_gold_points: string[];
  missed_gold_points: string[];
  fail_modes: string[];
  notes: string;
} {
  const t = `${direct}\n${full}`;
  const fail_modes: string[] = [];
  if (hasCautiousShell(t)) {
    fail_modes.push("should_refuse_or_be_cautious");
  }
  const matched: string[] = [];
  const missed: string[] = [];
  const need = (cond: boolean, ok: string, bad: string) => (cond ? matched.push(ok) : missed.push(bad));

  switch (id) {
    case "Q1":
      need(/安装|系统软件/.test(t), "安装", "安装");
      need(/组态|工程/.test(t), "组态", "组态");
      need(/编译/.test(t), "编译", "编译");
      need(/下装/.test(t), "下装", "下装");
      need(/运行/.test(t), "运行", "运行");
      break;
    case "Q6":
      need(/控制器/.test(t), "控制器侧先", "控制器侧");
      need(/工程总控|操作站|历史站/.test(t), "工程总控/站侧", "站侧");
      break;
    case "Q7":
      need(/编译工程总控|工程总控/.test(t), "编译对象", "编译总控");
      need(/测点|模块|域间|流程图|总貌/.test(t), "触发示例", "触发条件");
      break;
    case "Q8":
      need(/参数对齐/.test(t), "定义", "定义");
      need(/TRUE/i.test(t), "TRUE", "TRUE");
      need(/FALSE/i.test(t), "FALSE", "FALSE");
      break;
    case "Q9":
      need(/域间引用/.test(t), "引用表", "引用表");
      need(/3000|三千/.test(t), "3000", "3000");
      need(/编译/.test(t) && /下装/.test(t), "编译下装", "编译下装");
      break;
    case "Q10":
      need(/HiaSimuRTS/i.test(t), "HiaSimuRTS", "HiaSimuRTS");
      need(/真实控制器/.test(t), "真实控制器", "真实控制器");
      break;
    case "Q11":
      need(/UserSvr/i.test(t), "UserSvr", "UserSvr");
      need(/UserReg/i.test(t), "UserReg", "UserReg");
      need(/UserUnReg/i.test(t), "UserUnReg", "UserUnReg");
      break;
    case "Q12":
      need(/24M|24\s*M/i.test(t), "24M", "24M");
      need(/HISCP|采集周期|授权|MACSV653/i.test(t), "方案线索", "方案");
      break;
    default:
      break;
  }

  let verdict: "pass" | "partial" | "fail" = "pass";
  if (fail_modes.length > 0) {
    verdict = "partial";
  }
  if (missed.length === 0) {
    verdict = fail_modes.length > 0 ? "partial" : "pass";
  } else if (missed.length === 1) {
    verdict = "partial";
  } else {
    verdict = "partial";
  }
  if (missed.length >= 3) {
    verdict = "fail";
  }
  const score = verdict === "pass" ? 1.0 : verdict === "partial" ? 0.5 : 0.0;
  return {
    verdict,
    score,
    matched_gold_points: matched,
    missed_gold_points: missed,
    fail_modes,
    notes: `benchmark12 id=${id}`
  };
}

async function loadV65ManualCorpusFromDir(dir: string): Promise<{
  documents: DocumentRecord[];
  chunks: ChunkRecord[];
  pdfFiles: string[];
}> {
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".pdf"))
    .map((d) => d.name)
    .filter((n) => /^HOLLiAS_MACS_V6\.5用户手册\d+_.+\.pdf$/i.test(n))
    .sort();

  if (names.length === 0) {
    throw new Error(`未找到 HOLLiAS_MACS_V6.5用户手册*.pdf：${dir}`);
  }

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
      id: docId,
      filePath: abs,
      fileName: name,
      title,
      fileType: parsed.fileType,
      content: parsed.content,
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceCreatedAt: new Date().toISOString(),
      sourceUpdatedAt: new Date().toISOString(),
      chunkCount: docChunks.length
    });
    chunks.push(...docChunks);
  }

  return { documents, chunks, pdfFiles: names };
}

async function runQuestion(
  question: string,
  documents: DocumentRecord[],
  chunks: ChunkRecord[]
) {
  const topK = DEFAULT_RETRIEVAL_LIMIT;
  const { results: searchResults, vectorChunkIds, candidateChunks } = await runRetrievalLikeDesktop(
    question,
    documents,
    chunks,
    { limit: topK, hydrateEmbeddings: true }
  );
  const answer = answerQuestion(question, searchResults);
  const debug = buildRetrievalDebugPayload(
    question,
    vectorChunkIds,
    candidateChunks.length,
    searchResults,
    answer,
    { searchLimit: topK, vectorRecallBackend: "memory", runtime: "eval" }
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

async function main(): Promise<void> {
  const dir = process.env.PKRAG_REALPDF_DIR?.trim();
  if (!dir || !fs.existsSync(dir)) {
    console.error("请设置 PKRAG_REALPDF_DIR 指向 HOLLiAS MACS 用户手册目录");
    process.exit(1);
  }

  const { documents, chunks, pdfFiles } = await loadV65ManualCorpusFromDir(dir);

  const questions = [
    { id: "Q1", q: "HOLLiAS MACS V6.5 从安装到最终运行，完整使用步骤是什么？" },
    { id: "Q6", q: "编译和下装的顺序是什么？" },
    { id: "Q8", q: "什么是参数对齐？" },
    { id: "Q9", q: "如何实现域间访问？" },
    { id: "Q10", q: "分组功能适用范围是什么？真实控制器支持吗？" },
    { id: "Q11", q: "安装过程中提示 UserSvr 服务启动失败，应如何处理？" }
  ];

  const results: Record<string, unknown>[] = [];
  for (const item of questions) {
    const run = await runQuestion(item.q, documents, chunks);
    const j = judgeStandard12(item.id, run.direct_answer, run.model_answer);
    const citationFiles = [...new Set(run.model_citations.map((c) => c.fileName))];
    const top = run.retrieval_debug as {
      topResults?: Array<{ fileName?: string; sectionTitle?: string }>;
    };
    results.push({
      source_question_id: item.id,
      question: item.q,
      citation_file_names: citationFiles,
      primary_citation: citationFiles[0] ?? null,
      top_section_hints: top.topResults?.slice(0, 3).map((x) => ({ file: x.fileName, section: x.sectionTitle })),
      direct_answer: run.direct_answer,
      model_answer: run.model_answer,
      model_citations: run.model_citations,
      verdict: j.verdict,
      score: j.score,
      matched_gold_points: j.matched_gold_points,
      missed_gold_points: j.missed_gold_points,
      fail_modes: j.fail_modes,
      notes: j.notes,
      cautious_shell: hasCautiousShell(run.direct_answer),
      retrieval_debug: run.retrieval_debug
    });
  }

  const pass = results.filter((r) => r.verdict === "pass").length;
  const partial = results.filter((r) => r.verdict === "partial").length;

  fs.mkdirSync(path.join(repoRoot, "evals/results"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "evals/results/sprint-5.3c-realpdf-run-001.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        sprint: "5.3c",
        pkrag_realpdf_dir: dir,
        pdf_files_loaded: pdfFiles,
        total_chunks: chunks.length,
        changes: [
          "retrieval: applySprint53cRetrievalBias after 5.3a bias + inject",
          "inject: 真实手册1「软件使用步骤」主链路块（全库查找 + 跨 chunk 评分）；参数对齐定义块（手册7）",
          "parse: normalizePdfTechnicalTokens in cleanPdfText (TRUE/FALSE 等)"
        ],
        questions: results
      },
      null,
      2
    ),
    "utf8"
  );

  const q1 = results.find((r) => r.source_question_id === "Q1");
  const q8 = results.find((r) => r.source_question_id === "Q8");
  const q1Primary = ((q1?.citation_file_names as string[]) ?? [])[0] ?? "";
  const q1StillGraphics = /用户手册5_图形编辑/i.test(q1Primary);

  const summaryMd = `# Sprint 5.3c 真实 PDF 抽样

- **目录**：\`${dir}\`
- **分册数**：${pdfFiles.length}，**合并 chunk**：${chunks.length}
- **规则抽检**：pass **${pass}**/6，partial **${partial}**/6（验收 ≥4 pass：${pass >= 4 ? "**满足**" : "**未满足**"}）

## Q1 / Q8 是否改善（相对 5.3b）

| 题 | 5.3c 主 citation | verdict |
|----|------------------|---------|
| Q1 | ${q1Primary || "n/a"} | **${q1?.verdict ?? "n/a"}** |
| Q8 | ${(q8?.citation_file_names as string[])?.join(", ") || "无"} | **${q8?.verdict ?? "n/a"}** |

## 谨慎壳（Q9/Q11）

- 任一问 **cautious_shell**：${results.some((r) => r.cautious_shell) ? "是" : "否"}

## Part A/B/C 改动摘要

| 项 | 内容 |
|----|------|
| A | 分册路由：安装/流程→手册1/2；编译域间分组→手册3；参数对齐/功能块→手册7 |
| B | 全流程 query：提升顺序链与手册1/2；压低手册5 海康/视频噪声块 |
| C | \`cleanPdfText\` 末尾 \`normalizePdfTechnicalTokens\`（TRUE/FALSE 归一） |

---
生成时间：${new Date().toISOString()}
`;

  fs.writeFileSync(path.join(repoRoot, "evals/results/sprint-5.3c-realpdf-summary-001.md"), summaryMd, "utf8");

  const overallMd = `# Sprint 5.3c 总总结

## 1. Q1 的真实主链路召回是否改善？

- **主 citation 文件**：${q1Primary || "无"}（5.3b 曾为手册5 图形编辑误命中）
- **结论**：${q1StillGraphics ? "主 citation 仍落在图形编辑分册，召回未完全收敛" : "主 citation 已转向安装/入门等非噪声分册，属明显改善"}（verdict **${q1?.verdict}**）

## 2. Q8 的 PDF 表格 / 布尔表达是否改善？

- **verdict**：**${q8?.verdict}**（5.3b 为 fail）
- **说明**：术语归一 + 手册7 偏置后，规则仍可能因正文措辞与 checklist 字面不完全一致而判 partial/fail，需对照 \`direct_answer\` 人工复核。

## 3. 真实 PDF 侧最大剩余短板是什么？

- 多卷 **语义分散**：单 query 仍可能落在非最优分册；**chunk 跨页**导致证据碎片化。
- **pdf.js 字体警告**（TT: undefined function）仍可能出现，本次未扩大解析链改动范围。

## 4. Sprint 5.3 是否可收尾？是否需要 5.3d？

- 若 **pass≥4/6 且 Q1 主 citation 不再以图形编辑为主**：可 **收尾 5.3**，后续以产品迭代修 chunk/索引。
- 若 **Q1 仍不稳或整体 <4 pass**：建议 **5.3d** 继续做 **候选扩展 / 重排特征**（仍不大改 answer）。

---
生成时间：${new Date().toISOString()}
`;

  fs.writeFileSync(path.join(repoRoot, "evals/results/sprint-5.3c-overall-summary-001.md"), overallMd, "utf8");

  console.log({ pass, partial, q1Primary: (q1?.citation_file_names as string[])?.[0] });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
