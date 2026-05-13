# P0-A / RAG-only Round 3 — 聚焦故障/服务启动问法（允许 1 个极小 answer patch）

## 1) 为什么 Round 3 仍优先于 P0-B

- Round 2 的唯一 partial 主因是 **`answer`**（输出未显式点出关键实体 `UserSvr`），不是 retrieval/ranking/chunk/parse_normalize 的治理问题。
- 在这种情况下直接启动 P0-B 会把问题误归因到检索治理，既不必要也容易扩大影响面。

## 2) 为什么当前 partial 更像 answer-level 可接受形态问题

- 证据（topResults / citations）已能命中包含 `UserSvr` 的段落。
- 但答案生成/证据选择在“procedural 段落聚合”与“故障段落”之间发生了偏置，导致 directAnswer 没保留服务名与排障结构。

## 3) 本轮主测什么

- **故障 / 服务启动 / “先查什么”**：至少 2 个检查点；第一检查点明确。
- **边界提醒**：当问法提示“不要跑偏/先区分”时，答案应显式点名对象边界（本轮重点仍是 service/故障对象）。
- **关键实体词显式出现**：例如 `UserSvr`（以及同族 UserReg/UserUnReg 若出现）必须稳定出现在 directAnswer。

## 4) 什么时候才允许做一个极小 answer patch

仅当同时满足：

1. Round 2 的 partial 在 Round 3 同族题继续复现；
2. 主因仍是 `answer`；
3. 检索证据已足够（topResults/引用 chunk 内包含服务名），但 directAnswer 未显式输出服务名/结构；
4. patch 必须小范围、仅针对“故障/服务启动/先查什么”问法，不改 retrieval/ranking，不重写 `answerQuestion` 主干。

## 5) 本轮验收标准

- 新增 `evals/cases/rag-only-round3.json`（2～4 题）并跑通 runner。
- 生成新一轮 raw/results/summary。
- 观察同族故障题是否仍出现稳定 partial/fail：
  - 若仍为 `answer` 且服务名漏出 → 允许 1 个极小 patch 并复跑；
  - 若无稳定失败 → 不做 patch、不登记 P0-B 候选点。
