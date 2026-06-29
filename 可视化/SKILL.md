---
name: 可视化
description: >-
  将知识内容（文字、笔记、录音转写、文章等）转化为结构化的可视化HTML页面，辅助知识学习与深度理解。
  页面自带鼠标划线备注系统（选中文字→记笔记→下划线标记）和错题本（所有划线记录汇总、跳转原文、删除）。
  当用户要求可视化、知识可视化、做成可视化页面、可视化笔记、可视化学习、把XX内容做成页面、做一个学习页面时使用。
  当用户提供知识内容并希望系统化展示、带交互式学习功能时使用。
---

# 可视化 Skill

将知识内容转化为结构化的可视化 HTML 学习页面。

## 工作流程

1. 理解用户提供的知识内容，梳理逻辑结构
2. 用以下组件将内容组织为板块化的视觉页面
3. 将内容填入模板，输出为单个自包含 HTML 文件

## 页面组件库

生成页面时，根据内容特征选用以下组件：

### 基础布局
- **page-layout** — 页面最外层 flex 容器，包含左侧目录 + 右侧主内容
- **toc-sidebar** — 左侧目录导航栏，JS 自动从 section h2/h3 生成，滚动时高亮当前位置，移动端收起为侧滑抽屉
- **section** — 每个独立主题用一个 `.section` 卡片包裹，`h2` 标题前加 `.num` 序号
- **h3 子标题** — 橙色左边框，用于板块内子主题
- **h4 子标题** — 用于更细粒度的分组

### 信息展示
- **info-card** — 指标卡，含 `.card-label`（标签）、`.card-value`（数值）、`.card-desc`（说明），用 `.info-grid` 网格排列
- **data-table** — 数据对比表，`th` 表头灰底
- **compare-grid** — 两栏对比布局，`.compare-col` 左/右列

### 流程与步骤
- **flow** — 横向流程图，`.flow-step` 节点 + `.flow-arrow` 箭头（→）
- **process** — 纵向步骤列表，CSS 自动编号

### 引用与标注
- **quote** — 紫色左边框引用块，用于原文摘录
- **badge** — 小标签，绿/红/蓝/黄四色（`.badge-green` / `.badge-red` / `.badge-blue` / `.badge-yellow`）
- **num-highlight** — 数字高亮（橙色加粗）
- **unclear-block** — 黄色虚线框，标注不确定的概念

### 其他
- **tag** — 圆角标签，用 `.tag-row` 包裹
- **hr** — 分隔线
- **legend** — 图例条

## HTML 模板

使用 `assets/template.html` — 这是完整的页面框架，包含：

1. **CSS 设计系统** — 浅色主题，CSS 变量驱动，响应式
2. **划线备注系统** — 鼠标划选文字 → 弹出「💡 记一笔」→ 填写备注 → 橙色波浪下划线标记
3. **错题本** — 右下角 📋 浮动按钮 → 侧边面板展示所有划线记录（含上下文、跳转原文、删除）
4. **数据持久化** — 所有划线备注自动存入浏览器 localStorage

## 生成页面的步骤

### Step 1: 分析内容结构
阅读用户提供的知识内容，识别：
- 有几个独立主题？（每个主题 = 一个 section）
- 有哪些对比关系？（用 compare-grid 或 data-table）
- 有哪些流程/步骤？（用 flow 或 process）
- 有哪些关键数据点？（用 info-card）
- 有哪些需要引用的原文？（用 quote）

### Step 2: 构建 HTML
直接基于 `assets/template.html`，替换三个占位区域：

**HEADER_PLACEHOLDER** → 替换为页面头部：
```html
<div class="header">
  <h1>页面标题</h1>
  <div class="meta"><span>副标题/日期/来源</span></div>
  <div class="source-tags">
    <span class="source-tag" style="border-color:var(--accent);color:var(--accent);">📻 来源标签</span>
  </div>
</div>
```

**CONTENT_PLACEHOLDER** → 替换为所有 section 板块，例如：
```html
<div class="section">
  <h2><span class="num">1</span> 板块标题</h2>
  <p>正文内容…</p>
  <!-- 根据需要使用 data-table, info-card, flow, process, quote 等 -->
</div>
```

**FOOTNOTE_PLACEHOLDER** → 替换为页脚：
```html
<div class="footnote">
  <p><strong>整理说明：</strong>此处写来源、方法说明等</p>
</div>
```

### Step 3: 输出
将完整 HTML 保存到用户指定位置（默认桌面），告知用户用浏览器打开即可使用划线学习和错题本功能。

## 内容组织原则

- **穷尽但不重复** — 同一信息不跨板块重复
- **基于原文** — 不添油加醋，不编造原文没有的内容
- **颗粒度匹配原文** — 不删减原文覆盖的要点
- **概念存疑标注** — 遇到无法确定含义的术语，用 `.unclear-block` 标注出来
- **中文优先** — 标题、标签用中文，CSS 类名保持英文

## 注意事项

- 输出文件必须是完整的、可独立打开的 HTML（不依赖外部资源）
- 模板中的 JS 划线系统和错题本**不要修改**，直接保留
- 页面默认浅色主题，CSS 变量集中在 `:root` 中，如需调色只改变量值
- 生成完先验证：用 Edge 无头截图检查页面渲染是否正常
