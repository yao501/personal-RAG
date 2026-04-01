# Personal Knowledge RAG

Local-first desktop app for macOS that imports personal files, indexes them locally, and answers questions with explicit source citations.

## MVP stack

- Electron + React + TypeScript + Vite for a fast desktop shell
- SQLite via `better-sqlite3` for local metadata and chunk storage
- `pdf-parse` and `mammoth` for `pdf` / `docx` parsing
- Modular local retrieval pipeline with chunking, lexical scoring, and citation-first answers

This v1 intentionally avoids heavy agent architecture. The code is organized so future work can add local embeddings, rerankers, or model-backed answer synthesis without rewriting the app structure.

## Current vertical slice

Implemented:

- native file import for `pdf`, `md`, `txt`, `docx`
- local document parsing
- chunking with configurable chunk size and overlap
- SQLite-backed document and chunk persistence
- local retrieval over indexed chunks
- chat answer generation with explicit citations
- document detail view with chunk inspection
- settings for chunk controls
- reindex support

Still next:

- semantic embeddings for stronger retrieval
- optional local LLM answer synthesis
- indexing progress events
- richer snippet highlighting
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

## Tests

Run:

```bash
npm test
```

Included tests cover:

- chunk overlap behavior
- retrieval ranking behavior

## Architecture choices

- SQLite was chosen for reliable local persistence and simple reindex flows.
- The first retrieval implementation is lexical rather than embedding-based to keep the MVP reliable and fast to ship.
- Answer generation is citation-first and grounded in retrieved chunks, which keeps the system useful before model integration.
- The module boundaries leave room for future functions such as `searchKnowledge()`, `answerQuestion()`, and `reindexLibrary()` to support later automation or agent-like features without introducing them now.
