/**
 * 嵌入模型对比评估 — 评测 all-MiniLM-L6-v2 vs bge-small-zh-v1.5 的检索质量
 *
 * Usage:
 *   PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册" \
 *   node --max-old-space-size=6144 \
 *   ./node_modules/.bin/vite-node scripts/embedModelBench.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "../src/lib/modules/parse/parseDocument";
import { chunkText } from "../src/lib/modules/chunk/chunkText";
import { answerQuestion } from "../src/lib/modules/answer/answerQuestion";
import { runRetrievalLikeDesktop, DEFAULT_RETRIEVAL_LIMIT } from "../src/lib/modules/retrieve/retrievalPipeline";
import { cosineSimilarity } from "../src/lib/modules/embed/localEmbedder";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// ── Models to evaluate ──
const MODELS = [
  { id: "Xenova/all-MiniLM-L6-v2", label: "all-MiniLM-L6-v2", dims: 384, desc: "当前基线 (英文优化)" },
  { id: "Xenova/bge-small-zh-v1.5", label: "bge-small-zh-v1.5", dims: 512, desc: "中文SOTA轻量" },
] as const;

// ── Load PDFs ──
const dir = process.env.PKRAG_REALPDF_DIR!;
if (!dir) { console.error("Set PKRAG_REALPDF_DIR"); process.exit(1); }

async function loadDocs() {
  const names = fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith(".pdf"))
    .map(d => d.name)
    .filter(n => /手册[1346]_/.test(n))  // 支线B相关卷
    .sort();

  console.log(`📂 Loading ${names.length} PDFs...`);
  const docs: any[] = [];
  const chunks: any[] = [];
  for (const name of names) {
    const parsed = await parseDocument(path.join(dir, name));
    const dc = chunkText(name.slice(0, 40), parsed.content, {
      chunkSize: 260, chunkOverlap: 60,
      documentTitle: name.replace(".pdf", ""),
      pageSpans: parsed.pageSpans,
    });
    docs.push({
      id: name.slice(0, 40), filePath: path.join(dir, name), fileName: name,
      title: name.replace(".pdf", ""), fileType: parsed.fileType, content: parsed.content,
      importedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      sourceCreatedAt: new Date().toISOString(), sourceUpdatedAt: new Date().toISOString(),
      chunkCount: dc.length,
    });
    chunks.push(...dc);
  }
  return { docs, chunks };
}

// ── Questions ──
const QUESTIONS = [
  { id: "B1", q: "MACS V6.5 算法组态中，参数对齐功能的条件是什么？TRUE 和 FALSE 分别在什么情况下出现？该参数对齐功能主要用于什么场景？" },
  { id: "B2", q: "MACS V6.5 控制站的系统容量有哪些限制？I/O 点数、控制周期、任务数量分别有什么上限？扩展机架时需要注意什么？" },
  { id: "B3", q: "MACS V6.5 的工程加密功能适用于哪些场景？对工程编译、下装、在线修改各有什么影响和限制条件？" },
  { id: "B4", q: "MACS V6.5 中，操作员站、工程师站、历史站的功能定义分别是什么？它们各自运行哪些软件？是否可以合并部署在一台机器上？" },
];

// ── Judge (same as branch B eval) ──
function judge(id: string, direct: string, full: string) {
  const t = `${direct}\n${full}`;
  const m: string[] = []; const mi: string[] = [];
  const n = (c: boolean, ok: string, bad: string) => c ? m.push(ok) : mi.push(bad);
  switch (id) {
    case "B1": n(/参数对齐/.test(t), "参数对齐", "缺参数对齐"); n(/TRUE/.test(t), "TRUE条件", "缺TRUE"); n(/FALSE/.test(t), "FALSE条件", "缺FALSE"); n(/场景|用途|适用/.test(t), "使用场景", "缺场景"); break;
    case "B2": n(/控制站/.test(t), "控制站", "缺控制站"); n(/I\/O|IO|输入.*输出|点数/.test(t), "IO点数", "缺IO"); n(/\d+?毫秒|\d+?ms|周期/.test(t), "控制周期", "缺周期"); n(/任务.*数量|上限|容量/.test(t), "容量上限", "缺上限"); break;
    case "B3": n(/加密/.test(t), "工程加密", "缺加密"); n(/编译|下装|在线修改|影响|限制/.test(t), "各阶段影响", "缺影响"); n(/场景|用途|适用|保护/.test(t), "适用场景", "缺场景"); break;
    case "B4": n(/操作员站/.test(t), "操作员站", "缺操作员站"); n(/工程师站/.test(t), "工程师站", "缺工程师站"); n(/历史站/.test(t), "历史站", "缺历史站"); n(/软件|部署|合并|安装/.test(t), "软件/部署", "缺部署"); break;
  }
  const v = mi.length === 0 ? "pass" : mi.length <= 2 ? "partial" : "fail";
  return { verdict: v, score: v === "pass" ? 1 : v === "partial" ? 0.5 : 0, matched: m, missed: mi };
}

// ══════════════════════════════════════════
// Main: run each model and compare
// ══════════════════════════════════════════

async function main() {
  const { docs, chunks } = await loadDocs();
  console.log(`📚 ${docs.length} docs, ${chunks.length} chunks\n`);

  const results: any[] = [];

  for (const model of MODELS) {
    console.log(`\n🔬 模型: ${model.label} (${model.desc})`);
    console.log(`   维度: ${model.dims}, 大小: ~${model.id.includes("bge") ? "95" : "80"}MB`);

    // Set model env var for the pipeline to pick up
    process.env.PKRAG_EMBED_MODEL = model.id;

    const memStart = process.memoryUsage().heapUsed / 1024 / 1024;
    const timeStart = Date.now();
    const caseResults: any[] = [];

    for (const c of QUESTIONS) {
      const rr = await runRetrievalLikeDesktop(c.q, docs, chunks, {
        limit: DEFAULT_RETRIEVAL_LIMIT,
        hydrateEmbeddings: false,  // skip chunk pre-embedding for fair comparison
      });

      const answer = answerQuestion(c.q, rr.results);
      const j = judge(c.id, answer.directAnswer, answer.answer);

      caseResults.push({
        id: c.id, verdict: j.verdict, score: j.score,
        matched: j.matched, missed: j.missed,
        topChunkScore: rr.results[0]?.score ?? 0,
        topChunkFile: rr.results[0]?.fileName?.slice(0, 40) ?? "",
        retrievalCount: rr.results.length,
      });

      process.stdout.write(`  ${c.id}: ${j.verdict.toUpperCase()} (${j.score}) `);
    }

    const memEnd = process.memoryUsage().heapUsed / 1024 / 1024;
    const elapsed = (Date.now() - timeStart) / 1000;
    const avgScore = caseResults.reduce((s: number, r: any) => s + r.score, 0) / caseResults.length;
    const passCount = caseResults.filter((r: any) => r.verdict === "pass").length;

    console.log(`\n  📊 ${passCount}/4 pass, 平均 ${avgScore.toFixed(3)}, ${elapsed.toFixed(0)}s, 内存 +${(memEnd - memStart).toFixed(0)}MB`);

    results.push({
      model: model.label,
      passCount,
      avgScore,
      elapsedSec: elapsed,
      memDeltaMB: +(memEnd - memStart).toFixed(1),
      cases: caseResults,
    });
  }

  // ── Compare ──
  console.log(`\n══════════════════════════════════════════`);
  console.log(`📊 模型对比总结`);
  console.log(`──────────────────────────────────────────`);
  console.log(`| 模型 | Pass | 平均分 | 耗时 | 内存增量 |`);
  console.log(`|------|------|--------|------|----------|`);
  for (const r of results) {
    console.log(`| ${r.model} | ${r.passCount}/4 | ${r.avgScore.toFixed(3)} | ${r.elapsedSec.toFixed(0)}s | +${r.memDeltaMB}MB |`);
  }

  // ── Save ──
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.join(repoRoot, "evals", "results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `embed-model-bench-${ts}.json`),
    JSON.stringify({ timestamp: ts, models: MODELS.map(m => m.label), results }, null, 2),
  );
  console.log(`\n📁 结果: evals/results/embed-model-bench-${ts}.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
