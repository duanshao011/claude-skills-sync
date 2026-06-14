#!/usr/bin/env bash
set -euo pipefail

# github同步 — 本地与 GitHub 双向同步脚本
# 子命令: status | pull | push | sync | setup

DEFAULT_PATH="$HOME/.claude/skills"
DEFAULT_BRANCH="main"

# ─── 工具函数 ───────────────────────────────────────────────

die() {
    echo "❌ $1" >&2
    exit 1
}

warn() {
    echo "⚠️  $1"
}

info() {
    echo "ℹ️  $1"
}

success() {
    echo "✅ $1"
}

# 在目标目录执行 git 命令。返回 exit code，stdout/stderr 捕获到全局变量
GIT_STDOUT=""
GIT_STDERR=""
GIT_EXIT=0

exec_git() {
    local target="$1"
    shift
    GIT_STDOUT=""
    GIT_STDERR=""
    GIT_EXIT=0
    # 合并 stderr 到 stdout，通过 exit code 判断成功与否
    local out
    out=$(cd "$target" && git "$@" 2>&1) || GIT_EXIT=$?
    GIT_STDOUT="$out"
    GIT_STDERR="$out"
}

is_network_error() {
    local msg="$1"
    local patterns=(
        "Could not resolve"
        "Connection refused"
        "Connection timed out"
        "unable to access"
        "fatal: unable to connect"
        "Network is unreachable"
        "No route to host"
        "Failed to connect"
        "Could not resolve host"
    )
    for p in "${patterns[@]}"; do
        if echo "$msg" | grep -qF "$p" 2>/dev/null; then
            return 0
        fi
    done
    return 1
}

# ─── 前置检查 ────────────────────────────────────────────────

check_git_repo() {
    local target="$1"
    if [ ! -d "$target/.git" ]; then
        die "$target 不是 git 仓库。运行 \`sync.sh setup\` 初始化。"
    fi
}

check_remote() {
    local target="$1"
    local url
    url=$(cd "$target" && git remote get-url origin 2>/dev/null) || true
    if [ -z "$url" ]; then
        die "未配置远程仓库。运行 \`sync.sh setup --remote <url>\` 配置。"
    fi
    echo "$url"
}

# ─── 子命令实现 ──────────────────────────────────────────────

do_status() {
    local target="$1"

    check_git_repo "$target"

    echo "📋 同步状态 — $target"
    echo ""

    # 分支
    local branch
    branch=$(cd "$target" && git rev-parse --abbrev-ref HEAD 2>/dev/null)
    echo "  分支: $branch"

    # Remote URL
    local remote_url
    remote_url=$(cd "$target" && git remote get-url origin 2>/dev/null) || remote_url="(未配置)"
    echo "  远程: $remote_url"

    # ahead / behind
    local ahead=0 behind=0
    if [ "$remote_url" != "(未配置)" ]; then
        # fetch 仅获取元数据，不修改工作区
        cd "$target" && git fetch origin "$branch" 2>/dev/null || true
        ahead=$(cd "$target" && git rev-list --count "origin/$branch..$branch" 2>/dev/null) || ahead="?"
        behind=$(cd "$target" && git rev-list --count "$branch..origin/$branch" 2>/dev/null) || behind="?"
    fi
    echo "  领先远程: $ahead 提交"
    echo "  落后远程: $behind 提交"
    echo ""

    # 工作区状态
    local changes
    changes=$(cd "$target" && git status --porcelain 2>/dev/null)
    if [ -z "$changes" ]; then
        echo "  工作区: 干净"
    else
        echo "  工作区: 有未提交变更"
        echo ""
        cd "$target" && git status --short
    fi
}

do_pull() {
    local target="$1"
    local branch="$2"
    local dry_run="${3:-false}"

    check_git_repo "$target"
    local remote_url
    remote_url=$(check_remote "$target")

    info "目标: $remote_url ($branch)"
    echo ""

    if [ "$dry_run" = "true" ]; then
        info "[dry-run] 将执行 pull，不会实际修改文件"
        # 只 fetch 看看有没有更新
        exec_git "$target" fetch origin "$branch"
        if [ $GIT_EXIT -ne 0 ]; then
            if is_network_error "$GIT_STDERR"; then
                die "网络不可用，无法连接 GitHub。请检查网络/代理后重试。"
            fi
            die "fetch 失败: $GIT_STDERR"
        fi
        local behind
        behind=$(cd "$target" && git rev-list --count "$branch..origin/$branch" 2>/dev/null) || behind="?"
        if [ "$behind" = "0" ] || [ "$behind" = "00" ]; then
            success "已经是最新版本，无需拉取。"
        else
            echo "远端有 $behind 个新提交可以拉取。"
        fi
        return 0
    fi

    # 检查本地是否有未提交变更
    local has_changes=false
    local changes
    changes=$(cd "$target" && git status --porcelain 2>/dev/null)
    if [ -n "$changes" ]; then
        has_changes=true
        local count
        count=$(echo "$changes" | wc -l | tr -d ' ')
        info "本地有 $count 个未提交文件，先 stash..."
        exec_git "$target" stash push --include-untracked -m "sync: auto-stash before pull $(date '+%Y-%m-%d %H:%M:%S')"
    fi

    # pull
    info "拉取远程更新..."
    exec_git "$target" pull --rebase origin "$branch"

    if [ $GIT_EXIT -ne 0 ]; then
        if is_network_error "$GIT_STDERR"; then
            die "网络不可用，无法连接 GitHub。请检查网络/代理后重试。"
        fi
        die "pull 失败: $GIT_STDERR"
    fi

    local pull_output="$GIT_STDOUT"

    # 恢复 stash
    if [ "$has_changes" = "true" ]; then
        info "恢复本地变更..."
        exec_git "$target" stash pop
        if [ $GIT_EXIT -ne 0 ]; then
            if echo "$GIT_STDERR" | grep -qi "CONFLICT"; then
                warn "stash pop 产生冲突，采用远程版本..."

                # 列出冲突文件
                local conflict_files
                conflict_files=$(cd "$target" && git diff --name-only --diff-filter=U 2>/dev/null) || true
                if [ -n "$conflict_files" ]; then
                    echo "  冲突文件:"
                    echo "$conflict_files" | sed 's/^/    /'
                fi

                # 以远程版本为准
                exec_git "$target" checkout --theirs . 2>/dev/null || true
                exec_git "$target" add -A
                local hostname
                hostname=$(hostname 2>/dev/null || echo "unknown")
                exec_git "$target" commit -m "sync: auto-resolve conflict (remote wins) [$hostname $(date '+%Y-%m-%d %H:%M:%S')]"

                echo ""
                warn "冲突已自动解决（采用远程版本），请检查以上文件。"
                return 2
            else
                die "恢复本地变更失败: $GIT_STDERR"
            fi
        fi
    fi

    if echo "$pull_output" | grep -q "Already up to date"; then
        success "已经是最新版本。"
    else
        success "拉取完成。"
        if [ -n "$pull_output" ]; then
            echo ""
            echo "$pull_output" | head -20
        fi
    fi

    return 0
}

do_push() {
    local target="$1"
    local branch="$2"
    local dry_run="${3:-false}"
    local custom_message="${4:-}"

    check_git_repo "$target"
    check_remote "$target" > /dev/null

    # 检查是否有变更（不暂存，避免 dry-run 产生副作用）
    local changes
    changes=$(cd "$target" && git status --porcelain 2>/dev/null)
    if [ -z "$changes" ]; then
        success "工作区干净，无需推送。"
        return 0
    fi

    local count
    count=$(echo "$changes" | wc -l | tr -d ' ')
    echo "待推送变更 ($count 个文件):"
    echo "$changes" | head -20 | sed 's/^/  /'
    if [ "$count" -gt 20 ]; then
        echo "  ... 还有 $((count - 20)) 个文件"
    fi
    echo ""

    if [ "$dry_run" = "true" ]; then
        info "[dry-run] 以上变更不会被提交和推送。"
        return 0
    fi

    # 暂存所有变更
    exec_git "$target" add -A

    # commit
    local msg
    if [ -n "$custom_message" ]; then
        msg="$custom_message"
    else
        local hostname
        hostname=$(hostname 2>/dev/null || echo "unknown")
        msg="sync: $hostname $(date '+%Y-%m-%d %H:%M:%S')"
    fi

    info "提交变更..."
    exec_git "$target" commit -m "$msg"

    if [ $GIT_EXIT -ne 0 ]; then
        die "commit 失败: $GIT_STDERR"
    fi

    # push
    info "推送到 GitHub..."
    exec_git "$target" push origin "$branch"

    if [ $GIT_EXIT -eq 0 ]; then
        success "推送完成。"
        echo ""
        echo "  提交: $msg"
        return 0
    fi

    # push 被拒 — 远端有更新
    if echo "$GIT_STDERR" | grep -qiE "rejected|non-fast-forward"; then
        warn "远端有更新，先拉取再重试推送..."
        echo ""
        do_pull "$target" "$branch" "false"
        echo ""

        info "重试推送..."
        exec_git "$target" push origin "$branch"
        if [ $GIT_EXIT -eq 0 ]; then
            success "推送完成（已先同步远端更新）。"
            return 0
        fi
    fi

    # 网络错误
    if is_network_error "$GIT_STDERR"; then
        die "网络不可用，推送失败。本地 commit 已保留，联网后重新运行推送即可。"
    fi

    die "推送失败: $GIT_STDERR"
}

do_sync() {
    local target="$1"
    local branch="$2"
    local dry_run="${3:-false}"
    local custom_message="${4:-}"

    check_git_repo "$target"
    check_remote "$target" > /dev/null

    echo "🔄 双向同步 — 先拉取，再推送"
    echo ""

    # Step 1: pull
    echo "── 第 1 步：拉取远程更新 ──"
    do_pull "$target" "$branch" "$dry_run"
    local pull_rc=$?
    echo ""

    # Step 2: push (dry-run 模式下跳过)
    if [ "$dry_run" = "true" ]; then
        info "[dry-run] 跳过推送步骤。"
        return $pull_rc
    fi

    echo "── 第 2 步：推送本地变更 ──"
    echo ""
    echo "⚠️  即将推送本地变更到 GitHub。当前状态:"
    echo ""
    do_status "$target" | sed 's/^/  /'
    echo ""

    # push 需要确认，由 SKILL.md 层处理。这里直接执行，调用方负责确认。
    do_push "$target" "$branch" "$dry_run" "$custom_message"
}

do_setup() {
    local target="$1"
    local remote_url="${2:-}"

    echo "🔧 初始化同步设置"
    echo ""

    # 检查 git
    if ! command -v git &> /dev/null; then
        die "未找到 git，请先安装: https://git-scm.com"
    fi
    success "git 已安装: $(git --version | head -1)"

    # 如果目录不存在
    if [ ! -d "$target" ]; then
        if [ -z "$remote_url" ]; then
            die "目录 $target 不存在且未指定 --remote。请提供远程仓库地址。"
        fi
        info "克隆仓库..."
        git clone "$remote_url" "$target"
        success "克隆完成: $target"
        return 0
    fi

    # 目录存在但不是 git 仓库
    if [ ! -d "$target/.git" ]; then
        if [ -z "$remote_url" ]; then
            die "目录 $target 存在但不是 git 仓库，需要 --remote 参数来初始化。"
        fi
        # 检查目录是否为空
        if [ -n "$(ls -A "$target" 2>/dev/null)" ]; then
            local backup="${target}.backup.$(date +%Y%m%d%H%M%S)"
            warn "目录非空，备份到: $backup"
            mv "$target" "$backup"
        fi
        info "克隆仓库..."
        git clone "$remote_url" "$target"
        success "克隆完成: $target"
        return 0
    fi

    # 已有 git 仓库，检查/设置 remote
    local current_remote
    current_remote=$(cd "$target" && git remote get-url origin 2>/dev/null) || true
    if [ -n "$current_remote" ]; then
        success "已有远程配置: $current_remote"
        if [ -n "$remote_url" ] && [ "$remote_url" != "$current_remote" ]; then
            info "更新远程地址..."
            cd "$target" && git remote set-url origin "$remote_url"
            success "已更新: $remote_url"
        fi
    elif [ -n "$remote_url" ]; then
        info "配置远程仓库..."
        cd "$target" && git remote add origin "$remote_url"
        success "已配置: $remote_url"
    else
        warn "目录已初始化 git 但未配置 remote。请用 --remote 指定仓库地址。"
        echo ""
        echo "  sync.sh setup --remote https://github.com/<user>/<repo>.git"
        return 1
    fi

    # 确保有默认分支
    local branch
    branch=$(cd "$target" && git rev-parse --abbrev-ref HEAD 2>/dev/null)
    if [ "$branch" = "HEAD" ]; then
        info "切换到 main 分支..."
        cd "$target" && git checkout -b main 2>/dev/null || true
    fi
}

# ─── 主入口 ──────────────────────────────────────────────────

usage() {
    cat <<EOF
用法: sync.sh <子命令> [选项]

子命令:
  status      查看同步状态（分支、远程、未提交变更）
  pull        从 GitHub 拉取更新
  push        推送本地变更到 GitHub
  sync        双向同步（先拉取，再推送）
  setup       初始化 git 仓库和远程配置

选项:
  --path <dir>      目标目录（默认: $DEFAULT_PATH）
  --branch <name>   分支名（默认: $DEFAULT_BRANCH）
  --dry-run         仅预览，不实际执行（push/sync 可用）
  --message <msg>   自定义 commit message（push/sync 可用）
  --remote <url>    GitHub 仓库地址（setup 可用）

示例:
  sync.sh status
  sync.sh pull
  sync.sh push --dry-run
  sync.sh push --message "fix: 更新触发词"
  sync.sh sync
  sync.sh setup --remote https://github.com/user/repo.git
  sync.sh status --path ~/my-project
EOF
    exit 0
}

main() {
    local subcommand=""
    local target="$DEFAULT_PATH"
    local branch="$DEFAULT_BRANCH"
    local dry_run="false"
    local custom_message=""
    local remote_url=""

    while [ $# -gt 0 ]; do
        case "$1" in
            status|pull|push|sync|setup)
                subcommand="$1"
                shift
                ;;
            --path)
                target="${2%/}"  # 去尾斜杠
                shift 2
                ;;
            --branch)
                branch="$2"
                shift 2
                ;;
            --dry-run)
                dry_run="true"
                shift
                ;;
            --message)
                custom_message="$2"
                shift 2
                ;;
            --remote)
                remote_url="$2"
                shift 2
                ;;
            -h|--help)
                usage
                ;;
            *)
                die "未知参数: $1。运行 sync.sh --help 查看用法。"
                ;;
        esac
    done

    if [ -z "$subcommand" ]; then
        usage
    fi

    # 展开 ~ 路径
    target="${target/#\~/$HOME}"

    # 验证目录存在（setup 除外）
    if [ "$subcommand" != "setup" ] && [ ! -d "$target" ]; then
        die "目录不存在: $target"
    fi

    case "$subcommand" in
        status)
            do_status "$target"
            ;;
        pull)
            do_pull "$target" "$branch" "$dry_run"
            ;;
        push)
            do_push "$target" "$branch" "$dry_run" "$custom_message"
            ;;
        sync)
            do_sync "$target" "$branch" "$dry_run" "$custom_message"
            ;;
        setup)
            do_setup "$target" "$remote_url"
            ;;
    esac
}

main "$@"
