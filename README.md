# Personal Knowledge RAG

本仓库目标是演进为 **enterprise-ready 的 macOS 桌面私有知识助手**：本地优先存储与索引、引用优先回答、可诊断/可修复的导入与重建索引流程，并保持行为可解释、可支持。

核心方向（不变）：

- local-first + enhanced hybrid RAG
- citation-first answers
- strong diagnostics

非目标（当前阶段不做）：

- 不将主线切换为 GraphRAG
- 不引入复杂的多 agent 编排
- 不扩展为 SaaS / 平台化产品

## Current stack

- Electron + React + TypeScript + Vite for a fast desktop shell
- SQLite via `better-sqlite3` for local metadata and chunk storage
- LanceDB for local vector recall over embedded chunks
- `pdf-parse` and `mammoth` for `pdf` / `docx` parsing
- Modular local retrieval pipeline with structure-aware chunking, hybrid retrieval, intent routing, sentence-level rerank, and citation-first answers
- Electron security baseline work is in progress (hardened `BrowserWindow` defaults, navigation/window restrictions, IPC sender trust checks, IPC input validation)
- IPC errors now use a renderer-consumable structured error envelope (code/stage/message/suggestion/retryable/details) for clearer UI surfacing and supportability

This app intentionally avoids heavy agent architecture. The code is organized so future work can add reliability/diagnostics improvements without rewriting the app structure.

## Current vertical slice

Implemented:

- native file import for `pdf`, `md`, `txt`, `docx`
- local document parsing with PDF heading cleanup
- stronger structured parsing for key-value and table-like `docx` / `txt` content
- structure-aware chunking with configurable chunk size and overlap
- SQLite-backed document and chunk persistence
- local retrieval over indexed chunks
- local embeddings plus LanceDB vector recall
- hybrid ranking with query intent routing and sentence-level rerank
- chat answer generation with explicit citations, tighter evidence snippets, and page/paragraph plus sentence-level anchors
- in-app citation context drill-down from answer cards to the source chunk
- citation cards can jump back to the original file and try a PDF page-level open when page anchors are available
- document detail view with chunk inspection
- document detail can switch between structure order and current-question relevance order, with evidence-sentence cues for the top matching chunks
- document-detail keyword filtering for fast source review
- in-app source preview with highlighted excerpt around the selected chunk
- settings for chunk controls
- recent query log capture for real-user eval feedback loops
- import and reindex task progress with stage-level feedback plus skipped-file reasons
- incremental reindex that skips unchanged documents when chunk settings and source timestamps have not changed
- library health inspection for missing files, stale sources, index drift, and missing embeddings
- retry flow for failed imports
- duplicate import skip for unchanged files
- targeted repair flow for only the documents that need reindexing
- local diagnostics in `Settings` for app version, data directory, and database path
- reindex support
- **Support bundle export** from `Settings`：导出 ZIP（JSON + 说明文本），默认不包含原文与 chunk 正文；可选匿名化路径与提问预览（详见 `docs/SUPPORT_RUNBOOK.md`）

Still next:

- expand eval benchmark coverage and regression comparisons beyond the Sprint 3 smoke set (`docs/EVAL_GUIDE.md`)
- Apple signing / notarization / stapling and optional CI release uploads (release **packaging** foundation is in `docs/RELEASE.md`; install notes in `docs/INSTALLATION.md`)
- deeper import/reindex error codes + UI refinement as diagnostics surface grows

## Project structure

```text
src/
  lib/
    modules/
      answer/
      chunk/
      core/
      parse/
      retrieve/
    shared/
  main/
  preload/
  renderer/
```

Key extension points:

- `chunkText()` for chunking strategy
- `searchChunks()` for retrieval logic
- `answerQuestion()` for grounded answer composition
- `KnowledgeService` for orchestration

## Setup

Suggested:

1. Install Node.js 22+
2. Run `npm install`（`postinstall` 会针对当前 **Electron** 自带的 Node 版本执行 `electron-rebuild`，以编译 `better-sqlite3` 等原生模块）
3. Run `npm run electron:dev`

若启动时提示 `better-sqlite3` 的 `NODE_MODULE_VERSION` 不匹配，多半是原生模块未按 Electron 重编：在项目根目录执行 `npm run rebuild:native` 后再启动。升级 **Electron** 或 **Node** 版本后也建议重新执行一次 `npm install` 或 `npm run rebuild:native`。

## How to use

1. Open the desktop app
2. Import files from the `Library` sidebar
3. Ask a question in the main prompt box
4. Inspect the citation cards in `Chat`
5. Open `Document Detail` to review the chunked source context
6. Check `Settings` to inspect the latest real query logs, mark benchmark candidates, copy auto-generated eval drafts, and mark promoted cases
7. Watch the left sidebar status card during import or reindex to track current stage, progress, and failed files
8. In `Chat`, click `查看来源上下文` on a citation card to jump into the source chunk inside the app
9. In `Chat`, click `打开原文` on a citation card to reopen the source file; PDFs with page anchors now try to jump to the cited page
10. In `文档详情`, switch between `结构浏览` and `当前问题相关` to inspect the document either by section order or by question relevance
11. Retry failed imports from the sidebar status card, and copy diagnostics from `Settings` when you need to troubleshoot delivery issues
12. Use `重建索引` for maintenance; unchanged documents are now skipped automatically when the source file and chunk settings are unchanged
13. Use `设置 -> 资料库健康` to inspect stale or broken library state, then clear missing-source records directly in the app
14. In `文档详情`, click a chunk to preview its surrounding source excerpt inside the app

## Tests

Run:

```bash
npm test
```

Retrieval eval:

```bash
npm run eval:rag
```

Writes a timestamped Markdown report under `reports/rag-eval/`. Benchmark format, metrics, and limitations: [docs/EVAL_GUIDE.md](docs/EVAL_GUIDE.md).

Sprint 5 alignment: the default benchmark path hydrates embeddings and runs the same **query embedding → top-24 vector shortlist → lexical merge → `searchChunks`** shape as the desktop app (LanceDB is replaced by in-memory cosine ranking in the script). For ad-hoc retrieval inspection in development, run Electron with **`PKRAG_RETRIEVAL_DEBUG=1`** to log structured retrieval rows and citation ids to the terminal. Procedural questions with only weak single-hit evidence use a **cautious, overview-style** direct answer instead of an overconfident how-to (see `answerQuestion`).

Included tests cover:

- chunk overlap behavior
- retrieval ranking behavior
- retrieval eval matching and summary logic

## macOS app packaging (Sprint 4)

Repeatable **release** build (full `tsc` + `electron-vite` + `electron-builder`):

```bash
npm run release:mac
```

`npm run dist:mac` is the same as `release:mac`. For a faster local pack (skips the root `tsc -b` step), use `npm run app:mac`.

Output (gitignored until you build):

- `release/mac-arm64/个人知识库 RAG.app`

Detailed prerequisites, first-open Gatekeeper behavior, and what is **not** implemented yet: **`docs/INSTALLATION.md`**. Release checklist, versioning, and deferred signing work: **`docs/RELEASE.md`**.

Notes:

- Icon path is configured under `build.mac.icon` in `package.json` (`build/app-icon-1024.png`).
- Signing, notarization, and DMG/installer distribution are **out of scope** for the current foundation; see `docs/RELEASE.md`.

## Architecture choices

- SQLite was chosen for reliable local persistence and simple reindex flows.
- Retrieval combines lexical match, metadata boosts, local embeddings, LanceDB candidate recall, and intent-aware reranking so the stack stays local while improving recall quality.
- Answer generation is citation-first and grounded in retrieved chunks, with sentence-level evidence selection plus page/paragraph and sentence anchors to make citations easier to inspect.
- Real query logs are persisted locally so future retrieval changes can be compared against both curated eval datasets and actual user questions, then promoted into benchmark drafts from the desktop app.
- Import and reindex now expose stage-level progress plus structured failure reasons, which makes large-library maintenance much safer for end users.
- Reindex is now incremental-aware, so unchanged documents are skipped when their source timestamp and indexing signature still match, which reduces maintenance cost for larger libraries.
- The app now includes a library-health layer that can detect missing source files, stale source updates, index-config drift, and missing embeddings so maintenance problems are visible before retrieval quality degrades.
- Health issues can now be repaired selectively, so documents that need reindexing can be fixed without rebuilding the whole library.
- Settings now surface local diagnostics so packaging, support, and on-device troubleshooting are easier during delivery.
- The module boundaries leave room for future functions such as `searchKnowledge()`, `answerQuestion()`, and `reindexLibrary()` to support later automation or agent-like features without introducing them now.
