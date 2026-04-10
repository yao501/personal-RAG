# RAG evaluation and regression (Sprint 3)

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
| `library` | yes | How to build the in-memory library for eval (see below). |
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

### Library block (`library`)

Current runner supports:

- `type: "fixtureMarkdown"` — paths under `benchmarks/fixtures/` (repo-relative), ingested with the same markdown pipeline as other local docs.

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

- **No LLM-as-judge** in this sprint; “correctness” is substring and template based.
- **Eval environment**: the runner uses the in-process `searchChunks` + `answerQuestion` path (same code as much of the app), but **embedding / LanceDB vector paths may differ** from a fully hydrated desktop session. Treat absolute scores as smoke signals; use **before/after deltas** on the same machine for retrieval changes.
- **Small starter set**: `benchmarks/benchmark.v1.json` is a smoke set, not production coverage.

## Suggested next steps (post–Sprint 3)

- Grow the benchmark with real library exports (anonymized) and frozen expected docs.
- Optional CI: run `npm run eval:rag` on PRs if runtime stays acceptable; keep it non-blocking until stable.
