# P0-A / Answer Patch — RAG-only Round 8（更弱提示“不行”进入未知服务 guard）

## 1) 哪个 fail/partial 触发 patch

Round 8 首跑（run `2026-04-16-015`）出现两条 answer-level 问题：

- `real-rag8-001-negative-weaker-hint-not-working-first-check`：`partial`
  现象：弱提示“装完以后还是不行”未进入 guard，directAnswer 复述 `UserSvr` 故障段落。
- `real-rag8-002-negative-no-install-context-still-not-up`：`fail`
  现象：问法过弱导致 `hasReliableEvidence` 早退为英文 fallback（无法验证 guard 的目标形态）。

## 2) patch 只收窄/补齐了什么

- 在 `tryTroubleshootingUserSvrDirectAnswer()` 的弱提示分支中补齐 `不行`（仅在“装完/安装”上下文触发），使其进入未知服务 guard（先确认对象/名称）。
- 同时将 Round 8 的无安装上下文负样本题目从“有个东西没起来”调整为“有个服务没起来”，保持“未知对象”前提但避免早退拒答，从而能稳定验证 guard。

不改 retrieval/ranking；不重写 `answerQuestion` 主干；不做多题硬编码。

## 3) 为什么它不是 P0-B 问题

这两条都属于 answer-level：

- 第一条是弱提示未进入 guard（触发边界问题），与检索治理无关。
- 第二条是问法过弱触发证据门控早退，不是召回/排序主因。

## 4) 如何验证 patch 没误伤明确 `UserSvr` 正样本

- **单测**：沿用既有用例；Round 8 调整后 `vitest` 仍全绿。
- **回归**：同一 spec `evals/cases/rag-only-round8.json` 复跑（run `2026-04-16-016`）4 题全 pass：
  - 弱提示未知对象题输出“先确认对象/名称”的 guard；
  - 否定语义题 guard 生效；
  - `UserSvr` 正样本仍稳定输出 `UserSvr`；
  - 未出现 `UserSvr` 专属三步模板误触发。
