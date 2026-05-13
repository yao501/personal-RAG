# NEXT Top 3（RAG-only，跳过 notarization）

## 1) P0-A：新增 2～4 个真实题并跑通最小回归闭环

- 只加 2～4 题（跨分册主链/顺序边界/定义约束/可选故障各 1）。
- 每题必须带：`id/question/rationale/owner/source_section_hint/expected_shape/fail_stage`。
- 复用现有 runner，生成 `evals/raw` + `evals/results` + `summary`。
- 目标不是立刻“全绿”，而是把失败稳定归因到 `retrieval/ranking/answer/...`。

## 2) P0-A：把 case/summary 规范固定下来（不扩 schema）

- `evals/cases/README.md` 补一段本轮“RAG-only Round 1”约定（命名、fail_stage 示例、owner/last_verified 要求）。
- 让另一位同事能独立添加 1 题并跑出同样格式的 summary。

## 3) P0-B：只选 1 个最值得做的治理点做小步修补

- 只从“新回归题的稳定失败”里挑 1 个点（例如：跨分册主链被噪声分册抢占）。
- 必须可测、可回滚：加 1 个单测或最小可重复验证脚本输出。
- 不开大重构，不扩 benchmark，不引入 LLM judge。
