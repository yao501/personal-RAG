# RAG evaluation and regression

This document describes the **local-first** benchmark format and how to run the evaluation runner. It is intentionally small and deterministic: metrics are heuristics, not semantic “truth” labels.

## When to use this

- Before or after changing chunking, retrieval, reranking, or answer assembly.
- To compare two branches or commits using the same benchmark file and the same runner.

## Benchmark format (`schemaVersion: 1`)

Benchmarks are JSON files (single object). See `benchmarks/benchmark.v1.json`.

| Field | Required | Meaning |
|-------|----------|---------|
| `schemaVersion` | yes | Must be `1` for this format. |
| `id` | yes | Stable id for the benchmark set. |
| `description` | no | Human-readable summary. |
| `chunkSize` / `chunkOverlap` | no | Passed into `chunkText` when materializing fixtures. |
| `retrievalTopK` | no | Passed to `searchChunks` (default **6**, same as desktop `KnowledgeService.askQuestion`). |
| `embeddingHydration` | no | Default **true**: embed chunk text before vector shortlist (matches production). Set `false` for a faster lexical-only smoke (larger gap vs desktop). |
| `documents` | yes | Fixture markdown files under `benchmarks/fixtures/` (see below). |
| `cases` | yes | Array of cases. |

Each **case**:

| Field | Required | Meaning |
|-------|----------|---------|
| `id` | yes | Stable case id. |
| `question` | yes | Query string passed to retrieval + answering. |
| `expectedDocs` | no | File names (e.g. `alpha_rag_basics.md`) or document ids that should appear in top-`k` retrieval. |
| `expectedFacts` | no | Substrings that should appear in the **combined** answer text (case-insensitive). |
| `expectedCitations` | no | Substrings matched against citation snippets / evidence (case-insensitive). |
| `mustRefuse` | yes | If `true`, the run expects a refusal-style answer (template match), not a grounded synthesis. |
| `notes` | no | Free text for humans; not scored. |

### Documents

Each entry has `id`, `path` (repo-relative), optional `title` / `parserHint`. Files are parsed and chunked like normal imports.

## How to run

Default (uses `benchmarks/benchmark.v1.json`):

```bash
npm run eval:rag
```

Explicit benchmark file:

```bash
./node_modules/.bin/vite-node scripts/runRagEval.ts benchmarks/benchmark.v1.json
```

Legacy retrieval-only datasets (optional, may require local paths in `scripts/ragEval.config.ts`):

```bash
./node_modules/.bin/vite-node scripts/runRagEval.ts --legacy-all
```

## Report output

Markdown reports are written to:

`reports/rag-eval/eval-<ISO-timestamp>.md`

Generated reports are gitignored by default (`reports/rag-eval/*.md`).

## Metrics (current)

### Retrieval

- **Doc hit**: every non-empty `expectedDocs` entry has a matching document in the top-`k` hits (by `fileName` or `documentId`).
- **Recall@k**: `matchedExpected / expectedDocs.length` when `expectedDocs` is non-empty; `1` when there is nothing to match.

### Answer

- **Refusal correctness** (`mustRefuse`): whether the answer matches refusal heuristics (substring / template checks on `directAnswer` + `answer`).
- **Groundedness proxy** (when `mustRefuse` is false): answer is non-empty and has at least one citation when the pipeline returned hits (weak signal).
- **Expected facts**: each listed substring appears in combined answer text.
- **Citation hit rate**: share of `expectedCitations` substrings found in citation text.

Pass/fail for a case is a conjunction of the checks that apply to that case (see report per row).

## Known limitations

- **No LLM-as-judge**; “correctness” is substring and template based.
- **Vector store**: the runner uses `runRetrievalLikeDesktop` — query embedding, **in-memory** top-24 cosine shortlist, `selectCandidateChunksFromVectors`, then `searchChunks`. The desktop app uses **LanceDB** for the same shortlist when available; numerics can still differ slightly, but the **pipeline shape** matches.
- **Benchmark size**: `benchmarks/benchmark.v1.json` is a small smoke set.

## Desktop retrieval debug (developer)

When running the Electron app from a terminal, set:

```bash
export PKRAG_RETRIEVAL_DEBUG=1
```

Each `askQuestion` logs one JSON line (stderr) with vector shortlist size, candidate count, top retrieval rows (scores), and citation chunk ids used in the answer. This is **not** a polished UI; it is for local debugging only.

## Suggested next steps

- Grow the benchmark with anonymized real-library exports.
- Optional CI: run `npm run eval:rag` on PRs if runtime stays acceptable; keep it non-blocking until stable.
