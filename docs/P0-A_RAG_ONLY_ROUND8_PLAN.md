# P0-A / RAG-only Round 8 — 更弱提示未知对象：继续压住 UserSvr 误触发

## 1) 为什么 Round 8 仍优先于 P0-B

- 目前仍未出现满足门槛的 stable + 非 answer 的 `retrieval/ranking/chunk/parse_normalize` 主因。
- Round 7 的中间 run 仍能在“更弱提示未知对象”上复现 answer-level partial，说明 guard 的边界仍需继续压测；现在切 P0-B 会扩大改动面且模糊归因。

## 2) 为什么 Round 7 说明当前问题仍是 answer-level guard 边界问题，而不是检索主因

- Round 7 的偏差来自“弱提示未进入 guard 导致复述 UserSvr 故障段落”，通过更小的 answer patch（只补齐触发判定）即可修复。
- patch 后 Round 7 全绿且不改 retrieval/ranking，说明主因仍在 answer-level guard/触发边界。

## 3) 本轮要重点验证什么

- **更弱提示未知对象**：不出现 `UserSvr`，尽量不出现“服务名/对象名”等强提示词；答案仍应优先输出“先确认对象/名称”的通用排查结构，且不得输出 `UserSvr` 专属三步模板或直接复述 `UserSvr` 故障段落。
- **否定/限制语义**：更口语的“别默认/别按模板”语义稳定生效。
- **正样本回归**：明确点名 `UserSvr` 的故障问法仍稳定输出 `UserSvr` + ≥2 检查点，不被误伤。

## 4) 什么时候才允许再做一个更小 answer patch

仅当同时满足：

1. Round 7 刚压住的“弱提示未知对象误答成 `UserSvr`”在 Round 8 同类题继续复现；
2. 主因仍是 `answer`；
3. 检索证据并没有要求回答成 `UserSvr`；
4. patch 可进一步收窄/补齐触发边界，且不误伤 `UserSvr` 正样本、不影响通用故障回答。

## 5) 本轮验收标准

- 新增 `evals/cases/rag-only-round8.json`（2～4 题）。
- 复用 `scripts/runRealRegressionRagOnly.ts` 跑通并产出 `raw/results/summary`。
- 若无 stable + 非 answer 失败：不登记 P0-B 候选点，不启动 P0-B。
