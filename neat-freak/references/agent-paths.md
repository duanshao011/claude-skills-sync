# Agent Memory & Config Paths

This reference compares memory systems and file locations across four agent platforms:

**Claude Code** uses `~/.claude/projects/<path>/memory/MEMORY.md` for cross-session memory with YAML frontmatter, plus `~/.claude/CLAUDE.md` for global instructions and `CLAUDE.md` files in project roots.

**OpenAI Codex** stores instructions in `~/.codex/AGENTS.md` or project-level `AGENTS.md` files. It lacks a separate memory index—everything goes directly in `AGENTS.md`.

**OpenClaw** organizes skills in `~/.openclaw/skills/` (user) and `.openclaw/skills/` (project), with workspace skills in the current workspace directory. No independent memory file exists.

**OpenCode** scans `.opencode/skills/`, `.claude/skills/`, and `.codex/skills/` directories, making it compatible with multiple platforms. It reads both Claude Code and Codex directories.

For cross-platform projects, the recommendation is to include both `CLAUDE.md` and `AGENTS.md` at the project root, or have one reference the other. Platform-neutral files like `README.md` and `docs/` need only exist in one version.
