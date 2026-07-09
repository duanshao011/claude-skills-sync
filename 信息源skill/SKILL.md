---
name: 信息源
description: "本地信息源监控阅读器（YouTube频道RSS聚合+AI摘要）；用户说信息源、信息源监控、info-source时使用。"
---

# 信息源监控

本地 RSS 阅读器，聚合关注博主的最新内容。当前支持 YouTube，后续可扩展公众号、小红书等渠道。

## 使用方式

1. 运行 `scripts/open-info-source.ps1`（Windows 启动脚本）
2. 脚本自动检查 `http://localhost:3000` 是否可访问
3. 未启动则自动在后台拉起服务
4. 用默认浏览器打开页面

## 页面功能

- **三栏阅读器**：左侧博主/主题导航 → 中间文章列表 → 右侧内容预览
- **YouTube 视频嵌入**：直接在页面内播放
- **AI 摘要**：点击按钮调用 Claude API 生成视频结构化摘要（需配置 ANTHROPIC_API_KEY）

## 首次使用

1. 启动后在浏览器中点击「+ 添加博主」
2. 选择 YouTube，粘贴频道 URL（例如 `https://www.youtube.com/@Fireship`）
3. 点击验证，确认后添加
4. 系统自动抓取该频道最近视频
5. 如需 AI 摘要：复制 `app/.env.example` 为 `app/.env`，填入 API Key

## 配置

- 端口：默认 3000，可在 `.env` 中设置 `PORT=xxxx`
- AI 摘要：在 `app/.env` 中配置 `ANTHROPIC_API_KEY=sk-ant-xxx`
- 定时抓取：每天 06:00 自动运行
- 数据文件：`app/data/feeds.db`（SQLite）
