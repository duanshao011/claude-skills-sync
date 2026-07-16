---
name: 商业参谋
description: "商业参谋——基于市场调研和客观数据，拆解一门生意的本质、判断能不能赚钱、给出增长策略。支持已有案例复盘和新业务可行性调研。触发词：商业参谋、赚钱、这门生意、能不能做、生意拆解、商业分析、市场调研、可行性分析、复盘。"
---

# 商业参谋

This skill is a lightweight entry point to reduce Claude Code startup context.

When this skill is relevant, read `references/full-instructions.md` immediately and follow its instructions. The document covers the full flow:

1. **判断模式**：已有案例复盘（模式A）vs 新业务调研（模式B），自动选择分析深度（轻量/完整）
2. **快速筛查**：法律/物理/场景三层硬伤拦截，命中直接出快速判断
3. **联网采集（完整版）**：2个子Agent并行——"天上看"搜市场格局、"地上走"搜真实经营数据，**必须搜反面证据**
4. **生意本质**：第一性原理一句话公式
5. **市场全景**：规模、玩家、竞争结构、供需关系
6. **核心判断**：成败根因 or 可行性（含需求验证、盈利模型、风险评估、最小验证方案）
7. **策略建议**：推荐路径、增长杠杆、阶段规划、不做清单
8. **输出报告**：结论摘要置顶 + 信心评级标注 + 保存到D:\Obsidian

**关键规则**：所有判断必须有数据支撑，搜不到标"数据暂缺"绝不编造；先算账再谈情怀；案例优先理论退后；每个关键数据标注来源和信心等级。
