# 时间、Token 与费用

## 时间

脚本记录每个子进程的墙钟时间。案例顺序执行，因此不会发生多个模型或多个案例抢占造成的并发污染。

## Token

- Claude Code：解析 `--output-format json` 的 `usage` 字段。
- Codex：解析 `codex exec --json` 的完成事件。
- Claude 的缓存创建与缓存读取 Token 计入处理总量。
- Codex 的缓存 Token 通常是输入 Token 的子集，不重复累加。

报告保留输入、输出、缓存细分，但默认折叠。无法从工具输出可靠取得时显示“未获取”，不接受模型自报。

## 费用

费用来源按可信度显示：

- `tool_reported`：Agent 工具直接返回。
- `calculated`：按实际 Token 与 `assets/pricing.json` 中的版本化价格计算。
- `unavailable`：没有可靠来源。

工具返回费用不等同于最终账单，报告会标明来源。Codex 套餐内使用或第三方 Claude Code 路由经常无法自动折算，应保持“未获取”而不是猜测。
