/**
 * RAG-only real regression runner (fixture-first).
 *
 * Purpose: keep the "add 2-4 cases → run → raw/results/summary" loop working even when
 * a local real-PDF directory is unavailable. Uses sanitized markdown fixtures committed in-repo.
 *
 * Usage:
 *   ./node_modules/.bin/vite-node scripts/runRealRegressionRagOnly.ts --spec evals/cases/rag-only-round1.json
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
import type { ChunkRecord, DocumentRecord, SearchResult } from "../src/lib/shared/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

type FailStage = "retrieval" | "ranking" | "chunk" | "parse_normalize" | "answer" | "rule_check";

type ShapeCheck = {
  must_contain_all?: string[];
  must_contain_any?: string[];
  must_not_contain?: string[];
};

type CaseSpec = {
  id: string;
  question: string;
  rationale: string;
  owner: string;
  source_section_hint: string;
  expected_shape: ShapeCheck;
  fail_stage: FailStage;
};

type FixtureSpec = {
  id: string;
  scope: string;
  source: { kind: "fixture"; fixture_documents: string[] };
  cases: CaseSpec[];
};

function resolveSpecPath(argv: string[]): string {
  const i = argv.indexOf("--spec");
  if (i < 0 || !argv[i + 1]) {
    throw new Error('Missing --spec. Example: --spec evals/cases/rag-only-round1.json');
  }
  const p = argv[i + 1]!;
  return path.isAbsolute(p) ? p : path.join(repoRoot, p);
}

function loadSpec(specPath: string): FixtureSpec {
  return JSON.parse(fs.readFileSync(specPath, "utf8")) as FixtureSpec;
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

function inferFailStage(args: { missed: string[]; topFiles: string[] }): FailStage {
  if (args.topFiles.length === 0) return "retrieval";
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

async function loadFixtureCorpus(pathsRel: string[]): Promise<{ documents: DocumentRecord[]; chunks: ChunkRecord[] }> {
  const documents: DocumentRecord[] = [];
  const chunks: ChunkRecord[] = [];
  for (const rel of pathsRel) {
    const abs = path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
    const parsed = await parseDocument(abs);
    const fileName = path.basename(abs);
    const docId = `fixture-${fileName.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 56)}`;
    const title = fileName.replace(/\.(md|pdf|docx)$/i, "");
    const docChunks = chunkText(docId, parsed.content, {
      chunkSize: 260,
      chunkOverlap: 60,
      documentTitle: title
    });
    documents.push({
      id: docId,
      filePath: abs,
      fileName,
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
  return { documents, chunks };
}

async function runOne(question: string, documents: DocumentRecord[], chunks: ChunkRecord[]) {
  const topK = DEFAULT_RETRIEVAL_LIMIT;
  const { results: searchResults, vectorChunkIds, candidateChunks, queryRetrievalType, searchDiagnostics } = await runRetrievalLikeDesktop(
    question,
    documents,
    chunks,
    { limit: topK, hydrateEmbeddings: true }
  );
  const answer = answerQuestion(question, searchResults);
  const debug = buildRetrievalDebugPayload(question, vectorChunkIds, candidateChunks.length, searchResults, answer, {
    searchLimit: topK,
    vectorRecallBackend: "memory",
    runtime: "eval",
    queryRetrievalType,
    candidateChunkIds: candidateChunks.map((chunk) => chunk.id),
    searchDiagnostics
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
  const specPath = resolveSpecPath(process.argv.slice(2));
  const spec = loadSpec(specPath);
  if (spec.source.kind !== "fixture") {
    throw new Error(`This runner only supports source.kind=fixture. Got: ${spec.source.kind}`);
  }

  const { documents, chunks } = await loadFixtureCorpus(spec.source.fixture_documents);

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
    const topFiles = (run.retrieval_debug as any)?.topResults?.map((r: any) => r.fileName).filter(Boolean) ?? [];

    const verdict: "pass" | "partial" | "fail" = shape.ok ? "pass" : shape.missed.length <= 1 ? "partial" : "fail";
    const fail_stage: FailStage = shape.ok ? "rule_check" : inferFailStage({ missed: shape.missed, topFiles });
    const note = shape.ok ? "ok" : `missed: ${shape.missed.slice(0, 3).join(", ")}`;

    runRows.push({
      id: c.id,
      question: c.question,
      rationale: c.rationale,
      owner: c.owner,
      source_section_hint: c.source_section_hint,
      expected_shape: c.expected_shape,
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
        source_kind: spec.source.kind,
        fixture_documents: spec.source.fixture_documents,
        total_documents: documents.length,
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
  mdLines.push(`# P0-A real regression — RAG-only`);
  mdLines.push("");
  mdLines.push(`- spec: \`${path.relative(repoRoot, specPath)}\``);
  mdLines.push(`- fixtures: ${spec.source.fixture_documents.length} | docs: ${documents.length} | chunks: ${chunks.length}`);
  mdLines.push(`- run: ${date}-${seq}`);
  mdLines.push("");
  mdLines.push(`| id | verdict | fail_stage | one_line_note |`);
  mdLines.push(`|----|--------|-----------|---------------|`);
  for (const row of summaryRows) {
    mdLines.push(`| \`${row.id}\` | **${row.verdict}** | \`${row.fail_stage}\` | ${row.note} |`);
  }
  mdLines.push("");
  mdLines.push("## Notes");
  mdLines.push("- 本次为 fixture-first（脱敏 markdown）跑通闭环；若恢复真实 PDF 目录，再切回 realpdf runner。");
  fs.writeFileSync(summaryPath, mdLines.join("\n"), "utf8");

  console.log({ rawPath, resPath, summaryPath });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
