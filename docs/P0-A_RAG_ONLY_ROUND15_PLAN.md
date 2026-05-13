# P0-A / RAG-only Round 15 — UserSvr guard 支线：收口前第 1 轮确认

## 目标

- 按收口规则仅再做 Round 15/16 两轮。
- 本轮继续验证四类样本在**无新增 answer patch / 不改 `answerQuestion`**前提下仍稳定：
  1) 未知对象弱提示负样本（更弱口语但保留最低检索锚点，避免 `hasReliableEvidence` 早退）
  2) deny/限制语义（命中既有 `qDeniesUserSvr` 语义）
  3) `UserSvr` 正样本回归（≥2 检查点且第一项明确）
  4) 非服务类近邻干扰题（不触发故障模板、不输出 `UserSvr`）

## 为什么仍优先于 P0-B

- 目前尚未出现 stable + 非 answer 的 `retrieval/ranking/chunk/parse_normalize` 主因（且至少 2 题同类复现）的启动门槛。

## 允许/禁止

- **允许**：仅做小步扩题与回归运行；若遇到“题面过弱导致 evidence gate 早退”，允许做**最小题面锚点修正**以完成验证。
- **禁止**：不写 P0-C；不启动大而泛 P0-B；不重写 `answerQuestion` 主干；不引入 LLM judge；不大扩 benchmark。

## Patch 门槛（本轮默认不做）

仅当出现“未知对象误套 `UserSvr` 模板”且主因仍是 `answer`、并可通过进一步收窄模板触发条件修复时，才允许进入 patch 分支（否则只记录，不扩散改动面）。

## 验收标准

- `evals/cases/rag-only-round15.json`：4 题齐全字段。
- 复用 `scripts/runRealRegressionRagOnly.ts` 产出 `raw/results/summary`。
- 目标：**4/4 pass**，且不新增 answer patch、不改 `answerQuestion`。
