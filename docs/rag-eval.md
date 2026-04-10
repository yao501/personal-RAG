# RAG Eval Harness

This project now includes a lightweight retrieval evaluation harness so we can improve the product against multiple documents and question types instead of tuning against one sample by hand.

## What it checks

Each dataset defines:

- one or more source documents
- chunking settings
- a set of eval cases
- the expected evidence or section path that should appear in the top K retrieval results

The current harness focuses on retrieval and citation grounding, not final answer wording.

The product now also stores real query logs locally. Those logs are not automatically part of the curated benchmark, but they are the next input source for expanding it when repeated real-user questions expose new failure modes.

## Where it lives

- Config: [scripts/ragEval.config.ts](/Users/guangyaosun/personal-knowledge-rag/scripts/ragEval.config.ts)
- Runner: [scripts/runRagEval.ts](/Users/guangyaosun/personal-knowledge-rag/scripts/runRagEval.ts)
- Pure eval logic: [src/lib/eval/ragEval.ts](/Users/guangyaosun/personal-knowledge-rag/src/lib/eval/ragEval.ts)

## Run it

```bash
npm run eval:rag
```

Run a single dataset:

```bash
npm run eval:rag -- hollysys-install-manual
```

If a dataset references a local file outside the repo, you can override the path with an env var. Example:

```bash
HOLLIAS_INSTALL_PDF="/absolute/path/to/manual.pdf" npm run eval:rag
```

## How to add a new dataset

Add a dataset entry in [scripts/ragEval.config.ts](/Users/guangyaosun/personal-knowledge-rag/scripts/ragEval.config.ts):

- `documents`: files to parse and chunk
- `cases`: questions to ask
- `expectations`: what should match within top K

Prefer covering different product tasks:

- `definition`
- `procedure`
- `troubleshooting`
- `navigational`
- `role`
- `general`

## Product intent

This harness is meant to prevent us from overfitting on a single manual. As we add more document types and eval cases, retrieval changes should be judged by aggregate behavior across datasets and categories, not by whether one hand-picked question improves.

## Important: this is not the full product library

The eval set is a curated benchmark, not a mirror of every user document.

For a real product:

- user documents belong in the runtime knowledge library
- eval documents belong in a smaller, stable quality benchmark
- the benchmark should represent important document types and question types, not every single file

In other words, the eval set is a quality-control layer. We use it to catch regressions in retrieval, chunking, rerank, and citation grounding while the product evolves.

## Query-log loop

The app now captures recent real questions together with:

- the generated direct answer
- citation snapshots
- top retrieval results
- sentence-anchored evidence locators

This gives us two complementary quality loops:

- curated benchmark datasets in [scripts/ragEval.config.ts](/Users/guangyaosun/personal-knowledge-rag/scripts/ragEval.config.ts)
- real-user query logs surfaced in the desktop `Settings` view

The intended workflow is:

1. watch for repeated real-user misses or weak citations
2. mark representative logs as benchmark candidates in the desktop app
3. review or copy the auto-generated eval drafts
4. promote the best candidates into the curated eval set
5. rerun `npm run eval:rag`
6. only keep retrieval changes that improve aggregate behavior without breaking existing datasets
