---
name: model-test
description: 使用内置真实工作案例测试当前单个模型与 Agent 工具组合，顺序完成内容、调研、数据、本地文件、项目开发、联网核验、Skill 构建、图片理解与前端审美任务，并生成实际产物、耗时、Token、费用和人工判断分离的报告。用户说模型测试、测模型、测试当前模型、比较模型实际能力时使用；不用于公开学术跑分或同时并发测试多个模型。
---

# 模型测试

一次只测试当前一个“模型 + Agent 工具”组合。不要并发启动其他模型，也不要读取用户未明确指定的本地文件。

## 开始前

1. 读取 [references/workflow.md](references/workflow.md)。
2. 根据用户意图选择模式：
   - `quick`：八个常规任务，默认。
   - `full`：八个常规任务加八个压力任务。
   - `focus`：只测指定维度。
3. 确认当前 Agent 是 `claude` 或 `codex`。模型名称无法可靠识别时只询问一次。
4. 不要在用户未同意的情况下自动切换模型、扩大测试范围或使用个人资料。

## 执行

优先使用 [scripts/run_suite.py](scripts/run_suite.py) 顺序启动独立子会话。它会准备隔离目录、调用当前模型、自动验收并生成报告。

```powershell
python scripts/run_suite.py --agent claude --model "当前模型名称" --mode quick
python scripts/run_suite.py --agent codex --model "当前模型名称" --mode full
python scripts/run_suite.py --agent claude --model "当前模型名称" --mode focus --dimensions content,data
```

如果模型名称是 Claude Code 当前配置的默认路由且没有稳定的公开标识，可以省略 `--model`，但必须用 `--model-label` 填写报告显示名。

不要使用跳过权限或无沙箱参数。每个案例只能写入自己的 `submission/` 目录。案例按顺序执行，失败时保留产物并继续下一题，不无限重试。

## 结果

运行结束后打开脚本输出的 `report.html`。报告默认只突出：

- 实际案例与产物
- 耗时
- Token
- 费用
- 用户四档判断

自动检查只提示客观错误，不生成主观质量分。Token 只能来自工具输出或会话记录，费用必须标明工具返回、价格表估算或未获取。

需要解释统计口径时读取 [references/telemetry.md](references/telemetry.md)。需要新增或修改案例时读取 [references/case-schema.md](references/case-schema.md) 与 [references/evaluation-rules.md](references/evaluation-rules.md)。
