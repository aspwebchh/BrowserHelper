import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildList } from '../src/core/pipeline.js';
import { DEFAULTS } from '../src/core/settings.js';

const NOW = Date.UTC(2026, 8, 30, 12);
const rec = (url, visitCount) => ({
  url, title: '', visitCount, typedCount: 0, lastVisitTime: NOW, visits: null,
});
const RECORDS = [
  rec('https://github.com/a', 30),
  rec('https://mail.google.com/', 20),
  rec('https://www.google.com/search?q=1', 10),
  rec('https://www.zhihu.com/', 5),
];
const settings = (patch = {}) => ({ ...DEFAULTS, ...patch });
const keys = (entries) => entries.map((e) => e.key);

test('默认按域名、按访问次数排序', () => {
  const { pinned, ranked } = buildList(RECORDS, settings(), NOW);
  assert.deepEqual(pinned, []);
  assert.deepEqual(keys(ranked), ['domain:github.com', 'domain:mail.google.com', 'domain:google.com', 'domain:zhihu.com']);
});

test('屏蔽域名时一并屏蔽子域名', () => {
  const { ranked } = buildList(RECORDS, settings({ excludeDomains: ['www.google.com'] }), NOW);
  assert.deepEqual(keys(ranked), ['domain:github.com', 'domain:zhihu.com']);
});

test('隐藏的条目不出现，且隐藏优先于置顶', () => {
  const { pinned, ranked } = buildList(RECORDS, settings({
    hiddenKeys: ['domain:zhihu.com'],
    pinnedKeys: ['domain:zhihu.com'],
  }), NOW);
  assert.deepEqual(pinned, []);
  assert.ok(!keys(ranked).includes('domain:zhihu.com'));
});

test('置顶条目按设置中的顺序排列，并从排行中移出', () => {
  const { pinned, ranked } = buildList(RECORDS, settings({
    pinnedKeys: ['domain:zhihu.com', 'url:https://nowhere.com/', 'domain:github.com'],
  }), NOW);
  assert.deepEqual(keys(pinned), ['domain:zhihu.com', 'domain:github.com']);
  assert.deepEqual(keys(ranked), ['domain:mail.google.com', 'domain:google.com']);
});

test('按网址统计时 key 使用 url: 前缀', () => {
  const { ranked } = buildList(RECORDS, settings({ groupBy: 'url' }), NOW);
  assert.equal(ranked[0].key, 'url:https://github.com/a');
});
