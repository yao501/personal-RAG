## P0-B / B4 spot check（Q8 同族，真实 PDF）

### 1) 检查对象

- **PDF**：`HOLLiAS_MACS_V6.5用户手册7_功能块.pdf`
- **语义组**：`参数对齐` + `TRUE/FALSE` + `在线值/离线值` + `值比较` + `同步/同步提示`
- **B4 第一规则**：`chunkText.ts` 的 `coalescePdfTermTableWhitespaceForB4`（仅 PDF 路径，空行折叠避免 `\n{2,}` block 切碎）

### 2) 真实片段线索

- 5.3c 真实抽样中 Q8 的 section hints（历史观测）：`1.6 术语`、`6.2.6.2 引脚`、以及表格行标题碎片（如 `0.00 否 否 否 否 ...`）。

### 3) 当前观察（非常窄的 spot check）

使用脚本 `scripts/spotCheckQ8Manual7.ts` 对同一份真实 PDF 做 before/after：

- **before（禁用 B4）**：同一 `parsed.content` 下 **不传 `pageSpans`**（等价于 PDF 路径规则不触发）
- **after（启用 B4）**：同一 `parsed.content` 下 **传入 `pageSpans`**

结果摘要（来自脚本输出 JSON）：

- `keyBundleChunks`（单 chunk 同时包含 `参数对齐 + TRUE + FALSE + 在线值 + 离线值 + 值比较 + 同步`）
  - **before: 1**
  - **after: 2**
  - 结论：B4 第一规则对“关键子串同 chunk”有**小幅**改善，但不是数量级变化。
- `tableNoiseChunks`（表格/短行伪段落候选的粗略计数）
  - **before: 2462**
  - **after: 2446**
  - 结论：表格/短行噪声在手册 7 里是**全局性**的；B4 第一规则只在 cue 附近折叠空行，无法显著改变全局噪声分布。

结合现有 Q8 retrieval debug（`evals/results/sprint-5.3c-realpdf-run-001.json` 的 Q8）观察：

- Q8 的 topResults 里依然出现 **`6.2.6.2 引脚`** 等“表格/参数表头”类段落（qualityScore 为负但分数仍高）。

### 4) 主因判断（只选一个）

**主因更像：`ranking`**（而非 `chunk`）。

理由：B4 第一规则已经缓解了“空行导致 block 切碎”的局部边界问题，但 Q8 候选仍大量被“参数表头/引脚表格”类 chunk 命中并进入 top-k，这更像需要在排序侧进一步压制“表格短行伪段落”上位（或 parse_normalize 层去目录/表格噪声），而继续加 chunk boundary 规则可能会迅速扩大影响面。

### 5) 是否建议继续加 B4 第二条规则

**结论：A. 不建议继续加第二条规则**（暂时停在这里）。

- 当前仍存在噪声候选，但它是全局性表格/目录类噪声；若用 B4 继续压制，容易演变为更通用的表格识别/切分策略（风险上升，不再“单点可控”）。

### 6) 下一步建议回到哪条线

- 优先回到 **ranking 治理**：增加对“目录/表格短行伪段落”的可解释惩罚或过滤（保持可测/可审）；或在 `parse_normalize` 层做极小的“目录/点线 leader”清洗（若能证明不会伤正文）。

> 已执行：后续按该结论转向 **ranking 治理小轮**（压制目录/表格短行伪段落），不继续添加 B4 第二条规则。

