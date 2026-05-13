# P0-A / Q6 Round 1 — 真实题最小闭环计划（仅 Q6 同类）

## 范围与约束（必须遵守）

- **本轮只做**：Q6 同类（编译/下装顺序 + 控制器侧 vs 工程总控/站侧边界）。
- **本轮只补**：**2～3 题**（互相有区分度，不做同义句堆叠）。
- **不做**：扩成大 benchmark、不引入 LLM judge、不重开 5.3 系列实验、不新增 P0-B 检索/排序规则、不重写 answer 主干、不把 Q1/Q8 拉回主线。

## 1) 为什么 Q6 是当前最优先真实题型

依据 `docs/evals/sprint-5.3-q6-followup.md` 与 5.3c 真实 PDF 抽样：

- **Q8 已 pass**、**Q1 已 pass**，P0-B 已阶段性收口（至少 Q8 线可收）。
- 真实 PDF 侧当前最明确、可复现的剩余短板是 **Q6 partial**：需要同时体现 **控制器侧** 与 **工程总控/站侧** 的顺序与边界，但当前更容易只命中“工程总控 FAQ（先编译后下装）”。
- 因此 P0-A Round 1 的最佳 ROI 是：把 Q6 同类真实问法做成**可跑、可归因、可回归**的小闭环，避免后续改动“看不见伤”。

## 2) 本轮要补哪 2～3 类 Q6 变体

每题必须与其它题有区分度（问法与期望点均不同），建议选：

1. **编译与下装顺序（双侧）**：明确要求回答“控制器侧先、站侧后”。
2. **只问控制器侧先做什么（边界）**：强制检索/回答覆盖控制器侧要点，而非泛泛“先编译后下装”。
3. **两阶段顺序 + 易混提醒**：强调不要混淆“控制器算法工程”与“工程总控工程/站侧工程”。

## 3) 每题进入回归集的准入条件（Round 1）

每条 case 至少包含：

- `id`（稳定、可引用）
- `question`
- `rationale`
- `owner`
- `source_section_hint`（来自真实手册的章节线索，用于人工复核/定位）
- `expected_shape`（关键点，不写最终答案全文）
- `fail_stage`（本轮初始归因；runner 产物会给出建议归因）

## 4) fail_stage 定义（本轮落地版本）

沿用 `docs/P0-A_REAL_QUERY_EXPANSION_PLAN.md` 的主因标签，Round 1 用法（主因唯一）：

- `retrieval`：top-k 内没有出现目标分册（例如工程总控）或完全无关。
- `ranking`：目标分册出现了但排序靠后，导致主证据/主引用偏离。
- `chunk`：关键要点（控制器侧 vs 站侧）被切碎导致无法在单段证据中覆盖（本轮先记录，不做 B4/B5/P0-B 规则扩展）。
- `parse_normalize`：PDF 抽取文本缺失/乱序导致关键短语无法命中（本轮先记录，不做 parse 栈大改）。
- `answer`：检索证据已覆盖，但 direct/model 未体现关键点或顺序边界。
- `rule_check`：gold/checklist 与可接受答案形态争议（需要人工裁断）。

## 5) 验收方式（最小闭环）

本轮验收只要求“能跑通 + 可读 summary + 可归因”，不追求大而全：

- **能跑通**：`PKRAG_REALPDF_DIR` 指向多卷真实 PDF 目录后，可运行 `scripts/runRealRegressionQ6Round1.ts`。
- **产物齐全**：
  - `evals/raw/real-regression-<YYYY-MM-DD>-<seq>.raw.json`
  - `evals/results/real-regression-run-<YYYY-MM-DD>-<seq>.json`
  - `evals/results/real-regression-summary-<YYYY-MM-DD>-<seq>.md`
- **summary 内容**：每题一行 `id | verdict | fail_stage | one_line_note`，并列出 top citations 文件名与 missed key points。
