# Sprint 5.3 / 5.3a 评测摘要 — `sprint-5.3-run-002`

- **运行 ID**：`sprint-5.3-run-002`（在 `run-001` 上叠加 **Sprint 5.3a** 回答与检索最小收敛）
- **Gold 规范**：`docs/evals/sprint-5.3-benchmark-gold-v1.md`
- **完整结果**：`evals/results/sprint-5.3-run-002.json`
- **原始管道输出**：`evals/raw/sprint-5.3-run-002.raw.json`

## 与 run-001 对比（人工 checklist）

| 指标 | run-001 | run-002 |
|------|---------|---------|
| pass | 7 | **12** |
| partial | 5 | **0** |
| fail | 0 | 0 |
| 加权均分（pass=1, partial=0.5） | ≈ 0.79 | **1.0** |

## 曾 partial 的五题（5.3a 目标题）

| 题号 | run-001 主要 fail_modes | run-002 变化 |
|------|-------------------------|--------------|
| Q1 | `ranking_miss`, `should_refuse_or_be_cautious` | **pass**：主链路步骤结构化；无「概述性」壳；检索 bias + candidate 补块 |
| Q6 | `procedural_order_wrong`, `concept_confusion` | **pass**：阶段一/二 + 依据句；补入 Q6 段 |
| Q8 | `constraint_missing` | **pass**：direct 含 TRUE/FALSE 对仗与易混项 |
| Q9 | `should_refuse_or_be_cautious` | **pass**：证据覆盖门控 + 域间访问结构化 direct |
| Q11 | `constraint_missing`（.bat 截断） | **pass**：安全句子切分 + snippet 保留标识符 |

## 5.3a 代码改动摘要（对应关系）

1. **direct answer 规则**（`answerQuestion.ts`）：定义类合并 TRUE/FALSE；故障类 UserSvr 结构化；编译顺序专表。→ Q6、Q8、Q11  
2. **过程类结构化**：全流程与域间访问、编译顺序的「总述 / 步骤 / 注意」模板。→ Q1、Q6、Q9、Q11  
3. **谨慎门控**：`evidenceCoverageHighEnough` + 扩展 `chunkHasStepLikeContent`。→ Q1、Q9  
4. **展示截断**：`safeSentenceSplit.ts`、`snippetTruncate.ts`；eval 引用 `truncateSnippetPreservingIdentifiers`。→ Q8、Q11  
5. **检索**：`fullWorkflowBias.ts`（排序偏置 + `injectSprint53aCandidateChunks` 补块）。→ Q1、Q6  

## 仍须知晓的限制

- 语料仍为 **合成评测文本**，非厂商 PDF；`injectSprint53aCandidateChunks` 仅对少数可判定 pattern 补块，**不可**替代真实文档上的召回评测。
