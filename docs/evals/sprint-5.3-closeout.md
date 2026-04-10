# Sprint 5.3 收尾说明

本文档对 Sprint 5.3（含 5.3a / 5.3b / 5.3c）做阶段收口，结论与数字均来自仓库内已有评测摘要与结果文件，不新增实验目标。

---

## 1. Sprint 5.3 的原始目标

在 **不扩 benchmark、不改 gold 规范、不上 LLM judge** 的前提下，把 **Sprint 5.3 合成评测语料**上的回答质量与检索收敛做实，并验证 **同一套 answer / gating / snippet 逻辑**能否迁移到 **真实多卷 PDF**（和利时 HOLLiAS MACS V6.5 用户手册），使 **全流程主链（Q1）、参数对齐与布尔（Q8）** 等关键题在真实文档上可复现，而非仅在合成语料上通过。

---

## 2. 各子阶段完成内容

### 5.3a（回答与检索最小收敛）

- 在 `sprint-5.3-run-002` 上相对 `run-001`：**12/12 pass、0 partial**（加权均分 1.0）。
- 曾 partial 的 **Q1、Q6、Q8、Q9、Q11** 在合成语料上均达到 **pass**（见 `evals/results/sprint-5.3-summary-002.md`）。
- 手段概括：direct answer 规则与过程类结构化、谨慎门控、snippet/句子切分、检索偏置与 **candidate 补块**（`injectSprint53aCandidateChunks`）。

### 5.3b（泛化、消融与真实 PDF 摸底）

- **Paraphrase**：**18/18 pass**（验收 ≥15），说明变体问法下仍能支撑 gold 要点（见 `evals/results/sprint-5.3b-overall-summary-001.md`）。
- **Ablation（合成）**  
  - **A_full_5.3a**：**12/12 pass**  
  - **B_no_inject**：**11/12 pass**（A→B 退化题：**Q1**）  
  - **C_no_inject_no_bias**：**11/12 pass**（见 `evals/results/sprint-5.3b-ablation-summary-001.md`）  
  结论：关闭补块后 **Q1** 对检索更敏感；**Q6** 在 B 组曾出现 direct 与 gold 不一致、规则假阳性风险，需在真实 PDF 上继续核对。
- **真实 PDF（7 卷、7274 chunks）**：规则抽检 **3/6 pass**（目标 ≥4/6 **未满足**）。主要短板：**Q1** 误命中图形编辑分册；**Q8** 与 TRUE/FALSE 字面规则在 PDF 文本上未对齐；**Q9 / Q11** 未出现「概述性」谨慎壳。

### 5.3c（真实多卷 PDF 检索 / 排序与术语归一）

- 分册路由与全流程偏置、手册5 噪声重罚、手册7 参数对齐加分；PDF 术语归一（TRUE/FALSE 等）；**手册1「软件使用步骤」按相邻 chunk 合并后注入**；参数对齐块注入；答案层对全流程问法的小幅防误触（见 `evals/results/sprint-5.3c-realpdf-summary-001.md`）。
- **真实 PDF 抽样**：**5/6 pass，1/6 partial**（验收 ≥4 pass **满足**）。

---

## 3. 关键验收结果汇总

| 类别 | 结果 | 依据文件 |
|------|------|----------|
| **Synthetic（run-002 + 5.3a）** | **12/12 pass**，0 partial | `sprint-5.3-summary-002.md` |
| **Paraphrase** | **18/18 pass** | `sprint-5.3b-overall-summary-001.md` |
| **Ablation（合成）** | A **12/12**；B **11/12**；C **11/12** | `sprint-5.3b-ablation-summary-001.md` |
| **Real PDF（5.3c 抽样）** | **5/6 pass**，Q6 **partial** | `sprint-5.3c-realpdf-summary-001.md` |

---

## 4. 结论：**Sprint 5.3 正式关闭**

**Sprint 5.3 可以正式关闭。**

---

## 5. 关闭依据（与阶段目标对齐）

1. **真实 PDF 抽样达到 5/6 pass**（高于 5.3b 阶段未满足的 ≥4/6 目标，见 `sprint-5.3c-realpdf-summary-001.md`）。
2. **Q1**：从 5.3b 误命中 **手册5《图形编辑》**，修复为 **手册1《软件安装》** 主链（**「2.4 软件使用步骤」**），verdict **pass**（见 `sprint-5.3c-overall-summary-001.md`）。
3. **Q8**：从 5.3b **fail** 提升到 **pass**（`sprint-5.3c-realpdf-summary-001.md`）。
4. **Q9 / Q11**：真实 PDF 侧 **cautious_shell：否**，未出现概述性谨慎壳退化（同上）。

---

## 6. 剩余问题与 follow-up

- **Q6（编译与下装顺序）** 在真实 PDF 上仍为 **partial**：规则期望同时体现 **控制器侧** 与 **工程总控/站侧**，当前命中与表述仍以工程总控 FAQ 为主。  
- **不阻塞 Sprint 5.3 关闭**：整体抽样已达标，Q6 作为 **小修补遗** 单独跟踪（见 `docs/evals/sprint-5.3-q6-followup.md`）。

---

## 7. 引用与归档

- 合成与 5.3a：`evals/results/sprint-5.3-summary-002.md`，`evals/results/sprint-5.3-run-002.json`  
- 5.3b 总览：`evals/results/sprint-5.3b-overall-summary-001.md`  
- 5.3c 真实 PDF：`evals/results/sprint-5.3c-realpdf-summary-001.md`，`evals/results/sprint-5.3c-overall-summary-001.md`  
- 短归档：`evals/results/sprint-5.3-closeout-summary-001.md`
