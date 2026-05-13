# P0-A / RAG-only Round 9 — 无安装上下文弱提示：继续压住 UserSvr 误触发

## 1) 为什么 Round 9 仍优先于 P0-B

- 当前仍未出现满足门槛的 stable + 非 answer 的 `retrieval/ranking/chunk/parse_normalize` 主因。
- Round 5～8 的主要演进都在 **answer-level guard/模板触发边界**；本轮继续以最小增量扩“无安装上下文 + 更弱提示”的真实口语变体，收益更直接、影响面更小。

## 2) 为什么 Round 8 说明当前问题仍是 answer-level guard 边界问题，而不是检索主因

- Round 8 的偏差来自“弱提示未进入 guard / 过弱问法触发门控早退”，通过更小的 answer patch（仅补齐触发判定与用例形态）即可修复。
- patch 后 Round 8 全绿且不改 retrieval/ranking，说明主因仍集中在答案层边界与鲁棒性。

## 3) 本轮要重点验证什么

- **无安装上下文的弱提示未知对象/未知服务**：不出现 `UserSvr`，不出现“安装/装完/安装后”，尽量不出现“服务名/对象名”等强提示词；答案仍应优先输出“先确认对象/名称”的通用排查结构，且不得输出 `UserSvr` 专属三步模板/脚本名。
- **更口语否定语义**：如“别默认成 UserSvr/别按那个模板答”仍稳定生效。
- **正样本回归**：明确点名 `UserSvr` 时仍稳定输出 `UserSvr` + ≥2 检查点。

## 4) 什么时候才允许再做一个更小 answer patch

仅当同时满足：

1. Round 8 已压住的“无安装上下文弱提示未知对象误答成 `UserSvr`”在 Round 9 同类题继续复现；
2. 主因仍是 `answer`；
3. 检索证据并没有要求回答成 `UserSvr`；
4. patch 可进一步收窄/补齐触发边界，且不误伤 `UserSvr` 正样本、不影响通用故障回答。

## 5) 本轮验收标准

- 新增 `evals/cases/rag-only-round9.json`（2～4 题）。
- 复用 `scripts/runRealRegressionRagOnly.ts` 跑通并产出 `raw/results/summary`。
- 若无 stable + 非 answer 失败：不登记 P0-B 候选点，不启动 P0-B。
