import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateCase, summarizeCaseResults, type EvalCaseResult } from "../src/lib/eval/ragEval";
import { chunkText } from "../src/lib/modules/chunk/chunkText";
import { parseDocument } from "../src/lib/modules/parse/parseDocument";
import { searchChunks } from "../src/lib/modules/retrieve/searchIndex";
import type { ChunkRecord, DocumentRecord, SupportedFileType } from "../src/lib/shared/types";
import { ragEvalDatasets } from "./ragEval.config";
import {
  loadBenchmarkJsonFile,
  materializeBenchmarkLibrary,
  renderBenchmarkMarkdownReport,
  runBenchmarkCases,
  writeReportToFile
} from "../src/lib/eval/benchmarkRunner";
import { summarizeBenchmarkResults } from "../src/lib/eval/benchmarkMetrics";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const requestedDatasetId = process.argv[2] ?? null;

async function loadDataset(datasetId: string): Promise<{
  documents: DocumentRecord[];
  chunks: ChunkRecord[];
}> {
  const dataset = ragEvalDatasets.find((item) => item.id === datasetId);
  if (!dataset) {
    throw new Error(`Unknown dataset: ${datasetId}`);
  }

  const documents: DocumentRecord[] = [];
  const chunks: ChunkRecord[] = [];

  async function loadDocumentContent(filePath: string, parserHint?: SupportedFileType): Promise<{ fileType: SupportedFileType; content: string }> {
    if (parserHint === "txt") {
      return {
        fileType: "txt",
        content: fs.readFileSync(filePath, "utf8")
      };
    }

    return parseDocument(filePath);
  }

  for (const documentConfig of dataset.documents) {
    if (!fs.existsSync(documentConfig.filePath)) {
      throw new Error(`Missing document: ${documentConfig.filePath}`);
    }

    const parsed = await loadDocumentContent(documentConfig.filePath, documentConfig.parserHint);
    const title = documentConfig.title ?? path.basename(documentConfig.filePath, path.extname(documentConfig.filePath));
    const documentChunks = chunkText(documentConfig.id, parsed.content, {
      chunkSize: dataset.chunkSize ?? 180,
      chunkOverlap: dataset.chunkOverlap ?? 40,
      documentTitle: title,
      pageSpans: parsed.pageSpans
    });

    documents.push({
      id: documentConfig.id,
      filePath: documentConfig.filePath,
      fileName: path.basename(documentConfig.filePath),
      title,
      fileType: parsed.fileType,
      content: parsed.content,
      importedAt: new Date("2026-04-09").toISOString(),
      updatedAt: new Date("2026-04-09").toISOString(),
      sourceCreatedAt: new Date("2024-07-31").toISOString(),
      sourceUpdatedAt: new Date("2024-07-31").toISOString(),
      chunkCount: documentChunks.length
    });

    chunks.push(...documentChunks);
  }

  return { documents, chunks };
}

async function runLegacyDataset(datasetId: string): Promise<{ datasetId: string; caseResults: EvalCaseResult[] }> {
  const dataset = ragEvalDatasets.find((item) => item.id === datasetId);
  if (!dataset) {
    throw new Error(`Unknown dataset: ${datasetId}`);
  }

  const { documents, chunks } = await loadDataset(datasetId);
  const caseResults = dataset.cases.map((evalCase) => {
    const results = searchChunks(evalCase.question, documents, chunks, 5);
    return evaluateCase(evalCase, results);
  });

  return { datasetId, caseResults };
}

async function runBenchmarkMode(benchmarkPath: string): Promise<void> {
  const resolved = path.isAbsolute(benchmarkPath) ? benchmarkPath : path.join(repoRoot, benchmarkPath);
  const config = loadBenchmarkJsonFile(resolved);
  const { documents, chunks } = await materializeBenchmarkLibrary(config, repoRoot);
  const caseResults = await runBenchmarkCases(config, documents, chunks);
  const summary = summarizeBenchmarkResults(caseResults);
  const generatedAt = new Date().toISOString();
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const reportPath = path.join(repoRoot, "reports", "rag-eval", `eval-${stamp}.md`);

  const markdown = renderBenchmarkMarkdownReport({
    benchmarkId: config.id,
    benchmarkPath: resolved,
    config,
    caseResults,
    generatedAt
  });

  writeReportToFile(markdown, reportPath);

  console.log(`\nBenchmark: ${config.id}`);
  console.log(config.description ?? "");
  console.log(`Passed ${summary.passed}/${summary.total}`);
  console.log(`Mean recall@k: ${summary.meanRecallAtK.toFixed(3)} | Doc hit rate: ${summary.docHitRate.toFixed(3)}`);
  console.log(`mustRefuse correct: ${summary.mustRefuseCorrect}/${summary.mustRefuseCases}`);
  console.log(`\nReport written: ${reportPath}`);

  for (const row of caseResults.filter((item) => !item.passed)) {
    console.log(`\nFAIL ${row.case.id} :: ${row.case.question}`);
    console.log(row.failureReasons.join("; "));
  }

  if (summary.failed > 0) {
    process.exit(1);
  }
}

async function main(): Promise<void> {
  if (requestedDatasetId === "--legacy-all") {
    const failures: string[] = [];
    for (const datasetId of ragEvalDatasets.map((item) => item.id)) {
      try {
        const { caseResults } = await runLegacyDataset(datasetId);
        const summary = summarizeCaseResults(caseResults);
        console.log(`\nDataset: ${datasetId} — Passed ${summary.passed}/${summary.total}`);
        for (const caseResult of caseResults.filter((item) => !item.passed)) {
          failures.push(`${datasetId}:${caseResult.evalCase.id}`);
        }
      } catch (error) {
        failures.push(datasetId);
        console.log(`\nDataset: ${datasetId}`);
        console.log(`ERROR ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (failures.length > 0) {
      console.error(`\nRAG eval failed for ${failures.join(", ")}`);
      process.exit(1);
    }
    return;
  }

  if (!requestedDatasetId || requestedDatasetId.endsWith(".json")) {
    const benchmarkPath = requestedDatasetId ?? path.join("benchmarks", "benchmark.v1.json");
    await runBenchmarkMode(benchmarkPath);
    return;
  }

  const failures: string[] = [];
  try {
    const dataset = ragEvalDatasets.find((item) => item.id === requestedDatasetId);
    if (!dataset) {
      throw new Error(`Unknown dataset: ${requestedDatasetId}. Use a dataset id from ragEval.config.ts or a .json benchmark file.`);
    }

    const { caseResults } = await runLegacyDataset(requestedDatasetId);
    const summary = summarizeCaseResults(caseResults);

    console.log(`\nDataset: ${dataset.id}`);
    console.log(dataset.description);
    console.log(`Passed ${summary.passed}/${summary.total}`);
    for (const category of summary.byCategory) {
      console.log(`- ${category.category}: ${category.passed}/${category.total}`);
    }

    for (const caseResult of caseResults.filter((item) => !item.passed)) {
      failures.push(`${dataset.id}:${caseResult.evalCase.id}`);
      console.log(`\nFAIL ${caseResult.evalCase.id} :: ${caseResult.evalCase.question}`);
      for (const result of caseResult.results.slice(0, 3)) {
        console.log(JSON.stringify({
          sectionPath: result.sectionPath,
          evidenceText: result.evidenceText,
          snippet: result.snippet,
          score: Number(result.score.toFixed(3))
        }, null, 2));
      }
    }
  } catch (error) {
    failures.push(requestedDatasetId);
    const message = error instanceof Error ? error.message : String(error);
    console.log(`\nDataset: ${requestedDatasetId}`);
    console.log(`ERROR ${message}`);
  }

  if (failures.length > 0) {
    console.error(`\nRAG eval failed for ${failures.join(", ")}`);
    process.exit(1);
  }
}

void main();
