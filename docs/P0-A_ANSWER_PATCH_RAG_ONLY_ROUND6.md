# P0-A / Answer Patch — RAG-only Round 6（更稳健的故障触发边界）

## 1) 哪个 partial 触发 patch

Round 6 首次回归（run `2026-04-16-010`）出现两类 answer-level 偏差：

- `real-rag6-002-negative-unknown-service-no-usersvr-token`：未知服务问法未触发 guard，答案直接引用 `UserSvr` 段落（等价于“未知服务又被误答成 UserSvr”）。
- `real-rag6-004-interference-non-service-parameter-align-should-not-trigger-usersvr`：定义类问题含“提示同步”，因“提示”被当作故障触发词而误触发 guard，输出了含 `UserSvr` 的通用故障模板。

## 2) patch 只收窄/补齐了什么

仅调整 `tryTroubleshootingUserSvrDirectAnswer()` 的“看起来像服务故障”的触发判定：

- **补齐口语故障词**：新增 `没起来/没启动/未启动/没生效`，让未知服务类问法能进入 guard（先确认服务名）。
- **收窄“提示”**：将裸 `提示` 收窄为 `提示 +（失败/错误/启动/服务/未启动/没启动/没起来）` 上下文，避免“提示同步”这类定义问题误触发 troubleshooting。

不改 retrieval/ranking；不重写 `answerQuestion` 主干；不做多题硬编码。

## 3) 为什么它不是 P0-B 问题

两类偏差都来自 answer 层触发边界：

- 未知服务问法没有进入 guard → 不是召回问题，而是“故障触发词覆盖不足”。
- 定义问法被误当作故障 → 不是排序/召回，而是“触发词过宽”。

因此仍是 answer-level guard 问题，不是检索治理主线。

## 4) 如何验证 patch 没误伤明确 `UserSvr` 正样本

- **单测**：新增用例，确保“参数对齐/提示同步”不会触发故障 guard；同时保留既有 `UserSvr` 正样本测试。
- **回归**：同一 spec `evals/cases/rag-only-round6.json` 复跑（run `2026-04-16-011`）4 题全 pass：
  - `UserSvr` 正样本仍输出专属模板；
  - 未知服务负样本输出“先确认服务名”的 guard；
  - 否定语义样本 guard 生效；
  - 定义干扰样本不再被故障 guard 抢答。
