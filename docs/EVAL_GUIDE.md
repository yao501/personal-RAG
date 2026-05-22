# RAG evaluation and regression

This document describes the **local-first** benchmark format and how to run the evaluation runner. It is intentionally small and deterministic: metrics are heuristics, not semantic “truth” labels.

## When to use this

- Before or after changing chunking, retrieval, reranking, or answer assembly.
- To compare two branches or commits using the same benchmark file and the same runner.

`npm run eval:rag` writes both:

- a human-readable Markdown report under `reports/rag-eval/eval-<timestamp>.md`
- a machine-readable JSON summary under `reports/rag-eval/eval-<timestamp>.json` for CI or branch-to-branch comparison

### Real-library regression track (P0-A)

- **Plan and scope:** [`docs/P0-A_REAL_QUERY_EXPANSION_PLAN.md`](P0-A_REAL_QUERY_EXPANSION_PLAN.md) — small, anonymized real questions; no benchmark inflation in early rounds.
- **Directory placeholder (cases + `fail_stage` notes):** [`evals/cases/README.md`](../evals/cases/README.md).

### P0-A Round 1：Q6 同族最小闭环

本轮只聚焦 **Q6 同族**（编译/下装顺序 + 控制器侧 vs 工程总控/站侧边界）。

- **计划文档**：[`docs/P0-A_Q6_ROUND1_PLAN.md`](P0-A_Q6_ROUND1_PLAN.md)
- **cases**：`evals/cases/q6-round1.json`
- **runner**：`scripts/runRealRegressionQ6Round1.ts`

运行：

```bash
export PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册"
./node_modules/.bin/vite-node scripts/runRealRegressionQ6Round1.ts
```

### P0-A Round 2：Q6 控制器侧强约束问法

本轮仍只聚焦 Q6 同族，但新增的 case **更强约束** answer 必须覆盖：
控制器侧先做什么、两阶段边界、以及“先编译后下装”的顺序表达。

- **计划文档**：`docs/P0-A_Q6_ROUND2_PLAN.md`
- **cases**：`evals/cases/q6-round2.json`

运行：

```bash
export PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册"
./node_modules/.bin/vite-node scripts/runRealRegressionQ6Round1.ts round2
```

### P0-A Round 3：Q6 可接受答案形态收敛（acceptable variants）

本轮引入 `acceptable_variants`：允许同义表达与结构化表达，但仍禁止“只答泛化 FAQ、完全不点控制器侧/边界”的答案。

- **计划文档**：`docs/P0-A_Q6_ROUND3_PLAN.md`
- **cases**：`evals/cases/q6-round3.json`

运行：

```bash
export PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册"
./node_modules/.bin/vite-node scripts/runRealRegressionQ6Round1.ts round3
```

### Q6 Answer Patch 1：仅 answer 层修补验证

本轮只改 answer 层（不动检索规则），用 **Q6 Round 3** 回归验证是否更接近 `acceptable_variants`。

- **计划**：`docs/P0-A_Q6_ANSWER_PATCH1_PLAN.md`

运行（与 Round 3 相同）：

```bash
export PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册"
./node_modules/.bin/vite-node scripts/runRealRegressionQ6Round1.ts round3
```

产物：

- 原始 JSON：`evals/raw/real-regression-<YYYY-MM-DD>-<seq>.raw.json`
- 结果 JSON：`evals/results/real-regression-run-<YYYY-MM-DD>-<seq>.json`
- 可读 summary：`evals/results/real-regression-summary-<YYYY-MM-DD>-<seq>.md`

### P0-B Manual 7 Phase B：功能块专题回归

本组固化手册7功能块专题 M7-2 ~ M7-6，覆盖 PID 参数、PID 跟踪/自动、高级运算块、旁路 Bypass、MOTCTRL/VALCTRL。

- **cases**：`evals/cases/p0b-manual7-phaseb.json`
- **runner**：`scripts/p0bPhaseBOnly.ts`
- **当前基线**：2026-05-14，`P:5 Pa:0 F:0`，均分 `1.00`

运行：

```bash
export PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册"
./node_modules/.bin/vite-node scripts/p0bPhaseBOnly.ts --spec evals/cases/p0b-manual7-phaseb.json
```

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
| `intentGroup` | no | Optional label to group **near-equivalent** phrasings in the Markdown report (e.g. `import-procedure`). Does not change pass/fail logic. |
| `sourceType` | no | `fixture` (default) or `sanitized` — **metadata only** for reports; all in-repo cases use fictional/sanitized fixtures, not user libraries. |
| `expectedAnswerMode` | no | Optional regression label: `grounded` (non-refusal, non-cautious synthesis), `cautious` (cautious procedural template), `refusal` (refusal template). When set, adds extra assertions (see below). |
| `notes` | no | Free text for humans; not scored. |

### Documents

Each entry has `id`, `path` (repo-relative), optional `title` / `parserHint`. Files are parsed and chunked like normal imports.

## How to run

Default (uses `benchmarks/benchmark.v1.json`):

```bash
npm run eval:rag
```

Product gate (fixture smoke + optional/required real DCS Manual 7 gate):

```bash
npm run eval:rag:product
npm run eval:rag:refusal
PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册" npm run eval:rag:product -- --require-realpdf
PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册" npm run eval:rag:product -- --profile dcs-core --require-realpdf
```

`eval:rag:product` always runs the default fixture smoke benchmark and `benchmarks/refusal-gate.v1.json` first. The refusal gate covers no-match refusal, DCS-shaped unsupported questions, private-credential questions, thin procedural evidence, definition-only procedural evidence that must be cautious, and one grounded positive control. Product gate summaries are written under `evals/results/product-rag-gate-<date>-<seq>.md`. Files under `evals/results/` are gitignored because real-library runs may include absolute paths and source snippets.

Release-quality gate (tests + production build + `dcs-core` product gate):

```bash
npm run release:quality -- --skip-realpdf
PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册" npm run release:quality -- --require-realpdf
```

Profiles:

- `manual7` (default): fixture smoke + DCS Manual 7 Phase B (`M7-2` ~ `M7-6`).
- `dcs-core`: fixture smoke + cross-volume DCS core questions (`Q1`, `Q6`, `Q7`, `Q8`, `Q9`, `Q10`, `Q11`, `Q12`; metadata in `evals/cases/dcs-core-cross-volume.json`) + DCS Manual 7 Phase B.

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
- **Cautious procedural** (informational): whether `directAnswer` contains the cautious template marker (`概述性内容` in `cautiousMarkers.ts`). Shown per case in the report; not a failure by itself.

### Report extras (Sprint 5.1 / 5.2)

- **Failure buckets**: counts of failed cases by coarse category (`retrieval`, `facts`, `citation`, `refusal`, `unexpected_refusal`, `answer_mode`, `other`).
- **Intent groups**: pass rate per `intentGroup` (same-intent phrasing comparison).
- **Per-case columns** `src` / `exp.mode`: `sourceType` and `expectedAnswerMode` when present.

### Core retrieval paraphrase gate (Sprint 5.3)

The default fixture benchmark now includes product-grade paraphrase checks for:

- why-style chunking questions that should retrieve purpose evidence (`检索精度`, `上下文长度`)
- library health navigation questions (`资料库健康`, `健康检查`, index/embed status)
- procedural wording that only has overview evidence (`高级配置`, multi-module overview/manual pointers)

Current baseline on 2026-05-14: `npm run eval:rag` passes **16/16**, with both synthetic no-match cases still producing refusal answers.

### `expectedAnswerMode` (Sprint 5.2)

When set (and not redundant with `mustRefuse`):

- **`grounded`**: fails if the answer is a refusal template or a cautious procedural template.
- **`cautious`**: fails if the answer is **not** cautious procedural; use for thin procedural evidence and explicit “overview only / see full manual” fixtures.
- **`refusal`**: fails if the answer does not match refusal heuristics (for non-`mustRefuse` cases that still expect refusal).

For `mustRefuse: true`, refusal is already enforced; `expectedAnswerMode: "refusal"` is optional documentation.

**Cautious procedural** behavior is covered by unit tests and by the benchmark overview-only fixture (`epsilon-procedural-gap`). If evidence explicitly says the material is only an overview and points users back to a full manual, the benchmark must stay cautious even when retrieval scores are high.

Pass/fail for a case is a conjunction of the checks that apply to that case (see report per row).

### Cautious procedural gate (tunable heuristics)

For procedural-style questions (`detectQueryIntent.wantsSteps`), the app may emit a **cautious** overview answer instead of a confident how-to when evidence is thin. The single-hit **skip-cautious** rule (Sprint 5.1) replaces a flat `score ≥ 2.5` test with:

- `top.score ≥ 2.78` → strong enough; or
- `top.score ≥ 2.38` and `qualityScore ≥ 0.12` and `rerankScore ≥ 0.98` → strong enough; or
- `top.score ≥ 2.35` and `qualityScore ≥ 0.28` → strong enough.

If the retrieved evidence explicitly says it is overview/background material, lacks steps/commands/menu paths, or instructs users to consult the full manual, the cautious template is used before score-based overrides. Otherwise, if none of the strong-evidence score rules hold and the chunk text still lacks step-like markers, the cautious template is used. For two retrieved chunks, if the second score is **below** `0.58 × top.score`, the cautious path is preferred (Sprint 5.1 tightened from `0.62` to reduce unnecessary cautious answers when the runner-up is moderately strong).

**Refusal/sufficiency gate:** validation now also includes `benchmarks/refusal-gate.v1.json`, which hard-checks unsupported specifics, private-credential style questions, thin/definition-only procedural evidence, and a grounded positive control.

## Known limitations

- **No LLM-as-judge**; “correctness” is substring and template based.
- **Vector store**: the runner uses `runRetrievalLikeDesktop` — query embedding, **in-memory** top-24 cosine shortlist, `selectCandidateChunksFromVectors`, then `searchChunks`. The desktop app uses **LanceDB** for the same shortlist when available; numerics can still differ slightly, but the **pipeline shape** matches.
- **Benchmark size**: `benchmarks/benchmark.v1.json` is a small smoke set.

### Desktop vs eval runner (explicit gaps, Sprint 5.2)

| Aspect | Desktop | Eval (`npm run eval:rag`) |
|--------|---------|---------------------------|
| Vector shortlist | LanceDB ANN over persisted index | In-memory cosine vs embeddings hydrated in the runner |
| Chunk corpus | User library + backfill/reindex state | Fixture markdown only |
| `PKRAG_RETRIEVAL_DEBUG` | `vectorRecallBackend: "lancedb"`, `runtime: "desktop"` | Same JSON shape with `vectorRecallBackend: "memory"`, `runtime: "eval"` |

Use the **`vectorRecallBackend` + `runtime`** fields to tell log lines apart. **Do not** expect bit-identical scores or identical top-`k` ordering across desktop vs eval when embeddings differ or Lance is cold.

## Desktop & eval retrieval debug (developer)

Set:

```bash
export PKRAG_RETRIEVAL_DEBUG=1
```

- **Electron**: each `askQuestion` logs **one JSON object per line** (stderr).
- **Eval runner**: logs **one line per benchmark case** when the same env var is set (same schema for apples-to-apples inspection).

Payload **`schemaVersion` is 9** (`RETRIEVAL_DEBUG_PAYLOAD_SCHEMA_VERSION`). Fields include:

- `vectorRecallBackend` (`lancedb` | `memory`), `runtime` (`desktop` | `eval`)
- `queryRetrievalType` — coarse P0-B bucket (`procedural_full_flow` | `compile_order` | `definition` | `troubleshooting` | `default`) aligned with retrieval bias
- `effectiveQueryTokens` / `expandedTokens` / `intentPrimary` / `intentWantsSteps` — aligned with `searchChunks` tokenization
- `vectorShortlistCount`, `candidateChunkCount`, `searchTopK`
- `candidateSelection` — compact source summary for the candidate pool (`all_chunks_no_vector`, `hybrid_vector_lexical`, or `hybrid_vector_only_or_unknown`) plus vector/candidate/fallback counts where known
- `rejectionDiagnostics` — compact `searchChunks` primary-rank filtering diagnostics: evaluated/kept/rejected counts plus sampled rejected candidates with scores, coverage, penalty, and reason codes. It intentionally excludes raw chunk text and evidence snippets.
- `topResults` — top `searchTopK` rows with scores, weighted score contribution breakdowns, contextual chunk metadata, vector-hit status, selection reason codes, citation status, and non-citation reason when applicable
- `answerCitationChunkIds`
- `answerFlags.refusal` / `answerFlags.cautiousProcedural`
- `evidenceDecision` — compact answer-layer decision metadata: `mode` (`grounded` | `cautious` | `refusal`), `reasonCode`, human-readable `reason`, cited chunk count, source document count, and top evidence context signals when present

The desktop app also exposes a **Settings → 最近真实提问 → 检索调试** panel based on persisted query logs. It shows query type, intent hints, token expansion, answer flags, evidence decision reason, candidate pool source, primary-rank rejection reasons, vector shortlist count, candidate chunk count, citation-hit count, selection reason codes, and score breakdowns for the stored top results. Each row can export an anonymized single-query debug JSON snapshot; it excludes raw chunk text, snippets, evidence text, and answer text by default. The chat answer view also shows the same evidence decision in user-facing language so refusal/cautious behavior is inspectable without opening developer logs.

### Baseline comparability

Benchmark **case counts** and ids change over time (e.g. Sprint 5.1 added wording groups). Compare **before/after** deltas using the **same** `benchmarks/benchmark.v1.json` revision on the same machine; do not treat historical “N/ N passed” from a smaller file as a strict regression target.

## Suggested next steps

- Grow the benchmark with anonymized real-library exports.
- Use the desktop Settings query-log flow to mark representative real questions as benchmark candidates; copied drafts are benchmark v1 case JSON snippets with `sourceType: "sanitized"` and support grounded, cautious, and refusal cases.
- Optional CI: run `npm run eval:rag` on PRs if runtime stays acceptable; keep it non-blocking until stable.
