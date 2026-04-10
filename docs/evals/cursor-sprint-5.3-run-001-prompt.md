你现在在这个项目仓库里做 Sprint 5.3 的真实问题回归验证。

目标：
基于 `docs/evals/sprint-5.3-benchmark-gold-v1.md` 的 12 个高价值问题，
调用本地 RAG，收集答案、citation、retrieval debug，并写回
`evals/results/sprint-5.3-run-001.json`。

工作要求：

1. 读取：
- `docs/evals/sprint-5.3-benchmark-gold-v1.md`
- `evals/results/sprint-5.3-run-001.json`

2. 对 JSON 里的每个 question 逐题执行测试：
- 使用题目原文调用本地 RAG
- 保存 `model_answer`
- 保存 `model_citations`
- 如果项目支持 retrieval 调试输出，保存到 `retrieval_debug`
- 不要跳题

3. 对每题按 markdown 里的 gold 标准进行 checklist 对比：
优先判断：
- 是否命中 gold_answer_points
- 是否遗漏关键限制条件
- 是否把不同手册内容混淆
- 是否发生过度推断
- citation 是否命中正确文档或正确片段

4. 为每题填写这些字段：
- `verdict`: `pass` / `partial` / `fail`
- `score`: `1.0` / `0.5` / `0.0`
- `matched_gold_points`
- `missed_gold_points`
- `fail_modes`
- `notes`

5. `fail_modes` 只允许使用这些枚举：
- `retrieval_miss`
- `ranking_miss`
- `constraint_missing`
- `procedural_order_wrong`
- `concept_confusion`
- `citation_wrong`
- `overconfident_answer`
- `should_refuse_or_be_cautious`

6. 评判规则：
- `pass`：关键点齐全，无明显误导，无关键限制条件遗漏
- `partial`：方向正确，但缺少关键步骤、限制条件或 citation 明显偏弱
- `fail`：关键事实错误、顺序错误、概念混淆、没有答到核心、或在证据不足时乱补全

7. 注意事项：
- 不要追求逐字匹配
- 优先做结构化 checklist 对比，不要做主观泛化打分
- 如果 gold key 还不够完整（例如 Q3/Q4/Q6），也先把回答、citation、问题点收集进去，再给保守 verdict
- 如果 citation 缺失但答案基本对，通常判 `partial`，不要直接 `pass`

8. 完成后：
- 覆盖写回 `evals/results/sprint-5.3-run-001.json`
- 另外生成一个简短总结文件：
  `evals/results/sprint-5.3-summary-001.md`

总结文件至少包含：
- 总题数
- pass / partial / fail 数量
- 最常见 fail_modes
- 最不稳定的 3 道题
- 你建议下一步优先修的 3 类问题

输出风格要求：
- 先做事，再汇报
- 不要空谈方案
- 不要擅自扩题
- 如果遇到无法调用本地 RAG 的技术阻塞，明确记录阻塞点、命令、报错和建议修复路径
