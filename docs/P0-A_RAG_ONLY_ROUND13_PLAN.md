# P0-A / RAG-only Round 13 — 同类型更弱口语变体：未知对象不应误套 UserSvr

## 1) 为什么 Round 13 仍优先于 P0-B

- 仍未出现满足门槛的 stable + 非 answer 的 `retrieval/ranking/chunk/parse_normalize` 主因；此时切 P0-B 会扩大改动面并引入新的归因噪声。
- Round 12（最终 `-026`）在**不改 `answerQuestion`、不做新 patch**前提下全绿，说明当前 guard 在“最低锚点 + 口语弱提示”边界上开始稳定；Round 13 继续用同类型更弱口语变体压测，确认稳定性不是偶然。

## 2) 为什么 Round 12 的意义是

- **无 patch 前提下继续全绿**：负样本/deny/正样本/非服务干扰都能在 fixture-first 闭环下跑通。
- **“更弱提示但仍保留最低锚点”已继续被压住**：只要题面保留可触发的最低锚点（如“服务 + 没生效/没起来/没启动”等），未知对象不会误套 `UserSvr` 模板，优先走“先确认对象/名称”的通用 guard。

## 3) 本轮要重点验证什么

- **同类型更弱口语变体**：无安装上下文、不点名 `UserSvr`，但保留最低锚点（避免证据门控早退），未知对象仍不应误套 `UserSvr` 专属模板；应先要求确认对象/名称，再给通用检查点。
- **deny / 限制语义**：更口语的 deny/限制语义（尤其是“别默认/别套用 UserSvr”类）仍稳定生效，不输出 `UserSvr` 专属模板。
- **正样本回归**：明确点名 `UserSvr` 时仍稳定输出 `UserSvr` + ≥2 检查点，且第一检查项明确。
- **非服务类近邻干扰题**：术语定义/提示同步/TRUE-FALSE 等口语问法不应误触发故障模板，更不能输出 `UserSvr`。

## 4) 什么时候才允许再做一个更小 answer patch

仅当同时满足：

1. Round 12 已压住的“更弱口语未知对象误答成 `UserSvr`”在 Round 13 同类题复现；
2. 主因仍是 `answer`；
3. 检索证据并没有要求回答成 `UserSvr`；
4. patch 仅进一步收窄 `UserSvr` 专属模板触发条件，且不误伤正样本、不影响通用故障回答。

## 5) 本轮验收标准

- 新增 `evals/cases/rag-only-round13.json`（2～4 题）。
- 复用 `scripts/runRealRegressionRagOnly.ts` 产出 `raw/results/summary`。
- 若无 stable + 非 answer 失败：不登记 P0-B 候选点，不启动 P0-B。
