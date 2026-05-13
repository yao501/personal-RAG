# P0-A / RAG-only Round 11 — 更弱提示但仍可检索：未知对象不应误套 UserSvr

## 1) 为什么 Round 11 仍优先于 P0-B

- 仍未出现满足门槛的 stable + 非 answer 的 `retrieval/ranking/chunk/parse_normalize` 主因；此时切 P0-B 会扩大改动面并模糊归因。
- Round 10（最终 `-020`）在**不改 `answerQuestion`、不做新 patch**前提下全绿，说明 guard 边界开始稳定；Round 11 继续用更弱但仍可检索的问法压一轮，验证不是偶然。

## 2) 为什么 Round 10 的意义是

- **无 patch 前提下 guard 继续稳定**：未知对象/否定语义/正样本/干扰题都未触发误套 `UserSvr`。
- **但题面不能弱到触发 `hasReliableEvidence` 早退**：过弱问法会被证据门控拒答，形成“假失败/假通过”，本轮需要显式保留最低检索锚点。

## 3) 本轮要重点验证什么

- **更弱提示、但仍可检索**：在无安装上下文且不点名 `UserSvr` 时，问法更口语、更少强提示词，但至少保留“服务/没反应/没起来/没生效/排查”等最低锚点；答案仍不应误套 `UserSvr` 专属模板，应先要求确认对象/名称，再给通用首检点。
- **否定语义**：显式“不是/别默认成 UserSvr”等限制语义仍稳定生效，不应输出 `UserSvr` 专属三步模板。
- **正样本回归**：明确点名 `UserSvr` 时仍稳定输出 `UserSvr` + ≥2 检查点，且第一检查项明确。

## 4) 什么时候才允许再做一个更小 answer patch

仅当同时满足：

1. Round 10 已压住的“更弱提示未知对象误套 `UserSvr`”在 Round 11 同类题复现；
2. 主因仍是 `answer`；
3. 检索证据并没有要求回答成 `UserSvr`；
4. patch 可进一步收窄 `UserSvr` 专属模板触发条件，且不误伤 `UserSvr` 正样本、不影响通用故障回答。

## 5) 本轮验收标准

- 新增 `evals/cases/rag-only-round11.json`（2～4 题）。
- 复用 `scripts/runRealRegressionRagOnly.ts` 跑通并产出 `raw/results/summary`。
- 若无 stable + 非 answer 失败：不登记 P0-B 候选点，不启动 P0-B。
