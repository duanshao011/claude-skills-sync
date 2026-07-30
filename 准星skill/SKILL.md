---
name: 准星
description: "准星是本地关注圈内容阅读器：聚焦关注圈，盯住目标博主，把他们的最新内容集中送到眼前。用户提到准星、信息源、信息源监控、关注博主最新内容，或想集中查看所关注创作者的更新时，必须使用此 Skill 打开准星。"
---

# 准星

聚焦关注圈，盯住目标博主，把他们的最新内容集中送到眼前。

## 打开准星

运行 Windows 启动脚本：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts/open-zhunxing.ps1"
```

脚本会读取 `app/.env` 中的 `PORT`，服务固定监听本机 `127.0.0.1`，并验证当前端口上的服务确实是准星；必要时用 WorkBuddy 隔离托管的 Node.js 22.22.2 安装依赖并启动服务。每次打开都会请求一次内容更新，然后无论更新成功与否都打开页面。

## 停止准星

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts/stop-zhunxing.ps1"
```

停止脚本只会终止 PID 文件与准星健康接口共同确认的进程，避免误杀同端口或复用 PID 的其他程序。

## 首次配置

1. 将 `app/.env.example` 复制为 `app/.env`。
2. 按需填写连接配置；不要把 `.env` 或密钥内容输出到对话、日志或版本库。
3. 再运行打开脚本。

准星支持管理 YouTube、公众号、小红书和抖音关注。YouTube 使用公开 RSS，公众号和抖音已依据 Redfox 契约真实接入；小红书目前仅支持账号验证，因为现有契约缺少按博主获取作品列表的能力。不要猜测未提供的 Header、端点或返回结构。

## 行为约定

- 每次打开准星时更新，不做后台定时任务。
- 取消关注会同时删除该博主的历史内容。
- AI 摘要仅在配置可用时启用。
- 数据保存在本地 `app/data/`。
