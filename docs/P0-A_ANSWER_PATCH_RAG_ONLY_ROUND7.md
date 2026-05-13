# P0-A / Answer Patch — RAG-only Round 7（弱提示“跑不起来”进入未知服务 guard）

## 1) 哪个 partial 触发 patch

Round 7 复跑（run `2026-04-16-013`）中：

- `real-rag7-001-negative-weak-hint-still-not-running-first-check`：`partial`
  现象：弱提示“装完以后跑不起来”未进入 guard，directAnswer 直接复述 `UserSvr` 故障段落（等价于未知对象被默认套到 `UserSvr`）。

## 2) patch 只收窄/补齐了什么

仅调整 `tryTroubleshootingUserSvrDirectAnswer()` 的“看起来像服务故障”的触发判定：

- 新增弱提示模式：**仅在**出现“装完/安装”上下文时，将 `跑不起来/没成功/不生效/没反应` 视为 troubleshooting 触发信号，使其进入未知服务 guard（先确认对象/名称）。

不改 retrieval/ranking；不重写 `answerQuestion` 主干；不做多题硬编码。

## 3) 为什么它不是 P0-B 问题

失败不是召回不到证据，而是答案层没有把弱提示识别成 troubleshooting，从而落入对 `UserSvr` 段落的直接复述。属于 answer-level 触发边界问题。

## 4) 如何验证 patch 没误伤明确 `UserSvr` 正样本

- **单测**：新增用例，验证“装完后跑不起来”会走未知服务 guard（包含“确认”，且不输出 `UserSvr` 专属三步模板）。
- **回归**：同一 spec `evals/cases/rag-only-round7.json` 复跑（run `2026-04-16-014`）4 题全 pass：
  - 弱提示未知对象题输出 guard；
  - 否定语义题 guard 生效；
  - `UserSvr` 正样本仍稳定输出 `UserSvr`；
  - 口语化“参数对齐”干扰题不触发故障 guard。
