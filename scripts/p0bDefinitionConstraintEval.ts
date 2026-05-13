/**
 * P0-A 支线B Round 1：定义+约束型问题评测 — 轻量版
 *
 * Usage:
 *   PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册" \
 *   node --max-old-space-size=4096 \
 *   ./node_modules/.bin/vite-node scripts/p0bDefinitionConstraintEval.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "../src/lib/modules/parse/parseDocument";
import { chunkText } from "../src/lib/modules/chunk/chunkText";
import { answerQuestion } from "../src/lib/modules/answer/answerQuestion";
import { runRetrievalLikeDesktop, DEFAULT_RETRIEVAL_LIMIT } from "../src/lib/modules/retrieve/retrievalPipeline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const dir = process.env.PKRAG_REALPDF_DIR!;
if (!dir) { console.error("Set PKRAG_REALPDF_DIR"); process.exit(1); }

// ── Load all 7 volumes ──
const names = fs.readdirSync(dir, { withFileTypes: true })
  .filter(d => d.isFile() && d.name.endsWith(".pdf"))
  .map(d => d.name)
  .filter(n => /手册[1346]_/.test(n))  // 支线B相关卷: 1(安装/部署) 3(工程总控) 4(算法组态) 6(现场操作)
  .sort();

console.log(`📂 Loading ${names.length} PDF volumes...`);

const docs: any[] = [];
const chunks: any[] = [];

for (const name of names) {
  console.log(`  📄 ${name.slice(0, 55)}...`);
  const parsed = await parseDocument(path.join(dir, name));
  const dc = chunkText(name.slice(0, 40), parsed.content, {
    chunkSize: 260,
    chunkOverlap: 60,
    documentTitle: name.replace(".pdf", ""),
    pageSpans: parsed.pageSpans,
  });
  docs.push({
    id: name.slice(0, 40),
    filePath: path.join(dir, name),
    fileName: name,
    title: name.replace(".pdf", ""),
    fileType: parsed.fileType,
    content: parsed.content,
    importedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceCreatedAt: new Date().toISOString(),
    sourceUpdatedAt: new Date().toISOString(),
    chunkCount: dc.length,
  });
  chunks.push(...dc);
  console.log(`      → ${dc.length} chunks`);
}

console.log(`\n📚 Total: ${docs.length} docs, ${chunks.length} chunks\n`);

// ── Cases ──
const cases = [
  {
    id: "B1",
    q: "MACS V6.5 算法组态中，参数对齐功能的条件是什么？TRUE 和 FALSE 分别在什么情况下出现？该参数对齐功能主要用于什么场景？",
  },
  {
    id: "B2",
    q: "MACS V6.5 控制站的系统容量有哪些限制？I/O 点数、控制周期、任务数量分别有什么上限？扩展机架时需要注意什么？",
  },
  {
    id: "B3",
    q: "MACS V6.5 的工程加密功能适用于哪些场景？对工程编译、下装、在线修改各有什么影响和限制条件？",
  },
  {
    id: "B4",
    q: "MACS V6.5 中，操作员站、工程师站、历史站的功能定义分别是什么？它们各自运行哪些软件？是否可以合并部署在一台机器上？",
  },
];

// ── Judge ──
function judge(id: string, direct: string, full: string) {
  const t = `${direct}\n${full}`;
  const m: string[] = [];
  const mi: string[] = [];
  const n = (c: boolean, ok: string, bad: string) => c ? m.push(ok) : mi.push(bad);

  switch (id) {
    case "B1": // 参数对齐定义
      n(/参数对齐/.test(t), "提到参数对齐", "未提及参数对齐");
      n(/TRUE/.test(t) || /true/i.test(t), "提到TRUE条件", "未提TRUE条件");
      n(/FALSE/.test(t) || /false/i.test(t), "提到FALSE条件", "未提FALSE条件");
      n(
        /场景|用途|适用|作用|应用于|用于|功能/.test(t),
        "说明使用场景",
        "未说明使用场景"
      );
      break;

    case "B2": // 控制站容量约束
      n(/控制站/.test(t), "提到控制站", "未提及控制站");
      n(
        /I\/O|IO|输入.*输出|点数|通道/.test(t),
        "提到I/O点数约束",
        "未提及I/O点数约束"
      );
      n(
        /\d+?毫秒|\d+?ms|周期|扫描/.test(t),
        "提到控制周期",
        "未提及控制周期"
      );
      n(
        /任务.*数量|上限|限制|容量|最多/.test(t),
        "提到任务/容量上限",
        "未提及容量上限"
      );
      break;

    case "B3": // 工程加密约束
      n(/加密/.test(t), "提到工程加密", "未提及工程加密");
      n(
        /编译|下装|在线修改|影响|限制|条件/.test(t),
        "说明加密对各阶段影响",
        "未说明对各阶段影响"
      );
      n(
        /场景|用途|适用|保护|防止|权限/.test(t),
        "说明适用场景",
        "未说明适用场景"
      );
      break;

    case "B4": // 站类型定义
      n(/操作员站/.test(t), "提到操作员站", "未提及操作员站");
      n(/工程师站/.test(t), "提到工程师站", "未提及工程师站");
      n(/历史站/.test(t), "提到历史站", "未提及历史站");
      n(
        /软件|部署|合并|安装|运行/.test(t),
        "说明软件/部署方式",
        "未说明软件/部署"
      );
      break;
  }

  let verdict: string;
  if (mi.length === 0) verdict = "pass";
  else if (mi.length <= 2) verdict = "partial";
  else verdict = "fail";

  return {
    verdict,
    score: verdict === "pass" ? 1 : verdict === "partial" ? 0.5 : 0,
    matched: m,
    missed: mi,
  };
}

// ── Run ──
const results: any[] = [];
const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

for (const c of cases) {
  console.log(`🔍 [${c.id}] ${c.q.slice(0, 60)}...`);

  const rr = await runRetrievalLikeDesktop(c.q, docs, chunks, {
    limit: DEFAULT_RETRIEVAL_LIMIT,
  });

  const answer = answerQuestion(c.q, rr.results);

  const direct = answer?.directAnswer ?? "";
  const full = answer?.answer ?? "";
  const j = judge(c.id, direct, full);

  console.log(`   → ${j.verdict.toUpperCase()} (${j.score}) matched=${j.matched.length} missed=${j.missed.length}`);
  if (j.missed.length) console.log(`   ❌ Missed: ${j.missed.join(" | ")}`);
  if (j.matched.length) console.log(`   ✅ Matched: ${j.matched.join(" | ")}`);

  results.push({
    id: c.id,
    question: c.q,
    verdict: j.verdict,
    score: j.score,
    matched: j.matched,
    missed: j.missed,
    answerDirect: direct.slice(0, 600),
    answerFull: full.slice(0, 2000),
    topChunks: rr.results.slice(0, 5).map((r: any) => ({
      fileName: r.fileName?.slice(0, 60),
      sectionPath: r.sectionPath,
      sectionTitle: r.sectionTitle,
      score: r.score,
      snippet: r.snippet?.slice(0, 200),
      evidenceText: r.evidenceText?.slice(0, 200),
    })),
  });
}

// ── Summary ──
const passCount = results.filter((r: any) => r.verdict === "pass").length;
const partialCount = results.filter((r: any) => r.verdict === "partial").length;
const failCount = results.filter((r: any) => r.verdict === "fail").length;
const avgScore = results.reduce((s: number, r: any) => s + r.score, 0) / results.length;

console.log(`\n══════════════════════════════════════════`);
console.log(`📊 支线B Round 1 总评`);
console.log(` Pass: ${passCount}  Partial: ${partialCount}  Fail: ${failCount}`);
console.log(` 平均分: ${avgScore.toFixed(3)}`);
console.log(`══════════════════════════════════════════`);

// ── Save outputs ──
const outDir = path.join(repoRoot, "evals", "results");
fs.mkdirSync(outDir, { recursive: true });

// Raw data
fs.writeFileSync(
  path.join(outDir, `p0b-def-constraint-run-${ts}.json`),
  JSON.stringify({ timestamp: ts, docs: docs.length, chunks: chunks.length, cases: results }, null, 2),
  "utf-8"
);

// Summary markdown
const lines = [
  `# 支线B Round 1 — 定义+约束型问题评测`,
  ``,
  `**时间**: ${ts.replace(/T.*/, "")} ${ts.slice(11, 16)}`,
  `**文档**: ${docs.length} 卷, ${chunks.length} chunks`,
  ``,
  `## 总评`,
  ``,
  `| 指标 | 值 |`,
  `|------|-----|`,
  `| Pass | ${passCount} |`,
  `| Partial | ${partialCount} |`,
  `| Fail | ${failCount} |`,
  `| 平均分 | ${avgScore.toFixed(3)} |`,
  ``,
  `## 逐题结果`,
  ``,
];

for (const r of results) {
  lines.push(`### ${r.id} — ${r.verdict.toUpperCase()} (${r.score})`);
  lines.push(``);
  lines.push(`**问题**: ${r.question}`);
  lines.push(``);
  lines.push(`**✅ 通过项**: ${r.matched.join(", ") || "(无)"}`);
  lines.push(`**❌ 缺失项**: ${r.missed.join(", ") || "(无)"}`);
  lines.push(``);
  lines.push(`**回答摘要**:`);
  lines.push(`> ${r.answerDirect.slice(0, 300).replace(/\n/g, " ")}`);
  lines.push(``);
  if (r.topChunks?.length) {
    lines.push(`**Top-3 检索结果**:`);
    for (let i = 0; i < Math.min(3, r.topChunks.length); i++) {
      const tc = r.topChunks[i];
      lines.push(`- [${i + 1}] ${tc.fileName} — ${tc.sectionPath || "(无章节)"} (score: ${tc.score?.toFixed?.(4) ?? tc.score})`);
    }
    lines.push(``);
  }
}

// 收口判定
lines.push(`## 收口判定`);
lines.push(``);
if (failCount === 0 && partialCount === 0) {
  lines.push(`✅ 全绿收口 — 4/4 Pass`);
} else if (failCount === 0 && partialCount <= 2) {
  lines.push(`⚠️ 阶段性收口 — 0 fail, ${partialCount} partial, 主因分析后决定是否复跑`);
} else if (failCount >= 1) {
  lines.push(`🔄 需要分析 fail 主因 — 如为 retrieval → 登记治理候选; 如为 answer → 最小 patch 后复跑`);
}
lines.push(``);

fs.writeFileSync(
  path.join(outDir, `p0b-def-constraint-summary-${ts}.md`),
  lines.join("\n"),
  "utf-8"
);

console.log(`\n📁 结果已保存:`);
console.log(`   Raw:   evals/results/p0b-def-constraint-run-${ts}.json`);
console.log(`   Report: evals/results/p0b-def-constraint-summary-${ts}.md`);
