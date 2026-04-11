# 接下来最先做的 3 件事

主线已切换：**P0-B 检索治理** 为先，**P0-A 小步扩题** 与 **P0-C 发布最小闭环** 并行准备。以下 3 件**现在就能开工**，按顺序各由一人或同一人在一周内拆 PR。

---

## 1. 启动 P0-B 第一轮：统一检索 haystack + query 类型贯通 pipeline

打开 `src/lib/modules/retrieve/searchIndex.ts`（及组装 `SearchResult` 的路径），找出所有仅使用 `chunk.text` 做 lexical 匹配或打分的地方；实现单一 `retrievalHaystack(chunk)`（或同名），把 `sectionTitle`、`sectionPath` 与 `text` 按固定顺序拼接，并在**一处**用于检索相关逻辑。同时在 `retrievalPipeline.ts` 从现有 `detectQueryIntent` 读出**精简**类型枚举，把字符串传入 `applySprint53cRetrievalBias`（或后续 bias 模块），便于日志打印 `queryType`。  
**当天产出**：一个 PR，带 `chunkText` 或 search 层单测（mock「只有 title 有关键词」的块）。  
**验证**：`vitest` 绿；本地对 `benchmarks/benchmark.v1.json` 跑 `npm run eval:rag` 无意外失败。  
**注意**：不改 answer 主干；不启动新 5.3 实验。

---

## 2. 建立 P0-A 的「空架 + 2 题占位」：目录、命名、归因表

创建 `evals/cases/README.md`（或 `evals/real-regression/README.md`），写明命名规范与 `fail_stage` 表（与 `docs/P0-A_REAL_QUERY_EXPANSION_PLAN.md` 一致）。从三类优先题中**只登记 2 题**的 id、rationale、owner（可先不写 gold 细节，但 PR 合并前必须补 checklist）。在 `docs/EVAL_GUIDE.md` 增加 8～15 行链到 `P0-A_REAL_QUERY_EXPANSION_PLAN.md`。  
**当天产出**：文档 PR；若时间允许，拷贝 `scripts/sprint53cRealpdfEval.ts` 为 `scripts/realRegressionEval.ts` 的空壳（仅打印「未配置 cases」），不强制接 CI。  
**验证**：Reviewer 能按 README 添加第三题而不争议格式。  
**注意**：本轮**不**大量扩题；不把 5.3 合成题重复抄进真实集。

---

## 3. P0-C：发布最小闭环 — 对照 `docs/RELEASE.md` 写「5 步 checklist」并标缺口

阅读 `docs/RELEASE.md` 与当前 `electron-builder`（或等价）配置，在文首或附录增加**可勾选**的五步：`build` → `sign` → `notarize` → `staple` → `verify`（每步一条命令 + 期望输出关键词）。用 `[ ]` 标出当前仓库**尚未自动化**的步骤及负责人占位。  
**当天产出**：仅文档 PR；若某步完全未文档化，补外部链接到 Apple 官方 notarytool。  
**验证**：另一位同事不读代码仅按文档能执行到「知道卡在哪一步」。  
**注意**：首轮不强制 CI 上传；不追求一次做满自动发布。

---

**完成后**：将 B1/B3 的代码 PR 与 P0-A/P0-C 文档 PR 在 `docs/NEXT_PHASE_EXECUTION_PLAN.md` 的「变更记录」中记一行日期与链接（可选，第二周补）。
