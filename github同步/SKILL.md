---
name: github同步
name_en: github-sync
description: >
  GitHub 双向同步 / github-sync -- 在设备间通过 GitHub 同步技能文件和项目。
  本地→GitHub推送、GitHub→本地拉取、双向同步。默认同时检查所有跟踪仓库，
  汇总差异后统一同步。触发词：同步skill、skill同步、github同步、
  github sync、推送skill、拉取skill、push skill、pull skill、sync skills、
  上传skill到github、从github更新skill、同步到github、从github更新。
---

# github同步 — GitHub 多仓库双向同步

通过 GitHub 私有仓库在多台设备间同步所有跟踪项目。触发了就**对所有跟踪仓库做 status 检查，汇总差异后汇报**。

## 跟踪仓库列表（默认同步全部）

每次触发必须检查以下所有仓库的状态。如果某个路径不存在（比如新设备还没建），跳过并备注。

| # | 仓库 | 本地路径 | GitHub Remote |
|---|---|---|---|
| 1 | Skill 文件 | `~/.claude/skills` | `duanshao011/claude-skills-sync` |
| 2 | Skill 面板 | `~/Documents/Skill管理器` | `duanshao011/skill-manager` |
| 3 | 准星 | `~/.claude/skills/准星skill` | `duanshao011/zhunxing` |

> 准星已从 Skill 文件仓库拆出成独立项目（在 1 的 `.gitignore` 里排除）。本地目录仍在
> `~/.claude/skills/准星skill`，skill 照常从这个路径启动，只是版本由自己的仓库管理。
> 它是嵌套在 1 的工作区里的独立 git 仓库，两个仓库各推各的，不会互相干扰。

> 博哥要新增或移除跟踪仓库，直接改这个表。不需要改脚本。

## 前置检查（必须先执行）

对每个跟踪仓库逐一跑 status，汇总成一个报告：

```bash
bash ~/.claude/skills/github同步/scripts/sync.sh status --path <仓库路径>
```

## 汇报格式（必须按这个格式）

跑完所有仓库的 status 后，用下面的格式汇总给博哥：

```
📦 仓库: Skill 文件 (~/.claude/skills)
   领先: X 提交  落后: Y 提交  工作区: 干净 / N个未提交文件
   └─ 远程: duanshao011/claude-skills-sync

📦 仓库: Skill 面板 (~/Documents/Skill管理器)
   领先: X 提交  落后: Y 提交  工作区: 干净 / N个未提交文件
   └─ 远程: duanshao011/skill-manager
```

然后根据汇总结果决策：

| 汇总情况 | 下一步 |
|---|---|
| 所有仓库干净且已同步 | 告知「全部已同步，无变化」|
| 任一仓库落后远程 | 先对所有仓库执行 pull，再汇报拉取结果 |
| 任一仓库有领先/未提交 | 展示变更明细，问博哥是否推送 |
| 领先 + 落后都有 | 先 pull 再确认 push |

## 四种操作

### 1. status — 查看所有仓库状态

对每个跟踪仓库逐一跑：

```bash
bash ~/.claude/skills/github同步/scripts/sync.sh status --path <仓库路径>
```

汇总后按「汇报格式」输出。

### 2. pull — 所有仓库拉取

对每个跟踪仓库逐一 pull。**无需确认，直接执行。**

```bash
bash ~/.claude/skills/github同步/scripts/sync.sh pull --path <仓库路径>
```

每个仓库拉取完成后汇报结果。脚本自动处理 stash/冲突，冲突文件以远程为准并提醒博哥检查。

### 3. push — 推送到 GitHub

```bash
bash ~/.claude/skills/github同步/scripts/sync.sh push --path <仓库路径> [--message "自定义提交信息"]
```

**🔴 必须先汇总展示所有仓库的变更明细并明确获得博哥确认后才能执行！**

确认流程：
1. 汇总展示所有仓库的变更文件列表 + 领先提交数
2. 问「博哥，确认推送以上所有仓库到 GitHub？」（不可用其他措辞）
3. 获得肯定答复后，逐仓库执行 push
4. 每个仓库 push 完成后汇报结果

### 4. sync — 双向同步

```bash
bash ~/.claude/skills/github同步/scripts/sync.sh sync --path <仓库路径> [--message "自定义提交信息"]
```

先所有仓库 pull → 再统一走 push 确认流程。

## 变更明细展示（push 前必须展示）

博哥说「看看有什么改动」，或者 push 之前，对每个有领先/变更的仓库展示：

```bash
cd <仓库路径> && git log origin/main..HEAD --oneline   # 领先的提交列表
cd <仓库路径> && git status --short                      # 未提交的文件变更
cd <仓库路径> && git diff --stat origin/main..HEAD       # 文件级变更统计
```

用简明格式输出，不要 dump 原始 git 输出。例如：

```
📦 Skill 面板 — 18 个提交待推送
   最近 5 条:
   · 41f4bb3 Add git sync feature and refresh UX improvements
   · 1a6a51d Add category context menu management
   · f2575a1 Render category move menu outside list
   · ea7dbff Add detail action toast feedback
   · 81a1049 Remove detail page category selector
   📊 文件变更: 12 files, +340 -89
```

## 关键规则

- **默认全仓库同步**：博哥说「同步到github」不指明路径时，对全部跟踪仓库执行。
- **博哥说「同步我的项目」并给了路径**：**追加**到跟踪仓库列表一起检查，不要替换默认列表。
- **push 必须确认**：这是红线，不得自动执行。`sync` 中的 push 阶段也一样。
- **冲突自动以远程为准**：脚本会自动处理，但必须告知博哥哪些文件被覆盖了。
- **网络错误不重试**：直接告诉博哥网络不行，让他检查代理。
- **commit message 默认格式**：`sync: <主机名> <日期时间>`。博哥想自定义时用 `--message`。

## 异常处理指导

| 现象 | 处理 |
|---|---|
| 网络不可用 | 「博哥，网络不通，检查下代理」 |
| 认证失败 / 403 | 引导运行 `gh auth login`，或读 `references/setup.md` |
| 不是 git 仓库 / 路径不存在 | 跳过该仓库并备注，继续处理其他仓库 |
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
