# P0-A / UserSvr guard 压测支线 — 阶段性收口说明

## 结论（按收口规则）

- 已完成收口前最后两轮：Round 15 与 Round 16。
- 两轮均满足：
  - **4/4 pass**
  - **未新增 answer patch**
  - **未修改 `src/lib/modules/answer/answerQuestion.ts`**
  - 四类样本（未知对象弱提示负样本 / deny / `UserSvr` 正样本 / 非服务干扰）均保持稳定
- 因此：本支线标记为**阶段性收口**，**不再自动生成 Round 17+**。

## 已覆盖题型（本支线范围）

- **未知对象弱提示负样本**（无安装上下文 + 最低检索锚点）
  - 代表锚点：`服务 + 没启动/未启动/没起来/没生效/启动失败` 等（用于避免 `hasReliableEvidence` 早退）
  - 期望：不默认套 `UserSvr` 专属模板，先要求确认“失败对象/服务名”，再给通用首检点（依赖/注册/日志/事件）
- **deny / 限制语义**
  - 代表语义：`别默认/别套用/不是 UserSvr`（命中既有 `qDeniesUserSvr`）
  - 期望：deny 稳定生效，不输出 `UserSvr` 专属模板
- **`UserSvr` 正样本回归**
  - 期望：明确点名 `UserSvr` 时仍稳定输出 `UserSvr`，且 ≥2 检查点、第一检查项明确
- **非服务类近邻干扰题**
  - 范围：参数对齐 / 提示同步 / TRUE/FALSE 等更口语问法
  - 期望：不触发故障模板，更不输出 `UserSvr`

## 最后两轮结果（以最终有效 run 为准）

- **Round 15**：`evals/results/real-regression-summary-2026-04-16-032.md`
  - 4/4 pass
- **Round 16**：`evals/results/real-regression-summary-2026-04-16-033.md`
  - 4/4 pass

> 注：Round 15 首跑出现过一次 evidence gate 早退导致的假失败（检索命中偏离、refusal）；已通过“最小题面锚点增强（加入更可检索的故障锚点词）”复跑修正，最终有效 run 以 `-032` 为准。该过程不涉及代码 patch。

## 为什么现在可以先停

- 该支线的目标是压住“未知对象/口语弱提示时误套 `UserSvr` 模板”的 answer-level 风险，并验证 deny 与正样本不被误伤。
- Round 15/16 作为收口前两轮复核，均在无新增 patch 的情况下保持全绿，说明当前 guard 边界在该题型族群上已具备**阶段性稳定性**。
- 在未出现 stable + 非 answer 主因（且 ≥2 题同类复现）的前提下，继续无限追加 round 的边际收益已下降，且会引入更多“题面锚点/证据门控”层面的噪声。

## 后续如何再重开

仅在出现以下任一情况时再重开该支线：

- 新的真实回归（用户真实问法）触发：
  - 未知对象误套 `UserSvr` 专属模板，或
  - deny 语义失效导致误套，或
  - `UserSvr` 正样本被误伤（不再点名/检查点不足）
- 或出现 stable + 非 answer 主因（`retrieval/ranking/chunk/parse_normalize`）且至少 2 题同类复现：此时应停止继续压 P0-A，转为记录并准备轻量 P0-B。
