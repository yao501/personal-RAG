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

The release config sets `build.electronDist` to `node_modules/electron/dist`, so packaging uses the Electron runtime already installed by `npm install` instead of downloading Electron again during `electron-builder --mac`. This keeps release candidates repeatable on restricted enterprise networks and avoids late failures from transient GitHub/Electron download errors. If `node_modules/electron/dist/Electron.app` is missing, reinstall dependencies before packaging.

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
4. Run **`npm run release:quality -- --skip-realpdf`** for code-only validation, or **`PKRAG_REALPDF_DIR="$HOME/Desktop/和利时DCS操作手册" npm run release:quality -- --require-realpdf`** before a DCS-validated candidate.
5. Run **`npm run release:mac`** and confirm the `.app` appears under `release/mac-arm64/`.
6. Run **`npm run release:verify`** to inspect the local signature, Gatekeeper assessment, and stapler status.
   - For current unsigned internal builds, `codesign verify` should pass, while Gatekeeper/stapler warnings are expected until Developer ID signing, notarization, and stapling are configured.
7. **Smoke test** on a Mac: launch, import a small file, ask one question, open Settings, export support bundle if you need support-style diagnostics.
8. **Archive** the `.app` (zip the bundle or copy the folder) with a filename that includes **version + date** for traceability.

## Explicitly deferred (not in Sprint 4)

- **Developer ID** code signing and **Hardened Runtime** configuration in CI or locally.
- **Notarization** and **stapling** for Gatekeeper-friendly distribution.
- **DMG** / **pkg** / auto-updater channels.
- **Multi-arch** (x64) or universal binaries.
- **CI** job that uploads `release/` artifacts (add only when signing story is clearer).

## Apple distribution pipeline checklist (manual-first, P0-C Round 1)

目标：另一位同事仅按本文档，能跑到「build → sign → notarize → staple → verify」，并且在卡住时**知道卡在哪一步/缺什么**。

### 一次发布用到的路径约定（本仓库现状）

- **产物 `.app`**：`release/mac-arm64/个人知识库 RAG.app`
- 若 `build.productName` 改名，上述路径会变化（见 `package.json` → `build.productName`）。

### 前置条件（签名/公证相关）

- **Build** 可以在无 Apple 证书情况下完成（electron-builder 会退化为 ad-hoc signing，Gatekeeper 会提示“未验证开发者”）。
- 要做到“可分发（Gatekeeper 友好）”，需要：
  - Apple Developer Program 账号（含 Team ID）
  - **Developer ID Application** 证书安装到钥匙串
  - `notarytool` 凭证（推荐 App Store Connect API key + keychain profile；Apple ID + app 专用密码也可，但更不推荐）

可用 identity 自检：

```bash
security find-identity -v -p codesigning
```

---

## P0-C Round 2：配置入口固化（Developer ID + notarytool）

本节目标：把仓库从“知道缺口”推进到“**给出可填写的配置入口 + 可执行的手工步骤**”。
注意：仓库内**不**存任何真实 secret（Team ID / key-id / issuer / profile 名都由操作者本机提供）。

### A) Developer ID 签名配置（electron-builder 入口）

**仓库内入口**（见 `package.json` → `build.mac`）：

- `hardenedRuntime: true`
- `entitlements: build/entitlements.mac.plist`
- `entitlementsInherit: build/entitlements.mac.plist`

> `build/entitlements.mac.plist` 是最小模板（Electron 常见需求）。若 notarize 报拒，再按拒绝原因小步调整，不要一次性塞很多 entitlement。

**本机自检**（签名前）：

```bash
npm run release:sign-precheck
```

The script also accepts a custom app path when called directly:

```bash
./scripts/release-macos-sign-precheck.sh "release/mac-arm64/个人知识库 RAG.app"
```

**Round 3 实跑记录（本机缺口示例）**：

- 若 `security find-identity -v -p codesigning` 显示 `0 valid identities found`，说明本机没有可用的 Developer ID Application 证书（Round 3 无法继续）。
- 这种情况下 `codesign -dvvv` 往往会显示 `TeamIdentifier=not set`（ad-hoc）。

**如何判断 `TeamIdentifier=not set`**：

- 这通常意味着当前是 **ad-hoc** 签名（electron-builder fallback），或未选中 Developer ID identity。
- 首先确认本机确实安装了 Developer ID Application 证书，并能在 `security find-identity -v -p codesigning` 中看到类似：
  - `Developer ID Application: <NAME> (<TEAMID>)`

**成功标志（签名链）**：

- `codesign -dvvv` 输出包含：
  - `Authority=Developer ID Application: ...`
  - `TeamIdentifier=<TEAMID>`
- `codesign --verify --deep --strict` 返回 0，且看到 `valid on disk`

### B) notarytool 配置（manual-first）

**推荐路线（manual-first）**：App Store Connect API Key + keychain profile（不把密码写进脚本/仓库）。

1) 创建 keychain profile（仅在本机执行；不要提交任何 key 文件或输出）：

```bash
xcrun notarytool store-credentials "<PROFILE>" \
  --key-id "<ASC_KEY_ID>" \
  --issuer "<ASC_ISSUER_ID>" \
  --key "/path/to/AuthKey_<ASC_KEY_ID>.p8"
```

2) Profile 可用性自检：

```bash
npm run release:notary-precheck -- "<PROFILE>"
```

3) 提交 notarize（建议先把 `.app` 打包成 zip 再提交）：

```bash
APP="release/mac-arm64/个人知识库 RAG.app"
ZIP="release/mac-arm64/个人知识库 RAG-notarize.zip"
ditto -c -k --keepParent "$APP" "$ZIP"
xcrun notarytool submit "$ZIP" --keychain-profile "<PROFILE>" --wait
```

**成功标志**：

- `xcrun notarytool submit ... --wait` 输出 `status: Accepted`

**常见失败点（最小）**：

- `The binary is not signed`：先把签名链跑通（Developer ID + hardened runtime），并 `codesign --verify --deep --strict` 过。
- `Invalid/expired credentials`：profile 没建好或 key/issuer/key-id 不对。
- `The signature does not include a secure timestamp`：签名不符合 notarize 要求（通常是 identity/签名方式问题）。

### C) notarize 后 staple / verify

```bash
APP="release/mac-arm64/个人知识库 RAG.app"
xcrun stapler staple -v "$APP"
spctl --assess --verbose=4 --type execute "$APP"
xcrun stapler validate -v "$APP"
```

**成功标志**：

- `xcrun stapler staple`：`The staple and validate action worked`
- `spctl --assess`：`accepted`（并倾向出现 `source=Notarized Developer ID`）

---

### 5 步可执行 checklist

> 勾选每一步时填：命令、成功标志、当前是否具备、缺口与最常见失败点（1～3 条）。

| Step | Command / entry（可直接复制） | Success signal (keyword) | In repo today? | Gap if not | Common failures (1–3) |
|------|-------------------------------|--------------------------|----------------|------------|------------------------|
| **1) quality + build** | `npm run release:quality -- --skip-realpdf`（或带 `PKRAG_REALPDF_DIR` 的 `--require-realpdf`）后 `npm run release:mac` | `Release quality gate: PASS`；`release/mac-arm64/` 下出现 `.app`；日志含 `packaging platform=darwin arch=arm64` 和 `using custom unpacked Electron distribution` | **Yes** | 真实 DCS 门禁依赖本机 `PKRAG_REALPDF_DIR`；`node_modules/electron/dist/Electron.app` 由依赖安装提供 | `vitest` 失败；`tsc -b` 失败；RAG gate 失败；native deps rebuild 失败（`better-sqlite3`）；Electron runtime 缺失时重新 `npm install` |
| **2) sign** | `npm run release:sign-precheck`（或手工 `codesign ...`） | `valid on disk`（验证）+ 有 `Authority=Developer ID Application`（签名链）+ `TeamIdentifier=<TEAMID>` | **Partial**（当前是 ad-hoc，`TeamIdentifier=not set`） | 缺 Developer ID 证书、（可选）entitlements 固化 | identity 不对；缺 hardened runtime/timestamp（notarize 时失败） |
| **3) notarize** | 推荐（keychain profile）：`npm run release:notary-precheck -- "<PROFILE>"` 后再 `xcrun notarytool submit ... --wait` | `status: Accepted` | **No**（electron-builder 会跳过 notarize） | 缺 notarytool 凭证与配置（PROFILE） | `The binary is not signed`；`Invalid/expired credentials`；`The signature does not include a secure timestamp` |
| **4) staple** | `xcrun stapler staple -v "release/mac-arm64/个人知识库 RAG.app"` | `The staple and validate action worked` | **No**（依赖 3） | 需 3 成功后再 stapling | `No staple found`（未公证/未等待完成） |
| **5) verify** | ① Gatekeeper：`spctl --assess --verbose=4 --type execute "release/mac-arm64/个人知识库 RAG.app"` ② stapler validate：`xcrun stapler validate -v "release/mac-arm64/个人知识库 RAG.app"` | `accepted` / `source=Notarized Developer ID` | **No**（未作为门禁固化） | 缺 2–4 完整链 | 仅 ad-hoc 时 `spctl ... internal error` 属预期；未 notarize/staple 时 validate 会失败 |

---

### notarytool 凭证最小配置（建议写法）

> 本仓库 Round 1 不固化任何 secret；这里提供“手工可执行模板”，由操作者在本机 keychain 设置。

1. 创建 keychain profile（示例；具体参数以 Apple 官方 notarytool 文档为准）：

```bash
xcrun notarytool store-credentials "<PROFILE>" \
  --key-id "<ASC_KEY_ID>" \
  --issuer "<ASC_ISSUER_ID>" \
  --key "/path/to/AuthKey_<ASC_KEY_ID>.p8"
```

2. 之后使用：

```bash
xcrun notarytool submit "release/mac-arm64/个人知识库 RAG.app" --keychain-profile "<PROFILE>" --wait
```

---

### 最小“我卡住了”定位指南

- **卡在 build**：先确认 `npm run build` 过，再看 `electron-builder` 的 native deps（`better-sqlite3`）是否重建成功。
- **卡在 sign（仍是 ad-hoc）**：缺 Developer ID Application 证书（或 identity 名称没选中）。先用 `security find-identity -v -p codesigning` 列出可用 identity。
- **卡在 notarize**：通常是“签名不合格/缺 timestamp/缺 hardened runtime/凭证不对”。先把 `codesign --verify --deep --strict` 跑到 0，再提交 notarize。
- **卡在 staple/verify**：多数是 notarize 没 Accepted 或没 wait；重新 `submit --wait`，再 `stapler staple`。

## Related documentation

- End-user style install steps and Gatekeeper notes: **`docs/INSTALLATION.md`**
- Security assumptions: **`docs/SECURITY_BASELINE.md`**
- Product priorities: **`AGENTS.md`**, **`TODO.md`**
