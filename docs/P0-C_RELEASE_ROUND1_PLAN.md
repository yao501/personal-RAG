# P0-C / 发布最小闭环 Round 1（manual-first）

## 1) 当前目标（Round 1）

把 macOS 发布闭环推进成：**另一位同事可按文档跑通 build → sign → notarize → staple → verify**，并且在卡住时能明确：

- 当前卡在哪一步
- 缺什么（证书/凭证/命令/配置）
- 下一步该补什么（文档/脚本/配置），而不是“凭感觉试”

## 2) 本轮非目标

- 不做完整自动化 release pipeline / CI 上传
- 不做多环境 matrix / universal build
- 不做 Mac App Store 上架链路
- 不在本轮引入或固化任何 secret

## 3) 本轮产出

- **文档**
  - `docs/RELEASE.md`：补全为可执行 5 步 checklist（含命令、成功标志、缺口、常见失败点）
- **可选最小辅助**
  - 仅在能显著降低人为失误时添加：例如一个“本地验证脚本”把 `codesign/spctl/stapler validate` 串起来（不含凭证）

## 4) 最小验收标准

- 文档中 5 步都有“可复制命令 + 成功标志 + 缺口 + 常见失败点”
- 在当前仓库状态下：
  - **build** 可执行并产出 `.app`（允许 ad-hoc）
  - **sign/notarize/staple/verify** 至少能按文档走到“知道缺口是什么”（例如缺证书/缺 notarytool profile）

## 5) 当前阻塞项（基于审计）

- **build**：已具备（`npm run release:mac` 可产出 `release/mac-arm64/个人知识库 RAG.app`）
- **sign（Developer ID）**：仓库未固化签名 identity/entitlements；当前 electron-builder 会退化为 **ad-hoc signature**
- **notarize/staple/verify**：缺 notarytool 凭证与流程固化（仓库内无配置与脚本门禁）

## 6) 下一步（Round 2 候选）

按 Round 1 走通后的实际阻塞来选，不提前做满：

- 若卡在 **sign**：补最小 entitlements 文件 + electron-builder `mac` signing 配置入口（仍可保持 manual）
- 若卡在 **notarize**：补 `notarytool` keychain profile 使用说明与一条“提交+等待”命令模板；可考虑 electron-builder notarize 配置（不固化 secret）
- 若卡在 **verify**：补一条“在干净机器/新用户下 Gatekeeper 抽检”的手工步骤与截图要点
