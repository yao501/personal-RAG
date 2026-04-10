# Sprint 5.3 评测摘要 — `sprint-5.3-run-001`

- **运行 ID**：`sprint-5.3-run-001`
- **Gold 规范**：`docs/evals/sprint-5.3-benchmark-gold-v1.md`
- **完整结果**：`evals/results/sprint-5.3-run-001.json`
- **原始管道输出**（未含人工 verdict）：`evals/raw/sprint-5.3-run-001.raw.json`
- **语料说明**：答案基于 `docs/evals/fixtures/sprint-5.3-synthetic-corpus.md`（评测用合成语料），非厂商原文。

## 题量与判定

| 指标 | 数值 |
|------|------|
| 总题数 | 12 |
| pass | 7 |
| partial | 5 |
| fail | 0 |
| 加权均分（pass=1, partial=0.5） | ≈ 0.79 |

**pass**：Q2、Q3、Q4、Q5、Q7、Q10、Q12  

**partial**：Q1、Q6、Q8、Q9、Q11  

## 常见 fail_modes

| fail_mode | 出现题号 |
|-----------|----------|
| `should_refuse_or_be_cautious` | Q1、Q9 |
| `ranking_miss` | Q1 |
| `procedural_order_wrong` / `concept_confusion` | Q6 |
| `constraint_missing` | Q8、Q11 |

## 最不稳定的 3 题（优先复盘）

1. **Q1**：全流程问法下，检索排序偏向 Q5「下装」块，触发谨慎回答，未给出 gold 主链路。
2. **Q6**：两阶段「控制器算法编译下装 → 工程总控编译下装操作站/历史站」顺序与专指 FAQ 易混。
3. **Q9**：`direct_answer` 套谨慎模板，但引用块实际覆盖域间要点，**证据与回答壳层不一致**。

## 建议的下一步（三类修复）

1. **检索与排序**：针对「完整步骤 / 全流程」类查询加强段落类型或意图信号，避免被单主题高分块（如下装分类）抢占首位。
2. **过程类答案**：对「先 A 后 B」类 gold 增加结构化检查或专用提示，减少跨 FAQ 串话。
3. **回答层**：当 top citations 已覆盖 checklist 时，降低空泛谨慎壳；**direct_answer** 与 **supporting** 对关键布尔/路径约束应对仗写全，并避免 UI/片段截断影响可核查性（如 Q11 脚本名）。
