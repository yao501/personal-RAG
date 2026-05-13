# C线：技术债与已知限制

> 创建日期：2026-05-12
> 基于 B线全卷覆盖评测 Round 1（均分 0.45）暴露的问题

---

## 1. 嵌入模型限制

**现状**: 使用 `Xenova/all-MiniLM-L6-v2`（384维，英文优化）

**问题**:
- 对中文工程术语语义匹配弱，导致手册7功能块术语检索大面积失败
- 示例：ADD/SUB/MUL/DIV、PVU/PVL、SWITCH/ORSEL/MULDIV 等术语嵌入检索失效
- 手册7 均分仅 0.33（6题中 3 fail / 2 partial / 1 pass）

**计划**: 升级到 `Xenova/bge-small-zh-v1.5`（512维，中文优化 BAAI）
- 状态：代码已切换（`src/lib/modules/embed/localEmbedder.ts`），模型文件下载中
- 注意：维度变化（384→512），存量 embedding 数据需重建

---

## 2. PDF 解析 — 章节归属与表格污染

**现状**: PDF 解析器 `parseDocument.ts` 和 chunker `chunkText.ts` 存在以下缺陷：

### 2.1 表格参数行误判为章节（chunkText.ts `isPlainHeading`）
- 功能块参数表的列值（如 `"10 强制"` `"0 否 否 是 否"`）被当作文本标题
- 导致 sectionPath 被表格数据污染，检索时语义漂移
- **已修复（2026-05-12）**: 增加表格行识别规则，排除"是/否/TRUE/FALSE"和"数字+中文词"短行

### 2.2 噪音章节污染 sectionPath（chunkText.ts `buildUnits`）
- 每个手册的"关于本文档/文档用途/阅读对象/版权声明"等 boilerplate 被保留
- 这些章节下的内容继承无效 sectionPath
- **已修复（2026-05-12）**: 增加 `NOISE_HEADING_KEYWORDS` 过滤，跳过无意义章节

### 2.3 sectionPath 层级混乱
- 手册6（现场操作）: 有些 sectionPath 包含 `"10 CNETB 控制网B 黄 亮 亮"` 等硬件面板标签
- 手册4（算法组态）: 仿真内容可能挂在错误的父章节下
- 根因：PDF 中表格内的文本被解析为独立块，未保持章节上下文

### 2.4 PDF 文本抽取质量
- `pdf-parse` 库对中文 PDF 抽取存在 TT undefined function 警告
- 部分表格数据以碎片化文本出现，缺少结构信息
- 无 TOC ghost text 问题（当前正则过滤有效）

---

## 3. 语料规模与 OOM

**现状**:
- 全 7 卷：~7000+ chunks，嵌入+检索内存用量 > 4GB
- B线评测被迫分两组运行（手册5 + 手册7），无法全量加载

**优化方向**:
- 冗余章节去重（各手册的"关于本文档"等）
- 表格数据压缩（当前功能块参数表产生大量碎片 chunk）
- 考虑增量加载策略

---

## 4. OpenAI/CCCX API 接入

**状态**: ❌ 遗留，详见 MEMORY.md

---

## 5. 评测框架限制

- Judge 逻辑基于关键词匹配，存在误判（如 M5-3 命中了所有关键词但缺少场景区分描述）
- 嵌入模型维度变更后，存量评测的 embedding 缓存失效
- Chunk 加载对单个问题重加载全量语料（低效），应支持缓存

---

## 修复记录

| 日期 | 修复项 | 文件 | 状态 |
|------|--------|------|------|
| 2026-05-12 | 嵌入模型切换 | `localEmbedder.ts` | 代码已改，模型下载中 |
| 2026-05-12 | 表格行过滤 | `chunkText.ts` `isPlainHeading` | 已部署 |
| 2026-05-12 | 噪音章节过滤 | `chunkText.ts` `buildUnits` | 已部署 |
