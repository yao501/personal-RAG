# Security Baseline

This document describes the current Electron security baseline for Personal Knowledge RAG.

## Goals

The desktop app should:

- keep renderer privileges narrow
- avoid arbitrary web navigation
- avoid arbitrary external window creation
- validate IPC inputs before main-process work runs
- make security assumptions explicit for future changes

## Current Baseline

### BrowserWindow

Main window security settings now include:

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- `webSecurity: true`
- explicit preload entry

Why:

- renderer code should not receive direct Node.js access
- preload remains the only bridge surface

## Navigation and Window Rules

The app now blocks:

- arbitrary renderer navigation
- arbitrary `window.open()` / new-window creation
- webview attachment

Allowed navigation is limited to:

- packaged local `file://` app content
- local Vite dev server content during development

## IPC Rules

IPC now follows a validated registration pattern in [src/main/main.ts](/Users/guangyaosun/personal-knowledge-rag/src/main/main.ts).

Current protections:

- sender URL must match the app renderer origin
- every registered IPC route validates its input shape
- invalid requests fail before business logic runs
- validation and handler failures return standardized error prefixes:
  - `[IPC_VALIDATION]`
  - `[IPC_HANDLER]`
  - `[IPC_FORBIDDEN]`

Covered input checks include:

- non-empty string identifiers
- absolute local file paths
- bounded numeric inputs
- settings patch shape
- query-log status enum values

## External Open Restrictions

The app opens source files through local absolute paths.

For page-aware PDF jumps:

- only `file://` targets are allowed for `shell.openExternal`
- non-file targets are denied and fall back to local file open

This prevents citation links from becoming a generic URL-launch surface.

## Content Security Policy

The renderer entry page now includes a CSP in [src/renderer/index.html](/Users/guangyaosun/personal-knowledge-rag/src/renderer/index.html).

The current policy allows:

- self-hosted assets
- local dev server script/style/connect during development
- inline styles needed by the current app shell

It blocks:

- plugin/object embedding
- external framing
- general remote content by default

## Security Audit Command

Run:

```bash
npm run audit:security
```

This currently wraps `npm audit --audit-level=high`.

## Remaining Work

This baseline is an important first step, not the final security state.

Still recommended:

- move from lightweight validation helpers to explicit per-channel schemas if the IPC surface grows further
- add structured error objects once renderer error UX is upgraded
- review release-time entitlements and signing settings
- add dependency-review guidance to release documentation
- add regression checks for security-sensitive IPC routes

## Change Rule

Any new preload API or IPC route should ship with:

- input validation
- sender trust enforcement
- a short security note in this document if it expands capability
