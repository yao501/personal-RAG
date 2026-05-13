# P0-A / RAG-only Round 12 — 更弱提示但保留最低锚点：未知对象不应误套 UserSvr

## 1) 为什么 Round 12 仍优先于 P0-B

- 仍未出现满足门槛的 stable + 非 answer 的 `retrieval/ranking/chunk/parse_normalize` 主因；此时启动 P0-B 会扩大改动面并增加归因噪声。
- Round 10、Round 11 都在**无新增 patch / 不改 `answerQuestion`**前提下最终全绿，说明 guard 在当前边界上开始稳定；Round 12 继续小步压测，确认稳定性不是偶然。

## 2) 为什么 Round 11 的意义是

- **无 patch 前提下 guard 继续稳定**：未知对象负样本、deny 语义、正样本都可在 fixture-first 闭环下跑通。
- **题面仍不能弱到触发 `hasReliableEvidence` 早退**：过弱问法会被证据门控拒答，或被“全流程概览”类答案抢答，造成假失败/假通过；因此本轮负样本必须保留最低检索锚点。

## 3) 本轮要重点验证什么

- **更弱提示但仍保留最低锚点**：无安装上下文、不点名 `UserSvr`，但至少保留“服务 +（没生效/没起来/未启动/没启动/排查/先查）”之一，仍不应误套 `UserSvr` 专属模板；应先要求确认对象/名称，再给通用检查点。
- **否定/限制语义**：更口语的 deny/限制语义（含显式否定 `UserSvr`）仍稳定生效，不输出 `UserSvr` 专属三步模板。
- **正样本回归**：明确点名 `UserSvr` 时仍稳定输出 `UserSvr` + ≥2 检查点，且第一检查项明确。
- **非服务类干扰题**：术语定义/参数含义类口语问法不应误触发故障模板，更不能输出 `UserSvr`。

## 4) 什么时候才允许再做一个更小 answer patch

仅当同时满足：

1. Round 11 已压住的“更弱提示未知对象误答成 `UserSvr`”在 Round 12 同类题复现；
2. 主因仍是 `answer`；
3. 检索证据并没有要求回答成 `UserSvr`；
4. patch 仅进一步收窄 `UserSvr` 专属模板触发条件，且不误伤正样本、不影响通用故障回答。

## 5) 本轮验收标准

- 新增 `evals/cases/rag-only-round12.json`（2～4 题）。
- 复用 `scripts/runRealRegressionRagOnly.ts` 产出 `raw/results/summary`。
- 若无 stable + 非 answer 失败：不登记 P0-B 候选点，不启动 P0-B。
