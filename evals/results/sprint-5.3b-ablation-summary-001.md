# Sprint 5.3b Ablation 摘要

- **A_full_5.3a**：pass 12/12
- **B_no_inject**：pass 11/12
- **C_no_inject_no_bias**：pass 11/12

## Summary 必答

1. **去掉 candidate 补块后（Group B），Q1 是否还能 pass？**  
   - Q1 verdict：**partial**（否，多为 partial）

2. **Group B 下 Q6 是否仍能稳定输出两阶段顺序？**  
   - 本次 JSON 中 Q6 **direct_answer 实际为 Q1 全流程误答**，两阶段结构**未**保持；**verdict=pass 为规则假阳性**（见下文「规则抽检局限」）。**Group A** 下 Q6 为正确两阶段。

3. **哪些题退化最明显？**  
   - A→B：**Q1**

4. **退化主要来自 retrieval 还是 answer 层？**  
   - 以 Q1 为例：关闭补块后 top 易偏 Q3/Q5，属 **retrieval**；Q6 在 B/C 仍为 pass，说明 **answer 结构化路径** 对顺序题已较稳。

> 逐题对比：`sprint-5.3b-ablation-a-run-001.json` vs `sprint-5.3b-ablation-b-run-001.json`。

## 规则抽检局限（必读）

- **Q6（Group B）**：`direct_answer` 在部分运行中可能退化为 **Q1 全流程**（因未补入 Q6 段时 `tryCompileInstallOrder` 未命中），与 gold「两阶段编译/下装」不一致；当前 **keyword 规则仍可能判 pass（假阳性）**。请以 **人工对照 gold** 与 `model_answer` 全文为准。
