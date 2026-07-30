# 准星 — 设计文档

> 聚焦关注圈，盯住目标博主，把他们的最新内容集中送到眼前。

## 1. 产品定位

准星是本地关注圈内容阅读器。它不复刻平台推荐流，而是围绕用户明确关注的目标博主，将最新内容集中呈现，降低跨平台追踪成本。

- Skill 名称：准星（安装目录为 `准星skill`）
- 强触发语义：准星、信息源、信息源监控、关注博主最新内容
- 本地运行，不做登录、云端部署或推送通知
- 每次打开主动更新，不做后台定时任务

## 2. 平台范围与契约边界

产品界面支持四个平台：

1. YouTube
2. 公众号
3. 小红书
4. 抖音

YouTube 使用公开 RSS 实际接入。公众号和抖音已依据 Redfox 契约真实接入；小红书目前仅有账号验证契约，缺少按博主获取作品列表的能力，因此不能承诺真实的博主内容监控。实现不得猜测契约未提供的 Header、端点或响应字段，也不得用演示数据冒充真实抓取结果。

## 3. 打开与停止

### 每次打开

`scripts/open-zhunxing.ps1` 执行以下流程：

1. 读取 `app/.env` 的 `PORT`，空值回退到 `3000`；服务固定监听 `127.0.0.1`，`.env.example` 中的 `HOST` 仅为兼容占位，不作为可配置监听地址。
2. 请求 `GET /api/health`，只有响应中的 `app` 等于 `zhunxing` 才视为准星服务。
3. 服务未运行时，使用 WorkBuddy 隔离托管 Node.js 22.22.2 的绝对路径启动。
4. 缺少依赖时，通过同一托管 Node 执行对应 npm CLI；有锁文件用 `npm ci`，否则用 `npm install`。
5. 将进程 PID、stdout、stderr 分别记录到 PID 文件和日志文件。
6. 健康后请求 `POST /api/fetch`，正文为 `{ "trigger": "skill-open" }`。
7. 抓取成功或失败都打开准星页面。

### 停止

`scripts/stop-zhunxing.ps1` 读取 PID 文件，并在停止进程前同时验证：

- 健康响应 `app === "zhunxing"`
- 健康响应 `pid` 与 PID 文件一致
- 本机确实存在该 PID

任一条件不满足都不终止进程，避免误杀。

## 4. 技术架构

```text
浏览器三栏阅读器（原生 HTML/CSS/JS）
              │ REST API
              ▼
          Express 服务
     ┌────────┼────────┐
     ▼        ▼        ▼
  关注管理   内容抓取   AI 摘要
     │        │        │
     └────────┴────────┘
              ▼
          sql.js / SQLite
          data/feeds.db
```

核心依赖：

| 包名 | 用途 |
|---|---|
| express | HTTP 服务与静态页面 |
| sql.js | 纯 JavaScript/WASM SQLite，避免原生编译依赖 |
| rss-parser | YouTube RSS/Atom 解析 |
| @anthropic-ai/sdk | 按需按长文萃取规则生成结构化内容 |
| youtube-transcript | 尝试获取 YouTube 字幕 |
| dotenv | 本地环境变量加载 |

不使用 `node-cron` 或 `open`：更新由 Skill 每次打开触发，浏览器由 PowerShell 脚本打开。

### 运行时提示词约定

`app/src/prompts/` 只存放应用运行时提示词，文件统一使用 kebab-case。长文萃取提示词同步自本地「长文萃取」Skill，但应用通过 Anthropic Messages API 执行同一套规则，不启动 Claude Code Skill 运行时。每次调整输出规则时必须提升缓存版本；旧版本直接替换，不在目录中保留多份历史提示词。

## 5. 数据模型

### bloggers

| 字段 | 说明 |
|---|---|
| id | 本地主键 |
| name | 博主名称 |
| channel_type | youtube / wechat / xiaohongshu / douyin |
| channel_id | 平台内唯一标识 |
| avatar_color | 展示颜色 |
| created_at | 关注时间 |
| last_fetched_at | 最后抓取时间 |

唯一约束：`(channel_type, channel_id)`。

### articles

| 字段 | 说明 |
|---|---|
| id | 本地主键 |
| blogger_id | 所属博主 |
| title / url | 标题与原文链接 |
| summary / ai_summary | 来源摘要与 AI 摘要 |
| thumbnail | 缩略图 |
| published_at / fetched_at | 发布与抓取时间 |
| is_read | 已读状态 |

唯一约束：`(blogger_id, url)`。删除博主时级联删除其文章和主题关系；**取消关注即删除历史内容**，不保留孤立数据。

### topics / blogger_topics

主题由用户维护，博主与主题为多对多关系。删除主题不删除博主；删除博主清理对应关系。

## 6. API 契约

```text
GET    /api/health                    健康信息 { app: "zhunxing", pid }
GET    /api/bloggers                  博主列表
POST   /api/bloggers                  添加博主
DELETE /api/bloggers/:id              取消关注并删除历史内容
PUT    /api/bloggers/:id/topics       更新主题归属
GET    /api/topics                    主题列表
POST   /api/topics                    新建主题
PUT    /api/topics/:id                编辑主题
DELETE /api/topics/:id                删除主题
GET    /api/articles                  内容列表
PUT    /api/articles/:id/read         标记已读
PUT    /api/articles/read-all         全部已读
POST   /api/articles/:id/summary      按需生成 AI 摘要
POST   /api/fetch                     抓取全部关注，接受 trigger
POST   /api/fetch/:blogger_id         抓取单个博主
GET    /api/fetch/status              抓取状态
```

每次 Skill 打开调用全量抓取，`trigger` 固定为 `skill-open`，便于服务端区分来源。抓取失败不阻止用户查看已有内容。

## 7. 页面结构

- 左栏：关注博主与主题导航、搜索、添加/取消关注。
- 中栏：选中范围内的最新内容列表、未读状态与最近更新时间。
- 右栏：内容预览、视频播放、原文入口与按需长文萃取。

“生成摘要”采用长文萃取规则，依次展示信息速览、洞见种子（含 A/B/C 证据等级）和“对我可能有用的点”；复杂内容可增加“额外提炼”。无法取得全文或字幕时，必须在结果顶部标明“基于有限信息生成，不等同于全文分析”。结果继续缓存于 `articles.ai_summary TEXT`，使用内部版本前缀自动淘汰旧模板；本阶段不新增数据库字段或迁移。

文案围绕一个核心承诺：**聚焦关注圈，盯住目标博主，把他们的最新内容集中送到眼前。**

## 8. 配置与安全

`.env.example` 只提供空值占位：

- `HOST`、`PORT`
- `ANTHROPIC_API_KEY`
- `REDFOX_BASE_URL`、`REDFOX_API_KEY`
- `WECHAT_BASE_URL`、`WECHAT_API_KEY`

真实 `.env` 不进入版本库，不读取给对话，不在控制台或日志中输出密钥。外部平台契约未明确前，不扩展配置名。

## 9. 明确不做

- 不做定时任务；只在每次打开或用户手动操作时更新。
- 不保留已取消关注博主的历史内容。
- 不猜测三方服务契约，不用假数据伪装真实接入。
- 不做登录、权限、云部署、推送或自动批量摘要。
