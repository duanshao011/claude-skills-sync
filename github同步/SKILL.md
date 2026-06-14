---
name: github同步
name_en: github-sync
description: >
  GitHub 双向同步 / github-sync -- 在设备间通过 GitHub 同步技能文件和项目。
  本地→GitHub推送、GitHub→本地拉取、双向同步。默认操作目录 ~/.claude/skills，
  支持 --path 指定其他 git 仓库目录。触发词：同步skill、skill同步、github同步、
  github sync、推送skill、拉取skill、push skill、pull skill、sync skills、
  上传skill到github、从github更新skill、同步到github、从github更新。
---

# github同步 — GitHub 双向同步

通过 GitHub 私有仓库在多台设备间同步 skill 文件。默认操作 `~/.claude/skills`。

## 前置检查（必须先执行）

每次触发，第一步一定是查看状态：

```bash
bash ~/.claude/skills/github同步/scripts/sync.sh status [--path <目录>]
```

根据结果判断下一步：

| status 输出 | 下一步 |
|---|---|
| 工作区有未提交变更 | 询问博哥是否推送 |
| 落后远程 N 提交 | 询问博哥是否拉取 |
| 领先 + 落后都有 | 建议双向同步 |
| 工作区干净 + 已同步 | 告知无需操作 |
| 不是 git 仓库 | 引导读 `references/setup.md` |
| 未配置 remote | 引导读 `references/setup.md` |

## 四种操作

### 1. status — 查看状态

```bash
bash ~/.claude/skills/github同步/scripts/sync.sh status [--path <目录>]
```

展示分支、远程地址、领先/落后提交数、未提交文件列表。**所有操作前必须先跑 status。**

### 2. pull — 从 GitHub 拉到本地

```bash
bash ~/.claude/skills/github同步/scripts/sync.sh pull [--path <目录>] [--dry-run]
```

直接执行，无需确认。脚本自动处理：
- 本地有未提交变更 → stash → pull → stash pop
- stash pop 冲突 → 自动采用远程版本（checkout --theirs）

把脚本输出的结果展示给博哥。如有冲突文件，提醒博哥检查。

### 3. push — 推送到 GitHub

```bash
bash ~/.claude/skills/github同步/scripts/sync.sh push [--path <目录>] [--message "自定义提交信息"] [--dry-run]
```

**🔴 必须先展示 status 结果并明确获得博哥确认后才能执行！**

确认流程：
1. 先跑 status，把变更文件列表展示给博哥
2. 问「博哥，确认推送到 GitHub？」（不可用其他措辞）
3. 获得肯定答复后执行 push
4. push 被拒时脚本会自动 pull 后重试，无需额外处理

### 4. sync — 双向同步

```bash
bash ~/.claude/skills/github同步/scripts/sync.sh sync [--path <目录>] [--message "自定义提交信息"]
```

先 pull → 再 push。**push 阶段同样需要确认。** 分两步：
1. 先执行 `sync.sh pull`，展示拉取结果
2. 再走 push 确认流程

## 关键规则

- **默认目录**：`~/.claude/skills`。博哥说「同步到github」但没有指明路径时，就是同步 skill 目录。
- **博哥说「同步我的项目」并给了路径**：用 `--path` 指向那个目录。
- **push 必须确认**：这是红线，不得自动执行。`sync` 中的 push 阶段也一样。
- **dry-run 也要展示**：博哥说「先看看有什么要推的」，用 `--dry-run` 预览。
- **冲突自动以远程为准**：脚本会自动处理，但必须告知博哥哪些文件被覆盖了。
- **网络错误不重试**：直接告诉博哥网络不行，让他检查代理。
- **commit message 默认格式**：`sync: <主机名> <日期时间>`。博哥想自定义时用 `--message`。

## 异常处理指导

| 现象 | 处理 |
|---|---|
| 网络不可用 | 「博哥，网络不通，检查下代理」 |
| 认证失败 / 403 | 引导运行 `gh auth login`，或读 `references/setup.md` |
| 不是 git 仓库 | 引导运行 `sync.sh setup`，或读 `references/setup.md` |
| 冲突已解决 | 告知博哥哪些文件被远程覆盖 |
| 已经是最新 | 直接告知，不做多余操作 |

## 脚本路径

```
~/.claude/skills/github同步/
  SKILL.md                # 本文件
  scripts/
    sync.sh               # 核心同步脚本（status/pull/push/sync/setup）
  references/
    setup.md              # 新设备接入指引
```
