# TODO.md

## Purpose

This file is the working product-upgrade guide for this repository.

It combines:

- the original project direction in [AGENTS.md](AGENTS.md)
- the recent repo-specific roadmap discussion
- the current codebase reality

Use this as the default prioritization guide for future work.

## Product Direction

We are building a macOS desktop knowledge assistant for enterprise delivery.

Core direction:

- local-first
- citation-first
- hybrid RAG as the main retrieval route
- strong diagnostics and recoverability
- stable install and upgrade path

Do not optimize first for:

- GraphRAG as the main architecture
- heavy agent orchestration
- SaaS/platformization
- “smarter” behavior that reduces explainability or supportability

## Current Repo Baseline

The repo already has a meaningful MVP foundation:

- Electron + React + TypeScript desktop shell
- local import for `pdf` / `docx` / `md` / `txt`
- parsing, chunking, SQLite persistence, LanceDB vector recall
- hybrid retrieval and citation-first answering
- document detail and citation context drill-down
- local health checks and targeted repair basics
- local query logs and a lightweight `eval:rag` harness
- packaging baseline for macOS app bundles

This means the next phase should not start with feature sprawl.
It should focus on enterprise readiness:

- security boundary hardening
- release repeatability
- import/index reliability
- diagnostics and support tooling
- regression-quality infrastructure

## Execution Principles

1. Do P0 before P1, and P1 before P2.
2. Prefer reliability, safety, and observability over new intelligence features.
3. Any retrieval change should be backed by benchmark results.
4. Any high-risk change should be reversible or recoverable.
5. Any import, index, or answer failure should become diagnosable.
6. Keep the app runnable at every milestone.

## P0

### P0.1 Security baseline

Why this is first:

- highest enterprise risk if left loose
- relatively high value with contained implementation scope

Scope:

- harden all `BrowserWindow` settings
- enable and validate `sandbox: true`
- keep `contextIsolation: true`
- keep `nodeIntegration: false`
- explicitly deny arbitrary navigation and window creation
- restrict external open behavior
- add IPC input validation and a unified error envelope
- document the security baseline

Target files:

- [src/main/main.ts](src/main/main.ts)
- [src/preload/preload.ts](src/preload/preload.ts)
- [src/lib/shared/types.ts](src/lib/shared/types.ts)
- `docs/SECURITY_BASELINE.md`

Acceptance:

- renderer only gets whitelisted APIs
- IPC has typed request/response rules
- no obvious insecure Electron defaults remain

### P0.2 Import/index reliability

Why this is next:

- this is where enterprise users will feel breakage first
- it also powers better support and recovery flows

Scope:

- define standard error codes (**foundation in place; continue expanding for new real-world failures**)
- map each import/index failure stage to stable error codes (**foundation in place for preflight/parsing/chunking/embedding/indexing/storage**)
- unify how errors appear in UI, logs, and diagnostics (**IPC envelope, task issue panel, support bundle recent errors, vector-index fallback diagnostics, corrected import completion counts, and missing-source reindex regression coverage are in place**)
- add stronger pre-import checks
- improve per-file retry and repair flows
- deepen library consistency checks

Target areas:

- [src/main/knowledgeService.ts](src/main/knowledgeService.ts)
- [src/main/store.ts](src/main/store.ts)
- [src/lib/health/libraryHealth.ts](src/lib/health/libraryHealth.ts)
- [src/renderer/App.tsx](src/renderer/App.tsx)

Acceptance:

- failures are specific, stable, and actionable
- health checks can point to concrete broken documents or index state
- users do not need full rebuilds for common issues

### P0.3 Support bundle and diagnostics

Why this is now:

- supportability is part of product quality
- current repo already has app info, health checks, and task progress, so this is close

Scope:

- add one-click support bundle export
- include app version, build info, OS, data paths, DB path/schema version, recent task summaries, health results, and recent errors
- exclude raw document content by default
- allow anonymized export mode
- strengthen the Settings diagnostics view

Suggested modules:

- `src/lib/modules/support/`
- `docs/SUPPORT_RUNBOOK.md`

Acceptance:

- support can triage common failures without asking for raw source files
- export flow is clear and low-friction

### P0.4 Regression-quality evaluation

Status (Sprint 3 / 5.3): **foundation in place** — versioned benchmark JSON (`benchmarks/benchmark.v1.json`), `npm run eval:rag`, deterministic metrics, Markdown reports under `reports/rag-eval/`, and [docs/EVAL_GUIDE.md](docs/EVAL_GUIDE.md). Current default baseline on 2026-05-14 is **16/16**, including grounded paraphrase cases and synthetic refusal cases. `npm run eval:rag:product` now acts as the product gate: fixture smoke plus refusal/sufficiency gate first, then local DCS Manual 7 Phase B when `PKRAG_REALPDF_DIR` is available; `--profile dcs-core` adds the 8-case cross-volume DCS core gate for release-quality local validation.

Why this is P0:

- retrieval quality work is already active
- without a stronger harness, future improvements will regress silently

Scope:

- formalize benchmark data shape
- extend `eval:rag` beyond top-k evidence presence
- add retrieval metrics first
- add answer-layer checks after retrieval output is stable
- generate markdown reports and preserve history
- promote real query logs into sanitized benchmark v1 case drafts, including refusal candidates

Start small:

- `question`
- `expected_docs`
- `expected_facts`
- `expected_citations`
- `must_refuse`

Primary files:

- [benchmarks/benchmark.v1.json](benchmarks/benchmark.v1.json)
- [scripts/runRagEval.ts](scripts/runRagEval.ts)
- [src/lib/eval/benchmarkMetrics.ts](src/lib/eval/benchmarkMetrics.ts)
- [src/lib/eval/benchmarkRunner.ts](src/lib/eval/benchmarkRunner.ts)
- [scripts/ragEval.config.ts](scripts/ragEval.config.ts) (legacy datasets)
- [src/lib/eval/ragEval.ts](src/lib/eval/ragEval.ts)
- [src/lib/eval/queryLogDrafts.ts](src/lib/eval/queryLogDrafts.ts)

Acceptance:

- retrieval/chunk/rerank changes can be regression-tested
- bad cases can be tracked long-term
- reports are readable and comparable

### P0.5 Release pipeline baseline

Status (Sprint 4): **foundation in place** — `npm run release:quality` (tests + build + product RAG gate), `npm run release:mac` (alias `dist:mac`), predictable `release/mac-arm64/<productName>.app` output, `docs/INSTALLATION.md`, `docs/RELEASE.md`.

Why this is P0 but after the items above:

- it matters for delivery
- but signing/notarization is more valuable after the app boundary and diagnostics story are cleaner

Scope (done in Sprint 4):

- add `npm run release:mac`
- standardize release output shape (documented; `release/` + `build` config)
- document install and release steps

Still deferred:

- signing/notarization/staple flow
- optional CI artifact upload

Required docs:

- `docs/RELEASE.md`
- `docs/INSTALLATION.md`

Acceptance:

- release process is repeatable
- new machines can install and launch the app
- release requirements are documented

## P1

### P1.1 Retrieval quality improvements

Status (Sprint 5 + 5.1 + 5.2 + evidence-decision pass + candidate-reasons pass): **eval–desktop retrieval shape aligned**, **tuned cautious-procedural thresholds**, **benchmark intent groups + failure buckets + `expectedAnswerMode`**, **`PKRAG_RETRIEVAL_DEBUG` schema v5** (`vectorRecallBackend` / `runtime` + tokens + flags + answer evidence decision + candidate/result selection reasons; eval runner can emit the same shape per case).

Keep the current route:

- enhanced hybrid RAG
- stronger metadata-aware ranking
- citation-first answers

Good next steps:

- chunk contextualization
- configurable lexical/vector weighting
- conflict-evidence messaging and deeper candidate rejection reasons
- stable refusal on weak evidence

Important:

- do not ship ranking changes by instinct alone
- require benchmark runs for retrieval changes

### P1.2 Retrieval debug panel

Status: **first in-app version implemented** — Settings exposes recent-query debug details from persisted query logs: query type, intent hints, effective/expanded tokens, answer flags, evidence decision reasons, candidate pool source, citation-hit count, vector shortlist count, candidate chunk count, top-result selection reason codes, and score breakdowns. The chat answer view also shows the current answer's evidence decision.

Remaining scope:

- show deeper filtering / rejection reasons when available from the ranker
- export a single query debug snapshot

This will make retrieval iteration much faster and safer.

### P1.3 Source-view and detail-page UX

This stays important, but it is not ahead of security/reliability.

Continue improving:

- PDF page jump and source-open behavior
- evidence highlighting
- detail-page metadata
- better explanation for weak or empty answers

## P2

These are valid but intentionally later:

- optional local LLM answer synthesis
- pluggable stronger reranker
- multiple library profiles
- GraphRAG experiments in a side path only

## Recommended Working Sequence

### Milestone A

- Electron security baseline
- IPC validation and unified error shape
- `docs/SECURITY_BASELINE.md`

### Milestone B

- stable error codes
- stronger import/index diagnostics
- targeted repair improvements

### Milestone C

- support bundle export
- Settings diagnostics upgrade
- `docs/SUPPORT_RUNBOOK.md`

### Milestone D

- benchmark schema upgrade
- more realistic dirty-document eval sets
- markdown regression reports

### Milestone E

- `release:mac`
- release metadata
- install/release docs
- signing and notarization

## Immediate Next Sprint

If we want the highest-value next sprint based on the current repo, do this:

1. Harden Electron security settings and IPC validation.
2. Introduce stable import/index error codes and a unified error envelope.
3. Add support bundle export using the diagnostics and health data that already exist.
4. Upgrade `eval:rag` into a more formal benchmark/report flow.

## Definition Of “Done” For This Phase

The app is ready for the next level when:

- install and release steps are repeatable
- the desktop boundary is meaningfully hardened
- import/index failures are understandable and repairable
- diagnostics can be exported safely
- retrieval quality changes are benchmarked before shipping

## Notes For Future Threads

When starting a new implementation thread, treat this file as the default roadmap.

If a proposed task conflicts with this file:

- prefer reliability over novelty
- prefer diagnostics over hidden behavior
- prefer benchmark-backed retrieval work over intuition-led tuning
- prefer reversible changes over hard-to-recover upgrades
