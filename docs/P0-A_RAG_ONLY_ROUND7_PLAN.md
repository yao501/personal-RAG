# P0-A / RAG-only Round 7 — 弱提示未知服务：不应误触发 UserSvr 模板

## 1) 为什么 Round 7 仍优先于 P0-B

- 当前仍未出现 stable + 非 answer 的 `retrieval/ranking/chunk/parse_normalize` 主因；直接切 P0-B 会扩大改动面、降低可诊断性。
- Round 6 的修补是 **answer-level guard 边界**，需要在更贴近真实口语、且更弱提示的问法下继续验证稳健性。

## 2) 为什么 Round 6 说明当前问题仍是 answer-level guard 边界问题，而不是检索主因

- Round 6 首跑的偏差来自“故障触发词过宽/过窄”，与检索是否命中无关；通过更小的 answer patch（只改触发判定）即可修复。
- patch 后 Round 6 **4/4 pass**，且未改 retrieval/ranking，说明问题仍是答案层 guard 的边界与鲁棒性。

## 3) 本轮要重点验证什么

- **更弱提示下未知服务**：不出现 `UserSvr`，尽量不出现“服务名”等强提示词，仍不应默认套 `UserSvr` 专属模板；应先要求确认对象/名称，再给通用检查点。
- **否定/限制语义**：如“别默认按 UserSvr 算”“不要按那个模板答”等，guard 仍应稳定生效。
- **正样本回归**：明确点名 `UserSvr` 的问题不应被误伤，仍稳定输出 `UserSvr` + ≥2 检查点。
- **非服务近邻干扰**：更口语的定义/术语问题不应误触发故障 guard，更不能输出 `UserSvr`。

## 4) 什么时候才允许再做一个更小 answer patch

仅当同时满足：

1. Round 6 已压住的“未知服务误答成 `UserSvr`”在 Round 7 弱提示同类题继续复现；
2. 主因仍是 `answer`；
3. 检索证据并没有要求回答成 `UserSvr`；
4. patch 能进一步收窄触发条件/增强否定语义 guard，且不误伤 `UserSvr` 正样本、不影响通用故障回答。

## 5) 本轮验收标准

- 新增 `evals/cases/rag-only-round7.json`（2～4 题）。
- 复用 `scripts/runRealRegressionRagOnly.ts` 跑通并产出 `raw/results/summary`。
- 若无 stable + 非 answer 失败：不登记 P0-B 候选点，不启动 P0-B。
