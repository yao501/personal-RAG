# P0-C / 发布最小闭环 Round 2：Developer ID + notarytool 配置入口固化

## 1) Round 2 目标

把仓库推进到：**另一位同事具备证书与 notarytool 凭证后，可按文档与仓库内入口尝试跑通 Developer ID 签名与 notarize**（manual-first）。

## 2) 外部依赖（必须由操作者提供，不入库）

- Apple Developer Program（Team ID）
- Developer ID Application 证书（安装在 Keychain）
- notarytool 凭证（推荐 App Store Connect API key：`AuthKey_*.p8` + issuer + key-id；在本机用 keychain profile 管理）

## 3) 本轮固化的配置入口

- `package.json` → `build.mac`
  - `hardenedRuntime: true`
  - `entitlements` / `entitlementsInherit` 指向 `build/entitlements.mac.plist`
- `build/entitlements.mac.plist`
  - 提供最小 entitlements 模板（按 notarize 拒绝原因再小步调整）
- 脚本入口（不含 secret）
  - `scripts/release-macos-sign-precheck.sh`
  - `scripts/release-macos-notary-precheck.sh`

## 4) 本轮非目标

- 不接 CI secrets，不做全自动 notarize/staple
- 不引入 DMG/PKG 分发形式（保持 `dir` 产物）
- 不把任何真实凭证写入仓库

## 5) 最小验收标准

- `docs/RELEASE.md` 中明确写出：
  - Developer ID 签名配置入口（electron-builder / entitlements / hardened runtime）
  - notarytool profile 建立与提交流程（zip + submit --wait）
  - staple / verify 的命令与成功标志
- 仓库内有至少 1 个 precheck/helper 脚本，能帮助操作者在无 secret 的情况下定位卡点

## 6) Round 3 应做什么（建议）

在具备证书与 notarytool profile 的机器上做一次“端到端实跑记录”：

- `release:mac` → Developer ID 签名确认（TeamIdentifier 不再是 `not set`）
- `notarytool submit --wait` → `Accepted`
- `stapler staple` + `spctl --assess` → `accepted`
- 把实跑中遇到的 1～2 个具体错误与修复方式回填到 `docs/RELEASE.md`（不引入自动化）
