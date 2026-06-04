---
name: gl-shenhe
description: "达人脚本审核工具；当用户要求审核脚本、检查内容问题、输出评分和修改建议时使用。"
---

# gl-shenhe

这是一个轻量入口，避免 Claude Code 启动或恢复会话时一次性读取过多内容。

使用方式：
1. 先读取 `references/full-instructions.md`，了解审核维度、评分方式和输出格式。
2. 不要默认读取全部支撑文件。
3. 仅在当前任务确实需要时，按需读取：
   - `product-knowledge.md`：涉及具体产品参数、功能边界、禁忌红线时读取。
   - `review-templates.md`：需要匹配具体品类模板时读取相关片段。
   - `examples.md`：只有需要参考优秀/错误案例时读取相关片段，不要整文件读取。
   - `persona-standard.md`：只有做人感评分或人感表达优化时读取相关片段。
4. 若文件很长，优先搜索关键词或分段读取，避免触发上下文压缩。
