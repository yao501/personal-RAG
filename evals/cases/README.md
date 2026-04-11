# 真实问题回归（P0-A 占位）

本目录用于 **从真实库提炼、脱敏后的固定问句** 做人工/脚本回归；与 `benchmarks/benchmark.v1.json` 的 fixture smoke 互补。题量由 [`docs/P0-A_REAL_QUERY_EXPANSION_PLAN.md`](../../docs/P0-A_REAL_QUERY_EXPANSION_PLAN.md) 约束，**首轮仅结构占位，不扩题**。

## `fail_stage` 归因（人工标注用）

| Stage | 含义 | 典型信号 |
|-------|------|----------|
| `retrieval` | 向量/候选集合未召回相关块 | top-k 无目标文档或段落 |
| `ranking` | 召回到了但 lexical/重排顺序不对 | 目标块在候选中但排名靠后 |
| `chunk` | 分块切分导致证据断裂 | 同一段被切碎或标题与正文分离 |
| `parse_normalize` | 解析或规范化丢字/乱序 | 表格、编码、PDF 结构异常 |
| `answer` | 检索足够但答案组装失败 | 漏引、过度概括、与证据不符 |
| `rule_check` | 规则/模板门控误杀或误放 | refusal、cautious、coverage 等启发式 |

## 占位案例（勿批量添加）

| id | rationale | owner | data_path |
|----|-------------|-------|-----------|
| `p0a-placeholder-001` | 占位：待从 query log / 支持工单提炼 | TBD | `TBD`（脱敏导出路径） |
| `p0a-placeholder-002` | 占位：待与 P0-B 检索变更对照 | TBD | `TBD` |
