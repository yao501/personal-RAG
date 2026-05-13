# P0-A / RAG-only Round 6 — 继续验证“未知服务不应误套 UserSvr 模板”

## 1) 为什么 Round 6 仍优先于 P0-B

- 当前没有出现满足门槛的 stable + 非 answer 的 `retrieval/ranking/chunk/parse_normalize` 主因。
- Round 5 的修补是 **answer-level 的 guard/模板触发边界**，需要在更多“真实口语”变体下验证稳健性；现在切 P0-B 只会扩大改动面、模糊归因。

## 2) 为什么 Round 5 说明问题仍是 answer-level guard/边界问题

- Round 5 的失败模式是“未知服务被误答成 UserSvr 专属模板”，与检索是否命中无关，属于答案层过拟合风险。
- Round 5 patch 后同一组正/负/干扰/边界样本全 pass，且未改 retrieval/ranking，进一步确认这是 answer-level 问题。

## 3) 本轮要重点验证什么

- **正样本**：明确点名 `UserSvr` 时，仍稳定输出 `UserSvr` + 排查要点（≥2 检查点）。
- **负样本**：完全不点名对象/未知服务时，不再误套 `UserSvr` 专属三步模板，应先提示确认服务名/对象，再给通用检查点。
- **干扰样本**：明确点名别的对象（例如“参数对齐”这种非服务问题）或全流程问题时，不应被 `UserSvr` 抢答。
- **否定/限制语义样本**：包含“不是 UserSvr / 不要默认 / 不要套”时，guard 必须稳定生效。

## 4) 什么时候才允许再做一个更小 answer patch

仅当同时满足：

1. Round 5 已修的“未知服务误套 UserSvr”在 Round 6 同类题继续复现；
2. 主因仍是 `answer`；
3. 检索证据并没有要求回答成 `UserSvr`；
4. patch 可做到进一步收窄触发条件、或增强否定语义 guard，且不误伤明确点名 `UserSvr` 的正样本。

## 5) 本轮验收标准

- 新增 `evals/cases/rag-only-round6.json`（2～4 题）。
- 复用 `scripts/runRealRegressionRagOnly.ts` 跑通并产出 `raw/results/summary`。
- 若无 stable + 非 answer 失败：不登记 P0-B 候选点，不启动 P0-B。
