# 信息图 - 完整执行指令

## 总览

输入一段知识内容（文字或链接），经过五步处理：输入处理 → 知识结晶 → 风格确认 → 生成卡片图（手绘风 或 信息图海报风）→ 输出到桌面。

## 执行流程

### Step 1：输入处理

判断用户输入的类型：
- **外部链接**（URL）：调用 `/web-access` skill 抓取全文内容，不要问用户。公众号文章（mp.weixin.qq.com）、网页文章、博客等一律走 `/web-access`
- **本地文件路径**（D:\Obsidian\... 等）：直接用 Read 工具读取
- **文字**：直接进入 Step 2
- **对话上下文**：如果用户在对话中先贴了内容，再说"做成知识卡片"，从上下文提取该内容

抓取失败时告知用户并请求粘贴原文，不要反复重试。

### Step 2：知识结晶

对原文做 80/20 压缩：提取 20% 的核心信息，覆盖 80% 的内容价值。结晶的唯一消费者是 Step 4 的生图 prompt，不放进最终笔记，也不展示给用户。

**第一步：内容分型**

先判断原文属于哪种类型，不同类型用不同提取策略：

| 类型 | 特征 | 提取策略 | 视觉风格 |
|------|------|----------|----------|
| 观点论证 | 有明确立场，用论据支撑 | 提取核心观点 + 关键论据链 | Style A：手绘风 |
| 方法清单 | 步骤、技巧、框架，各项之间有顺序或层级关系 | 提取框架结构 + 每项的一句话精髓 | Style A：手绘风 |
| 概念解释 | 解释一个新概念或模型 | 提取定义 + 关键区分 + 适用场景 | Style A：手绘风 |
| 案例故事 | 以叙事为主，结论隐含在故事中 | 提取情节转折点 + 背后的洞察 | Style A：手绘风 |
| 混合型 | 以上多种混合 | 识别主线类型，按主线策略提取 | Style A：手绘风 |
| 清单盘点 | 并列的工具/资源/推荐列表，各项独立无先后，重在覆盖面和逐项区分 | 提取每项名称 + 一句话定位 + 分类标签 | Style B：信息图海报风 |
| 参数对比 | 多个对象按相同维度做对比，有表格化特征 | 提取对比维度 + 每项各维度的值 + 亮点差异 | Style B：信息图海报风 |

> **方法清单 vs 清单盘点 的判断：** 如果各项之间有"先做A再做B"的顺序或"基础→进阶"的层级关系，选方法清单；如果各项是平行并列的（去掉任何一项不影响其他项的理解），选清单盘点。

**第二步：核心提取**

1. 一句话结论：全文最核心的一个判断，不超过 30 字
2. 关键点提取（3-7 个）：
   - 每个关键点 = 一个判断句（直接写结论，不写"作者认为""文章提到"）
   - 关键点之间标注关系（递进、并列、因果、对比、包含、时间线……不限于固定类型，用最准确的词）
3. 锚点挂载：每个关键点配一个还原锚点——原文中最有辨识度的金句、数据或例子，不超过 20 字
4. 视觉提示：每个关键点附带一个图标/场景联想词，用于生图时转化为插画元素（如"咖啡杯""阶梯""人群"）

**第三步：边界标注（可选）**

只在原文明确提到不适用场景时才写，没有就跳过，不硬凑。

**输出格式：**

```
【类型】观点论证 / 方法清单 / 概念解释 / 案例故事 / 混合型

【结论】一句话核心判断

【关键点】
1. 判断句（与上一点的关系）
   锚点："金句或数据"
   视觉：图标/场景联想词
2. ...

【边界】（仅在原文明确提及时）

【来源】标题/作者/日期（或原文链接）
```

**清单盘点型 输出格式：**

```
【类型】清单盘点

【结论】一句话核心判断

【关键点】
1. 项目名称
   一句话：核心定位/特点
   标签：[标签1] [标签2] [标签3]
   视觉：图标联想词
2. ...

【分组】（可选，如果原文有明确分类维度）
- 分组A：项目1, 项目3
- 分组B：项目2, 项目4

【来源】标题/作者/日期（或原文链接）
```

**参数对比型 输出格式：**

```
【类型】参数对比

【结论】一句话核心判断

【对比维度】维度1 | 维度2 | 维度3 | ...

【关键点】
1. 对比项名称
   维度1：值
   维度2：值
   维度3：值
   亮点：最突出的差异点
2. ...

【来源】标题/作者/日期（或原文链接）
```

**约束：**
- 关键点数量跟随内容本身的结构：原文有明确的 N 点结构（如"9条心得""7个原则"）且每项有独立信息增量，保留完整数量，不强行压缩；原文是散文/论证型无明确条目的，提炼 3-7 个关键点，宁少勿多
- 不添加原文没有的推论或评价
- 碎片信息（语录、清单）直接归类合并，不强行造结构
- 视觉提示要具体可画，避免抽象词（"重要性"→ 不行，"天平/奖杯"→ 可以）

结晶完成后进入 Step 3 风格确认，结晶内容本身不展示给用户。

### Step 3：选择风格（自动）

结晶完成后，根据内容类型自动选择对应的视觉风格，不等待确认，直接进入 Step 4 生图。

风格路由表（自动选择，无需用户介入）：
- 观点论证 / 方法清单 / 概念解释 / 案例故事 / 混合型 → Style A：手绘横版（2048x1536）
- 清单盘点 / 参数对比 → Style B：信息图竖版（1536x2048）

### Step 4：生成知识卡片图

根据内容类型选择对应的视觉风格和尺寸，动态构建生图 prompt，调用生图脚本。

**风格路由表：**

| 内容类型 | 视觉风格 | 图片尺寸 |
|----------|----------|----------|
| 观点论证 / 方法清单 / 概念解释 / 案例故事 / 混合型 | Style A：有机手绘风 | 2048x1536（横版） |
| 清单盘点 / 参数对比 | Style B：信息图海报风 | 1536x2048（竖版） |

**调用方式：**

```bash
node "C:/Users/duansb/.claude/skills/信息图/scripts/generate-image.mjs" \
  --prompt "<动态生成的英文prompt>" \
  --size <根据路由表选择尺寸> \
  --quality high \
  --out "C:/Users/duansb/Desktop/信息图-<主题>.png"
```

---

#### Style A：有机手绘风（观点论证 / 方法清单 / 概念解释 / 案例故事 / 混合型）

Prompt 由三部分拼接：固定风格前缀 + 动态内容 + 固定风格后缀。全部用英文书写。

**固定风格前缀（直接复制，不要改动）：**

```
Exquisite hand-drawn knowledge infographic on clean white background. Visual note-taking style, like a talented illustrator's lively sketchnote — vivid, organic, and full of character. All text is Chinese-dominant, every Chinese character must be ultra sharp, perfectly legible, written in thick black marker pen hand-lettering style — bold, neat, and highly readable. Only product names, technical terms, abbreviations, or untranslatable proper nouns may remain in English. NO English subtitles or bilingual headings.

Black ink hand-drawn lines with marker pen texture, varied stroke thickness, clean and bold. Rich detailed illustrations including characters, objects, scenes, speech bubbles, arrows, labels, dividers, banners, badges, and visual metaphors. Each content section tells a small visual story, not just flat icons or pure text.

Layout follows the natural flow of thinking — freely organized by content using hand-drawn sections, card frames, arrow flows, comparison structures, banner summaries, highlight labels, and doodle decorations. High information density with clear hierarchy, not cluttered.

Color palette: black-and-white dominant, with minimal RED for numbering, keywords, warnings, arrows, and standout markings; YELLOW and ORANGE for highlights, glow effects, tags, conclusion boxes, and warm accents. Light gray shading for hand-drawn depth.

Decorative doodles around title area and edges: stars, lightbulbs, rockets, charts, hearts, dotted trails, checkmarks, tech symbols. Overall feel: vivid, warm, smart, detailed, professionally finished — like an exceptional illustrator's lively Chinese visual notes.
```

**动态内容（根据结晶结果填充）：**

将结晶的每个关键点转化为一个编号视觉区块（①②③...），每个区块是一个**有角色、有叙事、有层次的微型故事场景**，不是图标配标签。

每个区块包含：
- **区块标题**：关键点的核心词，**中文，在描述中显式写出中文原文**
- **场景叙事描述**（核心，决定图的丰富度）：用 **5-8 句英文**描述一个完整的视觉故事场景，必须包含以下要素：
  - **角色驱动**：至少 1 个有明确动作和表情的人物角色（如：a boy sitting at laptop looking frustrated, a girl with beret examining paintings with magnifying glass），不要只画抽象图标
  - **叙事结构**：用对比（before vs after）、因果（problem → solution）、或转折来讲故事，不要平铺陈述
  - **多层道具**：每个场景至少 3-4 个具体物件/道具（laptop, phone, books, clock, diamond, magnifying glass...），让画面有信息密度
  - **必须把该区块需要显示的所有中文文字（锚点金句、标注、说明、标签）逐一写进 prompt 中**，用双引号包裹
- **文字标注**（每个区块至少 3-4 个独立标注）：
  - 锚点金句 → quote bubble 或 speech bubble
  - 关键概念 → colored tag pill（红色/橙色圆角标签药丸）
  - 补充说明 → small label 或 hand-drawn annotation
  - 核心术语 → red/yellow highlight box
  - **所有标注的中文原文必须显式写在 prompt 中**
- **装饰元素**：每个区块内部散布小装饰（stars, sparkles, arrows, exclamation marks, checkmarks），不要只依赖区块之间的装饰

布局组装规则：
- TOP TITLE：从【结论】提取核心主题词，配中文大标题（必须写出中文原文），**不写英文副标题**
- NUMBERED SECTIONS：每个关键点一个编号区块，按逻辑顺序排列，用 hand-drawn arrows 连接
- BOTTOM BANNER：用手绘横幅呈现【结论】的完整一句话，**必须写出中文原文**

对于「方法清单」类内容（步骤、等级、框架），保持逐项展开，不要合并压缩——清单的价值在于每项的区分度。

**固定风格后缀（直接复制，不要改动）：**

```
Loose, organic layout with hand-drawn divider lines and arrows connecting ideas. Small doodles and decorative elements scattered throughout. Chinese text dominant, Chinese as the primary language. HIGH information density through RICH visual elements not text walls. Feels like an exceptional illustrator's lively Chinese visual notes — warm, vivid, detailed, and full of character. AVOID: English subtitles, forced bilingual text, large English descriptions, low detail, simple icons only, large empty spaces, messy layout, illegible text, garbled Chinese characters, photorealistic style, 3D rendering, dark backgrounds, neon cyberpunk, flat vector style, pure PowerPoint look, plain bullet points, blurry lines.
```

---

#### Style B：信息图海报风（清单盘点 / 参数对比）

Prompt 由三部分拼接：固定风格前缀 + 动态内容 + 固定风格后缀。全部用英文书写。

**固定风格前缀（直接复制，不要改动）：**

```
Vertical Chinese infographic poster style. Light tech aesthetic with white-to-light-gray gradient background, clean and bright, modern minimalist. High information density yet airy layout. Three-column grid layout with abundant rounded-corner card modules, thin borders, subtle shadows, soft whitespace, strictly aligned. Top area features a large bold Chinese title in heavy black font, smaller subtitle in clean typesetting, accented with light 3D tech-style illustrations. Section titles use colorful numbered circle badges in blue, purple, green, orange, pink, and teal for multi-color emphasis. Inside each card: white sub-item cards with icon on the left, text on the right, and small rounded tag badges.
```

**动态内容——清单盘点：**

将结晶的每个关键点转化为一个网格卡片模块，每张卡片包含：
- 彩色编号徽章（①②③...）+ 项目名称作为卡片标题（中文大字）
- 白色子条目卡片：左侧放基于「视觉」字段的图标描述，右侧放一句话定位
- 底部标签栏：将结晶中的「标签」转化为彩色圆角标签药丸（colored rounded-rect tag pills）

布局组装规则：
- TOP TITLE：从【结论】提取核心主题词，配中文大标题 + 英文副标题，搭配轻 3D 科技插画点缀
- CARD GRID：3 列网格排列。如果有【分组】，用分组标题将卡片分区
- BOTTOM：一句话结论放在 highlight box 中，来源信息小字标注

**动态内容——参数对比：**

将结晶内容转化为对比信息图：
- 每个对比项 → 一张卡片模块，卡片内包含各维度的子条目（左侧维度名标签，右侧值）
- 亮点维度用高亮色彩色标签标注
- 顶部放维度图例说明

布局组装规则：
- TOP TITLE：核心主题词 + "对比/Comparison"，中文大标题 + 英文副标题
- COMPARISON CARDS：如对比项 ≤ 3 个，用横向并列卡片；≥ 4 个，用纵向堆叠排列
- 如果维度超过 5 个，选择最重要的 4-5 个维度展示
- BOTTOM：一句话结论总结最关键的对比发现，放在 highlight box 中

**固定风格后缀（直接复制，不要改动）：**

```
Overall visual similar to Xiaohongshu/WeChat knowledge summary long images, AI tool roundup posters, SaaS product infographics. Professional, trustworthy, lightweight, orderly. Combines flat UI with light 3D icons. Chinese text is crisp and sharp, optimized for mobile reading. Refined, clean, practical. MUST AVOID: dark themes, cyberpunk, complex backgrounds, strong glare effects, cluttered layout, overlapping cards, exaggerated shadows, retro style, handwritten fonts, low resolution, garbled text, excessive decoration, photorealistic style.
```

### Step 5：返回结果

生成完成后：
1. 用 Read 工具展示图片给用户看
2. 告知用户图片已保存到桌面：`C:\Users\duansb\Desktop\信息图-<主题>.png`

## 注意事项

- 复用 `生图` skill 的 `generate-image.mjs`，不要自己写生图逻辑
- 图片只输出到桌面，不上传 OSS，不写入 OB
- 如果是从 `/入库` skill 调用过来的，同样只输出到桌面
