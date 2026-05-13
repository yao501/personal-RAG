# P0-A / Answer Patch — RAG-only Round 5（收窄 UserSvr 模板触发）

## 1) 哪个 fail 触发 patch

Round 5 首次回归（run `2026-04-16-006`）中出现同类失败：

- `real-rag5-002-negative-unknown-service-do-not-assume-usersvr`：`fail`（未知服务仍被答成 UserSvr 专属模板）
- `real-rag5-004-boundary-service-troubleshooting-not-workflow-and-not-usersvr-by-default`：`fail`（边界 + 未指名对象，仍被答成 UserSvr 专属模板）

两题共同点：问题明确表达“未知服务/不要默认/不要套 UserSvr”，但答案仍输出 `UserSvr` 专属三步模板。

## 2) patch 只收窄了什么

仅在 `tryTroubleshootingUserSvrDirectAnswer()` 中增加 **guard**：

- **只有在问题明确点名 `UserSvr`（或 `UserReg.bat`/`UserUnReg.bat`/`HOLLiAS_MACS` 等强对象词）且不含“不要默认/不要套/不是 UserSvr”否定语义时**，才触发 `UserSvr` 专属模板。
- 否则输出“先确认服务名/对象”的通用首检清单，并提示“若确认是 UserSvr 再按专属步骤执行”。

不改 retrieval/ranking；不重写 `answerQuestion` 主干；不做多题硬编码。

## 3) 为什么它不是 P0-B 问题

失败模式不是“找不到证据”，而是 **答案层把“服务启动失败”错误等同为“UserSvr 故障”**：

- 语料里存在 `UserSvr` 故障示例，检索命中后很容易被答案层误用；
- 但当用户未指名对象时，答案必须先确认对象边界，不能硬套专属模板。

因此这是 answer-level 的模板触发边界问题，不是检索治理主线。

## 4) 如何验证 patch 没误伤明确 `UserSvr` 正样本

- **单测**：新增用例，验证“未知服务 + 不要默认 UserSvr”不会输出 `UserSvr` 专属模板；同时保留既有 `UserSvr` 正样本测试。
- **回归**：同一 spec `evals/cases/rag-only-round5.json` 复跑（run `2026-04-16-009`）4 题全 pass：
  - 正样本仍稳定输出 `UserSvr` 专属模板；
  - 负/边界样本输出“先确认服务名”的 guard，不再串题。
