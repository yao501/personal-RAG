# Installation (macOS)

This document covers **developer and internal-tester** installation from source or from a **locally packaged** `.app` bundle. It does **not** describe App Store or signed distribution (not implemented yet).

## Prerequisites

- **macOS** on **Apple Silicon (arm64)**. The current Electron Builder configuration targets `arm64` only (see `package.json` → `build.mac.target`).
- **Node.js 22+** and **npm** (matching what you use for `npm install`).
- **Network access** for the first `npm install` (dependency download).
- **Disk space** for `node_modules`, build intermediates (`dist/`, `dist-electron/`), and the packaged app under `release/` (typically hundreds of MB).

Optional:

- **Xcode Command Line Tools** if macOS prompts for them while building native addons (e.g. `better-sqlite3` via `electron-rebuild`).

## Install dependencies (from source)

From the repository root:

```bash
npm install
```

`postinstall` runs `electron-rebuild` so native modules match the bundled Electron version. If you see `NODE_MODULE_VERSION` mismatches at runtime, run:

```bash
npm run rebuild:native
```

## Run in development

```bash
npm run electron:dev
```

## Build a packaged macOS app (recommended for internal testing)

Use the release-oriented script (full TypeScript build + Electron packaging):

```bash
npm run release:mac
```

Faster iteration without a full `tsc -b` pass (not recommended for “official” internal drops):

```bash
npm run app:mac
```

## Where the `.app` is produced

Electron Builder writes to the directory configured in `package.json` → `build.directories.output`, which is **`release/`**.

For the current **dir** target and **arm64** layout, expect:

- **`release/mac-arm64/个人知识库 RAG.app`**

The `release/` directory is **gitignored**; it only exists after you run a packaging command locally.

> **Note:** The product name and paths follow `build.productName` in `package.json`. If that string changes, the `.app` folder name under `release/mac-arm64/` will change accordingly.

## Install and open the packaged app

1. In Finder, open `release/mac-arm64/`.
2. Copy **`个人知识库 RAG.app`** to `/Applications` or run it from the build folder.
3. **First launch (unsigned build):** macOS Gatekeeper may block the app or show a warning because the bundle is **not** Developer ID signed or notarized yet.
   - **Right-click** the app → **Open** → confirm **Open** in the dialog, or  
   - **System Settings → Privacy & Security** → allow the app when macOS lists it after a blocked launch.

This is normal for ad-hoc local builds until signing and notarization are added (see `docs/RELEASE.md`).

## Data and privacy

The app stores its library, SQLite database, and embeddings under the OS user data area (see in-app **Settings** for paths). Installing a new `.app` build does not automatically remove existing data unless you delete those directories manually.

## What is not covered yet

- **Apple Developer ID signing**, **notarization**, **stapling**, and **DMG/installer** polish for wide distribution.
- **Intel (x64) macOS** builds (current config is arm64-only).
- **Automated CI** release artifacts (optional future work).

For the release checklist and versioning expectations, see **`docs/RELEASE.md`**.
