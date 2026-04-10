# AGENTS.md

## Mission

This repository should evolve into an **enterprise-ready macOS desktop private knowledge assistant**.

The product goal is **not** to become a multi-tenant SaaS platform, not to become a general-purpose agent framework, and not to chase the most complex RAG architecture first.

The goal is to deliver a **local-first, reliable, secure, diagnosable desktop RAG application** for enterprise customers.

---

## Product Direction

### Primary target
A **macOS desktop private knowledge assistant** with:

- local-first storage and indexing
- citation-first answers
- strong diagnostics and repairability
- stable import and reindex workflows
- enterprise-friendly installation and upgrade path
- predictable, explainable behavior

### Non-goals for the current stage
Do **not** optimize for these yet:

- GraphRAG as the primary architecture
- complex multi-agent orchestration
- multi-user cloud collaboration
- centralized organization-wide permissions platform
- SaaS-first or browser-first rewrite
- “more intelligent” behavior at the expense of reliability or explainability

---

## Architecture Principles

### 1. Keep the current main direction
Preserve and strengthen this direction:

**Local-first + Enhanced Hybrid RAG + Citation-first + Strong Diagnostics**

This means:

- local document ingestion
- structure-aware chunking
- hybrid retrieval
- evidence-based answer generation
- refusal when evidence is insufficient
- health checks, repair tools, and support tooling

### 2. Reliability over novelty
When choosing between:
- a more advanced idea, and
- a more reliable implementation,

prefer the more reliable implementation.

### 3. Explainability over “smartness”
Prefer:
- explicit citations
- visible evidence
- deterministic failure states
- understandable error messages

Do not introduce behavior that makes answers harder to verify.

### 4. Incremental delivery
Make small, reviewable changes.
Do not refactor large parts of the system unless necessary for the current sprint.

### 5. One sprint at a time
Do not work on multiple large workstreams in parallel.
Finish the current sprint cleanly before starting the next one.

---

## Current Priorities

Always follow this priority order unless explicitly told otherwise.

### P0 — Immediate priorities
1. Security hardening
2. Import/reindex reliability
3. Support bundle and diagnostics
4. Evaluation/regression pipeline
5. Release/release-doc foundations

### P1 — Next priorities
1. Retrieval debug tooling
2. Contextual metadata enrichment
3. Evidence sufficiency gating
4. Stable refusal behavior
5. Upgrade/migration safety

### P2 — Later priorities
1. Optional local LLM synthesis improvements
2. Stronger rerankers
3. Multi-library management
4. Experimental GraphRAG branch

---

## Mandatory Development Rules

### Rule 1: Do not change the product direction
Do not convert this project into:
- a GraphRAG-first system
- an agent-first system
- a cloud-first platform
- a multi-user enterprise portal

If an idea would push the repository in those directions, do not implement it unless explicitly requested.

### Rule 2: Security is a hard requirement
For Electron and desktop boundaries:

- keep `contextIsolation: true`
- keep `sandbox: true`
- keep `nodeIntegration: false`
- expose only minimal APIs via preload
- validate all IPC input
- restrict external navigation and window creation
- maintain CSP and secure defaults

Do not weaken security for convenience.

### Rule 3: Diagnostics are first-class
Every important workflow should be diagnosable.

When implementing or changing:
- import
- reindex
- retrieval
- answer generation
- migrations
- release behaviors

ensure failures are:
- structured
- inspectable
- user-facing where appropriate
- supportable via logs or exported diagnostics

### Rule 4: Prefer structured errors
Avoid ad hoc string-only errors where possible.

Prefer errors with fields such as:
- code
- stage
- message
- suggestion
- retryable
- details

Renderer-visible errors should be structured and consistent.

### Rule 5: Do not hide uncertainty
If evidence is weak:
- refuse
- ask for more documents
- suggest changing the query
- show why the system cannot answer confidently

Do not fabricate confident answers.

### Rule 6: Retrieval changes require evaluation
Any meaningful change to:
- chunking
- retrieval
- reranking
- evidence selection
- refusal logic

must include:
- benchmark impact
- regression considerations
- test updates where practical

### Rule 7: Keep docs in sync
Whenever behavior changes materially, update relevant docs.

At minimum consider:
- `README.md`
- `TODO.md`
- `docs/SECURITY_BASELINE.md`
- `docs/SUPPORT_RUNBOOK.md`
- `docs/RELEASE.md`
- `docs/MIGRATION.md`

---

## Working Style for Cursor

When asked to implement a task, follow this workflow:

### Step 1: Understand the sprint and scope
Before coding:
- identify which sprint/workstream the task belongs to
- confirm that the task aligns with the product direction
- avoid scope creep

### Step 2: Make a small implementation plan
Before editing files, write a short plan:
- what will change
- which files will be touched
- what tests/docs should be updated
- what is intentionally out of scope

### Step 3: Implement minimally
Prefer minimal, targeted edits over broad rewrites.

### Step 4: Update tests
If the affected area has tests, update or add them.
If tests are missing, add focused tests for critical logic.

### Step 5: Update docs
If user-facing or architecture-significant behavior changed, update docs.

### Step 6: Summarize clearly
After finishing, provide:
- changed files
- what was implemented
- what remains unfinished
- how to validate manually
- risks / follow-ups

---

## Preferred Sprint Order

Unless the user changes priorities, execute in this order:

### Sprint 1 — Close current foundation gaps
- align `AGENTS.md`, `TODO.md`, `README.md`
- improve structured IPC errors
- ensure import/reindex errors are fully surfaced in UI
- clean up any mismatch between docs and current implementation

### Sprint 2 — Support bundle
- implement exportable support bundle
- include app/build/system/library health metadata
- exclude raw document content by default
- add anonymize option
- surface export in Settings
- add `docs/SUPPORT_RUNBOOK.md`

### Sprint 3 — Evaluation and regression
- formalize benchmark format
- add retrieval metrics
- add refusal correctness checks
- generate readable reports
- prepare CI-friendly evaluation path

### Sprint 4 — Release foundation
- add repeatable release command
- add release documentation
- formalize installation guidance
- prepare for signing/notarization pipeline

### Sprint 5 — Retrieval engineering
- contextual chunk metadata
- retrieval debug panel
- evidence sufficiency gate
- improved refusal behavior

### Sprint 6 — Upgrade and migration safety
- schema/version checks
- backup before migration
- rollback strategy
- migration docs

---

## Repository Expectations

### Expected qualities of new code
New code should be:
- typed where appropriate
- readable
- small in scope
- testable
- consistent with existing architecture

### Avoid
Avoid introducing:
- large speculative abstractions
- framework churn
- unnecessary dependencies
- hidden background magic
- broad renames without strong reason

### Prefer
Prefer:
- explicit module boundaries
- focused utilities
- shared error/type definitions
- stable renderer-main contracts
- visible user-facing diagnostics

---

## Retrieval Strategy Guidance

The current RAG direction should remain an **enhanced hybrid RAG**.

Prefer improvements such as:
- better chunk metadata
- contextual chunk enrichment
- hybrid lexical/vector retrieval tuning
- rerank improvements
- evidence coverage tracking
- stable refusal and confidence gating

Do **not** switch the mainline to GraphRAG unless explicitly requested for a specific use case.

Graph-based methods, if explored, should live in an experimental path and must not disrupt the main delivery track.

---

## UI/UX Guidance

For enterprise desktop usage, optimize for:

- clarity
- traceability
- recoverability
- low surprise
- transparent system state

Important UX priorities:
- import progress should be understandable
- failure reasons should be actionable
- source citations should be easy to inspect
- empty-result states should be explicit
- repair/reindex flows should be safe and clear

---

## Definition of Good Output

A good implementation in this repository usually does **all** of the following:

- solves one clearly scoped problem
- does not weaken security
- improves reliability or diagnosability
- preserves citation-first behavior
- keeps docs and tests aligned
- does not introduce platform drift

---

## When in doubt

If unsure between two approaches, choose the one that is:

1. safer
2. smaller
3. easier to verify
4. easier to support after delivery
5. more aligned with enterprise desktop reliability

If still unsure, do not make a broad architectural leap. Make the smallest change that preserves the current roadmap.
