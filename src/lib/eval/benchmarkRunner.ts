import fs from "node:fs";
import path from "node:path";
import { chunkText } from "../modules/chunk/chunkText";
import { parseDocument } from "../modules/parse/parseDocument";
import { answerQuestion } from "../modules/answer/answerQuestion";
import { buildRetrievalDebugPayload } from "../modules/retrieve/retrievalDebug";
import { DEFAULT_RETRIEVAL_LIMIT, runRetrievalLikeDesktop } from "../modules/retrieve/retrievalPipeline";
import type { ChunkRecord, DocumentRecord, ParsedDocumentContent, SupportedFileType } from "../shared/types";
import {
  evaluateBenchmarkCase,
  summarizeBenchmarkResults,
  summarizeFailureBuckets,
  type BenchmarkCaseEvalResult
} from "./benchmarkMetrics";
import { isBenchmarkFileV1, type BenchmarkFileV1 } from "./benchmarkSchema";

export function loadBenchmarkJsonFile(absPath: string): BenchmarkFileV1 {
  const raw: unknown = JSON.parse(fs.readFileSync(absPath, "utf8"));
  if (!isBenchmarkFileV1(raw)) {
    throw new Error(`Invalid benchmark file (schemaVersion must be 1): ${absPath}`);
  }
  return raw;
}

async function loadDocumentContent(filePath: string, parserHint?: SupportedFileType): Promise<ParsedDocumentContent> {
  if (parserHint === "txt") {
    return {
      fileType: "txt",
      content: fs.readFileSync(filePath, "utf8")
    };
  }

  return parseDocument(filePath);
}

export async function materializeBenchmarkLibrary(
  config: BenchmarkFileV1,
  repoRoot: string
): Promise<{ documents: DocumentRecord[]; chunks: ChunkRecord[] }> {
  const documents: DocumentRecord[] = [];
  const chunks: ChunkRecord[] = [];
  const chunkSize = config.chunkSize ?? 180;
  const chunkOverlap = config.chunkOverlap ?? 40;

  for (const documentConfig of config.documents) {
    const filePath = path.isAbsolute(documentConfig.path) ? documentConfig.path : path.join(repoRoot, documentConfig.path);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Missing benchmark document: ${filePath}`);
    }

    const parsed = await loadDocumentContent(filePath, documentConfig.parserHint);
    const title =
      documentConfig.title ?? path.basename(documentConfig.path, path.extname(documentConfig.path));
    const documentChunks = chunkText(documentConfig.id, parsed.content, {
      chunkSize,
      chunkOverlap,
      documentTitle: title,
      pageSpans: parsed.pageSpans
    });

    documents.push({
      id: documentConfig.id,
      filePath,
      fileName: path.basename(filePath),
      title,
      fileType: parsed.fileType,
      content: parsed.content,
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceCreatedAt: new Date().toISOString(),
      sourceUpdatedAt: new Date().toISOString(),
      chunkCount: documentChunks.length
    });

    chunks.push(...documentChunks);
  }

  return { documents, chunks };
}

export async function runBenchmarkCases(
  config: BenchmarkFileV1,
  documents: DocumentRecord[],
  chunks: ChunkRecord[]
): Promise<BenchmarkCaseEvalResult[]> {
  const topK = config.retrievalTopK ?? DEFAULT_RETRIEVAL_LIMIT;
  const hydrate = config.embeddingHydration !== false;
  const caseResults: BenchmarkCaseEvalResult[] = [];

  const evalDebug = process.env.PKRAG_RETRIEVAL_DEBUG === "1";

  for (const benchmarkCase of config.cases) {
    const { results: searchResults, vectorChunkIds, candidateChunks, queryRetrievalType } = await runRetrievalLikeDesktop(
      benchmarkCase.question,
      documents,
      chunks,
      {
        limit: topK,
        hydrateEmbeddings: hydrate
      }
    );
    const chatAnswer = answerQuestion(benchmarkCase.question, searchResults);
    if (evalDebug) {
      console.log(
        JSON.stringify(
          buildRetrievalDebugPayload(
            benchmarkCase.question,
            vectorChunkIds,
            candidateChunks.length,
            searchResults,
            chatAnswer,
            {
              searchLimit: topK,
              vectorRecallBackend: "memory",
              runtime: "eval",
              queryRetrievalType
            }
          )
        )
      );
    }
    caseResults.push(evaluateBenchmarkCase(benchmarkCase, searchResults, chatAnswer, topK));
  }

  return caseResults;
}

export function renderBenchmarkMarkdownReport(options: {
  benchmarkId: string;
  benchmarkPath: string;
  config: BenchmarkFileV1;
  caseResults: BenchmarkCaseEvalResult[];
  generatedAt: string;
}): string {
  const summary = summarizeBenchmarkResults(options.caseResults);
  const lines: string[] = [];
  lines.push(`# RAG evaluation report`);
  lines.push("");
  lines.push(`- **Generated:** ${options.generatedAt}`);
  lines.push(`- **Benchmark:** \`${options.benchmarkId}\``);
  lines.push(`- **File:** \`${options.benchmarkPath}\``);
  lines.push(`- **Description:** ${options.config.description ?? "(none)"}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Cases passed | ${summary.passed}/${summary.total} |`);
  lines.push(`| Mean recall@k (expected docs) | ${summary.meanRecallAtK.toFixed(3)} |`);
  lines.push(`| Doc hit rate (non-empty expectedDocs) | ${summary.docHitRate.toFixed(3)} |`);
  lines.push(`| mustRefuse correct | ${summary.mustRefuseCorrect}/${summary.mustRefuseCases} |`);
  lines.push(`| Cautious procedural answers | ${options.caseResults.filter((r) => r.answerMetrics.cautiousProcedural).length} |`);
  lines.push("");

  const buckets = summarizeFailureBuckets(options.caseResults);
  const bucketLines = Object.entries(buckets)
    .filter(([, count]) => count > 0)
    .map(([k, v]) => `${k}: ${v}`)
    .join("; ");
  lines.push("## Failure buckets (failed cases only)");
  lines.push("");
  lines.push(bucketLines.length > 0 ? bucketLines : "_No failures._");
  lines.push("");

  const groupMap = new Map<string, BenchmarkCaseEvalResult[]>();
  for (const row of options.caseResults) {
    const key = row.case.intentGroup ?? `— (${row.case.id})`;
    const list = groupMap.get(key) ?? [];
    list.push(row);
    groupMap.set(key, list);
  }
  lines.push("## Intent groups (same-intent phrasing)");
  lines.push("");
  lines.push(`| Group | Pass rate | Case ids |`);
  lines.push(`| --- | --- | --- |`);
  for (const [group, rows] of [...groupMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const passed = rows.filter((item) => item.passed).length;
    const ids = rows.map((item) => item.case.id).join(", ");
    lines.push(`| ${group.replace(/\|/g, "\\|")} | ${passed}/${rows.length} | ${ids.replace(/\|/g, "\\|")} |`);
  }
  lines.push("");

  lines.push("## Per-case results");
  lines.push("");
  lines.push(`| Case | src | exp.mode | Group | Pass | cautious | recall@k | docHit | refusal | fail bucket |`);
  lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
  for (const row of options.caseResults) {
    const refusal = row.answerMetrics.refusalDetected ? "yes" : "no";
    const cautious = row.answerMetrics.cautiousProcedural ? "yes" : "no";
    const group = row.case.intentGroup ?? "—";
    const bucket = row.failureCategory ?? "—";
    const src = row.case.sourceType ?? "fixture";
    const mode = row.case.expectedAnswerMode ?? "—";
    lines.push(
      `| ${row.case.id} | ${src} | ${mode} | ${group.replace(/\|/g, "\\|")} | ${row.passed ? "yes" : "no"} | ${cautious} | ${row.retrieval.recallAtK.toFixed(2)} | ${row.retrieval.docHit ? "yes" : "no"} | ${refusal} | ${bucket} |`
    );
  }
  lines.push("");

  lines.push("## Notable misses");
  lines.push("");
  const failed = options.caseResults.filter((item) => !item.passed);
  if (failed.length === 0) {
    lines.push("_None._");
  } else {
    for (const item of failed) {
      lines.push(`### ${item.case.id}`);
      lines.push("");
      lines.push(`- **Question:** ${item.case.question}`);
      lines.push(`- **Reasons:** ${item.failureReasons.join("; ") || "(unknown)"}`);
      lines.push("");
    }
  }

  lines.push("## Limitations");
  lines.push("");
  lines.push("- Metrics are heuristic and deterministic; they are not semantic LLM-judge scores.");
  lines.push("- Refusal detection keys off empty citations plus known refusal strings in `directAnswer`.");
  lines.push("- Retrieval uses `runRetrievalLikeDesktop`: query embedding + in-memory vector shortlist + `selectCandidateChunksFromVectors` + `searchChunks`, matching the desktop pipeline (LanceDB replaced by cosine ranking on embeddings).");
  lines.push("- `intentGroup` is for human comparison only; pass/fail rules are unchanged.");
  lines.push("- `expectedAnswerMode` adds optional checks (`grounded` / `cautious` / `refusal`); see `docs/EVAL_GUIDE.md`.");
  lines.push("- When comparing runs across commits, use the same `benchmarks/benchmark.v1.json`; expanding case sets changes absolute pass-rate comparability.");
  lines.push("");

  return lines.join("\n");
}

export function writeReportToFile(content: string, reportPath: string): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, content, "utf8");
}
