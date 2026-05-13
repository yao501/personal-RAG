# 下一阶段工作计划（跳过 notarization，RAG-only）

## A. 当前正式决策

- **P0-C 暂停**：不再继续 Apple notarization / Developer ID / App Store Connect / notarytool 相关工作。
- **原因**：外部依赖强（账号/证书/权限），但对当前“个人知识库”主线不关键；继续投入的边际收益低。
- **状态**：不是永久删除，而是**阶段性降级**；未来确需对外分发时再恢复。

## B. 当前真正主线

1. **P0-A：真实问题回归扩展**（主线）
2. **P0-B：只做必要的 retrieval / ranking 治理**（维护线 + 小步治理）
3. **P0-C：暂停**（不进最近两周主任务）

## C. 工作原则（保持一致）

- **继续坚持**：Local-first / Enhanced Hybrid RAG / Citation-first / Strong Diagnostics
- **不做**：
  - GraphRAG 主路线
  - 复杂 agent orchestration
  - 大 UI 改版
  - LLM judge
  - 大规模 benchmark 扩张
