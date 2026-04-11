# 下一阶段执行计划（后 5.3）

**状态**：Sprint 5.3 已关闭；主线已切换至 **P0-A / P0-B / P0-C**（见 `docs/PRODUCT_RAG_ROADMAP_V1.md`）。本文档把三者为**可执行工作包**，不重复 5.3 结论。

**详细子计划**：

- P0-B 第一轮：`docs/P0-B_RETRIEVAL_GOVERNANCE_PLAN.md`
- P0-A 最小闭环：`docs/P0-A_REAL_QUERY_EXPANSION_PLAN.md`
- 立即行动 Top3：`docs/NEXT_ACTIONS_TOP3.md`

---

## P0-A：真实问题回归扩展

### 目标

- 每轮只增加**少量**高价值真实/半真实问题（经产品或支持确认）。
- **不大扩** benchmark；保持固定跑法、固定失败归因维度、固定 summary 产物形态。

### 优先扩的三类题（首轮方向）

1. **跨分册主链 / 全流程**（与 5.3b 消融 Q1、5.3c 真实 Q1 同源风险）。
2. **顺序 / 阶段边界**（编译—下装—控制器 vs 工程总控；与 Q6 follow-up 同源，见 `docs/evals/sprint-5.3-q6-followup.md`）。
3. **定义 + 约束项**（参数、TRUE/FALSE、表格项；与 5.3c Q8 类问题同源）。

### 每轮建议增量

- **2～4 题/轮**；上限由 PR reviewer 与 `docs/P0-A_REAL_QUERY_EXPANSION_PLAN.md` 中的准入表共同约束。
- 任意连续 4 周内新增题数建议 **≤10**，除非单独开「扩集评审」。

### 目录与资产放置

| 资产类型 | 建议路径 |
|----------|----------|
| Gold / checklist（Markdown） | `docs/evals/` 下独立文件，如 `docs/evals/real-query-regression-gold-v1.md`（首建时命名） |
| 可版本化的 case 列表（JSON/YAML） | `evals/cases/` 或 `evals/real-regression/`（首建目录时写 README） |
| 跑分脚本 | `scripts/` 前缀，与现有 `sprint53cRealpdfEval.ts` 模式一致，或抽公共 `runRealRegression.ts` |
| 单次运行原始 JSON | `evals/raw/` |
| 人类可读 summary | `evals/results/` |

### 结果文件命名规范

- JSON：`evals/results/real-regression-run-<YYYY-MM-DD>-<seq>.json`（seq 为当日序号 `001` 起）。
- Summary：`evals/results/real-regression-summary-<YYYY-MM-DD>-<seq>.md`
- 与某次代码变更强绑定可加 git short hash：`...-<seq>-<githash>.md`（可选）。

### 防止回归集失控

- **准入门槛**：每题必须带 `rationale`（为何进集）、`owner`、`last_verified_commit`（见 P0-A 专文）。
- **冻结集**：`frozen-set-vN` 标签；改检索管道的大 PR 必须跑**冻结集**全绿或列出豁免与原因。
- **定期剔除**：连续两个版本「永远 pass 且无信息量」的题可移到 `archive/`，不占主集额度。

### P0-A：目标 / 非目标 / 产出 / 验收（摘要）

| 维度 | 内容 |
|------|------|
| **目标** | 可重复的一键跑 + 可分类的失败报告。 |
| **非目标** | 不上 LLM judge；不扩成大规模竞赛集。 |
| **建议产出** | 目录、`EVAL_GUIDE` 增补一节、首版 2～4 题。 |
| **验收** | CI 或 `npm run` 一条命令；失败带 `fail_stage`: `retrieval` \| `answer` \| `rule_check`。 |

---

## P0-B：retrieval / ranking 治理（主线中的主线）

**依据（不展开 5.3 全文）**：合成消融在关 inject 时 **Q1 退化**；真实 PDF 上曾出现**误分册、chunk 与 sectionTitle 分离、术语字面不稳**——说明系统瓶颈在 **检索与排序的可治理性**，而非再堆零散 magic number。

### 治理面拆分（五个）

| 治理面 | 目标 | 非目标 | 建议产出 | 验收方式 |
|--------|------|--------|----------|----------|
| **Query type** | 全流程 / 定义 / 顺序 / 故障等意图有**显式**分支或表驱动入口，便于 code review。 | 不做通用 NLU 大模型分类器。 | `queryIntent` 扩展或并列模块 + 文档表。 | 每类至少 1 个固定用例；日志可打印 `queryType`。 |
| **Source / 分册 prior** | 多卷手册下**文件名/分册族**与 query 模式的映射可配置、可测试。 | 不做全库手工标注。 | 配置或常量表 + 单测；与 `sprint53cBias` 类逻辑对齐或收拢。 | 全流程用例主 citation 不落在已知噪声分册。 |
| **Metadata bias** | `sectionTitle` / `sectionPath` 参与**与文本一致的**打分，避免标题只在 chunk 外。 | 不引入重 RDF 本体。 | 检索层统一 `haystack()` 构造。 | 标题在正文外的 case 检索仍命中。 |
| **Chunk 边界** | 表格、小节、参数块**尽量少切断**；必要时合并策略有文档。 | 不重写整个 PDF 解析栈。 | `chunkText` 规则或小范围 merge 钩子 + 用例。 | 固定 PDF 片段上 before/after token 覆盖对比。 |
| **术语归一** | TRUE/FALSE、全角、常见参数名变体在**索引前**一致化。 | 不做完美 OCR。 | `parse` 层归一 + 测试。 | Q8 类规则或人工 spot check 改善。 |

**第一轮落地顺序**：见 `docs/P0-B_RETRIEVAL_GOVERNANCE_PLAN.md`（B1→B5）。

---

## P0-C：macOS 发布级交付收口

### 交付工程视角（非愿景）

以 **`docs/RELEASE.md`** 为真源增量维护，目标是最小可重复闭环，**不追求首轮全自动**。

### 必须覆盖的条目

| 条目 | 最小闭环含义 |
|------|----------------|
| **Code signing** | 明确证书类型、entitlements、`electron-builder`（或等价）配置入口、本地一次成功构建。 |
| **Notarization** | Apple notarytool 流程、常见拒绝原因、日志保留位置。 |
| **Stapling** | 分发前 staple 步骤与验证命令。 |
| **安装 / 升级 / 回滚** | 用户可执行路径：首装、覆盖安装、降级或删库重装（与数据目录约定一致）。 |
| **Release 产物版本化** | `CFBundleShortVersionString` / `CFBundleVersion` 与 git tag、CHANGELOG 对齐规则。 |
| **可重复 release / CI** | 至少：文档化 manual checklist + 可选 CI job 上传 artifact；另一人可按文档复现核心 5 步。 |

### P0-C：目标 / 非目标 / 产出 / 验收（摘要）

| 维度 | 内容 |
|------|------|
| **目标** | 团队内一人能带新人按文档跑通「构建→签名→公证→staple→验证」。 |
| **非目标** | 首轮不上多环境 matrix；不做自动上架 Mac App Store。 |
| **建议产出** | 更新 `docs/RELEASE.md`、必要时 `docs/MIGRATION.md` 中与升级相关的 1 节。 |
| **验收** | staging 证书下端到端一次 + PR 或邮件记录 artifact 校验和。 |

---

## 与路线图的关系

- 总览：`docs/PRODUCT_RAG_ROADMAP_V1.md`
- 5.3 收口（只读，不改）：`docs/evals/sprint-5.3-closeout.md`
