# P0-A / RAG-only Round 14 — 更弱更口语但保留最低锚点：继续压住 UserSvr 误触发

## 1) 为什么 Round 14 仍优先于 P0-B

- 仍未出现满足门槛的 stable + 非 answer 的 `retrieval/ranking/chunk/parse_normalize` 主因；此时启动 P0-B 会扩大改动面并增加归因噪声。
- Round 12（`-026`）与 Round 13（`-028`）都在**不改 `answerQuestion`、不做新 patch**前提下全绿，说明当前 guard 在“最低锚点 + 口语弱提示”边界上开始稳定；Round 14 再压一轮确认不是偶然。

## 2) 为什么 Round 13 的意义是

- **无 patch 前提下继续全绿**：负样本/deny/正样本/非服务干扰均可稳定跑通。
- **“同类型更弱口语未知对象误触发 UserSvr”继续被压住**：在无安装上下文下，只要题面仍保留最低检索锚点（如“服务 + 没启动/未启动/没起来/没生效”），未知对象优先走“先确认对象/名称”的通用 guard，而不是套 `UserSvr` 专属模板。

## 3) 本轮要重点验证什么

- **更弱、更口语但仍保留最低锚点**：未知对象问法不点名 `UserSvr`、无明显安装上下文，但保留最低锚点，仍不应误套 `UserSvr` 专属模板；应先要求确认对象/名称，再给通用检查点。
- **deny / 限制语义**：口语 deny 变体（“别默认/别套用 UserSvr”）仍稳定生效，不输出 `UserSvr` 专属模板。
- **正样本回归**：明确点名 `UserSvr` 时仍稳定输出 `UserSvr` + ≥2 检查点，且第一检查项明确。
- **非服务类近邻干扰题**：参数对齐/提示同步/TRUE-FALSE 等口语问法不应误触发故障模板，更不能输出 `UserSvr`。

## 4) 什么时候才允许再做一个更小 answer patch

仅当同时满足：

1. Round 13 已压住的“更弱口语未知对象误答成 `UserSvr`”在 Round 14 同类题复现；
2. 主因仍是 `answer`；
3. 检索证据并没有要求回答成 `UserSvr`；
4. patch 仅进一步收窄 `UserSvr` 专属模板触发条件，且不误伤正样本、不影响通用故障回答。

## 5) 本轮验收标准

- 新增 `evals/cases/rag-only-round14.json`（2～4 题）。
- 复用 `scripts/runRealRegressionRagOnly.ts` 产出 `raw/results/summary`。
- 若无 stable + 非 answer 失败：不登记 P0-B 候选点，不启动 P0-B。
