# 任务

请分析 `input/note-performance.xlsx` 中的营销笔记表现数据。源数据里存在一个完全重复的数据行，计算整体指标前需要去重，但不能因为 note_id 相同就随意合并不同记录。

## 指标口径

- CTR = clicks / impressions
- CPC = spend / clicks
- ROAS = revenue / spend
- 所有整体指标都用去重后的汇总值计算，不取单行比率平均值。
- `best_ctr_note` 只在 spend 大于0的笔记中选择。
- `risk_note` 选择有花费但订单为0的笔记；如果有多个，选择花费最高者。

## 交付要求

在 `submission/` 生成：

- `answers.json`：至少包含 raw_rows、deduplicated_rows、duplicate_note_id、total_impressions、total_clicks、total_spend、total_orders、total_revenue、overall_ctr、overall_cpc、overall_roas、best_ctr_note、risk_note。
- `analysis.md`：用业务语言说明数据清洗、表现最好与最需要警惕的笔记，以及下一步建议。

比率在 JSON 中使用小数，不使用带百分号的字符串；金额保留原始货币数值。
