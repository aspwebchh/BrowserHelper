import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frecency, rank } from '../src/core/rank.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 30, 12);

const entry = (key, visitCount, typedCount, lastVisitTime, visits = null) => ({
  key, visitCount, typedCount, lastVisitTime, visits, score: 0,
});
const keys = (entries) => entries.map((e) => e.key);

test('按访问次数排序，次数相同时比较最后访问时间', () => {
  const sorted = rank([
    entry('a', 10, 0, NOW - DAY),
    entry('b', 10, 0, NOW),
    entry('c', 20, 0, NOW - 5 * DAY),
  ], 'visits', NOW);
  assert.deepEqual(keys(sorted), ['c', 'b', 'a']);
  assert.equal(sorted[0].score, 20);
});

test('按输入次数排序，次数相同时比较访问次数', () => {
  const sorted = rank([
    entry('a', 50, 0, NOW),
    entry('b', 5, 3, NOW),
    entry('c', 9, 3, NOW),
  ], 'typed', NOW);
  assert.deepEqual(keys(sorted), ['c', 'b', 'a']);
});

test('按最近访问排序', () => {
  const sorted = rank([
    entry('a', 50, 0, NOW - 3 * DAY),
    entry('b', 1, 0, NOW),
  ], 'recent', NOW);
  assert.deepEqual(keys(sorted), ['b', 'a']);
});

test('综合分：只有汇总数据时按 14 天半衰', () => {
  assert.ok(Math.abs(frecency(entry('x', 10, 0, NOW - 14 * DAY), NOW) - 5) < 1e-9);
  assert.equal(frecency(entry('x', 4, 2, NOW), NOW), 7);
});

test('综合分：有访问明细时逐次加权', () => {
  const score = frecency(entry('x', 3, 1, NOW, [
    { time: NOW, transition: 'typed' },
    { time: NOW, transition: 'reload' },
    { time: NOW - 14 * DAY, transition: 'link' },
  ]), NOW);
  assert.ok(Math.abs(score - 2.5) < 1e-9);
});

test('综合排序：很久没去的网站排在最近常去的后面', () => {
  const sorted = rank([
    entry('old', 100, 0, NOW - 60 * DAY),
    entry('fresh', 20, 0, NOW),
  ], 'frecency', NOW);
  assert.deepEqual(keys(sorted), ['fresh', 'old']);
});

test('未知排序方式回退为访问次数', () => {
  const sorted = rank([entry('a', 1, 0, NOW), entry('b', 2, 0, NOW)], 'nope', NOW);
  assert.deepEqual(keys(sorted), ['b', 'a']);
});
