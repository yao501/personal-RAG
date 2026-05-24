# Migration notes

This project uses small, additive SQLite migrations in `src/main/store.ts`.

## Current schema version

- `PRAGMA user_version = 3`

## Version history

### v3 — migration safety and ingestion quality metadata

Added nullable column:

- `documents.ingestionQualityJson TEXT`

Purpose:

- Persist a compact, content-free import quality report for each document.
- Surface page count, text density, chunk token distribution, and warnings such as possible scanned PDFs or garbled text.
- Include the same metadata in document detail and support bundles without exporting raw document text.

Migration safety:

- `src/main/store.ts` now records a `DatabaseMigrationReport` for app diagnostics and support bundles.
- If an existing non-empty database has an older `PRAGMA user_version`, the app creates a migration-preflight copy under the local `backups/` directory before applying additive migrations.
- If the database version is newer than the app supports, startup stops instead of writing to an unknown schema.

### v2 — query-log retrieval debug snapshot

Added nullable column:

- `query_logs.retrievalDebugJson TEXT`

Purpose:

- Persist a compact retrieval debug snapshot for each new query log.
- Keep old logs readable: existing rows have `retrievalDebugJson = NULL`, and the renderer falls back to lightweight query hint reconstruction.

Privacy:

- The support bundle still exports only query-log metadata via `query_logs_meta.json`; it does not include full answers, citations JSON, top-k retrieval JSON, or `retrievalDebugJson`.

Compatibility note:

- Retrieval debug payload schema may evolve inside the existing nullable JSON column. As of schema v10, new rows can include compact answer evidence-decision metadata with top evidence context signals, candidate/result selection reason summaries, primary-rank rejection diagnostics, weighted score contribution breakdowns, contextual chunk metadata, and conflict-evidence chunk ids. This does **not** require a SQLite `user_version` bump because the table shape is unchanged and older rows remain readable.

### v1 — baseline local library schema

Includes settings, documents, chunks, chat sessions, chat turns, and query logs.
