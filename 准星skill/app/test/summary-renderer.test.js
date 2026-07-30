import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLongExtract } from '../public/summary-renderer.js';

const MARKDOWN = `> 内容完整度提示：基于有限信息生成。

**【第一部分：信息速览】**
1. **要点 (Key Points):** 关键要点
2. **简单解释 (Simple Explanation):** 简单解释
3. **核心价值 (Core Value):** 核心价值

**【第二部分：洞见种子清单 — 测试】**
- **洞见1**: 第一条洞见
    - 原文语录
    - **证据等级**: A
    - **启发性追问**: 如何迁移？
- **洞见2**: 第二条洞见
    - **证据等级**: C

**【额外提炼】**
- **案例抽象**: 通用模式

**【第三部分：对我可能有用的点】**
- **内容策略**：用于选题。
- **知识管理**：用于建立洞见卡。`;

test('parser recognizes dynamic sections, insights and optional fields', () => {
  const result = parseLongExtract(MARKDOWN);
  assert.match(result.warning, /有限信息/);
  assert.deepEqual(result.sections.map(section => section.kind), ['overview', 'insights', 'extra', 'personal']);
  const insights = result.sections.find(section => section.kind === 'insights').blocks.filter(block => block.type === 'insight');
  assert.equal(insights.length, 2);
  assert.equal(insights[0].evidence, 'A');
  assert.equal(insights[0].questions, '如何迁移？');
  assert.deepEqual(insights[0].notes, ['原文语录']);
  assert.equal(insights[1].evidence, 'C');
});

test('malicious HTML remains inert text data', () => {
  const attack = `${MARKDOWN}\n<img src=x onerror=alert(1)>\n<script>alert(1)</script>`;
  const result = parseLongExtract(attack);
  const personal = result.sections.find(section => section.kind === 'personal');
  assert.equal(personal.blocks.at(-2).text, '<img src=x onerror=alert(1)>');
  assert.equal(personal.blocks.at(-1).text, '<script>alert(1)</script>');
});

test('renderer source builds DOM without model-controlled innerHTML', () => {
  const source = fs.readFileSync(new URL('../public/summary-renderer.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(source, /textContent/);
  assert.match(source, /document\.createElement/);
});
