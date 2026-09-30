import assert from 'node:assert/strict';
import { test } from 'node:test';
import { faviconUrl, formatCount, formatRelativeTime } from '../src/core/format.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const NOW = new Date(2026, 8, 30, 12).getTime();

test('formatCount 加千分位', () => {
  assert.equal(formatCount(1284), '1,284');
  assert.equal(formatCount(7), '7');
});

test('formatRelativeTime', () => {
  assert.equal(formatRelativeTime(0, NOW), '—');
  assert.equal(formatRelativeTime(NOW - 10 * 1000, NOW), '刚刚');
  assert.equal(formatRelativeTime(NOW - 3 * MINUTE, NOW), '3 分钟前');
  assert.equal(formatRelativeTime(NOW - 5 * 60 * MINUTE, NOW), '5 小时前');
  assert.equal(formatRelativeTime(NOW - 2 * DAY, NOW), '2 天前');
  assert.equal(formatRelativeTime(new Date(2026, 5, 1).getTime(), NOW), '6月1日');
  assert.equal(formatRelativeTime(new Date(2025, 11, 25).getTime(), NOW), '2025年12月25日');
});

test('faviconUrl 使用扩展内的 _favicon 接口', () => {
  globalThis.chrome = { runtime: { getURL: (path) => `chrome-extension://abc${path}` } };
  assert.equal(
    faviconUrl('https://a.com/'),
    'chrome-extension://abc/_favicon/?pageUrl=https%3A%2F%2Fa.com%2F&size=32',
  );
});
