# P0-C / 发布最小闭环 Round 3：Developer ID + notarize 端到端实跑记录

## 1) 实跑机器前提（外部条件）

本轮需要在**具备真实证书与 notarytool profile** 的机器上执行。

本机（当前执行环境）自检结果：

- `security find-identity -v -p codesigning`：**0 valid identities found**
- `./scripts/release-macos-sign-precheck.sh`：
  - `TeamIdentifier=not set`（ad-hoc）
  - `codesign --verify --deep --strict`：通过（仅表示 bundle 内一致性，不代表 Developer ID）
- `xcrun notarytool --version`：可用（`1.1.0 (39)`）

结论：**本机不满足 Round 3 实跑前提**（缺 Developer ID Application 证书；因此无法进入“Developer ID signing → notarize”链路）。

## 2) 本轮实际跑到了哪一步

- ✅ `npm run release:mac`（已在 Round 1/2 验证可产出 `.app`）
- ✅ sign precheck / verify（仅 ad-hoc）
- ⛔ Developer ID signing：无法开始（缺证书）
- ⛔ notarytool submit：不应尝试（未 Developer ID 签名 + 未形成可公证产物）

## 3) 成功了哪些步骤

- build 产物生成（`.app`）
- 本地 `codesign --verify --deep --strict` 通过（ad-hoc）
- notarytool 命令可用

## 4) 卡住了哪些步骤

- **Developer ID Application 证书缺失**（导致 TeamIdentifier 无法设置，无法进入 notarize）

## 5) 真实错误摘要（本轮）

- `security find-identity -v -p codesigning` 输出：`0 valid identities found`
- `codesign -dvvv` 输出：`TeamIdentifier=not set`

## 6) 是否达到“另一位同事具备证书/凭证后可复现”

就“仓库入口 + 文档”而言：**已达到**（Round 2 已固化 hardened runtime/entitlements 入口与 notarytool profile 方式）。
就“本机实跑成功拿到 Accepted”而言：**未达到**（因为本机无证书/无 profile）。

## 7) 是否还需要 Round 4

建议下一轮（可命名 Round 3b 或 Round 4）在**具备证书与 notary profile** 的机器上完成端到端实跑，并将：

- `codesign -dvvv` 的 Authority/TeamIdentifier 成功样例（去掉敏感信息）
- `notarytool submit --wait` 的 Accepted 样例（去掉 UUID/账号信息）
- `stapler staple/validate` 与 `spctl --assess` 的通过样例

回填到 `docs/RELEASE.md`。
