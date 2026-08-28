# 运行流程

## 运行原则

- 一次只测试当前一个模型组合。
- 案例顺序执行，不并发。
- 每个案例使用独立工作目录；支持时使用独立子会话。
- 只把 `task.md` 与 `input/` 交给待测模型，不主动暴露标准答案和校验配置。
- 自动校验只检查客观项，用户通过实际产物判断质量。

## 推荐命令

从 Skill 根目录运行：

```powershell
python scripts/run_suite.py --agent claude --model-label "DeepSeek V4 Flash" --mode quick
```

Claude Code 的 `--model` 会改变实际路由。只有确认模型标识能被当前提供方识别时才传入；否则仅设置 `--model-label`，让子会话继承默认配置。

Codex 运行需要明确模型时使用：

```powershell
python scripts/run_suite.py --agent codex --model "gpt-5.6-sol" --model-label "GPT-5.6 Sol" --mode quick
```

## 模式

- `quick`：每个维度的 `standard` 案例，共八题。
- `full`：所有启用案例，共十六题。
- `focus`：用 `--dimensions` 传入逗号分隔维度；默认包含所选维度的常规与压力题。

维度标识：`content`、`research`、`data`、`local-files`、`development`、`web-verification`、`skill-building`、`visual`。

## 中断与恢复

运行过程中每题结束都会更新 `run.json`。进程中断后可使用：

```powershell
python scripts/run_suite.py --resume "运行目录"
```

已经完成的案例不会重复调用。失败或超时案例保留原始输出与 submission 文件。

## 只准备不调用模型

开发或检查素材时使用：

```powershell
python scripts/run_suite.py --agent claude --model-label "Dry Run" --mode quick --prepare-only
```

这不会消耗模型额度，只创建案例工作目录和空报告。
