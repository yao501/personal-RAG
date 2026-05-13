# 未来 2 周执行包（RAG-only，跳过 notarization）

> 本计划只覆盖未来两周，只做 P0-A + 必要的 P0-B 小步治理；不包含任何 Apple/notary 工作。

## Week 1：P0-A（真实问题回归扩展）

### 包 1：新增 2～4 个高价值真实题（RAG-only Round 1）

- **目标**：补齐 2～4 个“高价值、可复现、可归因”的真实题回归资产，并跑通 raw/results/summary 闭环。
- **题型优先级**：
  1. 跨分册主链 / 全流程（1 题）
  2. 顺序 / 阶段边界（Q6 同源，但不再围绕 Q6 扩题）（1 题）
  3. 定义 + 约束项（Q8 同源，但不做 Q8 单点优化）（1 题）
  4. 可选：真实故障/安装/service 启动类（1 题）
- **产出**：
  - `docs/P0-A_ROUND_NEXT_PLAN.md`
  - `evals/cases/rag-only-round1.json`（2～4 题）
  - `evals/raw/real-regression-*.raw.json`
  - `evals/results/real-regression-run-*.json`
  - `evals/results/real-regression-summary-*.md`
- **验收**：一条命令可跑通（复用现有 runner），summary 每题都有 verdict + `fail_stage` + 下一步建议。
- **非目标**：不扩成大 benchmark；不上 LLM judge；不改检索规则。

## Week 2：P0-B（必要治理，小步可验证）

### 包 2：只选 1 个最值得治理点（以回归新增题为准）

- **目标**：只对“新增真实题”中最稳定复现的 1 个 retrieval/ranking 问题做小步修补（可测、可回滚）。
- **产出**：
  - 1 个小改动（模块内单点治理）+ 对应单测/可重复验证
  - 更新 `docs/P0-B_RETRIEVAL_GOVERNANCE_PLAN.md` 的一小段状态说明（不重写）
- **验收**：
  - `npm test` 绿
  - 新增真实题回归 runner 复跑，明确 before/after（至少在 summary 里体现）
- **非目标**：不做大而泛的 retrieval 架构改造；不扩 benchmark；不重开 5.3。
