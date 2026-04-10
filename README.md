# Personal Knowledge RAG

Local-first desktop app for macOS that imports personal files, indexes them locally, and answers questions with explicit source citations.

## MVP stack

- Electron + React + TypeScript + Vite for a fast desktop shell
- SQLite via `better-sqlite3` for local metadata and chunk storage
- LanceDB for local vector recall over embedded chunks
- `pdf-parse` and `mammoth` for `pdf` / `docx` parsing
- Modular local retrieval pipeline with structure-aware chunking, hybrid retrieval, intent routing, sentence-level rerank, and citation-first answers

This v1 intentionally avoids heavy agent architecture. The code is organized so future work can add local embeddings, rerankers, or model-backed answer synthesis without rewriting the app structure.

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
- document detail view with chunk inspection
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

Still next:

- optional local LLM answer synthesis
- indexing progress events
- source-file jump/highlight integration beyond current in-app evidence highlighting
- packaging/signing for macOS distribution

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

You need a recent Node.js release installed locally first. This shell did not currently have `node` or `npm`, so install verification could not be completed yet.

Suggested:

1. Install Node.js 22+
2. Run `npm install`
3. Run `npm run electron:dev`

## How to use

1. Open the desktop app
2. Import files from the `Library` sidebar
3. Ask a question in the main prompt box
4. Inspect the citation cards in `Chat`
5. Open `Document Detail` to review the chunked source context
6. Check `Settings` to inspect the latest real query logs, mark benchmark candidates, copy auto-generated eval drafts, and mark promoted cases
7. Watch the left sidebar status card during import or reindex to track current stage, progress, and failed files
8. In `Chat`, click `查看来源上下文` on a citation card to jump into the source chunk inside the app
9. Retry failed imports from the sidebar status card, and copy diagnostics from `Settings` when you need to troubleshoot delivery issues
10. Use `重建索引` for maintenance; unchanged documents are now skipped automatically when the source file and chunk settings are unchanged
11. Use `设置 -> 资料库健康` to inspect stale or broken library state, then clear missing-source records directly in the app
12. In `文档详情`, click a chunk to preview its surrounding source excerpt inside the app

## Tests

Run:

```bash
npm test
```

Retrieval eval:

```bash
npm run eval:rag
```

Included tests cover:

- chunk overlap behavior
- retrieval ranking behavior
- retrieval eval matching and summary logic

## macOS app packaging

To build a double-clickable macOS app bundle:

```bash
npm run app:mac
```

Output:

- `release/mac-arm64/个人知识库 RAG.app`

You can open the `.app` directly in Finder and drag it into the Dock like a normal macOS app.

Notes:

- The current package uses the default Electron app icon.
- If you want a custom Dock/app icon next, add a macOS `.icns` asset and wire it into the build config.

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
