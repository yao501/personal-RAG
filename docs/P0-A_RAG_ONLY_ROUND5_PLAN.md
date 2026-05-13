# P0-A / RAG-only Round 5 — 验证故障模板是否误触发（避免过拟合 UserSvr）

## 1) 为什么 Round 5 仍优先于 P0-B

- Round 4 的唯一失败仍是 **`answer`**（未知服务/未指名对象时误套 `UserSvr` 模板风险），不是 retrieval/ranking/chunk/parse_normalize。
- 在这种情况下启动 P0-B 会把问题误归因到检索主线，扩大改动面且不利于诊断“模板触发边界”。

## 2) 为什么 Round 4 暴露的是 answer 模板误触发风险，而不是检索主因

- Round 4 的干扰题明确要求“不要默认就是 UserSvr”，但系统仍给出 `UserSvr` 专属故障模板 → 属于 **模板触发过宽/guard 缺失**。
- 这类风险即使检索完全正确也会发生：因为语料里恰好有 `UserSvr` 故障示例，答案层不应把“服务启动失败”泛化等同为“UserSvr 故障”。

## 3) 本轮重点验证什么

- **正样本（明确点名 `UserSvr`）**：仍应稳定输出 `UserSvr` 且给出 ≥2 个优先检查项（依赖/注册/日志/事件/脚本）。
- **负样本（不点名对象 / 未知服务）**：不得硬套 `UserSvr` 专属模板；应先提示“先确认服务名/对象”，再给通用检查项。
- **干扰样本（全流程/使用步骤）**：不得被 `UserSvr` 故障模板抢答；应回到主链步骤回答。

## 4) 什么情况下才允许再做极小 answer patch

仅当同时满足：

1. Round 4 的“未知服务误答成 `UserSvr`”在 Round 5 同类题继续复现；
2. 主因仍是 `answer`；
3. 检索证据并没有要求它回答成 `UserSvr`（问题本身未点名对象，且语料仅为示例）；
4. patch 可做到：**只缩窄 `UserSvr` 模板触发/增加 guard**，且不影响明确点名 `UserSvr` 的正样本。

## 5) 本轮验收标准

- 新增 `evals/cases/rag-only-round5.json`（2～4 题，覆盖正/负/干扰）。
- 复用 `scripts/runRealRegressionRagOnly.ts` 跑通并产出 `raw/results/summary`。
- 若未出现满足条件的“模板误触发”复现 → 不做 patch。
- 若出现且 patch 后正/负样本均通过 → 视为本轮收口；仍不切 P0-B。
