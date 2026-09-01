# 陈述核验证据

核验日期：2026-08-28。原则：只依据官方产品文档、帮助中心或官方 CLI 帮助文本直接支持的内容判「确认」；官方资料未明确说明的以「无法确认」处理，不用搜索摘要或第三方转述补齐。

## C1：Claude Code 的非交互模式可以输出机器可读 JSON — **确认**

**结论**：成立。

**依据**：Claude Code 官方 CLI 参考文档（页面标题 "CLI reference"）在 print 模式标志表中明确记载：

> `--output-format` | Specify output format for print mode (options: `text`, `json`, `stream-json`) | `claude -p "query" --output-format json`

> `--json-schema` | Get validated JSON output matching a JSON Schema after the agent completes its workflow (**print mode only**) | `claude -p --json-schema '{"type":"object",...}' "query"`

**条件**：
- `--output-format` 仅适用于 print 模式（`claude -p`），交互模式不适用。
- 可选值为 `text`、`json`、`stream-json` 三种；`json` 与 `stream-json` 均为机器可读格式。
- 部分高级特性有额外前提：`--include-partial-messages` 与 `--include-hook-events` 要求 `--output-format stream-json`（常配合 `--verbose`）；`--replay-user-messages` 要求输入输出均为 `stream-json`。

**来源**：
- https://code.claude.com/docs/en/cli-reference — 页面标题 "CLI reference"，页面未标注更新日期，访问日期 2026-08-28。（原 docs.claude.com 地址 301 重定向至此官方新域名。）

## C2：Codex CLI 可以在非交互模式中指定模型和工作目录 — **确认**

**结论**：成立。

**依据**：本机安装的 Codex CLI（codex-cli 0.149.1）执行 `codex exec --help` 的官方内置帮助文本，`codex exec` 即 "Run Codex non-interactively"，其选项中明确记载：

> `-m, --model <MODEL>` — Model the agent should use

> `-C, --cd <DIR>` — Tell the agent to use the specified directory as its working root

**条件**：
- 本次核验基于 codex-cli 0.149.1；标志为非交互子命令 `codex exec` 所有。
- 另有 `--add-dir <DIR>` 可指定额外可写目录。

**来源核实过程**：官方 GitHub 仓库 openai/codex 的 `docs/exec.md` 当前仅为指向 https://developers.openai.com/codex/noninteractive 的跳转说明；该官方页面在本机网络环境直连返回 403，无法直接读取，故未采用其内容，改以官方 CLI 帮助文本为准（属任务允许的官方来源「CLI帮助」）。

**来源**：
- `codex exec --help` / `codex --help`（codex-cli 0.149.1 官方内置帮助，本机运行，访问日期 2026-08-28）
- https://github.com/openai/codex/blob/main/docs/exec.md — 页面标题 "codex/docs/exec.md at main · openai/codex · GitHub"，访问日期 2026-08-28（仅确认其指向官方非交互文档，未采信其未包含的细节）

## C3：Claude Code 的 Skills 与 Codex Skills 使用完全相同的加载规则和界面配置 — **错误**

**结论**：不成立。两者均遵循 Agent Skills 开放标准（SKILL.md 文件格式兼容），但官方文档记载的加载规则与界面配置均不相同，「完全相同」为错误表述。

**依据（双方官方文档对照）**：

| 维度 | Claude Code（官方 Skills 文档） | Codex（官方 Skills 文档） |
|---|---|---|
| 用户级目录 | `~/.claude/skills/<skill-name>/SKILL.md` | `~/.agents/skills` |
| 项目级目录 | `.claude/skills/<skill-name>/SKILL.md`（支持嵌套 `.claude/skills/` 并生成目录限定名，如 `/apps/web:deploy`） | 从当前目录到仓库根逐层扫描 `.agents/skills` |
| 组织/机器级 | Enterprise：按 managed settings | ADMIN：`/etc/codex/skills`；另有 SYSTEM 级由 OpenAI 随产品内置 |
| 插件/扩展 | Plugin：`<plugin>/skills/<skill-name>/SKILL.md`，命名空间为 `plugin-name:skill-name` | 无对应插件目录机制 |
| 调用界面 | 斜杠命令 `/skill-name` 直接调用；bundled skills 如 `/doctor`、`/code-review` | `/skills` 命令列出，或输入 `$` 以提及方式调用；ChatGPT 端用 `@` 选择 |
| 配置开关 | settings 中 `disableBundledSkills`、`skillOverrides`（settings.json 体系） | `~/.codex/config.toml` 中 `[[skills.config]]`（`path` + `enabled = false`） |
| UI 元数据 | 无 openai.yaml 对应物；Claude Code 有专有 frontmatter 扩展（invocation control、subagent 执行、动态上下文注入） | `agents/openai.yaml`：`display_name`、`short_description`、`brand_color`、`default_prompt`、`policy.allow_implicit_invocation` |
| 冲突解析 | 文档明确规定跨层级覆盖顺序（enterprise > personal > project，插件独立命名空间等） | 同名不合并："both can appear in skill selectors" |

Claude Code 官方文档原话确认两者关系是「同标准、异扩展」：

> "Claude Code skills follow the [Agent Skills](https://agentskills.io) open standard, which works across multiple AI tools. Claude Code extends the standard with additional features like invocation control, subagent execution, and dynamic context injection."

**条件**：无——该陈述为无条件的「完全相同」断言，双方官方文档均已给出反证。

**来源**：
- https://code.claude.com/docs/en/skills — 页面标题 "Extend Claude with skills"，访问日期 2026-08-28。
- https://developers.openai.com/codex/skills — 页面标题 "Skills – OpenAI Codex"，访问日期 2026-08-28。注：该站点对本机环境直连返回 403，内容系通过只读代理抓取该官方页面的原文获得，非第三方转述。

## C4：只要知道模型的Token数量，就一定能从Agent工具中得到最终实际账单费用 — **错误**

**结论**：不成立。

**依据**：Claude Code 官方成本管理文档（页面标题 "Manage costs effectively"）多处直接否定该断言：

1. 本地估算不等于实际账单：

> "Claude Code computes the dollar figure locally from token counts priced at standard list rates, so it doesn't reflect promotional pricing or contracted discounts and may differ from your actual bill. For authoritative billing, see the Usage page in the Claude Console."

2. 计费不只取决于 token 总数——不同类型 token 牌价不同（官方 `/usage` 示例输出按 `input / output / cache read / cache write` 分列计价），同一 token 数在不同模型上费用也不同（文档："Per-developer costs vary widely based on model selection, codebase size, and usage patterns"）。

3. 订阅计费与 token 数无换算关系：

> "Claude Max and Pro subscribers have usage included in their subscription, so the session cost figure isn't relevant for billing purposes."

> "Usage inside the seat allowance isn't metered in dollars."

4. 接入渠道改变计费主体：经 Amazon Bedrock、Google Cloud、Microsoft Foundry 接入时按云厂商账单计费（"Claude Code is billed per token to your cloud account"），与 Anthropic Console 账单体系相互独立。

**条件**：无——该陈述为「一定能」的无条件断言，官方文档已给出多重反证。反过来说：只有在「API 按量计费 + 已知该模型全部 token 分类的标准牌价 + 无折扣/订阅/云厂商转售」等前提同时满足时，token 数量才可推算费用，但即便如此官方仍声明以 Console Usage 页为权威。

**来源**：
- https://code.claude.com/docs/en/costs — 页面标题 "Manage costs effectively"，访问日期 2026-08-28。

---

## 核验方法说明

- 所有「确认」判断均来自官方来源原文：Claude Code 官方文档站（code.claude.com）、Codex CLI 官方内置帮助文本（本机 0.149.1 实际运行输出）。
- developers.openai.com 对当前网络环境直连返回 403（curl 与直接抓取均如此），C3 所需 Codex Skills 官方页面内容通过只读代理获取该 URL 原文，已在对应条目中注明。未使用任何搜索引擎摘要或第三方文章作为判定依据。
- 版本条件已逐条标注：C2 依赖 codex-cli 0.149.1 的帮助文本；C1 的 `--json-schema`、部分流式标志有模式/搭配前提；C3、C4 为无条件断言，判「错误」。
