import fs from "node:fs";
import path from "node:path";
import { chunkText } from "../modules/chunk/chunkText";
import { parseDocument } from "../modules/parse/parseDocument";
import { searchChunks } from "../modules/retrieve/searchIndex";
import { answerQuestion } from "../modules/answer/answerQuestion";
import type { ChunkRecord, DocumentRecord, SupportedFileType } from "../shared/types";
import { evaluateBenchmarkCase, summarizeBenchmarkResults, type BenchmarkCaseEvalResult } from "./benchmarkMetrics";
import { isBenchmarkFileV1, type BenchmarkFileV1 } from "./benchmarkSchema";

export function loadBenchmarkJsonFile(absPath: string): BenchmarkFileV1 {
  const raw: unknown = JSON.parse(fs.readFileSync(absPath, "utf8"));
  if (!isBenchmarkFileV1(raw)) {
    throw new Error(`Invalid benchmark file (schemaVersion must be 1): ${absPath}`);
  }
  return raw;
}

async function loadDocumentContent(filePath: string, parserHint?: SupportedFileType): Promise<{ fileType: SupportedFileType; content: string }> {
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
  const topK = config.retrievalTopK ?? 8;
  const results: BenchmarkCaseEvalResult[] = [];

  for (const benchmarkCase of config.cases) {
    const searchResults = searchChunks(benchmarkCase.question, documents, chunks, topK);
    const chatAnswer = answerQuestion(benchmarkCase.question, searchResults);
    results.push(evaluateBenchmarkCase(benchmarkCase, searchResults, chatAnswer, topK));
  }

  return results;
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
  lines.push("");

  lines.push("## Per-case results");
  lines.push("");
  lines.push(`| Case | Pass | recall@k | docHit | refusal | Notes |`);
  lines.push(`| --- | --- | --- | --- | --- | --- |`);
  for (const row of options.caseResults) {
    const refusal = row.answerMetrics.refusalDetected ? "yes" : "no";
    const notes = row.failureReasons.length > 0 ? row.failureReasons.join("; ") : "—";
    lines.push(
      `| ${row.case.id} | ${row.passed ? "yes" : "no"} | ${row.retrieval.recallAtK.toFixed(2)} | ${row.retrieval.docHit ? "yes" : "no"} | ${refusal} | ${notes.replace(/\|/g, "\\|")} |`
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
  lines.push("- Retrieval uses the same `searchChunks` path as the app, without LanceDB vector recall in this script (lexical/hybrid in-memory path only).");
  lines.push("");

  return lines.join("\n");
}

export function writeReportToFile(content: string, reportPath: string): void {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, content, "utf8");
}
