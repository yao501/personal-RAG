# Support runbook

This document describes the **support bundle** export in Personal Knowledge RAG and how support staff should use it.

## Purpose

The support bundle helps triage desktop issues (import/reindex failures, health warnings, IPC errors, embedding status) **without** asking users to send their original documents or full index content.

## How users export

1. Open the app → **设置 (Settings)**.
2. Optionally enable **匿名化路径与提问预览** (recommended for sharing outside the org).
3. Click **导出支持包（ZIP）…** and choose a save location.
4. Send the resulting `.zip` through your approved support channel.

## Bundle format

- **Container**: a single `.zip` file.
- **Contents**: a folder of **JSON** files plus `00-README.txt` (plain text).
- **Format version**: see `manifest.json` → `bundleFormatVersion`.

## Typical files inside the archive

| File | Description |
|------|-------------|
| `00-README.txt` | Short human-readable note about what is included / excluded. |
| `manifest.json` | Bundle metadata: format version, timestamps, anonymize flag, app name/version. |
| `app_runtime.json` | Node/Electron/Chrome versions, platform, arch, locale. |
| `paths.json` | `userData`, SQLite DB path, LanceDB directory, temp dir (paths may be redacted). |
| `sqlite.json` | SQLite `PRAGMA` snapshot (`user_version`, `journal_mode`, `page_size`) and DB file name. |
| `embedding.json` | Local embedding pipeline availability and reason if unavailable. |
| `system_status.json` | Document/chunk counts and embedding availability as shown in the app. |
| `settings_safe.json` | Chunk size/overlap and optional library path (may be redacted). |
| `library_health.json` | Full library health report (same shape as in-app health check). |
| `documents_summary.json` | Per-document metadata: ids, titles, types, chunk counts, paths (paths redacted when anonymize is on). **No document body text.** |
| `query_logs_meta.json` | Recent query logs as **metadata only** (counts, timestamps, short preview or redacted text). **No answers, citations, or retrieval payloads.** |
| `library_tasks_recent.json` | Recent import/reindex task progress snapshots (ring buffer). `currentFile` may be redacted. |
| `ipc_errors_recent.json` | Recent structured IPC failures (channel, code, stage, message, suggestion). `details` omitted when anonymize is on. |
| `chat_sessions_summary.json` | Session counts and titles (titles redacted when anonymize is on). **No chat turns or answers.** |

## What is intentionally excluded (default)

The bundle **never** includes:

- Raw imported **document text** (`documents.content` in SQLite).
- **Chunk bodies** or **embedding vectors**.
- Full **chat answers**, **citations JSON**, or **top-k retrieval JSON** from query logs.
- API keys or tokens (the app does not store provider secrets in SQLite for this workflow).

## Privacy and anonymize mode

When **匿名化** is enabled in Settings before export:

- Absolute paths are shortened using `~` where possible and macOS `/Users/<name>` segments are replaced with `/Users/[USER]`.
- Query log **session ids** and **question previews** are replaced with `[REDACTED]`.
- Chat session **titles** are redacted.
- IPC error **`details`** fields are omitted to reduce accidental leakage of paths or internal data.

When anonymize is **off**, more path and preview text is present to speed up internal debugging. Only share with trusted staff.

## How support should use the bundle

1. **Start with** `manifest.json`, `app_runtime.json`, `paths.json`, `sqlite.json`, `embedding.json` to confirm environment and storage layout.
2. Check **`library_health.json`** for actionable issues (missing sources, stale files, missing embeddings).
3. Review **`library_tasks_recent.json`** for the last import/reindex timeline and failure phases.
4. Use **`ipc_errors_recent.json`** if the user reports UI actions failing (settings, import, etc.).
5. Use **`query_logs_meta.json`** only for **volume and recency** of questions—do not expect answer content here.

## Limitations

- Task and IPC history are **in-memory ring buffers** since app start; long-running sessions may have incomplete early history.
- The archive is built with the **system `zip` utility** on macOS; if `zip` is unavailable, export fails with an error (enterprise Macs normally include it).

## Related documentation

- Security assumptions: `docs/SECURITY_BASELINE.md`
- Product direction: `AGENTS.md`, `TODO.md`
- Developer regression eval (local benchmark runner, not part of the support bundle): `docs/EVAL_GUIDE.md`
- Local macOS packaging and install (for building the app that generates support bundles): `docs/INSTALLATION.md`, `docs/RELEASE.md`
