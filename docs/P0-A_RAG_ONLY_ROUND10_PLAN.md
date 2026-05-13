# P0-A / RAG-only Round 10 — 更少故障关键词：未知对象不应误套 UserSvr

## 1) 为什么 Round 10 仍优先于 P0-B

- 仍未出现 stable + 非 answer 的 `retrieval/ranking/chunk/parse_normalize` 主因；现在切 P0-B 会扩大改动面并模糊归因。
- Round 9 在**不改 `answerQuestion`、不做新 patch**的情况下全绿，说明边界开始稳定；Round 10 用更弱提示再压一轮，验证不是偶然。

## 2) 为什么 Round 9 的意义是：无新增 patch 下边界开始稳定

- Round 9 新增的“无安装上下文弱提示”负样本与否定语义样本均通过，且 `UserSvr` 正样本未被误伤。
- 这表明当前 answer-level guard/触发边界已经能覆盖一批弱提示形态，不需要通过不断 patch 才能跑通。

## 3) 本轮要重点验证什么

- **更少故障关键词**：弱提示不依赖“服务/启动/安装”等强提示词时，未知对象仍不会误套 `UserSvr` 专属模板；应先确认对象/名称再给通用检查点。
- **无安装上下文**：问法不含“安装/装完/安装后”时，guard 仍能稳定生效（只要问法仍表达“没生效/没反应/没起来”等弱故障）。
- **正样本回归**：明确点名 `UserSvr` 时，仍稳定输出 `UserSvr` + ≥2 检查点。

## 4) 什么时候才允许再做一个更小 answer patch

仅当同时满足：

1. Round 9 已压住的“弱提示未知对象误套 `UserSvr`”在 Round 10 同类题复现；
2. 主因仍是 `answer`；
3. 检索证据并没有要求回答成 `UserSvr`；
4. patch 能进一步收窄/补齐触发边界，且不误伤 `UserSvr` 正样本、不影响通用故障回答。

## 5) 本轮验收标准

- 新增 `evals/cases/rag-only-round10.json`（2～4 题）。
- 复用 `scripts/runRealRegressionRagOnly.ts` 产出 `raw/results/summary`。
- 若无 stable + 非 answer 失败：不登记 P0-B 候选点，不启动 P0-B。
