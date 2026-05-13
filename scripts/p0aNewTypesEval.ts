/**
 * P0-A 支线A 新题型 Round 1：故障排查型+参数约束型+操作条件型 — 轻量版（逐题运行）
 *
 * 复用 p0aCrossVolumeEval.ts 的 runOne/loadCorpus 模式，
 * 新增 N1-N9 的 judge 逻辑，加载5卷（手册1-4+6）。
 *
 * Usage:
 *   PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册" \
 *   node --max-old-space-size=4096 \
 *   ./node_modules/.bin/vite-node scripts/p0aNewTypesEval.ts
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

/**
 * 故障排查型 judge (N1, N2, N3)
 * 核心：确认 answer 层没有误套流程模板，给出针对性的故障原因/排查步骤
 */
function judgeFaultDiagnosis(id: string, direct: string, full: string): JudgeResult {
  const t = `${direct}\n${full}`;
  const matched: string[] = [];
  const missed: string[] = [];
  const fail_modes: string[] = [];
  const n = (cond: boolean, ok: string, bad: string) => need(cond, matched, missed, ok, bad);

  switch (id) {
    case "N1": {
      n(/编译失败|编译.*错误/.test(t), "提到编译失败/编译错误", "未提及编译失败");
      n(/原因|导致|可能/.test(t), "给出可能原因", "未给原因分析");
      n(/组态.*错误|点数.*授权|变量.*声明|中间变量/.test(t), "涉及具体原因(组态错误/授权点数/变量声明)", "具体原因不充分");
      n(/排查|处理|解决|检查/.test(t), "给出排查/处理步骤", "未给出排查步骤");
      break;
    }
    case "N2": {
      n(/下装失败|创建压缩文件/.test(t), "提到下装失败/创建压缩文件", "未提及具体错误");
      n(/文件权限|文件夹|权限/.test(t), "涉及文件权限排查", "未涉及权限排查");
      n(/检查|解决方案|排查/.test(t), "给出排查/解决方案", "未给出解决方案");
      if (/下装.*流程|下装.*步骤/.test(t) && !/失败|错误|排查|解决/.test(t)) {
        fail_modes.push("generic_procedure_instead_of_diagnosis");
      }
      break;
    }
    case "N3": {
      n(/通讯失败|连接失败|无法连接/.test(t), "提到通讯失败/连接失败", "未提及通讯失败");
      n(/原因|可能|导致/.test(t), "给出可能原因", "未给原因分析");
      n(/排查|检查|尝试/.test(t), "给出排查步骤", "未给出排查步骤");
      n(/网段|网络|在线|仿真/.test(t), "涉及网段/在线模式/仿真限制", "未涉及通讯失败的具体因素");
      break;
    }
  }

  if (/当前检索到的资料仅包含概述性内容|未形成可逐步执行的/.test(t)) {
    fail_modes.push("cautious_overview_shell");
  }
  if (/这个问题更适合参考/.test(t) || /建议参考.*整节/.test(t)) {
    fail_modes.push("redirect_to_manual_section");
  }

  return computeVerdict(matched, missed, fail_modes);
}

/**
 * 参数约束型 judge (N4, N5, N6)
 * 核心：确认精确参数值召回（数字/TRUE-FALSE）和约束边界表述
 */
function judgeParameterConstraint(id: string, direct: string, full: string): JudgeResult {
  const t = `${direct}\n${full}`;
  const matched: string[] = [];
  const missed: string[] = [];
  const fail_modes: string[] = [];
  const n = (cond: boolean, ok: string, bad: string) => need(cond, matched, missed, ok, bad);

  switch (id) {
    case "N4": {
      n(/I\/O|IO|点数/.test(t), "提到 I/O 点数", "未提及 I/O 点数");
      n(/\d{2,},?\d{3}|20000|36000/.test(t), "包含具体数字约束(≥4位数)", "缺少具体数字约束");
      n(/K-CU|控制器.*型号/.test(t), "区分不同控制器型号", "未区分控制器型号");
      n(/控制站.*数量|域.*控制站/.test(t), "涉及域/控制站数量上限", "未涉及控制站数量上限");
      break;
    }
    case "N5": {
      n(/参数对齐/.test(t), "提到参数对齐", "未提及参数对齐");
      n(/TRUE|FALSE/.test(t), "包含 TRUE/FALSE 说明", "未展开 TRUE/FALSE 含义");
      n(/基本类型|基础类型|BOOL|FB.*类型|功能块/.test(t), "区分变量类型(基本类型 vs FB)", "未区分变量类型");
      n(/在线值|离线值|对比|覆盖/.test(t), "涉及在线值/离线值对比行为", "未说明在线/离线值对比");
      break;
    }
    case "N6": {
      n(/加密/.test(t), "提到工程加密", "未提及工程加密");
      n(/密码|权限|限制/.test(t), "涉及密码/权限/限制", "未说明密码或限制条件");
      n(/编译|下装|在线修改/.test(t), "涉及对编译/下装/在线修改的影响", "未说明对编译/下装/在线修改的影响");
      n(/POU|控制逻辑图|程序组织单元/.test(t), "涉及 POU/控制逻辑图", "未涉及 POU");
      break;
    }
  }

  if (/当前检索到的资料仅包含概述性内容/.test(t)) {
    fail_modes.push("cautious_overview_shell");
  }

  return computeVerdict(matched, missed, fail_modes);
}

/**
 * 操作条件型 judge (N7, N8, N9)
 * 核心：确认条件分支提取（全编译/增量编译场景，在线/下装场景）
 */
function judgeOperationCondition(id: string, direct: string, full: string): JudgeResult {
  const t = `${direct}\n${full}`;
  const matched: string[] = [];
  const missed: string[] = [];
  const fail_modes: string[] = [];
  const n = (cond: boolean, ok: string, bad: string) => need(cond, matched, missed, ok, bad);

  switch (id) {
    case "N7": {
      n(/全编译/.test(t), "提到全编译", "未提及全编译");
      n(/增量编译/.test(t), "提到增量编译（对比）", "未提及增量编译对比");
      n(/首次|第一.*编译|初始/.test(t), "涉及首次编译条件", "未提及首次编译触发条件");
      n(/增删|控制站.*增|控制站.*删|系统异常/.test(t), "涉及增删控制站/系统异常触发条件", "未涉及其他触发条件");
      n(/场景|情况|条件|适用/.test(t), "有场景/条件描述", "缺少场景/条件描述");
      break;
    }
    case "N8": {
      n(/增量编译/.test(t), "提到增量编译", "未提及增量编译");
      n(/前提|条件|正常|异常|无.*异常/.test(t), "涉及增量编译前提条件（无系统异常）", "未涉及前提条件");
      n(/修改.*内容|变更|改动/.test(t), "涉及修改内容触发条件", "未涉及修改内容触发");
      n(/优势|优点|快|节省/.test(t), "涉及增量编译优势（快/省时）", "未涉及增量编译优势");
      break;
    }
    case "N9": {
      n(/在线修改|在线值/.test(t), "提到在线修改/在线值", "未提及在线修改");
      n(/下装/.test(t), "提到下装修改", "未提及下装修改");
      n(/参数对齐/.test(t), "涉及参数对齐的作用", "未涉及参数对齐");
      n(/场景|适用|区别|不同/.test(t), "有场景区分描述", "缺少场景区分");
      break;
    }
  }

  if (/当前检索到的资料仅包含概述性内容|未形成可逐步执行的/.test(t)) {
    fail_modes.push("cautious_overview_shell");
  }
  if (/这个问题更适合参考/.test(t) || /建议参考.*整节/.test(t)) {
    fail_modes.push("redirect_to_manual_section");
  }

  return computeVerdict(matched, missed, fail_modes);
}

function computeVerdict(
  matched: string[],
  missed: string[],
  fail_modes: string[]
): JudgeResult {
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
    // 核心词检测：如果核心术语缺失 → retrieval，否则 answer
    const coreTerms = ["编译失败", "下装失败", "I/O", "参数对齐", "全编译", "增量编译", "在线修改", "加密", "通讯失败"];
    const missedCore = missed.filter((m) =>
      coreTerms.some((ct) => m.includes(ct))
    );
    failStage = missedCore.length >= 2 ? "retrieval" : "answer";
  }

  const score = verdict === "pass" ? 1.0 : verdict === "partial" ? 0.5 : 0.0;
  return { verdict, score, matched, missed, fail_modes, fail_stage_hint: failStage };
}

function need(cond: boolean, matched: string[], missed: string[], ok: string, bad: string) {
  cond ? matched.push(ok) : missed.push(bad);
}

// ═══════════ 精简5卷语料加载（跳过高chunk数无关卷：手册5图形编辑1333chunks + 手册7功能块2792chunks） ═══════════

async function loadCorpus(dir: string): Promise<{
  documents: DocumentRecord[];
  chunks: ChunkRecord[];
}> {
  // 精选5卷：手册1(安装),2(快速入门),3(工程总控),4(算法组态),6(现场操作)
  // 跳过手册5（图形编辑，1333chunks）和手册7（功能块，2792chunks）— 与新题型无关
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".pdf"))
    .map((d) => d.name)
    .filter((n) => /^HOLLiAS_MACS_V6\.5用户手册[1-46]_.+\.pdf$/i.test(n))
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

function getJudge(id: string): (direct: string, full: string) => JudgeResult {
  if (id === "N1" || id === "N2" || id === "N3") {
    return (d, f) => judgeFaultDiagnosis(id, d, f);
  }
  if (id === "N4" || id === "N5" || id === "N6") {
    return (d, f) => judgeParameterConstraint(id, d, f);
  }
  if (id === "N7" || id === "N8" || id === "N9") {
    return (d, f) => judgeOperationCondition(id, d, f);
  }
  throw new Error(`Unknown question id: ${id}`);
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

  // 9 道新题型
  const questions: [string, string][] = [
    ["N1", "在 HOLLiAS MACS V6.5 进行工程编译时，如果出现'编译失败'的报错信息，可能是什么原因导致的？应该如何排查和处理？"],
    ["N2", "MACS V6.5 下装操作失败，系统提示'创建压缩文件失败，将导致OPS监视的逻辑与AT不一致，请检查工程文件权限'，这个错误如何排查和解决？"],
    ["N3", "在 AutoThink 中执行在线操作时提示'通讯失败'，无法连接到控制器。有哪些可能的原因？应该如何逐步排查？"],
    ["N4", "MACS V6.5 一个现场控制站最多能支持多少个 I/O 点数？一个域最多能支持多少个控制站？不同型号控制器（K-CU01、K-CU02、K-CU03）的容量有什么区别？"],
    ["N5", "MACS V6.5 算法组态中，变量和功能块的'参数对齐'属性设置为 TRUE 和 FALSE 分别有什么含义？基本类型变量和 FB 类型变量的参数对齐行为有什么不同？"],
    ["N6", "MACS V6.5 的工程加密功能启用后，对工程的编译、下装、在线修改分别有什么影响？加密的 POU 在打开时需要满足什么条件？"],
    ["N7", "MACS V6.5 中，什么情况下需要进行全编译？全编译和增量编译各适用于什么场景？触发全编译的条件有哪些？"],
    ["N8", "MACS V6.5 增量编译的前提条件是什么？修改了哪些内容时会触发增量编译而不是全编译？增量编译相比全编译有什么优势和限制？"],
    ["N9", "MACS V6.5 中，在线修改值和下装修改各适用于什么场景？如果在运行过程中修改了在线值，之后进行下装操作时这些在线值会怎样？参数对齐功能在这个场景中起什么作用？"]
  ];

  const allResults: Record<string, unknown>[] = [];

  // 逐题处理：每轮重新加载语料，跑完一题立即写结果释放内存
  for (const [id, q] of questions) {
    console.log(`\n${"=".repeat(50)}`);
    console.log(`🔍 P0-A ${id} [${id >= "N1" && id <= "N3" ? "故障排查" : id >= "N4" && id <= "N6" ? "参数约束" : "操作条件"}]: ${q.slice(0, 80)}...`);
    console.log(`${"=".repeat(50)}`);

    console.log("📖 加载语料（手册1-4+6，5卷）...");
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

    const judge = getJudge(id);
    const j = judge(run.direct_answer, run.model_answer);
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
    const seq = String(questions.findIndex(([iid]) => iid === id) + 1).padStart(2, "0");
    fs.writeFileSync(
      path.join(resultsDir, `p0a-new-types-run-${dateStr}-N${seq}.json`),
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

  // 按类型分组统计
  const byType: Record<string, { pass: number; partial: number; fail: number; count: number; scores: number[] }> = {};
  for (const r of allResults) {
    const id = r.source_question_id as string;
    let t = "??";
    if (id === "N1" || id === "N2" || id === "N3") t = "故障排查型";
    else if (id === "N4" || id === "N5" || id === "N6") t = "参数约束型";
    else if (id === "N7" || id === "N8" || id === "N9") t = "操作条件型";
    if (!byType[t]) byType[t] = { pass: 0, partial: 0, fail: 0, count: 0, scores: [] };
    byType[t].count++;
    byType[t].scores.push(r.judge_score as number);
    if (r.judge_verdict === "pass") byType[t].pass++;
    else if (r.judge_verdict === "partial") byType[t].partial++;
    else byType[t].fail++;
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`📊 P0-A 新题型支线 Round 1 总结`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Pass: ${pass}/${total} | Partial: ${partial}/${total} | Fail: ${fail}/${total}`);
  console.log(`  平均分: ${avgScore.toFixed(2)}`);
  for (const [t, s] of Object.entries(byType)) {
    const ta = s.scores.reduce((a, b) => a + b, 0) / s.count;
    console.log(`  ${t}: P:${s.pass} Pa:${s.partial} F:${s.fail} | 均分 ${ta.toFixed(2)}`);
  }

  // ── 写 raw json ──
  const ts = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const rawPath = path.join(resultsDir, `p0a-new-types-round1-${ts}.json`);
  fs.writeFileSync(rawPath, JSON.stringify(allResults, null, 2), "utf-8");
  console.log(`\n  Raw JSON → ${rawPath}`);

  // ── 写 summary md ──
  const summaryLines: string[] = [
    `# P0-A 支线A 新题型 Round 1：故障排查+参数约束+操作条件 — 评测报告`,
    ``,
    `**日期**: ${now.toISOString()}`,
    `**知识库**: HOLLiAS MACS V6.5 用户手册（5卷：手册1-4+6）`,
    `**轮次**: Round 1（首轮基线，未修改任何源代码）`,
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

  // 按类型组织详情
  for (const [t, stats] of Object.entries(byType)) {
    const ta = stats.scores.reduce((a, b) => a + b, 0) / stats.count;
    summaryLines.push(`## ${t}（均分 ${ta.toFixed(2)}）`);
    summaryLines.push(``);
    summaryLines.push(`| ID | 结果 | 分数 | 命中 | 遗漏 | 失败阶段 |`);
    summaryLines.push(`|----|------|------|------|------|----------|`);
    const typeResults = allResults.filter((r) => {
      const id = r.source_question_id as string;
      return (t === "故障排查型" && (id === "N1" || id === "N2" || id === "N3")) ||
        (t === "参数约束型" && (id === "N4" || id === "N5" || id === "N6")) ||
        (t === "操作条件型" && (id === "N7" || id === "N8" || id === "N9"));
    });
    for (const r of typeResults) {
      const emoji = r.judge_verdict === "pass" ? "✅" : r.judge_verdict === "partial" ? "⚠️" : "❌";
      summaryLines.push(`| ${r.source_question_id} | ${emoji} ${r.judge_verdict} | ${r.judge_score} | ${(r.judge_matched as string[]).join("; ")} | ${(r.judge_missed as string[]).join("; ")} | ${r.fail_stage_hint || "N/A"} |`);
    }
    summaryLines.push(``);
  }

  summaryLines.push(`## 逐题分析`);
  summaryLines.push(``);
  for (const r of allResults) {
    summaryLines.push(`### ${r.source_question_id} — ${(r.judge_verdict as string).toUpperCase()} (${r.judge_score})`);
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
    summaryLines.push(`**失败模式**: ${(r.judge_fail_modes as string[]).join(", ") || "(无)"}`);
    summaryLines.push(``);
    const da = (r.direct_answer as string).slice(0, 400);
    summaryLines.push(`**回答摘要**: ${da}...`);
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
  summaryLines.push(`| P0-B触发 (≥2非answer同类复现) | ${nonAnswer >= 2 ? "是 ⚠️" : "否"} |`);

  let conclusion = "";
  if (pass === total) {
    conclusion = "✅ **直接收口** — 首轮 9/9 全绿。新题型支线基线达标。";
  } else if (fail === 0 && partial > 0 && nonAnswer === 0) {
    conclusion = `⚠️ **可阶段性收口** — ${partial}/${total} partial，但全部为 answer 层主因。允许最小 answer patch 后复跑 1 轮。`;
  } else if (fail > 0 || nonAnswer >= 2) {
    conclusion = `❌ **存在非answer主因失败** — ${fail} fail, ${nonAnswer} 非answer主因。需深度分析后决定下步。`;
  } else {
    conclusion = `⚠️ 混合状态 — 需人工评估。`;
  }
  summaryLines.push(`| **结论** | ${conclusion} |`);
  summaryLines.push(``);

  const summaryMd = summaryLines.join("\n");
  const summaryPath = path.join(resultsDir, `p0a-new-types-summary-${dateStr}-round1.md`);
  fs.writeFileSync(summaryPath, summaryMd, "utf-8");
  console.log(`  Summary MD → ${summaryPath}`);

  // 9问检查
  console.log("\n📋 V3 强制收口 9 问:");
  console.log(`  1. 新增/修改了哪些文件 → docs/P0-A_NEW_TYPES_PLAN.md, evals/cases/p0a-new-types-round1.json, scripts/p0aNewTypesEval.ts, ${path.basename(rawPath)}, ${path.basename(summaryPath)}`);
  console.log(`  2. 加了几题 → ${total} 题 (${pass} pass, ${partial} partial, ${fail} fail)`);
  console.log(`  3. 每题分别测什么 → 见 summary MD`);
  console.log(`  4. runner 是否复用成功 → 基于 p0aCrossVolumeEval.ts 模式，创建 p0aNewTypesEval.ts（同架构，新增三类 judge）`);
  console.log(`  5. 是否生成新的 raw / results / summary → 是`);
  console.log(`  6. 是否出现 stable partial / fail → ${failsOnly.length > 0 ? `是 (${failsOnly.length}题)` : "否"}`);
  console.log(`  7. 若有 fail/partial，主因是不是 answer → ${failsOnly.length > 0 ? (nonAnswer === 0 ? "是（全为 answer 主因）" : `否（${nonAnswer}题非answer主因）`) : "N/A"}`);
  console.log(`  8. 是否出现满足门槛的 stable+非answer主因+≥2题同类复现 → ${nonAnswer >= 2 ? "是 ⚠️ 登记 P0-B" : "否"}`);
  console.log(`  9. 是否真的需要下一轮 → ${pass === total ? "否（直接收口）" : nonAnswer >= 2 ? "是（需depth分析）" : partial > 0 ? "可选（最小 answer patch 后复跑）" : "是"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
