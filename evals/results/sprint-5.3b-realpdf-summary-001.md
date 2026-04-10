# Sprint 5.3b 真实文档抽样（HOLLiAS MACS V6.5 用户手册 PDF）

- **来源**（仅用户指定目录）：`/Users/guangyaosun/Desktop/和利时DCS操作手册`
- **已加载 PDF**：`HOLLiAS_MACS_V6.5用户手册1_软件安装.pdf`、`HOLLiAS_MACS_V6.5用户手册2_快速入门.pdf`、`HOLLiAS_MACS_V6.5用户手册3_工程总控.pdf`、`HOLLiAS_MACS_V6.5用户手册4_算法组态.pdf`、`HOLLiAS_MACS_V6.5用户手册5_图形编辑.pdf`、`HOLLiAS_MACS_V6.5用户手册6_现场操作.pdf`、`HOLLiAS_MACS_V6.5用户手册7_功能块.pdf`
- **合并 chunk 数**：7274
- **规则抽检 pass**：3/6（验收 ≥4/6：未满足）
- **任一问出现「概述性」谨慎壳**：否

## 每题引用到的文件名（citation）

- **Q1**：HOLLiAS_MACS_V6.5用户手册5_图形编辑.pdf
- **Q6**：HOLLiAS_MACS_V6.5用户手册3_工程总控.pdf
- **Q9**：HOLLiAS_MACS_V6.5用户手册3_工程总控.pdf
- **Q11**：HOLLiAS_MACS_V6.5用户手册1_软件安装.pdf
- **Q8**：无
- **Q10**：HOLLiAS_MACS_V6.5用户手册3_工程总控.pdf

## 与 synthetic 相比的新问题（归类）

- 真实 PDF 排版与 OCR 分词与 synthetic 不同，lexical/向量排序可能偏移；inject 子串仅在 synthetic 命中，真实语料上补块通常不生效。
- 多文档合并后 chunk 边界跨页，可能出现 citation 片段与人工阅读位置不一致。

## 新问题类型（检索 / chunk / citation / answer）

| 类型 | 说明 |
|------|------|
| retrieval | 多卷 PDF 下 top 命中可能落在非最佳分册 |
| chunk | 页断/表格导致语义块切碎 |
| citation | snippet 与段落边界对齐依赖 PDF 解析质量 |
| answer layer | 证据弱时谨慎模板；结构化路径仍依赖命中含步骤/条款的块 |

## 逐题简析（规则抽检 + 人工可读结论）

| 题 | verdict | 主要现象 |
|----|---------|----------|
| Q1 | **fail** | 检索 top 落在 **手册5 图形编辑**（与海康/矢量图控件噪声相关），未命中「安装→…→运行」主链；**非**谨慎壳问题，属 **retrieval + 多卷合并下的排序**。 |
| Q6 | **partial** | 引用 **工程总控** 分册合理；direct 未命中规则里的「控制器侧」字面（可能用语变体），需人工对照原文。 |
| Q9 | **pass** | citation 在 **工程总控**，未出现「资料不足」壳。 |
| Q11 | **pass** | citation 在 **软件安装**，符合预期分册。 |
| Q8 | **fail** | 规则要求 TRUE/FALSE 字面；PDF 可能用不同记号或表格，导致未命中；需 **人工** 对照 **手册7 功能块**。 |
| Q10 | **pass** | 引用工程总控分册，关键词规则通过。 |

## 下一阶段输入（真实短板）

1. **跨分册查询**（如 Q1）：需 **query 路由或分册先验**（安装/快速入门优先），或 **metadata 过滤**，避免图形编辑分册抢占。  
2. **inject 补块**在真实 PDF 上 **不生效**（无 synthetic 子串）；Q1 更依赖 **检索** 而非 answer 模板。  
3. **PDF 解析** 出现 `TT: undefined function` 警告时，可能影响部分页文本质量（见运行日志）。
