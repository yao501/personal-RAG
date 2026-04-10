# Sprint 5.3b 总总结

## 1. 5.3a 的收益是否对 paraphrase 泛化？

- Paraphrase pass 数：**18/18**（验收 ≥15：是）
- 结论：在变体问法下整体仍可用同一套 answer/gating/snippet 逻辑支撑 gold 要点。

## 2. 关闭 candidate 补块后，收益是否仍大体成立？

- Group A pass：**12/12**
- Group B pass：**11/12**
- A→B 退化题（A pass 而 B 非 pass）：Q1

结论：关闭补块后 **Q1** 规则退化；**Q6 在 B 组曾出现 direct 误用 Q1 全流程**（见 `sprint-5.3b-ablation-summary-001.md`），说明 **顺序专条仍依赖补块或检索命中 Q6 段**，不能仅凭 keyword 规则断言「Q6 已稳」。

## 3. 能否迁移到真实 PDF？

- Part C 状态：**ok**（已从 `~/Desktop/和利时DCS操作手册` 加载 **7 卷** V6.5 用户手册 PDF，合并 **7274** chunks）
- 规则抽检：**3/6 pass**（验收目标 ≥4/6：**未满足**）；**Q9 / Q11 未出现「概述性」谨慎壳**。
- 主要短板：**Q1** 检索误命中 **图形编辑** 分册；**Q8** 与 TRUE/FALSE 字面规则在 PDF 文本上未对齐（见 `sprint-5.3b-realpdf-summary-001.md`）。

结论：**answer/gating 可部分迁移**；**全流程主链与跨分册检索**必须在 **5.3c** 用真实手册继续修。

## 4. 下一步路线建议

| 条件 | 建议 |
|------|------|
| 真实多卷 PDF 上 Q1 排序错误 | **优先 5.3c retrieval/ranking**（分册路由、元数据、或全流程查询偏置） |
| B 组仅 Q1 退化（synthetic） | 与上条一致：补检索后再减依赖 inject |
| 真实 PDF 上 Q8/Q6 规则 partial | **chunk + 术语归一**（TRUE/FALSE 变体）；必要时 **补 gold key** |
| Paraphrase 已 18/18 但真实 3/6 | **勿结束 5.3**；先完成 5.3c 再扩真实题集 |

---
生成时间：2026-04-10T16:33:57.799Z
