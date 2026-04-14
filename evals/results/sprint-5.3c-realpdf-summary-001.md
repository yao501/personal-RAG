# Sprint 5.3c 真实 PDF 抽样

- **目录**：`/Users/guangyaosun/Desktop/和利时DCS操作手册`
- **分册数**：7，**合并 chunk**：7260
- **规则抽检**：pass **5**/6，partial **1**/6（验收 ≥4 pass：**满足**）

## Q1 / Q8 是否改善（相对 5.3b）

| 题 | 5.3c 主 citation | verdict |
|----|------------------|---------|
| Q1 | HOLLiAS_MACS_V6.5用户手册1_软件安装.pdf | **pass** |
| Q8 | HOLLiAS_MACS_V6.5用户手册7_功能块.pdf | **pass** |

## 谨慎壳（Q9/Q11）

- 任一问 **cautious_shell**：否

## Part A/B/C 改动摘要

| 项 | 内容 |
|----|------|
| A | 分册路由：安装/流程→手册1/2；编译域间分组→手册3；参数对齐/功能块→手册7 |
| B | 全流程 query：提升顺序链与手册1/2；压低手册5 海康/视频噪声块 |
| C | `cleanPdfText` 末尾 `normalizePdfTechnicalTokens`（TRUE/FALSE 归一） |

---
生成时间：2026-04-14T09:14:31.413Z
