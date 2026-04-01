# cat > AGENTS.md <<'EOF'
# AGENTS.md

## Project overview
This repository is for building a local-first desktop app called "个人知识库 RAG" / "Personal Knowledge RAG".

The goal is to create a Mac-friendly personal knowledge base app that:
- stores and indexes my personal knowledge files locally
- supports natural language question answering over my files
- returns answers with citations to source passages
- is RAG-first and Agent-ready
- runs well on a MacBook M4 Pro

## Product direction
This is NOT a full autonomous agent in v1.
Do NOT build a heavy agent architecture first.

The product direction is:
- v1: high-quality local RAG app
- v2+: light automations and agent-like workflows
- architecture should remain extensible for future agent features

## v1 MVP scope
Build a working MVP with:
1. local desktop app shell
2. file import
3. document parsing
4. chunking and indexing
5. hybrid retrieval if practical
6. chat-style Q&A over indexed documents
7. answer with citations / source snippets
8. view source context
9. reindex support
10. simple settings page

Supported file types for v1:
- pdf
- md
- txt
- docx

## Non-goals for v1
Do NOT implement these first unless required by the core architecture:
- full autonomous planning
- email/calendar/tool orchestration
- multi-step agent execution
- background autonomous actions
- cloud-first storage
- complicated collaboration features

## Technical preferences
Prioritize:
- local-first architecture
- maintainable code
- simple, reliable UX
- explicit citations
- easy future extensibility

Favor:
- TypeScript where reasonable
- clean module boundaries
- clear README and setup instructions
- practical defaults over overengineering

## Suggested architecture
Use a structure like:
- app/ or src/ for UI
- backend/ or main/ for app logic
- lib/ for shared logic
- modules for:
  - ingest
  - parse
  - chunk
  - embed
  - index
  - retrieve
  - answer
  - settings

Keep the retrieval pipeline modular so future tools/agents can call functions like:
- ingestDocuments()
- searchKnowledge()
- answerQuestion()
- summarizeDocuments()
- reindexLibrary()

## UX expectations
Main screens:
- Library
- Chat
- Document Detail
- Settings

The user should be able to:
- import files easily
- see indexing progress
- ask questions naturally
- inspect citations and source passages
- open the source file context

## Preferred development behavior
When working:
1. first inspect the repo and propose the exact implementation plan
2. then create the initial scaffold
3. then implement the MVP in small, reviewable steps
4. keep the app runnable as early as possible
5. explain tradeoffs briefly when making architecture decisions

## Code quality
- keep functions small and named clearly
- avoid unnecessary abstraction
- add types
- include basic error handling
- include minimal but useful tests where practical
- update README as the project evolves

## Delivery expectations
At each meaningful milestone, provide:
- what was added
- which files changed
- how to run it
- what remains next

## Important
If some framework choice is uncertain, choose the fastest stable option for shipping a local Mac desktop MVP.
Default to a practical solution rather than asking too many questions.
EOF