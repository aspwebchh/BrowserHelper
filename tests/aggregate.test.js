import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregate } from '../src/core/aggregate.js';

const rec = (url, visitCount, extra = {}) => ({
  url, title: '', visitCount, typedCount: 0, lastVisitTime: 0, visits: null, ...extra,
});

test('按域名合并 www 与非 www，次数相加', () => {
  const entries = aggregate([
    rec('https://www.github.com/', 5, { title: 'GitHub', typedCount: 2, lastVisitTime: 100 }),
    rec('https://github.com/foo/bar', 20, { title: 'foo/bar', lastVisitTime: 300 }),
    rec('https://gist.github.com/x', 3),
  ], { groupBy: 'domain' });

  assert.equal(entries.length, 2);
  const gh = entries.find((e) => e.key === 'domain:github.com');
  assert.equal(gh.visitCount, 25);
  assert.equal(gh.typedCount, 2);
  assert.equal(gh.lastVisitTime, 300);
  assert.equal(gh.title, 'GitHub', '优先使用首页标题');
  assert.equal(gh.url, 'https://github.com/', '打开访问最多那条的 host');
  assert.equal(gh.iconUrl, 'https://github.com/foo/bar');
  assert.equal(gh.domain, 'github.com');
  assert.equal(gh.hint, '');
});

test('没有首页记录时用域名作标题，hint 为最常看的页面', () => {
  const [entry] = aggregate([
    rec('https://www.zhihu.com/question/1', 9, { title: '问题一' }),
    rec('https://www.zhihu.com/question/2', 3, { title: '问题二' }),
  ], { groupBy: 'domain' });
  assert.equal(entry.title, 'zhihu.com');
  assert.equal(entry.hint, '问题一');
  assert.equal(entry.url, 'https://www.zhihu.com/');
});

test('按域名时打开地址保留端口', () => {
  const [entry] = aggregate([rec('http://localhost:3000/app', 4)], { groupBy: 'domain' });
  assert.equal(entry.url, 'http://localhost:3000/');
});

test('按网址合并只差锚点、追踪参数的记录', () => {
  const entries = aggregate([
    rec('https://a.com/doc#intro', 2, { title: 'Doc', lastVisitTime: 10 }),
    rec('https://a.com/doc?utm_source=x', 5, { lastVisitTime: 20 }),
    rec('https://a.com/other', 1, { title: 'Other' }),
  ], { groupBy: 'url' });

  assert.equal(entries.length, 2);
  const doc = entries.find((e) => e.key === 'url:https://a.com/doc');
  assert.equal(doc.visitCount, 7);
  assert.equal(doc.lastVisitTime, 20);
  assert.equal(doc.title, 'Doc', '访问最多的那条没有标题时，取其他记录的标题');
  assert.equal(doc.url, 'https://a.com/doc?utm_source=x');
  assert.equal(doc.domain, 'a.com');
});

test('stripTracking 关闭时不合并追踪参数', () => {
  const entries = aggregate([
    rec('https://a.com/doc', 2),
    rec('https://a.com/doc?utm_source=x', 5),
  ], { groupBy: 'url', stripTracking: false });
  assert.equal(entries.length, 2);
});

test('合并逐次访问明细', () => {
  const [entry] = aggregate([
    rec('https://a.com/1', 2, { visits: [{ time: 1, transition: 'link' }, { time: 2, transition: 'typed' }] }),
    rec('https://a.com/2', 1, { visits: [{ time: 3, transition: 'link' }] }),
  ], { groupBy: 'domain' });
  assert.equal(entry.visits.length, 3);
});
