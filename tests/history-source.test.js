import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchHistory, getRangeStart, MAX_CACHED_URLS } from '../src/core/history-source.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 30, 12);

// 模拟 chrome.history：search 按 lastVisitTime 过滤，getVisits 异步返回并记录并发数。
function installChrome(items, visitsByUrl = {}) {
  const calls = { search: [], getVisits: 0, maxInFlight: 0 };
  let inFlight = 0;
  globalThis.chrome = {
    history: {
      async search(query) {
        calls.search.push(query);
        return items.filter((item) => item.lastVisitTime >= query.startTime);
      },
      async getVisits({ url }) {
        calls.getVisits++;
        inFlight++;
        calls.maxInFlight = Math.max(calls.maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
        return visitsByUrl[url] ?? [];
      },
    },
  };
  return calls;
}

const item = (url, lastVisitTime, extra = {}) => ({
  id: url, url, title: url, visitCount: 1, typedCount: 0, lastVisitTime, ...extra,
});
const visit = (visitTime, transition = 'link', isLocal = true) => ({ visitTime, transition, isLocal });

test('getRangeStart', () => {
  assert.equal(getRangeStart('all', NOW), 0);
  assert.equal(getRangeStart('7d', NOW), NOW - 7 * DAY);
  assert.equal(getRangeStart('30d', NOW), NOW - 30 * DAY);
  assert.equal(getRangeStart('today', NOW), new Date(NOW).setHours(0, 0, 0, 0));
});

test('"全部"范围直接使用 HistoryItem 的计数，并过滤非 http(s) 网址', async () => {
  const calls = installChrome([
    item('https://a.com/', NOW, { visitCount: 12, typedCount: 3, title: 'A' }),
    item('chrome://settings/', NOW),
    item('file:///C:/x.txt', NOW),
  ]);
  const records = await fetchHistory('all', { now: NOW });

  assert.equal(calls.search[0].startTime, 0, '必须显式传 startTime，否则只查 24 小时');
  assert.ok(calls.search[0].maxResults >= 10000);
  assert.equal(calls.getVisits, 0);
  assert.deepEqual(records, [{
    url: 'https://a.com/', title: 'A', visitCount: 12, typedCount: 3, lastVisitTime: NOW, visits: null,
  }]);
});

test('时间范围内只统计范围内的访问', async () => {
  installChrome([
    item('https://a.com/', NOW - DAY, { visitCount: 99 }),
    item('https://b.com/', NOW - 2 * DAY),
  ], {
    'https://a.com/': [visit(NOW - 40 * DAY, 'typed'), visit(NOW - 3 * DAY, 'typed'), visit(NOW - DAY)],
    'https://b.com/': [visit(NOW - 2 * DAY, 'link', false)],
  });
  const records = await fetchHistory('7d', { now: NOW });

  const a = records.find((r) => r.url === 'https://a.com/');
  assert.equal(a.visitCount, 2);
  assert.equal(a.typedCount, 1);
  assert.equal(a.lastVisitTime, NOW - DAY);
  assert.deepEqual(a.visits, [
    { time: NOW - 3 * DAY, transition: 'typed' },
    { time: NOW - DAY, transition: 'link' },
  ]);
  assert.equal(records.length, 2);
});

test('localOnly 排除其他设备同步来的访问，并丢弃计数为 0 的记录', async () => {
  installChrome([
    item('https://a.com/', NOW - DAY),
    item('https://b.com/', NOW - DAY),
  ], {
    'https://a.com/': [visit(NOW - DAY, 'link', true), visit(NOW - DAY, 'link', false)],
    'https://b.com/': [visit(NOW - DAY, 'link', false)],
  });
  const records = await fetchHistory('30d', { localOnly: true, now: NOW });
  assert.deepEqual(records.map((r) => [r.url, r.visitCount]), [['https://a.com/', 1]]);
});

test('逐个读取访问明细时限制并发并汇报进度', async () => {
  const items = [];
  const visits = {};
  for (let i = 0; i < 100; i++) {
    const url = `https://site${i}.com/`;
    items.push(item(url, NOW - DAY));
    visits[url] = [visit(NOW - DAY)];
  }
  const calls = installChrome(items, visits);
  const progress = [];
  const records = await fetchHistory('7d', { now: NOW, onProgress: (done, total) => progress.push([done, total]) });

  assert.equal(records.length, 100);
  assert.equal(calls.getVisits, 100);
  assert.ok(calls.maxInFlight > 1 && calls.maxInFlight <= 32, `maxInFlight=${calls.maxInFlight}`);
  assert.equal(progress.length, 100);
  assert.deepEqual(progress.at(-1), [100, 100]);
});

test('不同范围共享访问明细，重新按时间和本机条件统计', async () => {
  const url = 'https://a.com/';
  const calls = installChrome([item(url, NOW)], {
    [url]: [visit(NOW - 20 * DAY, 'typed'), visit(NOW - DAY), visit(NOW, 'link', false)],
  });
  const visitCache = new Map();
  const month = await fetchHistory('30d', { now: NOW, visitCache });
  const week = await fetchHistory('7d', { now: NOW, visitCache, localOnly: true });
  assert.equal(calls.getVisits, 1);
  assert.equal(month[0].visitCount, 3);
  assert.equal(week[0].visitCount, 1);
  assert.equal(week[0].typedCount, 0);
});

test('网址计数变化或明细缓存过期时重新读取', async () => {
  const url = 'https://a.com/';
  const historyItem = item(url, NOW);
  const visits = [visit(NOW)];
  const calls = installChrome([historyItem], { [url]: visits });
  const visitCache = new Map();
  await fetchHistory('7d', { now: NOW, visitCache });
  visits.push(visit(NOW + 1));
  historyItem.visitCount++;
  const updated = await fetchHistory('7d', { now: NOW + 1, visitCache });
  assert.equal(updated[0].visitCount, 2);
  await fetchHistory('7d', { now: NOW + 30001, visitCache });
  assert.equal(calls.getVisits, 3);
});

test('取消请求后停止排队，不再汇报旧进度', async () => {
  const items = Array.from({ length: 100 }, (_, i) => item(`https://site${i}.com/`, NOW));
  const calls = installChrome(items);
  const controller = new AbortController();
  const progress = [];
  const pending = [];
  chrome.history.getVisits = ({ url }) => {
    calls.getVisits++;
    return new Promise((resolve) => pending.push(() => resolve([visit(NOW)])));
  };
  const result = fetchHistory('7d', {
    now: NOW, signal: controller.signal, onProgress: (...args) => progress.push(args),
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.getVisits, 32);
  controller.abort();
  pending.forEach((resolve) => resolve());
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(calls.getVisits, 32);
  assert.deepEqual(progress, []);
});

test('已取消的请求不读取历史', async () => {
  const calls = installChrome([]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchHistory('all', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls.search.length, 0);
});

test('并行范围共享尚未完成的访问明细请求', async () => {
  const calls = installChrome([item('https://a.com/', NOW)], {
    'https://a.com/': [visit(NOW)],
  });
  const visitCache = new Map();
  const [month, week] = await Promise.all([
    fetchHistory('30d', { now: NOW, visitCache }),
    fetchHistory('7d', { now: NOW, visitCache }),
  ]);
  assert.equal(calls.getVisits, 1);
  assert.equal(month[0].visitCount, 1);
  assert.equal(week[0].visitCount, 1);
});

test('读取失败后停止后续排队，失败的明细不进入缓存', async () => {
  const items = Array.from({ length: 100 }, (_, i) => item(`https://site${i}.com/`, NOW));
  const calls = installChrome(items);
  const visitCache = new Map();
  chrome.history.getVisits = async () => {
    calls.getVisits++;
    throw new Error('history unavailable');
  };
  await assert.rejects(fetchHistory('7d', { now: NOW, visitCache }), /history unavailable/);
  assert.equal(calls.getVisits, 32);
  assert.equal(visitCache.size, 0);
  chrome.history.getVisits = async () => [visit(NOW)];
  assert.equal((await fetchHistory('7d', { now: NOW, visitCache })).length, 100);
});

test('明细缓存满后保留最近的网址，窄范围仍可复用', async () => {
  // history.search 按最近访问倒序返回：越靠前越新。
  // 间隔 2 分钟，共约 14 天：7 天范围只包含最前面的约 5000 个网址。
  const items = Array.from({ length: MAX_CACHED_URLS + 100 }, (_, i) => item(`https://site${i}.com/`, NOW - i * 120000));
  const timeByUrl = new Map(items.map((it) => [it.url, it.lastVisitTime]));
  const calls = installChrome(items);
  chrome.history.getVisits = async ({ url }) => {
    calls.getVisits++;
    return [visit(timeByUrl.get(url))];
  };
  const visitCache = new Map();
  await fetchHistory('30d', { now: NOW, visitCache });
  assert.equal(calls.getVisits, items.length);
  assert.equal(visitCache.size, MAX_CACHED_URLS);

  const before = calls.getVisits;
  const week = await fetchHistory('7d', { now: NOW, visitCache });
  assert.ok(week.length > 0 && week.length < items.length);
  assert.equal(calls.getVisits, before, '最近的网址仍在缓存中，不应重新读取');
});
