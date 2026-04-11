# P0-B：Retrieval / ranking 治理 — 第一轮执行计划

**定位**：后 5.3 阶段**最先开工**的技术主线（与 `docs/NEXT_PHASE_EXECUTION_PLAN.md` 一致）。  
**范围**：仅**第一轮**治理——收束现有有效做法、补文档与接口、为后续轮次留扩展点；**不重写**整条 RAG 管道。

---

## 1. 目标（本轮要解决什么）

结合当前代码与 5.3 已暴露问题，第一轮聚焦：

| 痛点 | 本轮期望 |
|------|----------|
| **跨分册主链路召回** | 全流程类 query 的 top-k **稳定**落在工程主链相关分册，而非图形/控件等噪声分册。 |
| **全流程类查询偏移** | 排序对「顺序词 + 主链词」与「仅子步骤 FAQ」可区分，减少抢头条。 |
| **无关来源噪声** | 已知噪声模式（如特定控件/视频段落）有**统一**惩罚或过滤策略，而非散落魔数。 |
| **chunk 边界导致证据切碎** | 至少对**一类**高价值结构（如「标题在 sectionTitle、正文无关键词」）有**文档化**的检索侧处理（合并、haystack 或注入策略）。 |
| **术语 / 表格 / 参数表达不稳** | 索引前归一策略**列表化**并带测试；snippet 侧不因截断破坏参数名（延续 5.3a 方向，本轮以**检索与 parse 交界**为主）。 |

---

## 2. 非目标（本轮明确不做）

- **不重写** `answerQuestion` 主干或大规模改 direct 模板。
- **不重开** Sprint 5.3 系列实验或改写 5.3 结论文档。
- **不大规模 UI 改版**。
- **不上 LLM judge**。
- **不引入**复杂多 agent 编排或云端 rerank 服务。
- **不切换** GraphRAG / 新主架构。

---

## 3. 第一轮工作包（B1–B5）

### B1：Query-type routing / intent buckets

| 字段 | 内容 |
|------|------|
| **为什么现在做** | 5.3c 已证明不同 query 需要不同偏置；若无显式类型，后续只能继续堆 `if`。 |
| **改哪些文件类型** | `src/lib/modules/retrieve/queryIntent.ts`（或并列小模块）、`retrievalPipeline.ts` 入口、可选 `docs/` 策略表。 |
| **产出** | 枚举或常量：`procedural_full_flow` / `compile_order` / `definition` / `troubleshooting` / `default` 等（**宁少勿滥**）；pipeline 仅**读**类型并传入 bias 层。 |
| **如何验证** | 单元测试：输入问题字符串 → 期望类型；日志或 debug payload 带 `queryType`。 |
| **风险** | 类型互斥导致边界 query 错分 → 默认走保守 `default`，并文档列出「误判时改关键词表而非 answer」。 |

### B2：Source prior / manual-family routing

| 字段 | 内容 |
|------|------|
| **为什么现在做** | 5.3b/5.3c 的核心失败是**分册抢占**；prior 必须可审、可测。 |
| **改哪些文件类型** | `src/lib/modules/retrieve/sprint53cBias.ts` 或新建 `sourcePrior.ts`；配置可考虑 JSON 常量同目录。 |
| **产出** | 表：`pattern → fileName 子串/正则 → delta`；与 B1 的 query 类型**组合**使用（避免全局加分）。 |
| **如何验证** | 单测：给定 `SearchResult[]` + question，期望某手册 id 相对排序变化；真实 PDF 脚本 `scripts/sprint53cRealpdfEval.ts` 作回归（环境允许时）。 |
| **风险** | prior 过强误伤单册库 → prior 仅在 `documents.length > 1` 或检测到多卷前缀时启用（实现时二选一并文档化）。 |

### B3：Metadata / sectionTitle / section role bias

| 字段 | 内容 |
|------|------|
| **为什么现在做** | 真实手册「## 标题」进 `sectionTitle`、正文不含关键词时，纯 `text` 匹配会漏（5.3c 注入已侧面证明）。 |
| **改哪些文件类型** | `searchChunks` 或构造 lexical haystack 处、`SearchResult` 组装处；与 `chunkText` 输出字段对齐。 |
| **产出** | 统一函数 `retrievalHaystack(chunk)` = `title + path + text`（命名以代码为准）；全文检索/打分**一处**使用。 |
| **如何验证** | 单测：mock chunk 仅 title 含关键词、text 不含 → 仍参与匹配或得分合理。 |
| **风险** | title 噪声过大 → 对 title 匹配加权**低于**正文或仅用于 tie-break（实现时选一种并记录）。 |

### B4：Chunk boundary / table-sensitive splitting

| 字段 | 内容 |
|------|------|
| **为什么现在做** | Q8 类与长列表在 PDF 上被切碎后，即使用 prior 也难救；第一轮只做**最小**规则。 |
| **改哪些文件类型** | `src/lib/modules/chunk/chunkText.ts`（及测试 `chunkText.test.ts`）；避免动 `parsePdf` 除非必要。 |
| **产出** | 1～2 条可测规则（例如：表格行密度高时不强行在行间切断；或参数名行与下一行粘合阈值）；**配套** 1 个 fixture 或真实片段截图转文本的单元测试。 |
| **如何验证** | `vitest` + before/after chunk 列表长度与关键子串是否落在同一 chunk。 |
| **风险** | chunk 过大拖慢 embed → 设硬上限 + 二次切分策略写进注释。 |

### B5：术语归一与参数表达标准化

| 字段 | 内容 |
|------|------|
| **为什么现在做** | 5.3c 已在 parse 侧做 TRUE/FALSE；第一轮把**范围与调用点**写清，避免重复归一或漏网。 |
| **改哪些文件类型** | `src/lib/modules/parse/pdfTextNormalize.ts`、`parseDocument.ts`；索引前是否统一走同一函数。 |
| **产出** | 归一词表（代码内常量 + 注释）；`pdfTextNormalize.test.ts` 增量用例。 |
| **如何验证** | 单测覆盖全角/大小写变体；可选对 Q8 类 benchmark 跑一次 `npm run eval:rag`（若 fixture 覆盖）。 |
| **风险** | 归一过度改变语义 → 仅对**白名单** token 归一，禁止泛用 NFKC 全文。 |

**建议实施顺序**：**B3 → B1 → B2 → B5 → B4**（先统一 haystack，再挂类型与 prior，再扩归一，最后动切分——减少连锁 diff）。

---

## 4. 验收方案

### 用什么题集验证

| 层级 | 题集 | 用途 |
|------|------|------|
| **必跑** | 合成 `benchmarks/benchmark.v1.json` + `npm run eval:rag` | 防全局退化。 |
| **高优先** | `scripts/sprint53cRealpdfEval.ts`（需 `PKRAG_REALPDF_DIR`） | 与 5.3c 对齐：Q1 主分册、Q8、Q9/Q11 不谨慎壳；**不**要求重跑 5.3b 全量。 |
| **可选** | P0-A 建立后的 `evals/results/real-regression-*` | 第一轮 P0-B 合并前至少跑一次若已有题。 |

### 高优先样本（人工 + 规则一起看）

- **Q1 类**：全流程主链，主 citation **不得**为已知噪声分册（如图形编辑独占头条）。
- **Q8 类**：参数定义 + TRUE/FALSE 可对仗出现（规则或人工 checklist）。
- **Q6 follow-up**（若本轮顺手修）：`docs/evals/sprint-5.3-q6-followup.md` 范围，**不**强制第一轮闭环。

### 什么算「改善」

- 真实 PDF 脚本中：Q1 主链文件与 section 与上一轮 baseline **一致或更好**；无新增 cautious 壳退化。
- 合成 eval：**无**未解释的 recall/answer 模式回退（允许单独列出「预期变化」的 case）。

### 什么算「无效 / 需回滚」

- 为抬某一题导致 **多题** 主 citation 文档类型漂移且无解释。
- 引入无法从 `queryType` / prior 表说明的硬编码文件名（除迁移期短暂兼容外）。
- chunk 改动导致 **平均 chunk 大小** 暴涨且 embed 超时无开关。

---

## 5. 文档与代码索引（开工时对照）

| 区域 | 路径 |
|------|------|
| 管道入口 | `src/lib/modules/retrieve/retrievalPipeline.ts` |
| 全流程 bias / 注入 | `src/lib/modules/retrieve/fullWorkflowBias.ts` |
| 分册偏置 | `src/lib/modules/retrieve/sprint53cBias.ts` |
| 检索核心 | `src/lib/modules/retrieve/searchIndex.ts` |
| 切分 | `src/lib/modules/chunk/chunkText.ts` |
| 归一 | `src/lib/modules/parse/pdfTextNormalize.ts` |

本轮结束后应新增或更新：**`docs/RETRIEVAL_GOVERNANCE.md`**（或等价节）简述 B1–B5 与表格——可在最后一 PR 附交。
