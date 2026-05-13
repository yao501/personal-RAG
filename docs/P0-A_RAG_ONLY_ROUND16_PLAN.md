# P0-A / RAG-only Round 16 — UserSvr guard 支线：收口前第 2 轮确认（最后一轮）

## 目标

- 按收口规则的最后一轮（Round 16）复核四类样本仍稳定，且**不改 `answerQuestion` / 不新增 answer patch**：
  1) 未知对象弱提示负样本（更弱口语但保留最低检索锚点，避免 `hasReliableEvidence` 早退）
  2) deny/限制语义（命中既有 `qDeniesUserSvr` 语义）
  3) `UserSvr` 正样本回归（≥2 检查点且第一项明确）
  4) 非服务类近邻干扰题（不触发故障模板、不输出 `UserSvr`）

## 为什么仍优先于 P0-B

- 目前仍未满足“stable + 非 answer 主因（且至少 2 题同类复现）”的切换门槛。

## 允许/禁止

- **允许**：小步扩题 + 复用 runner 跑通闭环；若遇到 evidence gate 早退，可做最小题面锚点增强来完成验证。
- **禁止**：不写 P0-C；不启动大而泛 P0-B；不重写 `answerQuestion` 主干；不引入 LLM judge；不大扩 benchmark。

## 验收标准

- `evals/cases/rag-only-round16.json`：4 题齐全字段。
- 复用 `scripts/runRealRegressionRagOnly.ts` 产出 `raw/results/summary`。
- 目标：**4/4 pass**，且不新增 answer patch、不改 `answerQuestion`。
