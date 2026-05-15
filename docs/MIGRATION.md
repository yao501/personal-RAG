# Migration notes

This project uses small, additive SQLite migrations in `src/main/store.ts`.

## Current schema version

- `PRAGMA user_version = 2`

## Version history

### v2 — query-log retrieval debug snapshot

Added nullable column:

- `query_logs.retrievalDebugJson TEXT`

Purpose:

- Persist a compact retrieval debug snapshot for each new query log.
- Keep old logs readable: existing rows have `retrievalDebugJson = NULL`, and the renderer falls back to lightweight query hint reconstruction.

Privacy:

- The support bundle still exports only query-log metadata via `query_logs_meta.json`; it does not include full answers, citations JSON, top-k retrieval JSON, or `retrievalDebugJson`.

Compatibility note:

- Retrieval debug payload schema may evolve inside the existing nullable JSON column. As of schema v5, new rows can include compact answer evidence-decision metadata plus candidate/result selection reason summaries. This does **not** require a SQLite `user_version` bump because the table shape is unchanged and older rows remain readable.

### v1 — baseline local library schema

Includes settings, documents, chunks, chat sessions, chat turns, and query logs.
