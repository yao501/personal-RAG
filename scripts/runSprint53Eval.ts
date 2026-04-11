/**
 * Sprint 5.3: run local RAG against synthetic gold corpus; outputs raw results for merging into eval JSON.
 * Usage: ./node_modules/.bin/vite-node scripts/runSprint53Eval.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chunkText } from "../src/lib/modules/chunk/chunkText";
import { parseDocument } from "../src/lib/modules/parse/parseDocument";
import { answerQuestion } from "../src/lib/modules/answer/answerQuestion";
import { truncateSnippetPreservingIdentifiers } from "../src/lib/modules/citation/snippetTruncate";
import { buildRetrievalDebugPayload } from "../src/lib/modules/retrieve/retrievalDebug";
import { DEFAULT_RETRIEVAL_LIMIT, runRetrievalLikeDesktop } from "../src/lib/modules/retrieve/retrievalPipeline";
import type { ChunkRecord, DocumentRecord } from "../src/lib/shared/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const CORPUS = path.join(repoRoot, "docs/evals/fixtures/sprint-5.3-synthetic-corpus.md");
/** 与 `docs/evals/cursor-sprint-5.3-run-001-prompt.md` 一致：以 `evals/results/` 为规范路径。 */
const INPUT_JSON = path.join(repoRoot, "evals/results/sprint-5.3-run-001.json");

async function main(): Promise<void> {
  const parsed = await parseDocument(CORPUS);
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
    filePath: CORPUS,
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

  const documents: DocumentRecord[] = [document];
  const topK = DEFAULT_RETRIEVAL_LIMIT;

  const input = JSON.parse(fs.readFileSync(INPUT_JSON, "utf8")) as {
    questions: Array<{ id: string; question: string }>;
  };

  const out: Array<{
    id: string;
    question: string;
    model_answer: string;
    direct_answer: string;
    model_citations: Array<{ chunkId: string; fileName: string; snippet: string }>;
    retrieval_debug: ReturnType<typeof buildRetrievalDebugPayload>;
  }> = [];

  for (const q of input.questions) {
    const { results: searchResults, vectorChunkIds, candidateChunks, queryRetrievalType } =
      await runRetrievalLikeDesktop(q.question, documents, chunks, { limit: topK, hydrateEmbeddings: true });
    const answer = answerQuestion(q.question, searchResults);
    const debug = buildRetrievalDebugPayload(
      q.question,
      vectorChunkIds,
      candidateChunks.length,
      searchResults,
      answer,
      { searchLimit: topK, vectorRecallBackend: "memory", runtime: "eval", queryRetrievalType }
    );

    out.push({
      id: q.id,
      question: q.question,
      model_answer: answer.answer,
      direct_answer: answer.directAnswer,
      model_citations: answer.citations.map((c) => ({
        chunkId: c.chunkId,
        fileName: c.fileName,
        snippet: truncateSnippetPreservingIdentifiers(c.snippet ?? "", 320)
      })),
      retrieval_debug: debug
    });
  }

  console.log(JSON.stringify({ generated_at: new Date().toISOString(), results: out }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
