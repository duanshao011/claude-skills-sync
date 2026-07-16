# 新设备接入指引

## 前置条件

- Git：macOS 自带，或 `brew install git`
- GitHub CLI（推荐）：`brew install gh`，用于认证管理

## 场景 A：从零开始（新设备首次接入）

```bash
# 1. 登录 GitHub
gh auth login

# 2. 配置同步
bash ~/.claude/skills/github同步/scripts/sync.sh setup --remote https://github.com/<你的用户名>/<仓库名>.git
```

`sync.sh setup` 会自动：
1. 检查 git 是否安装
2. clone 远程仓库到 `~/.claude/skills`
3. 配置好 remote 和分支

## 场景 B：已有本地文件，关联到 GitHub

```bash
# 1. 在 GitHub 上创建一个新的私有仓库（不要勾选 README）
# 2. 配置远程地址
bash ~/.claude/skills/github同步/scripts/sync.sh setup --remote https://github.com/duanshao011/claude-skills-sync.git
```

如果目录非空，setup 会自动备份现有文件再 clone，不会丢数据。

## 场景 C：手动 git 操作

如果你更习惯手动操作：

```bash
cd ~/.claude/skills

# 初始化
git init
git remote add origin https://github.com/<user>/<repo>.git
git checkout -b main

# 首次推送
git add -A
git commit -m "init: skills backup"
git push -u origin main
```

## 认证问题

如果遇到 `403` 或 `Authentication failed`：

```bash
gh auth login          # GitHub CLI 方式
# 或
gh auth setup-git      # 配置 git 使用 gh 认证
```

## 目录结构约定

同步脚本默认操作 `~/.claude/skills`，也就是你的 skill 存放目录。如果想同步其他项目目录，用 `--path` 参数指定：

```bash
bash ~/.claude/skills/github同步/scripts/sync.sh status --path ~/my-project
```

前提是目标目录已经是 git 仓库且配置了 remote。
