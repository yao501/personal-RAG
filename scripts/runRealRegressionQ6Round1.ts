/**
 * P0-A Q6 family — minimal real regression runner (Round 1 / Round 2).
 *
 * Scope: small real regression specs under `evals/cases/*.json` (initially Q6 rounds; later small RAG-only rounds).
 * Non-goals: generic framework, CI integration, benchmark expansion, LLM judge.
 *
 * Usage:
 *   export PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册"
 *   ./node_modules/.bin/vite-node scripts/runRealRegressionQ6Round1.ts
 *   ./node_modules/.bin/vite-node scripts/runRealRegressionQ6Round1.ts round2
 *   ./node_modules/.bin/vite-node scripts/runRealRegressionQ6Round1.ts round3
 *   ./node_modules/.bin/vite-node scripts/runRealRegressionQ6Round1.ts --spec evals/cases/q6-round2.json
 *   ./node_modules/.bin/vite-node scripts/runRealRegressionQ6Round1.ts --spec evals/cases/rag-only-round1.json
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

type FailStage = "retrieval" | "ranking" | "chunk" | "parse_normalize" | "answer" | "rule_check";

type ShapeCheck = {
  must_contain_all?: string[];
  must_contain_any?: string[];
  must_not_contain?: string[];
};

type Q6Case = {
  id: string;
  question: string;
  rationale: string;
  owner: string;
  source_section_hint: string;
  expected_shape: ShapeCheck;
  acceptable_variants?: Array<{ label: string; shape: ShapeCheck }>;
  fail_stage: FailStage;
};

type Q6SpecFile = {
  id: string;
  scope: string;
  source: { kind: "realpdf"; env: string; expected_files_regex: string };
  cases: Q6Case[];
};

function resolveSpecPath(argv: string[]): string {
  const i = argv.indexOf("--spec");
  if (i >= 0 && argv[i + 1]) {
    return path.isAbsolute(argv[i + 1]!) ? argv[i + 1]! : path.join(repoRoot, argv[i + 1]!);
  }
  const round = argv.find((a) => a === "round1" || a === "round2" || a === "round3") ?? "round1";
  const file =
    round === "round3"
      ? "evals/cases/q6-round3.json"
      : round === "round2"
        ? "evals/cases/q6-round2.json"
        : "evals/cases/q6-round1.json";
  return path.join(repoRoot, file);
}

function loadCases(specPath: string): Q6SpecFile {
  return JSON.parse(fs.readFileSync(specPath, "utf8")) as Q6SpecFile;
}

function listV65ManualPdfs(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.toLowerCase().endsWith(".pdf"))
    .map((d) => d.name)
    .filter((n) => /^HOLLiAS_MACS_V6\.5用户手册\d+_.+\.pdf$/i.test(n))
    .sort();
}

async function loadCorpusFromDir(dir: string): Promise<{ documents: DocumentRecord[]; chunks: ChunkRecord[]; pdfFiles: string[] }> {
  const pdfFiles = listV65ManualPdfs(dir);
  if (pdfFiles.length === 0) {
    throw new Error(`目录内未找到匹配的 HOLLiAS_MACS_V6.5用户手册*.pdf：${dir}`);
  }

  const documents: DocumentRecord[] = [];
  const chunks: ChunkRecord[] = [];
  for (const name of pdfFiles) {
    const abs = path.join(dir, name);
    const parsed = await parseDocument(abs);
    const docId = `realpdf-${name.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 56)}`;
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
  return { documents, chunks, pdfFiles };
}

function checkExpectedShape(text: string, expected: ShapeCheck): { ok: boolean; missed: string[] } {
  const missed: string[] = [];
  const mustAll = expected.must_contain_all ?? [];
  for (const s of mustAll) {
    if (!text.includes(s)) missed.push(`must_contain_all:${s}`);
  }
  const mustAny = expected.must_contain_any ?? [];
  if (mustAny.length > 0 && !mustAny.some((s) => text.includes(s))) {
    missed.push(`must_contain_any:${mustAny.join("|")}`);
  }
  const mustNot = expected.must_not_contain ?? [];
  for (const s of mustNot) {
    if (s && text.includes(s)) missed.push(`must_not_contain:${s}`);
  }
  return { ok: missed.length === 0, missed };
}

function checkAcceptableVariants(
  text: string,
  variants: Q6Case["acceptable_variants"] | undefined
): { ok: boolean; hit_label: string | null; missed: string[] } {
  if (!variants || variants.length === 0) {
    return { ok: false, hit_label: null, missed: [] };
  }
  for (const v of variants) {
    const res = checkExpectedShape(text, v.shape);
    if (res.ok) {
      return { ok: true, hit_label: v.label, missed: [] };
    }
  }
  // For debugging: return the first variant's missed list (best-effort).
  const first = variants[0];
  return first ? { ok: false, hit_label: null, missed: checkExpectedShape(text, first.shape).missed } : { ok: false, hit_label: null, missed: [] };
}

function inferFailStage(args: {
  missed: string[];
  topFiles: string[];
  expectedTopFamilyHint?: RegExp;
}): FailStage {
  if (args.topFiles.length === 0) return "retrieval";
  // If we missed required points but at least the engineering manual shows up, treat as answer (first closed loop).
  const hasEng = args.topFiles.some((f) => /用户手册3_工程总控/i.test(f));
  if (!hasEng) return "retrieval";
  if (args.missed.some((m) => m.startsWith("must_not_contain:"))) return "answer";
  if (args.missed.length > 0) return "answer";
  return "rule_check";
}

function nextSeqForDate(dir: string, date: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const prefix = `real-regression-run-${date}-`;
  const existing = fs
    .readdirSync(dir)
    .filter((n) => n.startsWith(prefix) && n.endsWith(".json"))
    .map((n) => n.replace(prefix, "").replace(/\.json$/, ""))
    .map((s) => Number.parseInt(s, 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const next = (existing.at(-1) ?? 0) + 1;
  return String(next).padStart(3, "0");
}

async function runOne(q: string, documents: DocumentRecord[], chunks: ChunkRecord[]) {
  const topK = DEFAULT_RETRIEVAL_LIMIT;
  const { results: searchResults, vectorChunkIds, candidateChunks, queryRetrievalType } = await runRetrievalLikeDesktop(
    q,
    documents,
    chunks,
    { limit: topK, hydrateEmbeddings: true }
  );
  const answer = answerQuestion(q, searchResults);
  const debug = buildRetrievalDebugPayload(q, vectorChunkIds, candidateChunks.length, searchResults, answer, {
    searchLimit: topK,
    vectorRecallBackend: "memory",
    runtime: "eval",
    queryRetrievalType
  });
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
    console.error("请设置 PKRAG_REALPDF_DIR 指向真实 PDF 目录（多卷 HOLLiAS MACS V6.5 用户手册）");
    process.exit(1);
  }

  const specPath = resolveSpecPath(process.argv.slice(2));
  const spec = loadCases(specPath);
  const { documents, chunks, pdfFiles } = await loadCorpusFromDir(dir);

  const date = new Date().toISOString().slice(0, 10);
  const outRawDir = path.join(repoRoot, "evals/raw");
  const outResDir = path.join(repoRoot, "evals/results");
  fs.mkdirSync(outRawDir, { recursive: true });
  fs.mkdirSync(outResDir, { recursive: true });
  const seq = nextSeqForDate(outResDir, date);

  const runRows: any[] = [];
  const summaryRows: Array<{ id: string; verdict: "pass" | "partial" | "fail"; fail_stage: FailStage; note: string }> = [];

  for (const c of spec.cases) {
    const run = await runOne(c.question, documents, chunks);
    const combined = `${run.direct_answer}\n${run.model_answer}`;
    const shape = checkExpectedShape(combined, c.expected_shape);
    const acceptable = shape.ok ? { ok: false, hit_label: null as string | null, missed: [] } : checkAcceptableVariants(combined, c.acceptable_variants);
    const topFiles = (run.retrieval_debug as any)?.topResults?.map((r: any) => r.fileName).filter(Boolean) ?? [];

    const accepted = shape.ok || acceptable.ok;
    const verdict: "pass" | "partial" | "fail" = accepted ? "pass" : shape.missed.length <= 1 ? "partial" : "fail";
    const fail_stage: FailStage = accepted ? "rule_check" : inferFailStage({ missed: shape.missed, topFiles });
    const note = accepted
      ? acceptable.ok
        ? `ok (acceptable_variant: ${acceptable.hit_label})`
        : "ok"
      : `missed: ${shape.missed.slice(0, 3).join(", ")}`;

    runRows.push({
      id: c.id,
      question: c.question,
      rationale: c.rationale,
      owner: c.owner,
      source_section_hint: c.source_section_hint,
      expected_shape: c.expected_shape,
      acceptable_variants: c.acceptable_variants ?? [],
      accepted_by_variant: acceptable.ok,
      accepted_variant_label: acceptable.hit_label,
      verdict,
      fail_stage,
      missed: shape.missed,
      citation_file_names: [...new Set(run.model_citations.map((x) => x.fileName))],
      primary_citation: run.model_citations[0]?.fileName ?? null,
      model_citations: run.model_citations,
      direct_answer: run.direct_answer,
      retrieval_debug: run.retrieval_debug
    });

    summaryRows.push({ id: c.id, verdict, fail_stage, note });
  }

  const rawPath = path.join(outRawDir, `real-regression-${date}-${seq}.raw.json`);
  const resPath = path.join(outResDir, `real-regression-run-${date}-${seq}.json`);
  const summaryPath = path.join(outResDir, `real-regression-summary-${date}-${seq}.md`);

  fs.writeFileSync(
    rawPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        plan: spec.id,
        scope: spec.scope,
        pkrag_realpdf_dir: dir,
        pdf_files_loaded: pdfFiles,
        total_chunks: chunks.length,
        rows: runRows
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(resPath, JSON.stringify({ generated_at: new Date().toISOString(), rows: runRows }, null, 2), "utf8");

  const mdLines: string[] = [];
  mdLines.push(`# P0-A real regression — Q6`);
  mdLines.push("");
  mdLines.push(`- dir: \`${dir}\``);
  mdLines.push(`- pdfs: ${pdfFiles.length} | chunks: ${chunks.length}`);
  mdLines.push(`- run: ${date}-${seq}`);
  mdLines.push(`- spec: \`${path.relative(repoRoot, specPath)}\``);
  mdLines.push("");
  mdLines.push(`| id | verdict | fail_stage | one_line_note |`);
  mdLines.push(`|----|--------|-----------|---------------|`);
  for (const row of summaryRows) {
    mdLines.push(`| \`${row.id}\` | **${row.verdict}** | \`${row.fail_stage}\` | ${row.note} |`);
  }
  mdLines.push("");
  mdLines.push("## Notes");
  mdLines.push(
    "- 本 runner 仅用于 Q6 同族最小闭环（Round 1/2/3）；失败的 `fail_stage` 以 runner 粗归因为准，review 时可人工调整主因。"
  );
  mdLines.push(
    "- Round 3 支持 `acceptable_variants`：当 `expected_shape` 未命中但任一可接受形态命中时，会判定为 pass 并标注 `accepted_by_variant` / `accepted_variant_label`。"
  );

  fs.writeFileSync(summaryPath, mdLines.join("\n"), "utf8");

  console.log({ rawPath, resPath, summaryPath });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
