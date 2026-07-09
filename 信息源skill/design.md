# 信息源监控 — 设计文档

> 日期：2026-07-09
> 状态：待确认

## 1. 项目概述

从杂乱的推荐流中提取关注的博主和主题，聚合到一个本地阅读器。用户自由管理关注列表，系统每天自动抓取更新，通过三栏阅读器按博主/主题维度浏览内容。

**第一期范围**：YouTube 频道监控 + 本地阅读器
**后续扩展**：公众号、小红书、抖音等渠道

## 2. 使用方式

- 通过 Claude Code skill 触发启动（触发词：信息源、信息源监控）
- 终端执行 `npm start`，自动打开浏览器 `http://localhost:3000`
- 本地使用，不需要部署到服务器
- 关闭终端即停止服务

## 3. 技术架构

```
┌─────────────────────────────────────────────┐
│                 浏览器                        │
│   三栏阅读器（HTML/CSS/JS，无框架）           │
└──────────────────┬──────────────────────────┘
                   │ REST API
┌──────────────────▼──────────────────────────┐
│              Express 服务                     │
│                                              │
│  路由层        服务层         定时任务          │
│  /api/*  →  BloggerService  ← node-cron     │
│             TopicService      每天 06:00      │
│             ArticleService                   │
│             FetchService                     │
│                  │                           │
│          ┌───────▼────────┐                  │
│          │  Fetcher 接口   │                  │
│          ├────────────────┤                  │
│          │ YouTubeFetcher │ ← rss-parser     │
│          │ (未来)WechatF  │                  │
│          │ (未来)XhsF     │                  │
│          └───────┬────────┘                  │
│                  │                           │
│          ┌───────▼────────┐                  │
│          │    SQLite       │ ← better-sqlite3│
│          │   feeds.db      │                 │
│          └────────────────┘                  │
└──────────────────────────────────────────────┘
```

### 依赖清单

| 包名 | 用途 |
|---|---|
| express | HTTP 服务 |
| better-sqlite3 | SQLite 驱动（同步 API，简单可靠） |
| rss-parser | RSS/Atom 解析 |
| node-cron | 定时任务 |
| open | 启动时自动打开浏览器 |
| @anthropic-ai/sdk | Claude API 调用（AI 摘要） |
| youtube-transcript | 获取 YouTube 视频字幕文本 |

## 4. 数据库设计

### bloggers 表 — 关注的博主

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | 自增主键 |
| name | TEXT NOT NULL | 博主昵称 |
| channel_type | TEXT NOT NULL | 渠道类型：youtube / wechat / xiaohongshu |
| channel_id | TEXT NOT NULL | 渠道内唯一标识（YouTube 为 channel_id） |
| avatar_color | TEXT | 头像渐变色，自动生成 |
| created_at | TEXT | 添加时间 |
| last_fetched_at | TEXT | 最后抓取时间 |

唯一约束：`(channel_type, channel_id)`

### articles 表 — 抓取到的文章/视频

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | 自增主键 |
| blogger_id | INTEGER FK | 关联 bloggers.id |
| title | TEXT NOT NULL | 标题 |
| url | TEXT NOT NULL | 原文链接 |
| summary | TEXT | 摘要/描述（RSS 原始） |
| ai_summary | TEXT | AI 生成的摘要 |
| thumbnail | TEXT | 缩略图 URL |
| published_at | TEXT | 发布时间 |
| fetched_at | TEXT | 抓取时间 |
| is_read | INTEGER DEFAULT 0 | 是否已读 |

唯一约束：`(blogger_id, url)` — 防止重复抓取

### topics 表 — 用户自定义主题

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | 自增主键 |
| name | TEXT NOT NULL UNIQUE | 主题名称 |
| icon | TEXT | 主题图标（emoji） |
| created_at | TEXT | 创建时间 |

### blogger_topics 表 — 博主与主题的多对多关系

| 字段 | 类型 | 说明 |
|---|---|---|
| blogger_id | INTEGER FK | 关联 bloggers.id |
| topic_id | INTEGER FK | 关联 topics.id |

联合主键：`(blogger_id, topic_id)`

## 5. API 设计

### 博主管理

```
GET    /api/bloggers              — 博主列表（含未读数）
POST   /api/bloggers              — 添加博主 { name, channel_type, channel_id }
DELETE /api/bloggers/:id          — 取消关注（保留历史文章）
PUT    /api/bloggers/:id/topics   — 更新博主的主题归属 { topic_ids: [] }
```

### 主题管理

```
GET    /api/topics                — 主题列表（含博主数、未读数）
POST   /api/topics               — 新建主题 { name, icon }
PUT    /api/topics/:id           — 编辑主题 { name, icon, blogger_ids: [] }
DELETE /api/topics/:id           — 删除主题（不影响博主）
```

### 文章

```
GET    /api/articles?blogger_id=&topic_id=  — 文章列表（支持按博主或主题筛选）
PUT    /api/articles/:id/read               — 标记已读
PUT    /api/articles/read-all?blogger_id=   — 全部已读
POST   /api/articles/:id/summary            — 生成 AI 摘要
```

### 抓取

```
POST   /api/fetch                — 手动触发全量抓取
POST   /api/fetch/:blogger_id   — 抓取单个博主
GET    /api/fetch/status         — 上次抓取状态和时间
```

## 6. 前端设计

直接复用 brainstorming 阶段确认的三栏阅读器布局：

### 左栏（260px）— 导航

- 顶部：博主/主题维度切换 tab
- 搜索框：过滤博主或主题
- 博主视图：按「有新内容 / 已读完」分组，头像右上角红色角标显示未读数
  - 悬停操作：🏷 归入主题、✕ 取消关注
- 主题视图：图标 + 主题名 + 角标
  - 悬停操作：✎ 编辑、✕ 删除
- 底部：+ 添加博主 / + 新建主题（跟随维度切换）

### 中栏（340px）— 文章列表

- 顶部：当前博主/主题名称 + 渠道标签
- 统计栏：未读数 + 最近更新时间 + 全部已读按钮
- 文章卡片：标题（未读加粗）+ 摘要两行 + 来源·时间·标签

### 右栏（自适应）— 内容预览

- 顶部：来源标识 + 发布时间 + 操作按钮（收藏、原文链接、摘要）
- YouTube 视频：嵌入 iframe 播放器 + 视频描述
- 其他渠道（未来）：文章正文或跳转原文

### 浅色主题

白底 + 蓝色主色调（#4f6af6），与 mockup 一致。

## 7. AI 摘要功能

用户在右栏点击「📋 摘要」按钮触发，按需生成，不预生成。

### 流程

1. 前端请求 `POST /api/articles/:id/summary`
2. 后端检查 `ai_summary` 字段是否已有值 → 有则直接返回（不重复生成）
3. 无缓存时：通过 youtube-transcript 获取视频字幕文本
4. 调用 Claude API（Haiku，成本最低）生成结构化摘要
5. 摘要写入 `ai_summary` 字段持久化
6. 返回前端，右栏展示摘要卡片

### 摘要格式

```
核心观点：一句话概括
要点：
- 要点 1
- 要点 2
- 要点 3
关键词：xxx, xxx, xxx
```

### API Key 配置

应用首次启动时检查环境变量 `ANTHROPIC_API_KEY`：
- 有 → 摘要功能可用
- 无 → 摘要按钮显示为灰色，hover 提示「需要配置 API Key」

Key 配置方式：应用根目录 `.env` 文件中写入 `ANTHROPIC_API_KEY=sk-xxx`。

### 无字幕降级

部分视频没有字幕，此时用视频标题 + RSS 描述文本作为输入生成摘要，并在摘要卡片上标注「基于描述生成，非完整内容」。

## 8. 添加博主流程

用户点击「+ 添加博主」→ 弹窗：

1. 选择渠道（第一期仅 YouTube 可选）
2. 输入 YouTube 频道 URL 或频道名
3. 系统自动解析出 channel_id，验证 RSS 可用
4. 确认后保存，立即触发一次抓取

## 9. 定时抓取机制

- 使用 node-cron，每天 06:00 自动抓取所有关注博主
- 抓取逻辑：遍历 bloggers 表 → 按 channel_type 分发到对应 fetcher → 解析结果写入 articles 表（通过唯一约束去重）
- 应用启动时检查：如果距上次抓取超过 24 小时，立即补一次

## 9. Fetcher 接口（渠道扩展）

每个渠道实现一个 fetcher，统一接口：

```javascript
// fetchers/youtube.js
async function fetch(channelId) {
  // 返回标准格式
  return [
    {
      title: '...',
      url: '...',
      summary: '...',
      thumbnail: '...',
      published_at: '...'
    }
  ]
}
```

新增渠道只需：
1. 在 `fetchers/` 下新建文件，实现 `fetch(channelId)` 方法
2. 在 fetcher 注册表中添加映射
3. 前端「添加博主」弹窗中新增渠道选项

## 10. 项目目录结构

```
~/.claude/skills/信息源skill/
├── SKILL.md                    # Skill 定义文件
├── design.md                   # 本设计文档
└── app/                        # 应用代码
    ├── package.json
    ├── server.js               # 入口：Express + 定时任务
    ├── src/
    │   ├── db.js               # SQLite 初始化和连接
    │   ├── routes/
    │   │   ├── bloggers.js
    │   │   ├── topics.js
    │   │   ├── articles.js
    │   │   └── fetch.js
    │   ├── fetchers/
    │   │   ├── index.js        # fetcher 注册表
    │   │   └── youtube.js      # YouTube RSS fetcher
    │   └── summarizer.js       # AI 摘要（Claude API + 字幕获取）
    ├── public/                 # 前端静态文件
    │   ├── index.html
    │   ├── style.css
    │   └── app.js
    └── data/                   # 运行时数据（gitignore）
        └── feeds.db            # SQLite 数据库文件
```

## 11. Skill 集成

skill 的职责是启动/停止应用服务：

- **触发词**：信息源、信息源监控、info-source
- **启动行为**：`cd app && npm start` → 自动打开浏览器
- **停止行为**：关闭终端或 Ctrl+C

## 12. 不做的事（明确排除）

- 不做用户登录/权限系统
- 不做移动端适配
- 不做云端部署
- 不做推送通知
- 不做全文内容抓取（第一期只抓标题、摘要、链接）
- 不做自动批量生成摘要（按需点击生成，控制 API 成本）
