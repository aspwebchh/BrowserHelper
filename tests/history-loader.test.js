import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHistoryLoader, HISTORY_CACHE_KEY, HISTORY_REVISION_KEY } from '../src/core/history-loader.js';

const NOW = new Date(2026, 8, 30, 12).getTime();
const DAY = 24 * 60 * 60 * 1000;

function installChrome() {
  const calls = { search: 0, visits: 0, set: 0 };
  const data = {};
  const items = [{ url: 'https://a.com/', title: 'A', visitCount: 2, typedCount: 1, lastVisitTime: NOW }];
  const visits = [{ visitTime: NOW, transition: 'typed', isLocal: true },
    { visitTime: NOW - 2 * DAY, transition: 'link', isLocal: false }];
  const storage = {
    async get(keys) {
      return structuredClone(Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]])));
    },
    async set(patch) {
      calls.set++;
      Object.assign(data, structuredClone(patch));
    },
  };
  globalThis.chrome = {
    history: {
      async search() { calls.search++; return structuredClone(items); },
      async getVisits() { calls.visits++; return structuredClone(visits); },
    },
  };
  return { calls, data, storage, items, visits };
}

test('重复打开弹窗复用会话缓存，不再次查询历史或访问明细', async () => {
  const { calls, storage } = installChrome();
  const first = await createHistoryLoader({ storage }).load('7d', { now: NOW });
  const reopened = await createHistoryLoader({ storage }).load('7d', { now: NOW + 1000 });
  assert.deepEqual(reopened, first);
  assert.equal(calls.search, 1);
  assert.equal(calls.visits, 1);
});

test('缓存满 30 秒后重新统计', async () => {
  const { calls, storage } = installChrome();
  const loader = createHistoryLoader({ storage });
  await loader.load('7d', { now: NOW });
  await loader.load('7d', { now: NOW + 30000 });
  assert.equal(calls.search, 2);
  assert.equal(calls.visits, 2);
});

test('弹窗内命中范围缓存时只读取版本号，不重复传输整个快照', async () => {
  const { storage, calls } = installChrome();
  const reads = [];
  const original = storage.get;
  storage.get = async (keys) => { reads.push(keys); return original(keys); };
  const loader = createHistoryLoader({ storage });
  await loader.load('7d', { now: NOW });
  await loader.load('7d', { now: NOW + 1 });
  assert.deepEqual(reads.at(-1), [HISTORY_REVISION_KEY]);
  assert.equal(calls.search, 1);
});

test('被取消的统计不写入结果缓存', async () => {
  const { storage, calls } = installChrome();
  const controller = new AbortController();
  const original = chrome.history.getVisits;
  chrome.history.getVisits = async () => {
    const visits = await original();
    controller.abort();
    return visits;
  };
  await assert.rejects(createHistoryLoader({ storage }).load('7d', {
    now: NOW, signal: controller.signal,
  }), { name: 'AbortError' });
  assert.equal(calls.set, 0);
});

test('本机选项使用不同结果缓存，但在同一个弹窗复用原始明细', async () => {
  const { calls, storage } = installChrome();
  const loader = createHistoryLoader({ storage });
  const allDevices = await loader.load('7d', { now: NOW });
  const local = await loader.load('7d', { now: NOW, localOnly: true });
  assert.equal(allDevices[0].visitCount, 2);
  assert.equal(local[0].visitCount, 1);
  assert.equal(calls.visits, 1);
});

test('今天的缓存跨午夜立即失效', async () => {
  const { calls, storage } = installChrome();
  const beforeMidnight = new Date(2026, 8, 30, 23, 59, 59).getTime();
  const loader = createHistoryLoader({ storage });
  await loader.load('today', { now: beforeMidnight });
  await loader.load('today', { now: beforeMidnight + 2000 });
  assert.equal(calls.search, 2);
});

test('删除历史更新版本后，内存和会话缓存均失效', async () => {
  const { calls, storage, data, items } = installChrome();
  const loader = createHistoryLoader({ storage });
  await loader.load('7d', { now: NOW });
  data[HISTORY_REVISION_KEY] = 'deleted';
  items.length = 0;
  assert.deepEqual(await loader.load('7d', { now: NOW + 1 }), []);
  assert.deepEqual(await createHistoryLoader({ storage }).load('7d', { now: NOW + 2 }), []);
  assert.equal(calls.search, 2);
});

test('历史在读取期间变化时，旧快照不能被下次打开复用', async () => {
  const { calls, data, storage, items } = installChrome();
  const original = chrome.history.getVisits;
  chrome.history.getVisits = async () => {
    const visits = await original();
    data[HISTORY_REVISION_KEY] = 'changed-during-fetch';
    return visits;
  };
  await createHistoryLoader({ storage }).load('7d', { now: NOW });
  assert.ok(data[HISTORY_CACHE_KEY], '模拟旧读取晚于失效通知写回');
  items.length = 0;
  assert.deepEqual(await createHistoryLoader({ storage }).load('7d', { now: NOW + 1 }), []);
  assert.equal(calls.search, 2);
});

test('会话缓存不可用或写入超额时，历史读取仍然成功', async () => {
  installChrome();
  const unavailable = {
    async get() { throw new Error('unavailable'); },
    async set() { throw new Error('quota'); },
  };
  assert.equal((await createHistoryLoader({ storage: unavailable }).load('all', { now: NOW })).length, 1);
  const { storage } = installChrome();
  storage.set = unavailable.set;
  assert.equal((await createHistoryLoader({ storage }).load('7d', { now: NOW })).length, 1);
});

test('大快照不写入会话缓存，避免序列化和超额开销', async () => {
  const { calls, storage, items } = installChrome();
  items[0].title = 'x'.repeat(3 * 1024 * 1024);
  assert.equal((await createHistoryLoader({ storage }).load('all', { now: NOW })).length, 1);
  assert.equal(calls.set, 0);
});

test('后台监听新增和删除历史，更新版本并清理快照', async () => {
  const { storage, data } = installChrome();
  const listeners = {};
  chrome.storage = { session: storage };
  chrome.history.onVisited = { addListener(fn) { listeners.visited = fn; } };
  chrome.history.onVisitRemoved = { addListener(fn) { listeners.removed = fn; } };
  await import('../src/background.js');
  data[HISTORY_CACHE_KEY] = { records: ['old'] };
  listeners.visited();
  assert.equal(data[HISTORY_CACHE_KEY], null);
  const revision = data[HISTORY_REVISION_KEY];
  data[HISTORY_CACHE_KEY] = { records: ['old'] };
  listeners.removed();
  assert.equal(data[HISTORY_CACHE_KEY], null);
  assert.notEqual(data[HISTORY_REVISION_KEY], revision);
});

test('只有真正读取历史时才调用 onFetchStart，命中内存或会话缓存不调用', async () => {
  const { storage } = installChrome();
  let started = 0;
  const onFetchStart = () => { started++; };
  const loader = createHistoryLoader({ storage });
  await loader.load('7d', { now: NOW, onFetchStart });
  assert.equal(started, 1);
  await loader.load('7d', { now: NOW + 1, onFetchStart });
  assert.equal(started, 1, '内存缓存命中');
  await createHistoryLoader({ storage }).load('7d', { now: NOW + 2, onFetchStart });
  assert.equal(started, 1, '会话缓存命中');
  await createHistoryLoader({ storage }).load('7d', { now: NOW + 30000, onFetchStart });
  assert.equal(started, 2, '缓存过期后重新读取');
});
