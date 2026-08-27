---
name: codex-login-switch
description: 切换 Codex 的登录方式——ChatGPT 个人订阅 或 公司光粒 API 中转。用户说「切换 gpt订阅」「订阅登录」「用我自己的账号」「切换 api登录」「换回公司」「切光粒中转」时使用；也用于查看 codex 当前用哪种登录、切换后验证、codex 登录/计费相关的问题排查。
---

# Codex 登录切换

在两套登录方式之间切换，原理是替换 `~\.codex\config.toml`（两套完整配置已提前备好）：

- **个人订阅版** = 走博哥自己的 ChatGPT Plus/Pro 订阅额度
- **公司中转版** = 走光粒内网中转 `http://10.0.7.45:9090/v1`（API key 计费）

## 文件位置

| 文件 | 作用 |
|---|---|
| `~\.codex\config.toml` | 当前生效的配置 |
| `~\.codex\config.personal.toml` | 个人订阅版配置 |
| `~\.codex\config.company.toml` | 公司中转版配置 |

## 切换到个人订阅

用户说「切换 gpt订阅」「用订阅登录」时：

1. 复制配置：
   ```powershell
   Copy-Item "$env:USERPROFILE\.codex\config.personal.toml" "$env:USERPROFILE\.codex\config.toml" -Force
   ```
2. 检查登录态：跑 `codex login status`
   - 显示 `Logged in using ChatGPT` → 登录态还在，跳到第 4 步
   - 显示 `Not logged in` → 需要博哥本人授权（浏览器操作无法代劳），让他在输入框执行 `! codex login`，浏览器弹出后选 Sign in with ChatGPT 登录订阅账号
3. 等博哥确认登录完成后，再跑一次 `codex login status` 验证
4. 验证配置生效：确认 `config.toml` 中 `model_provider = "company"` 处于注释状态（行首有 `#`）
5. 提醒博哥完整重启 codex（见下方「切换后必做」）

## 切换到公司 API 中转

用户说「切换 api登录」「换回公司」时：

1. 复制配置：
   ```powershell
   Copy-Item "$env:USERPROFILE\.codex\config.company.toml" "$env:USERPROFILE\.codex\config.toml" -Force
   ```
2. 验证配置生效：确认 `config.toml` 中 `model_provider = "company"` 未被注释
3. **不需要**任何登录操作，也不用动 ChatGPT 登录态——中转配置自带 api_key，订阅登录留着不影响
4. 提醒博哥完整重启 codex（见下方「切换后必做」）

## 切换后必做

完整退出并重开 codex 桌面端（任务栏右键图标 → 退出，只关窗口不算），配置才会重新加载。终端用 codex 的话重开终端即可。

## 判断当前用哪种（重要）

**`codex login status` 不能用来判断当前走哪套计费**——它只显示 ChatGPT 登录态，即使配置走中转它也可能显示 `Logged in using ChatGPT`。

正确方法：看 `~\.codex\config.toml` 内容：
- `model_provider = "company"` 且未注释 → 当前走公司中转
- 该行被注释（行首有 `#`）→ 当前走个人订阅

## 注意事项

- codex 桌面端会自动往 `config.toml` 写设置（主题、插件等），时间久了两个快照会和实际配置有差异。如果博哥反馈切换后桌面端某些设置「倒退」了，先把当前 `config.toml` 的新设置合并进对应快照再切换，不要直接覆盖了事。
- 切到订阅版后如果提示模型不可用，让博哥在 codex 里 `/model` 换一个订阅可用的模型即可，不用改配置文件。
- 备用文件位置（2026-08-27 备份的原始 key）：`~\openai_api_key_backup.txt`
- 桌面端若报「Unable to locate the Codex CLI binary」：这是 Store 版 App 的包权限 bug，已通过用户级环境变量 `CODEX_CLI_PATH = %LOCALAPPDATA%\OpenAI\Codex\bin\d0097be4feba73d0\codex.exe` 绕过，此变量不要删。
