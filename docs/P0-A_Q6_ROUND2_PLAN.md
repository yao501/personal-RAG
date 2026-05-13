# P0-A / Q6 Round 2 — 控制器侧强约束问法（仅 answer-level 缺口）

## 范围与约束（必须遵守）

- **只针对**：Q6 Round 1 暴露出的 **answer-level 缺口**（控制器侧表述缺失 / 两阶段边界易混 / 易混提醒缺失）。
- **本轮只补**：**2～3 个**“更强约束”的 Q6 同类问法（不是 Round 1 同义改写）。
- **不做**：扩成大 benchmark；不重开 5.3；不继续优化 Q8；不新增 retrieval/ranking/chunk/parse 规则；不重写 `answerQuestion` 主干（只做回归资产与 runner）。

## 1) 为什么 Q6 Round 2 现在比 P0-C 更优先

- Q6 是目前真实 PDF 侧**唯一明确残留短板**，且 Round 1 的 3 个 case **全部 partial**，信号非常集中。
- Round 1 的 `fail_stage` 已稳定落在 **`answer`**：说明“工程总控 FAQ（先编译后下装）”能被命中，但答案缺失 **控制器侧**与**两阶段边界**，属于交付风险（用户会据此做错顺序/混淆对象）。
- 因此在不动检索规则的前提下，先把“缺口钉死”为更强约束问法与更苛刻 `expected_shape`，更符合 P0-A 的目标：**让风险可回归、可持续监控**。

## 2) 本轮要测的不是“能不能命中工程总控”，而是 answer 是否满足三项强约束

Round 2 的新增 case 必须显式约束并检查：

1. **是否明确回答“控制器侧先做什么”**
2. **是否明确区分“控制器算法工程”与“工程总控工程/站侧工程”**
3. **是否给出“先编译再下装”的顺序表达**（并且不出现“先下装后编译”这类反向错误）

## 3) 新增 case 的准入标准（Round 2）

每条 case 至少包含：

- `id`
- `question`（必须是强约束问法，包含“只看控制器侧/先讲控制器侧/不要混淆”之一）
- `rationale`
- `owner`
- `source_section_hint`
- `expected_shape`（Round 2 必须更严格：对“控制器侧/算法工程/工程总控工程/顺序”至少 2～3 个点做 hard checks）
- `fail_stage`（初始可标 `answer`；runner 仍会给出粗归因）

## 4) fail_stage 定义（仍沿用 Round 1）

本轮仍使用统一主因标签（见 `docs/P0-A_REAL_QUERY_EXPANSION_PLAN.md` 与 `docs/P0-A_Q6_ROUND1_PLAN.md`）：

- `retrieval` / `ranking` / `chunk` / `parse_normalize` / `answer` / `rule_check`

Round 2 的设计目标是：即使检索命中工程总控 FAQ，也要通过强约束把缺口明确归为 **`answer`**（而不是“看起来 pass”）。

## 5) 验收方式（最小闭环）

- **runner 复用成功**：在不推翻 Round 1 的前提下，runner 支持选择 `q6-round2.json` 并跑通。
- **产物齐全**：照旧生成 `evals/raw/`、`evals/results/` 与 summary。
- **对比价值**：Round 2 的 summary 能比 Round 1 更稳定暴露“控制器侧 + 两阶段边界 + 顺序表达”的缺口（即：更少依赖运气，更少被泛化回答蒙混过关）。
