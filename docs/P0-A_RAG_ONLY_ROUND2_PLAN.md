# P0-A / RAG-only Round 2 — 继续小步扩题（不启动大治理）

## 1) 为什么 Round 2 现在比 P0-B 更优先

- Round 1 的 4 题全 pass 只能证明闭环可跑，不足以覆盖“更易跑偏”的真实问法形态。
- 在不启动大治理前，先用 2～4 个**更有区分度**的问法把回归资产做“更可信”，能更快暴露真正值得治理的点。

## 2) 本轮仍坚持“小步扩题”

- 只新增 **2～4 题**。
- 继续使用 **fixture-first（脱敏 markdown）** 跑通 raw/results/summary 闭环。
- 不引入 LLM judge，不扩成大 benchmark。

## 3) 本轮目标：提升题目区分度（不是堆数量）

Round 2 的题必须比 Round 1 更“容易跑偏”，例如：

- 全流程主链更长、要求回答“安装后到运行前的关键环节”，不能只抓某个子步骤。
- 顺序/边界换说法（非 Q6 复读），测试同意图不同表达。
- 定义+约束换成更像用户的问法（TRUE/FALSE、前提、生效条件）。
- 故障类问法更像排障路径，而非一句“怎么处理”。

## 4) 什么时候才允许登记 P0-B 候选治理点

仅当出现**稳定失败**（同一题多次复跑仍 `partial/fail`，且主因更像 `retrieval/ranking/chunk/parse_normalize`）才登记：

- 记录：题目 id、失败主因、为什么值得治理
- **但本轮不修**（不立刻启动大范围 P0-B 改造）

## 5) 本轮验收标准

- `evals/cases/rag-only-round2.json` 新增 2～4 题
- 复用 `scripts/runRealRegressionRagOnly.ts` 跑通并产出：
  - `evals/raw/real-regression-*.raw.json`
  - `evals/results/real-regression-run-*.json`
  - `evals/results/real-regression-summary-*.md`
- summary 每题输出：`verdict + fail_stage + 一句话说明`
