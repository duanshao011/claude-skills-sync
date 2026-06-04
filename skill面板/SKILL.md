---
name: skill面板
description: "打开本地 Skill 管理器面板；当用户说 skill面板、技能面板、打开 skill 管理器、查看本地 skills、管理 Claude/Codex skills 时使用。触发后直接在浏览器打开 http://localhost:4174。"
---

# skill面板

打开本地 Skill 管理器面板。

## Workflow

1. 运行 `scripts/open-skill-panel.ps1`。
2. 脚本会检查 `http://localhost:4174` 是否可访问。
3. 如果服务未启动，脚本会尝试从本地 Skill 管理器项目启动服务。
4. 最后用默认浏览器打开 `http://localhost:4174`。

不要编辑 skill 文件，不要扫描或修改用户其他 skills；这个 skill 只负责打开面板。
