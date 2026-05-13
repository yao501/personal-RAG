# P0-A / RAG-only Round 4 — 扩故障/服务启动口语变体（不切 P0-B）

## 1) 为什么 Round 4 现在仍优先于 P0-B

- Round 2→3 的主问题已被证明是 **answer-level 的“可接受形态/触发条件”缺口**，并已用极小 patch 修复。
- 在未扩大“真实口语变体覆盖面”之前直接开 P0-B，容易把问题误归因到检索治理，扩大改动面且降低可诊断性。

## 2) 为什么 Round 3 结果说明它不是检索主线问题

- Round 3 的复现显示：证据 chunk 能命中包含 `UserSvr` 的段落，但因为故障措辞（如“起不来”）未被识别，答案路径落入 procedural 概览兜底，导致漏掉关键实体词。
- patch 后 Round 3 **3/3 pass**，且未改 retrieval/ranking，说明主因确为 answer-level 小缺口，而非检索/排序治理主线。

## 3) 本轮要验证什么

- **故障 / 服务启动问法在更多口语变体下是否仍稳定**：
  - “没起来/启动不了/跑不起来/未生效”等说法是否都能进入合适的 troubleshooting answer 形态。
- **“第一步先查什么”是否稳定给出至少 2 个检查点**（用形态约束近似验证：至少出现两个不同的检查对象/动作关键词）。
- **关键对象名 `UserSvr` 是否还能稳定显式出现**（避免再被 procedural 概览兜底吞掉）。
- **是否开始出现真正的 retrieval/ranking 主因**（例如：topResults 不再包含故障段落、或相关段落稳定落后于无关段落）。
- **反向验证不过拟合**：加入 1 道“未指名服务但提到服务启动失败”的干扰题，观察是否被错误套用 `UserSvr` 故障模板。

## 4) 什么情况下才允许登记 P0-B 候选点

仅当同时满足：

1. Round 4 出现 **stable partial/fail**（同类问题在 ≥2 道题上出现）；
2. 主因 **不是** `answer`；
3. 主因更像 `retrieval` / `ranking` / `chunk` / `parse_normalize`；
4. 并且能在 run 产物中用 `topResults` / citations 直接观察到该失败特征。

## 5) 本轮验收标准

- 新增 `evals/cases/rag-only-round4.json`（2～4 题，含 1 道干扰题）。
- 复用 `scripts/runRealRegressionRagOnly.ts` 跑通并产出：
  - `evals/raw/real-regression-*.raw.json`
  - `evals/results/real-regression-run-*.json`
  - `evals/results/real-regression-summary-*.md`
- summary 每题包含：`pass/partial/fail` + `fail_stage` + 一句话备注。
- 若没有满足条件的非 answer stable failure：**不登记 P0-B 候选点**。
