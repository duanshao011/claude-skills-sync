import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIdentity, normalizeAccount, pickAccountMatch } from '../src/fetchers/wechat.js';

// ── buildIdentity ────────────────────────────────────────────────────────

test('buildIdentity 老号无 account 按名称构造', () => {
  const id = buildIdentity('数字生命卡兹克', null);
  assert.equal(id.account, '');
  assert.equal(id.accountName, '数字生命卡兹克');
});

test('buildIdentity 有 account 只传微信号，不带 accountName（防 3203 交集成因）', () => {
  const id = buildIdentity('数字生命卡兹克', 'kazikai');
  assert.equal(id.account, 'kazikai');
  assert.ok(!('accountName' in id), '绝不能同传 accountName，否则红狐当交集查直接返回 3203');
});

test('buildIdentity 无 account 但 channel_id 形似微信号用正则兜底', () => {
  const id = buildIdentity('TheOrganicOrange', null);
  assert.equal(id.account, 'TheOrganicOrange');
  assert.ok(!('accountName' in id));
});

// 已知缺陷：纯英文公众号名（如 GitHubDaily）会被 WECHAT_ID 正则误判为微信号，
// 从而只传 account 不传 accountName，对未回填的老号可能导致 3203。
// 这条不会立即修——回填一次后 channel_account 就永久接管了，属于会自然消亡的代码路径。
test('buildIdentity 纯英文公众号名被正则误判（已知缺陷：仅影响未回填的老号）', () => {
  const id = buildIdentity('GitHubDaily', null);
  assert.equal(id.account, 'GitHubDaily');
  assert.ok(!('accountName' in id), '期望 {accountName:GitHubDaily}，但正则把纯英文名当成了微信号');
});

// ── normalizeAccount ─────────────────────────────────────────────────────

test('normalizeAccount 字段映射：camelCase → snake_case 且时间归一化', () => {
  const fixture = {
    account: 'duhaoshu',
    accountName: '十点读书',
    avatarUrl: 'http://example.com/avatar.jpg',
    description: '深夜十点，陪你读书。',
    verifyInfo: '微信认证：厦门十点文化传播有限公司',
    lastArticleTitle: '最近的爆文',
    lastPublishTime: '2026-08-03 16:28:23',
  };
  const a = normalizeAccount(fixture);
  assert.equal(a.account, 'duhaoshu');
  assert.equal(a.name, '十点读书');
  assert.equal(a.avatar_url, 'http://example.com/avatar.jpg');
  assert.equal(a.description, '深夜十点，陪你读书。');
  assert.equal(a.verify_info, '微信认证：厦门十点文化传播有限公司');
  assert.equal(a.last_article_title, '最近的爆文');
  assert.ok(a.last_publish_time);
});

test('normalizeAccount 缺字段全返回空字符串或 null', () => {
  const a = normalizeAccount({});
  assert.equal(a.account, '');
  assert.equal(a.name, '');
  assert.equal(a.avatar_url, null);
  assert.equal(a.description, '');
  assert.equal(a.last_publish_time, null);
});

// ── pickAccountMatch ─────────────────────────────────────────────────────

test('pickAccountMatch 精确名称且唯一 → 命中', () => {
  const match = pickAccountMatch('记忆承载', [
    { name: '记忆承载' },
    { name: '记忆承载官方' },
  ]);
  assert.equal(match?.name, '记忆承载');
});

test('pickAccountMatch 大小写宽松匹配 → 命中（修复 Agent橘 → AGENT橘）', () => {
  const match = pickAccountMatch('Agent橘', [
    { name: 'AGENT橘' },
    { name: 'Agent Framework' },
  ]);
  assert.equal(match?.name, 'AGENT橘');
});

test('pickAccountMatch 同名多个 → 返回 null 不猜', () => {
  const match = pickAccountMatch('记忆承载', [
    { name: '记忆承载', account: 'a' },
    { name: '记忆承载', account: 'b' },
  ]);
  assert.equal(match, null);
});

test('pickAccountMatch 空结果 → 返回 null', () => {
  const match = pickAccountMatch('X', []);
  assert.equal(match, null);
});
