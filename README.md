# Claude Skills 同步仓库

这个仓库用于在**多台电脑之间同步 Claude Code 的 skill 文件**，搭配 Skill 管理面板使用。

## 工作原理

```
公司电脑 ~/.claude/skills/  ──自动 commit+push──→  GitHub 私有仓库
                                                        │
家里电脑 ~/.claude/skills/  ←──点「同步」按钮拉取────────┘
```

- 本地修改 skill 后，面板会在 5 秒内自动 commit 并 push 到这个仓库
- 另一台电脑打开面板，点「同步」按钮即可拉取最新变更
- 双向同步：无论哪台电脑改了文件，点同步都能保持一致

## 新设备接入步骤

### 1. 安装前置工具

- [Git](https://git-scm.com/downloads)
- [Node.js](https://nodejs.org/)（LTS 版本）
- [GitHub CLI](https://cli.github.com/)

### 2. 登录 GitHub

```bash
gh auth login
```

按提示选择 GitHub.com → HTTPS → 浏览器登录。

### 3. 拷贝面板项目

把公司电脑上的 `Documents\Skill管理器` 文件夹整个拷贝到新电脑的相同位置（U盘、网盘都行）。

### 4. 运行同步配置

```bash
cd ~/Documents/Skill管理器
npm run setup-sync
```

选择「连接已有仓库」，输入仓库地址：

```
https://github.com/duanshao011/claude-skills-sync.git
```

脚本会自动把仓库克隆到 `~/.claude/skills/`。

### 5. 启动面板

```bash
npm run dev
```

打开 http://127.0.0.1:4174 ，顶栏会显示同步状态指示器。

## 日常使用

| 场景 | 操作 |
|------|------|
| 在当前电脑改了 skill | 不用管，5 秒后自动推送 |
| 想拉取另一台电脑的改动 | 面板顶栏点「同步」按钮 |
| 在 GitHub 网页改了文件 | 面板点「同步」拉取到本地 |

## 注意事项

- **私有仓库**：只有你自己能看到，不用担心泄露
- **不要在两台电脑同时编辑同一个 skill**：虽然有冲突自动处理（远端优先），但最好避免
- **敏感信息**：skill 里如果有 API key 或 token，不要把仓库改成 Public
- **断网时**：本地修改会正常保存和 commit，联网后下次同步自动推送
- **`.gitignore` 已配置**：`node_modules`、`.env`、临时文件等不会被同步

## 仓库信息

- 拥有者：duanshao011
- 仓库类型：Private
- 关联目录：`~/.claude/skills/`
- 面板项目：`~/Documents/Skill管理器/`
