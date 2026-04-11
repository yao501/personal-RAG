# Release (macOS) — Sprint 4 foundation

This document describes the **repeatable local release** workflow for internal testing and future enterprise packaging. It intentionally stops **before** Apple signing/notarization automation.

## Release command

The canonical command for a **full compile + package** is:

```bash
npm run release:mac
```

This runs:

1. `npm run build` — `tsc -b` (project references) plus `electron-vite build` (main, preload, renderer).
2. `electron-builder --mac` — packages according to `package.json` → `build`.

`npm run dist:mac` is an **alias** of `npm run release:mac` (same behavior).

### Faster local packaging (non-canonical)

For quick iteration when you already trust the TypeScript state:

```bash
npm run app:mac
```

This uses `electron:build` only (skips the standalone `tsc -b` step from the root `build` script). Prefer **`release:mac`** for anything you would hand to another machine or label as a “build candidate.”

## Artifact locations and layout

| Item | Location / note |
|------|------------------|
| Electron Builder output root | `release/` (`build.directories.output`) |
| Packaged app (current config) | `release/mac-arm64/个人知识库 RAG.app` |
| Build intermediates | `dist/`, `dist-electron/` (also gitignored in dev workflows) |

The **`release/`** tree is listed in `.gitignore`; artifacts are **not** committed.

### What gets produced today

The macOS target in `package.json` uses the **`dir`** target: an **unpacked `.app` bundle** suitable for copying to `/Applications` or zipping for internal sharing. **DMG / zip** targets are not configured in this sprint; they can be added later without changing the product direction.

### Version and naming

- **Application version** is taken from **`package.json` → `version`** (e.g. `0.1.0`). Bump this field before cutting a labeled internal release.
- **Bundle id** is `build.appId` in `package.json` (`com.guangyaosun.personal-knowledge-rag`).
- **Display name** is `build.productName` (`个人知识库 RAG`).

## Local / internal release checklist

Use this before sharing a build outside your own machine:

1. **Branch/commit** is the one you intend to ship (tag optional).
2. **Bump `version`** in `package.json` if this drop should be distinguishable from previous zips.
3. **Clean install test (optional but valuable):** fresh `npm ci` or `npm install` on a clean clone.
4. Run **`npm test`** — recommended before packaging; not enforced by the `release:mac` script.
5. Run **`npm run release:mac`** and confirm the `.app` appears under `release/mac-arm64/`.
6. **Smoke test** on a Mac: launch, import a small file, ask one question, open Settings, export support bundle if you need support-style diagnostics.
7. **Archive** the `.app` (zip the bundle or copy the folder) with a filename that includes **version + date** for traceability.

## Explicitly deferred (not in Sprint 4)

- **Developer ID** code signing and **Hardened Runtime** configuration in CI or locally.
- **Notarization** and **stapling** for Gatekeeper-friendly distribution.
- **DMG** / **pkg** / auto-updater channels.
- **Multi-arch** (x64) or universal binaries.
- **CI** job that uploads `release/` artifacts (add only when signing story is clearer).

## Apple distribution pipeline checklist (manual, P0-C)

勾选每一行时填写「命令 / 期望关键词 / 当前是否具备 / 缺口」。首轮以文档闭环为主，不要求 CI 全自动。

| Step | Command or entry | Expect to see (keyword) | In repo today? | Gap if not |
|------|-------------------|-------------------------|----------------|------------|
| **build** | `npm run release:mac`（或 `npm run build` + `electron-builder --mac`） | `release/mac-arm64/`、`.app`、`electron-builder` **done** | Yes — produces unpacked `.app` under `release/mac-arm64/` | — |
| **sign** | `codesign --verify --deep --strict ...` on the `.app`（具体 identity 见 Apple 账号与 `codesign -dvvv`） | **valid on disk**、Team ID 与签名链一致 | No — Developer ID / entitlements 未在仓库内固化 | 需证书、Provisioning、entitlements 文件与本地 `codesign` 脚本 |
| **notarize** | `xcrun notarytool submit ...`（或 `altool` 已弃用路径） | **Accepted**、UUID、`status: Accepted` | No — 无自动化提交与存储凭证 | 需 App Store Connect API key 或 Apple ID app 专用密码、CI secret 策略 |
| **staple** | `xcrun stapler staple "…/MyApp.app"` | **The staple and validate action worked** | No — 依赖成功 notarize | 需上一步通过后再 staple |
| **verify** | `spctl --assess --verbose --type execute .../MyApp.app` | **accepted** / **source=Notarized Developer ID** | No — 未作为发布门禁运行 | 在干净 macOS 用户上 gatekeeper 抽检 |

## Related documentation

- End-user style install steps and Gatekeeper notes: **`docs/INSTALLATION.md`**
- Security assumptions: **`docs/SECURITY_BASELINE.md`**
- Product priorities: **`AGENTS.md`**, **`TODO.md`**
