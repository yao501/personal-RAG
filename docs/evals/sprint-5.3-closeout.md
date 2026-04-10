# Sprint 5.3 正式收尾说明

本文档对 **Sprint 5.3（5.3a / 5.3b / 5.3c）** 做**阶段正式关闭**陈述。数字与结论均来自仓库内已有摘要，**不追加新的 5.3 主目标**。

---

## Sprint 5.3 已正式关闭

**结论（唯一）：Sprint 5.3 已正式关闭。**

---

## 关闭依据（分阶段、可核对）

### 1）5.3a：合成语料上达到收敛

- **基线**（`evals/results/sprint-5.3-summary-001.md`）：`run-001` 为 **7 pass / 5 partial**，加权均分约 **0.79**。
- **5.3a 后**（`evals/results/sprint-5.3-summary-002.md`）：`run-002` 为 **12/12 pass、0 partial**，加权均分 **1.0**；原 partial 的 **Q1、Q6、Q8、Q9、Q11** 均在**合成 gold** 上达标。

→ **依据**：在既定 benchmark 与 gold 不变的前提下，**answer / gating / snippet / 检索最小补丁**已在 synthetic 上收敛。

### 2）5.3b：完成 paraphrase、消融与真实 PDF 初次定位

- **Paraphrase**：**18/18 pass**（验收 ≥15，见 `evals/results/sprint-5.3b-overall-summary-001.md`）。
- **Ablation（合成）**：A **12/12**；B **11/12**；C **11/12**；A→B 退化题为 **Q1**（见 `evals/results/sprint-5.3b-ablation-summary-001.md`）。结论：**Q1 仍偏 retrieval/ranking**；Q6 在 B 组存在与 gold 不一致及规则假阳性风险说明，需在真实语料上核对。
- **真实 PDF 初次摸底**（同文件）：7 卷、7274 chunks，规则抽检 **3/6 pass**（目标 ≥4/6 **未满足**）；短板集中在 **Q1 误分册**、**Q8 与 TRUE/FALSE 字面**；**Q9 / Q11** 未出现「概述性」谨慎壳。

→ **依据**：5.3b 完成了**泛化验证**、**消融归因**与**真实 PDF 差距定位**，为 5.3c 提供明确输入。

### 3）5.3c：真实 PDF 达到收尾线

- **抽样结果**（`evals/results/sprint-5.3c-realpdf-summary-001.md`）：**5/6 pass，1/6 partial**，满足 **≥4 pass** 的收尾线。
- **Q1**（`evals/results/sprint-5.3c-overall-summary-001.md`）：主 citation 从 5.3b 的**图形编辑分册**修复为 **手册1《软件安装》「2.4 软件使用步骤」**，**pass**。
- **Q8**：相对 5.3b **fail** → **pass**。
- **Q9 / Q11**：**cautious_shell：否**，未退化。

→ **依据**：真实多卷 PDF 上**主链与关键定义题**已按阶段目标收敛到可收尾状态。

---

## 剩余与 follow-up（不阻塞关闭）

- **Q6** 在真实 PDF 上仍为 **partial**（控制器侧 / 工程总控侧表述与命中对齐），单独记入 **`docs/evals/sprint-5.3-q6-followup.md`**，**不阻塞** Sprint 5.3 关闭。

---

## 下一阶段（不在 5.3 范围内）

产品级后续路线见 **`docs/PRODUCT_RAG_ROADMAP_V1.md`**（与本文档同日收口，供工程与 owner 执行）。

---

## 引用索引

| 文件 | 用途 |
|------|------|
| `evals/results/sprint-5.3-summary-001.md` | run-001 基线 |
| `evals/results/sprint-5.3-summary-002.md` | 5.3a synthetic 收敛 |
| `evals/results/sprint-5.3b-overall-summary-001.md` | 5.3b paraphrase / 真实 PDF 摸底 |
| `evals/results/sprint-5.3b-ablation-summary-001.md` | 5.3b 消融数字与 Q1/Q6 说明 |
| `evals/results/sprint-5.3c-realpdf-summary-001.md` | 5.3c 真实 PDF 抽样表 |
| `evals/results/sprint-5.3c-overall-summary-001.md` | 5.3c Q1/Q8 结论与收尾判断 |
| `evals/results/sprint-5.3-closeout-summary-001.md` | 归档短摘要 |
