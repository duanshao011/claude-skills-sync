# 投放看板 Git 操作指南

## 唯一主仓库

- 主仓库：`D:\Project\data-dashboard\skill`
- 稳定分支：`main`
- Claude/Codex Skill 目录是同步镜像，不单独建立 Git 仓库。
- 原始报表和正式 `全链路投放看板.html` 不进入 Git。

## 日常修改

最省心的做法是把需求交给 Codex，并明确要求“按 Git 流程修改”。Codex 应依次完成：

1. 进入主仓库并读取 `AGENTS.md`。
2. 执行 `git status`，确认当前修改属于谁。
3. 从 `main` 创建一个功能分支，例如 `feature/xhs-cost-card`。
4. 只修改本次需求涉及的文件。
5. 查看差异并运行项目规定的测试。
6. 用一句清楚的中文创建提交。
7. 验证通过后再合并回 `main`。
8. 只在 `main` 上统一构建、备份并更新正式看板。

建议直接这样说：

```text
在投放看板主仓库修改小红书成本卡。
先检查 Git 状态，创建独立功能分支。
完成后展示修改差异和验证结果，得到我确认后再合并 main。
不要更新正式看板，直到合并和验证完成。
```

## 常用查看命令

这些命令只查看，不会修改文件：

```powershell
git status
git diff
git log --oneline --decorate -10
git branch
git worktree list
```

含义：

- `git status`：现在有哪些文件被修改。
- `git diff`：具体改了什么。
- `git log`：最近保存了哪些版本。
- `git branch`：当前有哪些功能分支。
- `git worktree list`：当前有哪些并行工作目录。

## 建立一个功能分支

```powershell
git switch main
git switch -c feature/xhs-cost-card
```

分支名约定：

- 小红书：`feature/xhs-功能名`
- 抖音：`feature/douyin-功能名`
- B站：`feature/bilibili-功能名`
- 修复问题：`fix/问题名`
- 维护工作：`chore/工作名`

## 保存一个版本

```powershell
git add <本次修改的文件>
git diff --cached
git commit -m "调整小红书成本卡布局"
```

不要习惯性提交整个电脑目录。提交前必须查看 `git diff --cached`，确认只有本次需求。

## 并行修改

只有两个任务确实需要同时开展，并且修改边界清楚时才使用 Worktree：

```powershell
git worktree add D:\Project\data-dashboard\worktrees\xhs-cost -b feature/xhs-cost
git worktree add D:\Project\data-dashboard\worktrees\douyin-trend -b feature/douyin-trend
```

然后分别在两个 Codex任务中打开对应目录。两个任务都只能提交源码，不得各自覆盖正式看板。

如果两个任务都会大改 `assets/dashboard.js`、`assets/dashboard.css` 或 `assets/template.html`，应优先串行处理，或先明确文件边界。Worktree 只能避免互相覆盖，不能消除合并冲突。

## 合并和发布

推荐让 Codex执行并展示结果：

1. 确认功能分支工作区干净。
2. 切回 `main`。
3. 合并一个功能分支。
4. 运行测试并检查正式数据口径。
5. 再合并下一个功能分支并重新验证。
6. 全部通过后，创建时间戳备份并更新正式 HTML。

任何 Worktree 清理、`git push`、`git rebase`、`git reset --hard` 或历史改写都必须先获得用户明确许可。

## 出错恢复

先查看历史：

```powershell
git log --oneline -10
```

恢复时优先采用“生成一个新的恢复提交”，保留原始历史，不直接抹掉记录。让 Codex先展示准备恢复的提交和文件，再执行恢复。

Git 只能恢复已经提交的源码。尚未提交的修改、原始报表和正式 HTML 仍依赖人工检查及时间戳备份。
