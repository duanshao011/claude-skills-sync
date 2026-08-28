# 任务

请分析 `input/campaign-funnel.xlsx`。工作簿包含 Notes、Traffic、Spend、Orders 和 Data Notes 五个工作表。数据来自不同系统，存在重复数据、合法的多渠道花费、订单重复以及 note_id 前后空格。

## 时间范围与口径

- 只分析2026-08-04至2026-08-06，数据表已经限制在这一范围。
- Traffic 的完全重复行应删除。
- Orders 按 order_id 去重。
- Spend 同一 note_id、日期存在多渠道记录时是合法的，不能只保留一行。
- 关联前清理 note_id 前后空格。
- CTR = total clicks / total impressions。
- visit_rate = total store visits / total clicks。
- ROAS = total revenue / total spend。
- CPO = note total spend / unique orders；只在有订单的笔记中比较。
- risk_note 选择CTR和进店率都明显偏低且仍有花费的笔记。

## 交付要求

在 `submission/` 生成：

- `answers.json`：包含任务要求的整体数字和笔记判断。
- `quality-log.md`：说明发现的数据问题、处理方式，以及哪些相似记录不能当重复项删除。
- `analysis.md`：给出笔记级结论、风险和下一步动作。

不要修改输入工作簿。JSON中的比率使用小数。
