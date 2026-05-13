# P0-A / Q6 Answer Patch 1 — 只动 answer 层的最小修补轮

## 目标与边界

### 本轮只修什么

- **只修 Q6 同类的 answer-level 缺口**：让答案更稳定说出
  - **控制器侧**
  - **先后顺序（先编译后下装）**
  - **区分：控制器算法工程 vs 工程总控工程/站侧**
  - **必要时给出“不混淆/边界提醒”**

### 本轮明确不修什么

- 不改 `retrieval/ranking/chunk/parse`（不加新规则、不调权重、不改分册 prior）。
- 不重开 5.3，不修改 5.3 closeout 结论。
- 不做大模板体系，不重写 `answerQuestion` 全主干。

## 什么叫“最小修补”

- **只在 answer 层做可解释的小动作**：
  - 对 Q6 同族问法：在现有 `SearchResult[]` 里**选择更合适的证据块**（例如同时包含“控制器 + 编译 + 下装”或“下装控制器算法”的段落），避免 directAnswer 被 top1 的“无关段/工程总控 FAQ 单句”带偏。
  - 在证据足够时，输出更稳定的 **两阶段结构**（先控制器侧、再工程总控/站侧）与简短 guardrail。

## 什么叫“过度修补”（禁止）

- 为了过 Q6，把所有 procedural 问题都强制套“控制器侧/工程总控侧”结构。
- 在证据不足时仍强行补齐细节（无引用支撑的“硬写控制器侧步骤”）。
- 硬编码某一段固定答案全文来刷题。

## 本轮验收

- 用 `evals/cases/q6-round3.json`（含 `acceptable_variants`）重跑 Round 3。
- 关注点：
  - 是否比 patch 前更接近 `acceptable_variants`（更少 `answer` fail/partial）。
  - 是否确实补上“控制器侧 / 两阶段边界 / guardrail”这些生产关键约束（不要求把所有题刷成 pass）。
