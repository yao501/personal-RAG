# P0-A：真实问题回归 — 最小闭环计划

**目的**：在**不大扩**题集的前提下，建立「加题 → 跑 → summary → 归因」的**固定习惯**，与 P0-B 并行。  
**本文不新增具体题目**，只定义规则与命名。

---

## 1. 下一轮只补多少题

- **下一批（首个闭环）**：**2～3 题**。
- **之后每批**：**2～4 题**，由 PR assignee 与 reviewer 共同确认。
- **硬上限**：未经过「扩集评审」时，主回归集 **≤20 题**（含从 5.3c 脚本迁移过来的等价题）。

---

## 2. 优先从哪些真实问题类型选

与 `docs/NEXT_PHASE_EXECUTION_PLAN.md` 一致，首轮优先：

1. **跨分册全流程 / 主链**（安装→组态→编译→下装→运行 或厂商等价表述）。
2. **顺序与阶段边界**（控制器侧 vs 工程总控/站侧；与 Q6 follow-up 同族）。
3. **定义 + 约束**（参数对齐、布尔项、表格项；与 Q8 同族）。

**选题来源**：内部手册、已脱敏客户问题、支持工单模板（**禁止**未经脱敏的用户原文入库）。

---

## 3. 进入回归集的准入标准

每题必须满足：

| 字段 | 要求 |
|------|------|
| **id** | 稳定 snake_case，如 `real-q-001-compile-order-v1`。 |
| **rationale** | 1～3 句话：代表哪类用户场景、历史上哪类失败。 |
| **gold 或 checklist** | Markdown 或 JSON 字段：`must_contain[]`、`must_cite_family[]`、`fail_modes[]` 等，**与 5.3 gold 风格一致即可**，不强制同一 schema。 |
| **owner** | GitHub handle 或姓名。 |
| **last_verified** | 通过时的 commit SHA（首录可为空，合并前必填）。 |
| **data_path** | 固定语料位置：多卷 PDF 目录 env 或 `benchmarks/fixtures/` 内脱敏 md（二选一，写清）。 |

不满足任一项 → **不得合并进主集**。

---

## 4. Run / summary 文件命名规范

| 产物 | 路径与模式 |
|------|------------|
| 原始 JSON | `evals/raw/real-regression-<YYYY-MM-DD>-<seq>.raw.json` |
| 结果 JSON | `evals/results/real-regression-run-<YYYY-MM-DD>-<seq>.json` |
| Summary | `evals/results/real-regression-summary-<YYYY-MM-DD>-<seq>.md` |

`<seq>`：当日从 `001` 递增。同一 PR 可固定一次 run，在 summary 里引用 commit。

---

## 5. 失败归因标签（统一）

每条失败必须标**一个主因**（可多标次因，但主因唯一）：

| `fail_stage` | 含义 |
|--------------|------|
| `retrieval` | top-k 文档/块错、分册错、无关噪声。 |
| `ranking` | 相关块在池中但排序靠后。 |
| `chunk` | 证据被切断、标题与正文分离导致不可检索。 |
| `parse_normalize` | PDF 文本/术语归一问题。 |
| `answer` | direct 模板、门控、串题。 |
| `rule_check` | 自动化规则与人工 gold 争议（需在 summary 记「待人工裁断」）。 |

Summary 中每题一行：`id | verdict | fail_stage | one_line_note`。

---

## 6. 与现有工具的关系

- **合成**：继续 `npm run eval:rag` / `docs/EVAL_GUIDE.md`。
- **多卷真实 PDF**：在统一脚本中支持 `PKRAG_REALPDF_DIR`（模式参考 `scripts/sprint53cRealpdfEval.ts`）；P0-A 正式脚本命名建议 **`scripts/realRegressionEval.ts`**（首 PR 创建）。
- **文档入口**：在 `docs/EVAL_GUIDE.md` 增加「Real regression」小节链到本文。

---

## 7. 最小闭环检查表（复制到 PR 描述）

- [ ] 新增 ≤4 题，且均有 rationale + owner  
- [ ] 已跑 `eval:rag`（若 touching 合成）或真实回归脚本  
- [ ] 已写 `evals/results/real-regression-summary-*.md`  
- [ ] 无失败或失败均已 `fail_stage` 标注  
