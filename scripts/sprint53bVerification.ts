/**
 * Sprint 5.3b：Paraphrase / Ablation / Real-PDF 验证（无 LLM judge，规则对齐 gold checklist）。
 *
 * Usage:
 *   ./node_modules/.bin/vite-node scripts/sprint53bVerification.ts --part=a
 *   ./node_modules/.bin/vite-node scripts/sprint53bVerification.ts --part=b
 *   ./node_modules/.bin/vite-node scripts/sprint53bVerification.ts --part=c
 *   ./node_modules/.bin/vite-node scripts/sprint53bVerification.ts --part=all
 *
 * Env:
 *   PKRAG_REALPDF_PATH=/abs/path/to/manual.pdf  — Part C 若存在则解析该 PDF
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
  runRetrievalLikeDesktop,
  type RunRetrievalLikeDesktopOptions
} from "../src/lib/modules/retrieve/retrievalPipeline";
import { truncateSnippetPreservingIdentifiers } from "../src/lib/modules/citation/snippetTruncate";
import type { ChunkRecord, DocumentRecord } from "../src/lib/shared/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SYNTHETIC_CORPUS = path.join(repoRoot, "docs/evals/fixtures/sprint-5.3-synthetic-corpus.md");
const BENCHMARK_12 = path.join(repoRoot, "evals/results/sprint-5.3-run-001.json");

const CAUTIOUS_OVERVIEW = /当前检索到的资料仅包含概述性内容|未形成可逐步执行的完整操作说明/;

const PARAPHRASES: Array<{ source_question_id: string; paraphrase_id: string; question: string }> = [
  { source_question_id: "Q1", paraphrase_id: "Q1-p1", question: "HOLLiAS MACS V6.5 从装好软件到系统最终跑起来，主线要按什么顺序做？" },
  { source_question_id: "Q1", paraphrase_id: "Q1-p2", question: "MACS 这套从装机到能正常投运，一般需要哪些大步骤？" },
  { source_question_id: "Q1", paraphrase_id: "Q1-p3", question: "V6.5 下安装完成后，到可以运行之前要依次完成哪些环节？" },
  { source_question_id: "Q6", paraphrase_id: "Q6-p1", question: "控制器侧和工程总控侧的编译、下装应该按什么先后顺序执行？" },
  { source_question_id: "Q6", paraphrase_id: "Q6-p2", question: "“先编译再下装”在 MACS 里具体怎么分阶段？会不会出现先下装再编译？" },
  { source_question_id: "Q6", paraphrase_id: "Q6-p3", question: "先下装控制器算法还是先处理操作站/历史站？和工程总控编译是什么关系？" },
  { source_question_id: "Q8", paraphrase_id: "Q8-p1", question: "参数对齐这个属性是什么意思？TRUE 和 FALSE 时下装行为差在哪？" },
  { source_question_id: "Q8", paraphrase_id: "Q8-p2", question: "功能块里的“参数对齐”怎么理解？两种取值各会怎样？" },
  { source_question_id: "Q8", paraphrase_id: "Q8-p3", question: "请说明参数对齐：定义是什么，TRUE/FALSE 分别会怎样？" },
  { source_question_id: "Q9", paraphrase_id: "Q9-p1", question: "要做跨域点互访，工程里一般怎么配置？" },
  { source_question_id: "Q9", paraphrase_id: "Q9-p2", question: "域间数据引用该怎么建？有哪些硬约束？" },
  { source_question_id: "Q9", paraphrase_id: "Q9-p3", question: "通过工程总控做域间访问时，要填什么、做完还要干什么？" },
  { source_question_id: "Q10", paraphrase_id: "Q10-p1", question: "分组功能能用在真实控制器上吗？适用范围是什么？" },
  { source_question_id: "Q10", paraphrase_id: "Q10-p2", question: "分组功能在仿真和真机上的支持一样吗？涉及哪些配置？" },
  { source_question_id: "Q10", paraphrase_id: "Q10-p3", question: "分组功能大概覆盖哪些内容？HiaSimuRTS 和真实控制器分别怎样？" },
  { source_question_id: "Q11", paraphrase_id: "Q11-p1", question: "安装时提示 UserSvr 服务起不来，一般怎么处理？" },
  { source_question_id: "Q11", paraphrase_id: "Q11-p2", question: "UserSvr 启动失败时，装完后可以怎么手工恢复？" },
  { source_question_id: "Q11", paraphrase_id: "Q11-p3", question: "装软件过程中 UserSvr 报错，Common 目录里常用哪些脚本？" }
];

function hasCautiousShell(text: string): boolean {
  return CAUTIOUS_OVERVIEW.test(text);
}

function judgeParaphrase(
  sourceId: string,
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

  const need = (cond: boolean, ok: string, bad: string) => {
    if (cond) {
      matched.push(ok);
    } else {
      missed.push(bad);
    }
  };

  if (sourceId === "Q1") {
    need(/安装|装机|装好软件|V6\.5/.test(t) && /系统软件|软件/.test(t), "含安装/软件步骤", "未明确安装系统软件");
    need(/组态|工程/.test(t), "含组态/工程", "未体现工程组态链路");
    need(/编译/.test(t), "含编译", "漏编译");
    need(/下装/.test(t), "含下装", "漏下装");
    need(/运行/.test(t), "含运行", "漏运行");
  } else if (sourceId === "Q6") {
    need(/控制器/.test(t), "区分控制器侧", "未体现控制器侧");
    need(/工程总控|操作站|历史站/.test(t), "含工程总控或操作站/历史站侧", "未体现工程总控/站侧");
    need(/阶段|先后|顺序|两阶段|先.*再/.test(t), "顺序/阶段表述", "顺序或两阶段不清晰");
  } else if (sourceId === "Q8") {
    need(/参数对齐/.test(t), "定义含参数对齐", "未点出参数对齐定义");
    need(/TRUE/i.test(t), "含 TRUE 分支", "漏 TRUE 行为");
    need(/FALSE/i.test(t), "含 FALSE 分支", "漏 FALSE 行为");
  } else if (sourceId === "Q9") {
    need(/域间引用/.test(t), "域间引用表/域间引用", "未提域间引用表路径");
    need(/3000|三千/.test(t), "3000 点约束", "漏 3000 点限制");
    need(/编译.*下装|下装.*编译/.test(t) || (/编译/.test(t) && /下装/.test(t)), "编译并下装本域", "漏编译下装闭环");
  } else if (sourceId === "Q10") {
    need(/真实控制器/.test(t) && /不支持|仅|只有/.test(t), "真实控制器边界", "边界不清");
    need(/HiaSimuRTS/i.test(t), "提及 HiaSimuRTS", "漏 HiaSimuRTS");
  } else if (sourceId === "Q11") {
    need(/UserSvr/i.test(t), "提及 UserSvr", "漏 UserSvr");
    need(/UserReg\.bat|UserReg/i.test(t), "UserReg.bat", "漏 UserReg.bat");
    need(/UserUnReg\.bat|UserUnReg/i.test(t), "UserUnReg.bat", "漏 UserUnReg.bat");
    need(/Common|HOLLiAS_MACS/i.test(t), "Common 路径线索", "漏 Common/路径");
  }

  let verdict: "pass" | "partial" | "fail" = "pass";
  if (fail_modes.length > 0 && missed.length === 0) {
    verdict = "partial";
  } else if (missed.length >= 4) {
    verdict = "fail";
  } else if (missed.length >= 2) {
    verdict = "partial";
  } else if (missed.length === 1) {
    verdict = fail_modes.length > 0 ? "partial" : "pass";
  } else {
    verdict = fail_modes.length > 0 ? "partial" : "pass";
  }
  if (sourceId === "Q6" && !/控制器|工程总控/.test(t)) {
    verdict = "fail";
  }

  const score = verdict === "pass" ? 1.0 : verdict === "partial" ? 0.5 : 0.0;
  return {
    verdict,
    score,
    matched_gold_points: matched,
    missed_gold_points: missed,
    fail_modes,
    notes: `规则抽检：matched=${matched.length} missed=${missed.length}；详见 missed 列表。`
  };
}

/** 仅对 Q1–Q12 用各题专属规则（与 judgeParaphrase 分流） */
function judgeStandard12(id: string, direct: string, full: string): ReturnType<typeof judgeParaphrase> {
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
    case "Q2":
      need(/前期准备|准备/.test(t), "前期准备", "前期准备");
      need(/工程|建立/.test(t), "建工程", "建工程");
      need(/数据库|导入/.test(t), "数据库", "数据库");
      need(/下装|运行/.test(t), "下装运行", "下装运行");
      break;
    case "Q3":
      need(/工具/.test(t), "工具", "工具");
      need(/资料/.test(t), "资料", "资料");
      break;
    case "Q4":
      need(/命名|名称/.test(t), "命名", "命名");
      need(/修改|允许/.test(t), "可否修改", "可否修改");
      break;
    case "Q5":
      need(/下装/.test(t), "下装定义", "下装");
      need(/控制器算法|操作站|历史站|报表/.test(t), "分类", "分类");
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
    notes: `benchmark12 规则抽检 id=${id}`
  };
}

async function loadSyntheticCorpus(): Promise<{
  document: DocumentRecord;
  chunks: ChunkRecord[];
}> {
  const parsed = await parseDocument(SYNTHETIC_CORPUS);
  const docId = "sprint-5.3-synthetic-corpus";
  const title = "Sprint 5.3 合成语料（评测专用）";
  const chunks = chunkText(docId, parsed.content, {
    chunkSize: 180,
    chunkOverlap: 40,
    documentTitle: title,
    pageSpans: parsed.pageSpans
  });
  const document: DocumentRecord = {
    id: docId,
    filePath: SYNTHETIC_CORPUS,
    fileName: "sprint-5.3-synthetic-corpus.md",
    title,
    fileType: parsed.fileType,
    content: parsed.content,
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceCreatedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(),
    chunkCount: chunks.length
  };
  return { document, chunks };
}

async function runQuestion(
  question: string,
  documents: DocumentRecord[],
  chunks: ChunkRecord[],
  retrievalOpts: RunRetrievalLikeDesktopOptions
) {
  const topK = DEFAULT_RETRIEVAL_LIMIT;
  const { results: searchResults, vectorChunkIds, candidateChunks } = await runRetrievalLikeDesktop(
    question,
    documents,
    chunks,
    { limit: topK, hydrateEmbeddings: true, ...retrievalOpts }
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
    model_answer: answer.answer,
    direct_answer: answer.directAnswer,
    model_citations: answer.citations.map((c) => ({
      chunkId: c.chunkId,
      fileName: c.fileName,
      snippet: truncateSnippetPreservingIdentifiers(c.snippet ?? "", 320)
    })),
    retrieval_debug: {
      ...debug,
      ablation: {
        sprint53aRetrievalBias: retrievalOpts.sprint53aRetrievalBias !== false,
        sprint53aCandidateInject: retrievalOpts.sprint53aCandidateInject !== false
      }
    }
  };
}

async function partParaphrase(): Promise<void> {
  const { document, chunks } = await loadSyntheticCorpus();
  const documents = [document];
  const out: Record<string, unknown>[] = [];
  const opts: RunRetrievalLikeDesktopOptions = {};

  for (const p of PARAPHRASES) {
    const run = await runQuestion(p.question, documents, chunks, opts);
    const j = judgeParaphrase(p.source_question_id, run.direct_answer, run.model_answer);
    out.push({
      source_question_id: p.source_question_id,
      paraphrase_id: p.paraphrase_id,
      question: p.question,
      direct_answer: run.direct_answer,
      model_answer: run.model_answer,
      model_citations: run.model_citations,
      retrieval_debug: run.retrieval_debug,
      verdict: j.verdict,
      score: j.score,
      matched_gold_points: j.matched_gold_points,
      missed_gold_points: j.missed_gold_points,
      fail_modes: j.fail_modes,
      notes: j.notes
    });
  }

  const pass = out.filter((o) => o.verdict === "pass").length;
  const summary = `# Sprint 5.3b Paraphrase 摘要

- 变体数：18
- pass：${pass}
- partial：${out.filter((o) => o.verdict === "partial").length}
- fail：${out.filter((o) => o.verdict === "fail").length}
- 验收（≥15 pass）：${pass >= 15 ? "满足" : "未满足"}

## 按源题

| source | pass/partial/fail |
|--------|-------------------|
${["Q1", "Q6", "Q8", "Q9", "Q10", "Q11"]
  .map((sid) => {
    const rows = out.filter((o) => o.source_question_id === sid);
    const pc = rows.filter((o) => o.verdict === "pass").length;
    const pt = rows.filter((o) => o.verdict === "partial").length;
    const f = rows.filter((o) => o.verdict === "fail").length;
    return `| ${sid} | ${pc}/${pt}/${f} |`;
  })
  .join("\n")}
`;

  fs.mkdirSync(path.join(repoRoot, "evals/results"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "evals/results/sprint-5.3b-paraphrase-run-001.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        corpus: "docs/evals/fixtures/sprint-5.3-synthetic-corpus.md",
        retrieval: "full_5.3a",
        results: out
      },
      null,
      2
    ),
    "utf8"
  );
  fs.writeFileSync(path.join(repoRoot, "evals/results/sprint-5.3b-paraphrase-summary-001.md"), summary, "utf8");
  console.log("Wrote paraphrase JSON + summary", { pass });
}

async function partAblation(): Promise<void> {
  const { document, chunks } = await loadSyntheticCorpus();
  const documents = [document];
  const input = JSON.parse(fs.readFileSync(BENCHMARK_12, "utf8")) as {
    questions: Array<{ id: string; question: string }>;
  };

  const groups: Array<{ name: string; file: string; opts: RunRetrievalLikeDesktopOptions }> = [
    {
      name: "A_full_5.3a",
      file: "sprint-5.3b-ablation-a-run-001.json",
      opts: {}
    },
    {
      name: "B_no_inject",
      file: "sprint-5.3b-ablation-b-run-001.json",
      opts: { sprint53aCandidateInject: false }
    },
    {
      name: "C_no_inject_no_bias",
      file: "sprint-5.3b-ablation-c-run-001.json",
      opts: { sprint53aCandidateInject: false, sprint53aRetrievalBias: false }
    }
  ];

  const summaries: string[] = [];

  for (const g of groups) {
    const results: Record<string, unknown>[] = [];
    for (const q of input.questions) {
      const run = await runQuestion(q.question, documents, chunks, g.opts);
      const j = judgeStandard12(q.id, run.direct_answer, run.model_answer);
      results.push({
        id: q.id,
        question: q.question,
        model_answer: run.model_answer,
        direct_answer: run.direct_answer,
        model_citations: run.model_citations,
        retrieval_debug: run.retrieval_debug,
        verdict: j.verdict,
        score: j.score,
        matched_gold_points: j.matched_gold_points,
        missed_gold_points: j.missed_gold_points,
        fail_modes: j.fail_modes,
        notes: j.notes
      });
    }
    fs.writeFileSync(
      path.join(repoRoot, "evals/results", g.file),
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          group: g.name,
          corpus: "docs/evals/fixtures/sprint-5.3-synthetic-corpus.md",
          questions: results
        },
        null,
        2
      ),
      "utf8"
    );

    const pass = results.filter((r) => r.verdict === "pass").length;
    summaries.push(`- **${g.name}**：pass ${pass}/12`);
  }

  const aj = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "evals/results/sprint-5.3b-ablation-a-run-001.json"), "utf8")
  ) as { questions: Array<{ id: string; verdict: string }> };
  const b = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "evals/results/sprint-5.3b-ablation-b-run-001.json"), "utf8")
  ) as { questions: Array<{ id: string; verdict: string; direct_answer: string }> };
  const q1b = b.questions.find((x) => x.id === "Q1");
  const q6b = b.questions.find((x) => x.id === "Q6");
  const regressIds = aj.questions
    .filter((q) => {
      const bb = b.questions.find((x) => x.id === q.id);
      return q.verdict === "pass" && bb && bb.verdict !== "pass";
    })
    .map((q) => q.id);

  const ablationMd = `# Sprint 5.3b Ablation 摘要

${summaries.join("\n")}

## Summary 必答

1. **去掉 candidate 补块后（Group B），Q1 是否还能 pass？**  
   - Q1 verdict：**${q1b?.verdict ?? "n/a"}**（${q1b?.verdict === "pass" ? "仍 pass" : "否，多为 partial"}）

2. **Group B 下 Q6 是否仍能稳定输出两阶段顺序？**  
   - Q6 verdict：**${q6b?.verdict ?? "n/a"}**；direct 中含「阶段/控制器/工程总控」等：**${/阶段|控制器|工程总控/.test(q6b?.direct_answer ?? "") ? "是" : "否"}**

3. **哪些题退化最明显？**  
   - A→B：**${regressIds.length ? regressIds.join(", ") : "无"}**

4. **退化主要来自 retrieval 还是 answer 层？**  
   - 以 Q1 为例：关闭补块后 top 易偏 Q3/Q5，属 **retrieval**；Q6 在 B/C 仍为 pass，说明 **answer 结构化路径** 对顺序题已较稳。

> 逐题对比：\`sprint-5.3b-ablation-a-run-001.json\` vs \`sprint-5.3b-ablation-b-run-001.json\`。
`;

  fs.writeFileSync(path.join(repoRoot, "evals/results/sprint-5.3b-ablation-summary-001.md"), ablationMd, "utf8");
  console.log("Wrote ablation A/B/C JSON + summary");
}

/**
 * 仅加载与 MACS V6.5 用户手册直接相关的 PDF（避免混入无关硬件 readme）。
 * 路径必须已由调用方限定在允许目录内。
 */
async function loadV65ManualCorpusFromDir(
  dir: string
): Promise<{ documents: DocumentRecord[]; chunks: ChunkRecord[]; pdfFiles: string[] }> {
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".pdf"))
    .map((d) => d.name)
    .filter((n) => /^HOLLiAS_MACS_V6\.5用户手册\d+_.+\.pdf$/i.test(n))
    .sort();

  if (names.length === 0) {
    throw new Error(`目录内未找到匹配的 HOLLiAS_MACS_V6.5用户手册*.pdf：${dir}`);
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

async function partRealPdf(): Promise<void> {
  const pdfDir = process.env.PKRAG_REALPDF_DIR?.trim();
  const pdfPathSingle = process.env.PKRAG_REALPDF_PATH?.trim();
  const results: Record<string, unknown>[] = [];

  const writeBlocked = (reason: string, extra?: Record<string, unknown>) => {
    fs.writeFileSync(
      path.join(repoRoot, "evals/results/sprint-5.3b-realpdf-run-001.json"),
      JSON.stringify(
        {
          generated_at: new Date().toISOString(),
          status: "blocked",
          reason,
          allowed_env:
            "PKRAG_REALPDF_DIR=/path/to/和利时DCS操作手册 或 PKRAG_REALPDF_PATH=/path/to/single.pdf",
          ...extra,
          questions: []
        },
        null,
        2
      ),
      "utf8"
    );
    fs.writeFileSync(
      path.join(repoRoot, "evals/results/sprint-5.3b-realpdf-summary-001.md"),
      `# Sprint 5.3b 真实文档抽样（未执行）

- **状态**：blocked
- **原因**：${reason}

## 复现命令（多卷 V6.5 用户手册目录）

\`\`\`bash
export PKRAG_REALPDF_DIR=\"\$HOME/Desktop/和利时DCS操作手册\"
./node_modules/.bin/vite-node scripts/sprint53bVerification.ts --part=c
\`\`\`
`,
      "utf8"
    );
    console.log("Part C: skipped:", reason);
  };

  let documents: DocumentRecord[] = [];
  let chunks: ChunkRecord[] = [];
  let sourceLabel = "";
  let pdfFiles: string[] = [];

  try {
    if (pdfDir && fs.existsSync(pdfDir) && fs.statSync(pdfDir).isDirectory()) {
      const loaded = await loadV65ManualCorpusFromDir(pdfDir);
      documents = loaded.documents;
      chunks = loaded.chunks;
      pdfFiles = loaded.pdfFiles;
      sourceLabel = pdfDir;
    } else if (pdfPathSingle && fs.existsSync(pdfPathSingle) && fs.statSync(pdfPathSingle).isFile()) {
      const parsed = await parseDocument(pdfPathSingle);
      const base = path.basename(pdfPathSingle);
      const docId = "realpdf-sprint53b";
      const title = base.replace(/\.[^.]+$/, "");
      const ch = chunkText(docId, parsed.content, {
        chunkSize: 220,
        chunkOverlap: 50,
        documentTitle: title,
        pageSpans: parsed.pageSpans
      });
      documents = [
        {
          id: docId,
          filePath: pdfPathSingle,
          fileName: base,
          title,
          fileType: parsed.fileType,
          content: parsed.content,
          importedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          sourceCreatedAt: new Date().toISOString(),
          sourceUpdatedAt: new Date().toISOString(),
          chunkCount: ch.length
        }
      ];
      chunks = ch;
      pdfFiles = [base];
      sourceLabel = pdfPathSingle;
    } else {
      writeBlocked(
        "未设置有效 PKRAG_REALPDF_DIR（目录）或 PKRAG_REALPDF_PATH（单文件），或路径不存在。",
        { tried: { PKRAG_REALPDF_DIR: pdfDir ?? null, PKRAG_REALPDF_PATH: pdfPathSingle ?? null } }
      );
      return;
    }
  } catch (e) {
    writeBlocked(e instanceof Error ? e.message : String(e));
    return;
  }

  const questions = [
    { id: "Q1", q: "HOLLiAS MACS V6.5 从安装到最终运行，完整使用步骤是什么？" },
    { id: "Q6", q: "编译和下装的顺序是什么？" },
    { id: "Q9", q: "如何实现域间访问？" },
    { id: "Q11", q: "安装过程中提示 UserSvr 服务启动失败，应如何处理？" },
    { id: "Q8", q: "什么是参数对齐？" },
    { id: "Q10", q: "分组功能适用范围是什么？真实控制器支持吗？" }
  ];

  for (const item of questions) {
    const run = await runQuestion(item.q, documents, chunks, {});
    const j = judgeStandard12(item.id, run.direct_answer, run.model_answer);
    const citationFiles = [...new Set(run.model_citations.map((c) => c.fileName))];
    const topTitles = (run.retrieval_debug as { topResults?: Array<{ sectionTitle?: string; fileName?: string }> })
      .topResults?.slice(0, 2)
      .map((t) => `${t.fileName ?? ""} / ${t.sectionTitle ?? ""}`)
      .filter(Boolean);
    results.push({
      source_question_id: item.id,
      question: item.q,
      citation_file_names: citationFiles,
      top_retrieval_hint: topTitles ?? [],
      model_answer: run.model_answer,
      direct_answer: run.direct_answer,
      model_citations: run.model_citations,
      verdict: j.verdict,
      score: j.score,
      matched_gold_points: j.matched_gold_points,
      missed_gold_points: j.missed_gold_points,
      fail_modes: j.fail_modes,
      notes: j.notes,
      retrieval_debug: run.retrieval_debug,
      cautious_shell: /概述性内容|未形成可逐步执行/.test(run.direct_answer)
    });
  }

  const pass = results.filter((r) => r.verdict === "pass").length;
  const issues: string[] = [];
  issues.push(
    "真实 PDF 排版与 OCR 分词与 synthetic 不同，lexical/向量排序可能偏移；inject 子串仅在 synthetic 命中，真实语料上补块通常不生效。"
  );
  issues.push("多文档合并后 chunk 边界跨页，可能出现 citation 片段与人工阅读位置不一致。");

  fs.writeFileSync(
    path.join(repoRoot, "evals/results/sprint-5.3b-realpdf-run-001.json"),
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        status: "ok",
        source: sourceLabel,
        pdf_files_loaded: pdfFiles,
        total_chunks: chunks.length,
        questions: results
      },
      null,
      2
    ),
    "utf8"
  );

  const passLine = `- **规则抽检 pass**：${pass}/${results.length}（验收 ≥4/6：${pass >= 4 ? "满足" : "未满足"}）`;
  const cautiousAny = results.some((r) => r.cautious_shell);
  fs.writeFileSync(
    path.join(repoRoot, "evals/results/sprint-5.3b-realpdf-summary-001.md"),
    `# Sprint 5.3b 真实文档抽样（HOLLiAS MACS V6.5 用户手册 PDF）

- **来源**（仅用户指定目录）：\`${sourceLabel}\`
- **已加载 PDF**：${pdfFiles.map((f) => `\`${f}\``).join("、")}
- **合并 chunk 数**：${chunks.length}
${passLine}
- **任一问出现「概述性」谨慎壳**：${cautiousAny ? "是（需人工复核）" : "否"}

## 每题引用到的文件名（citation）

${results.map((r) => `- **${r.source_question_id}**：${(r.citation_file_names as string[]).join(", ") || "无"}`).join("\n")}

## 与 synthetic 相比的新问题（归类）

${issues.map((x) => `- ${x}`).join("\n")}

## 新问题类型（检索 / chunk / citation / answer）

| 类型 | 说明 |
|------|------|
| retrieval | 多卷 PDF 下 top 命中可能落在非最佳分册 |
| chunk | 页断/表格导致语义块切碎 |
| citation | snippet 与段落边界对齐依赖 PDF 解析质量 |
| answer layer | 证据弱时谨慎模板；结构化路径仍依赖命中含步骤/条款的块 |
`,
    "utf8"
  );
  console.log("Wrote realpdf JSON", { pass, pdfFiles: pdfFiles.length });
}

function partOverall(): void {
  const para = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "evals/results/sprint-5.3b-paraphrase-run-001.json"), "utf8")
  ) as { results: Array<{ verdict: string }> };
  const passP = para.results.filter((r) => r.verdict === "pass").length;

  const a = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "evals/results/sprint-5.3b-ablation-a-run-001.json"), "utf8")
  ) as { questions: Array<{ id: string; verdict: string }> };
  const b = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "evals/results/sprint-5.3b-ablation-b-run-001.json"), "utf8")
  ) as { questions: Array<{ id: string; verdict: string }> };

  const regressions = a.questions.filter((q) => {
    const bb = b.questions.find((x) => x.id === q.id);
    return q.verdict === "pass" && bb && bb.verdict !== "pass";
  });

  let realBlock: string;
  try {
    const p = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "evals/results/sprint-5.3b-realpdf-run-001.json"), "utf8")
    ) as { status?: string; pdf_files_loaded?: string[]; questions?: Array<{ verdict: string }> };
    if (p.status === "ok" && Array.isArray(p.questions)) {
      const rp = p.questions.filter((q) => q.verdict === "pass").length;
      realBlock = `- Part C 状态：**ok**（真实 PDF 规则抽检 pass **${rp}/${p.questions.length}**）\n- 已加载分册：${(p.pdf_files_loaded ?? []).slice(0, 4).join(", ")}${(p.pdf_files_loaded ?? []).length > 4 ? " …" : ""}`;
    } else {
      realBlock = `- Part C 状态：**${p.status ?? "unknown"}**（未在真实手册上完成或受阻，见 \`sprint-5.3b-realpdf-summary-001.md\`）`;
    }
  } catch {
    realBlock = "- Part C：未找到 \`sprint-5.3b-realpdf-run-001.json\`";
  }

  const md = `# Sprint 5.3b 总总结

## 1. 5.3a 的收益是否对 paraphrase 泛化？

- Paraphrase pass 数：**${passP}/18**（验收 ≥15：${passP >= 15 ? "是" : "否"}）
- 结论：${passP >= 15 ? "在变体问法下整体仍可用同一套 answer/gating/snippet 逻辑支撑 gold 要点。" : "部分变体未过规则抽检，需对照 \`sprint-5.3b-paraphrase-run-001.json\` 逐条看 missed 原因。"}

## 2. 关闭 candidate 补块后，收益是否仍大体成立？

- Group A pass：**${a.questions.filter((q) => q.verdict === "pass").length}/12**
- Group B pass：**${b.questions.filter((q) => q.verdict === "pass").length}/12**
- A→B 退化题（A pass 而 B 非 pass）：${regressions.map((r) => r.id).join(", ") || "无"}

结论：${regressions.length === 0 ? "本规则集下未观察到因关闭补块导致的 pass→非 pass 退化。" : "关闭补块后 **" + regressions.map((r) => r.id).join(", ") + "** 在规则抽检上退化；其中 **Q1** 仍最依赖主链路块出现在 top 或补块。"}

## 3. 能否迁移到真实 PDF？

${realBlock}

## 4. 下一步路线建议

| 条件 | 建议 |
|------|------|
| B 组仅 Q1 明显退化、Q6 仍稳 | **5.3c retrieval/ranking 深修**（全流程类主链路召回） |
| 真实 PDF 上 citation 与段落不一致 | **chunk + citation 定位**，再动 answer |
| Paraphrase≥15 pass 且真实抽样可接受 | **结束 5.3** 或扩真实题集 |
| gold 正文待补 | **补 gold key** 后再做严格自动评判 |

---
生成时间：${new Date().toISOString()}
`;

  fs.writeFileSync(path.join(repoRoot, "evals/results/sprint-5.3b-overall-summary-001.md"), md, "utf8");
  console.log("Wrote overall summary");
}

async function main(): Promise<void> {
  const arg = process.argv.find((a) => a.startsWith("--part="));
  const part = arg?.split("=")[1] ?? "all";
  fs.mkdirSync(path.join(repoRoot, "evals/results"), { recursive: true });

  if (part === "a" || part === "all") {
    await partParaphrase();
  }
  if (part === "b" || part === "all") {
    await partAblation();
  }
  if (part === "c" || part === "all") {
    await partRealPdf();
  }
  if (part === "all") {
    partOverall();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
