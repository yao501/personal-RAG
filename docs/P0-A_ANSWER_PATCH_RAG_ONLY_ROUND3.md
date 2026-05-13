# P0-A / Answer Patch — RAG-only Round 3（极小修补记录）

## 1) 哪个 partial 触发了 patch

- Round 3 复跑（run `2026-04-16-003`）中：
  - `real-rag3-001-usersvr-service-wont-start-first-two-checks`：`partial`（missed `UserSvr`）
  - `real-rag3-003-usersvr-vs-workflow-boundary-reminder`：`partial`（missed `UserSvr`）

现象一致：**证据 chunk 中出现 `UserSvr`，但 directAnswer 未显式输出 `UserSvr`**，导致形态检查失败。

## 2) patch 只修什么

- 仅调整 `answerQuestion` 中 `tryTroubleshootingUserSvrDirectAnswer()` 的触发条件：将用户常见故障措辞 **“起不来 / 启动不了”** 纳入 “failure-ish” 判定。
- 不改 retrieval/ranking；不改 `answerQuestion` 主干结构；不做多题硬编码。

## 3) 为什么判定它不是 P0-B 问题

- 在 `2026-04-16-003` 的 run 里，检索/引用已经能命中包含 `UserSvr` 的证据 chunk。
- 失败来自 answer 层：由于触发条件过窄（只认“失败/错误/提示/怎么办”等字样），导致故障问法（“起不来”）没有走到 `UserSvr` 故障 directAnswer，反而落入 procedural 概览兜底，最终漏掉关键实体词。

## 4) 如何验证 patch 没有扩大影响面

- **单测**：新增 1 条用例，确保在同时存在“软件使用步骤（概览）”强证据时，故障措辞“起不来”仍会输出包含 `UserSvr` + `UserReg.bat`/`UserUnReg.bat` 的 directAnswer。
- **回归**：同一 spec `evals/cases/rag-only-round3.json` 复跑后（run `2026-04-16-004`）三题全 pass，且不涉及 retrieval/ranking 行为变化。
