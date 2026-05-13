# P0-A（RAG-only）Round 1 — 真实题回归扩展计划（跳过 notarization）

## 范围与约束

- 本轮只做 **RAG-only**：新增 2～4 个真实题回归资产并跑通闭环。
- 不扩成大 benchmark；不引入 LLM judge；不重开 5.3。
- 不做 P0-C/notary；P0-B 仅作为下一周的必要治理候选，不在本轮开工。

## 本轮选题（2～4 题）

优先覆盖三类（各 1 题），可选再加 1 个故障类：

1. **跨分册主链 / 全流程**（multi-doc 下主 citation 不应落在噪声分册）
2. **顺序 / 阶段边界**（Q6 同源，但不再围绕 Q6 扩题）
3. **定义 + 约束项**（Q8 同源，但不再做 Q8 单点优化）
4. **可选：故障/安装/service 启动类**（验证 troubleshooting 路径）

## case 准入标准（本轮）

每题必须包含字段：

- `id`
- `question`
- `rationale`
- `owner`
- `source_section_hint`
- `expected_shape`（关键点，不写全文答案）
- `fail_stage`（初始主因；runner 会给粗归因）

## fail_stage（主因唯一）

沿用 `docs/P0-A_REAL_QUERY_EXPANSION_PLAN.md`：
`retrieval | ranking | chunk | parse_normalize | answer | rule_check`

## 验收方式

- 运行新增 spec（见 `evals/cases/rag-only-round1.json`）并生成：
  - `evals/raw/real-regression-*.raw.json`
  - `evals/results/real-regression-run-*.json`
  - `evals/results/real-regression-summary-*.md`
- summary 每题一行：`id | verdict | fail_stage | one_line_note`
