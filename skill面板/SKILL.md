---
name: skill面板
description: "打开本地 Skill 管理器面板；当用户说 skill面板、技能面板、打开 skill 管理器、查看本地 skills、管理 Claude/Codex skills 时使用。触发后直接在浏览器打开 http://localhost:4174。"
---

# skill面板

打开本地 Skill 管理器面板。

## 项目

本地项目位于 `~/Documents/Skill管理器`，对应 GitHub 仓库 `duanshao011/skill-manager`。

- 开发启动：`npm run dev`（`node server/dev.js`，先检查端口再 spawn）
- 直接启动：`node server/index.js`
- 前端页面：`public/index.html`
- 默认端口：4174

## Workflow

1. 运行 `scripts/open-skill-panel.sh`（macOS/Linux）或 `scripts/open-skill-panel.ps1`（Windows）。
2. 脚本检查 `http://localhost:4174` 是否可访问。
3. 如果服务未启动，从 `~/Documents/Skill管理器` 启动 `node server/index.js`。
4. 用默认浏览器打开 `http://localhost:4174`。

不要编辑 skill 文件，不要扫描或修改用户其他 skills；这个 skill 只负责打开面板。
