// 从 chrome.history 读取数据，统一成 Record：
// { url, title, visitCount, typedCount, lastVisitTime, visits: [{ time, transition }] | null }

import { isTrackable } from './normalize.js';

export const RANGES = ['all', '30d', '7d', 'today'];

const DAY = 24 * 60 * 60 * 1000;
const MAX_RESULTS = 100000;
const CONCURRENCY = 32;
const VISIT_CACHE_TTL = 30 * 1000;
export const MAX_CACHED_URLS = 10000;

export function getRangeStart(range, now = Date.now()) {
  switch (range) {
    case 'today': {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    case '7d':
      return now - 7 * DAY;
    case '30d':
      return now - 30 * DAY;
    default:
      return 0;
  }
}

export async function fetchHistory(range, {
  localOnly = false, onProgress, now = Date.now(), signal, visitCache,
} = {}) {
  signal?.throwIfAborted();
  const startTime = getRangeStart(range, now);
  // 不传 startTime 时 history.search 只查最近 24 小时，所以始终显式传入。
  const items = (await chrome.history.search({ text: '', startTime, maxResults: MAX_RESULTS }))
    .filter((item) => isTrackable(item.url));
  signal?.throwIfAborted();

  // HistoryItem 上的计数是整个保留期的总数，只有"全部"范围能直接使用。
  if (range === 'all') {
    return items.map((item) => ({
      url: item.url,
      title: item.title || '',
      visitCount: item.visitCount || 0,
      typedCount: item.typedCount || 0,
      lastVisitTime: item.lastVisitTime || 0,
      visits: null,
    }));
  }

  const records = new Array(items.length);
  let done = 0;
  await mapConcurrent(items, CONCURRENCY, async (item, index) => {
    const visits = await getVisits(item, visitCache, now);
    signal?.throwIfAborted();
    records[index] = toRangedRecord(item, visits, startTime, localOnly);
    done++;
    onProgress?.(done, items.length);
  }, signal);
  return records.filter((record) => record.visitCount > 0);
}

function getVisits(item, cache, now) {
  if (!cache) return chrome.history.getVisits({ url: item.url });
  const signature = `${item.lastVisitTime}|${item.visitCount}|${item.typedCount}`;
  const cached = cache.get(item.url);
  if (cached?.signature === signature && now >= cached.createdAt
    && now - cached.createdAt < VISIT_CACHE_TTL) return cached.promise;

  // 缓存已满时不再收新网址，也不淘汰旧的：history.search 按最近访问倒序返回，
  // 先进入缓存的正是较窄范围（7 天 / 今天）要复用的网址。
  if (!cached && cache.size >= MAX_CACHED_URLS) return chrome.history.getVisits({ url: item.url });

  // 缓存 Promise：切换范围时可以复用尚未完成的读取，不再发起同一个请求。
  const entry = { signature, createdAt: now, promise: null };
  entry.promise = chrome.history.getVisits({ url: item.url }).catch((err) => {
    if (cache.get(item.url) === entry) cache.delete(item.url);
    throw err;
  });
  cache.set(item.url, entry);
  return entry.promise;
}

function toRangedRecord(item, visits, startTime, localOnly) {
  const kept = [];
  let typedCount = 0;
  let lastVisitTime = 0;
  for (const visit of visits) {
    if (visit.visitTime < startTime) continue;
    // isLocal 自 Chrome 115 起提供；旧版本没有该字段，视为本机访问。
    if (localOnly && visit.isLocal === false) continue;
    kept.push({ time: visit.visitTime, transition: visit.transition });
    if (visit.transition === 'typed') typedCount++;
    if (visit.visitTime > lastVisitTime) lastVisitTime = visit.visitTime;
  }
  return {
    url: item.url,
    title: item.title || '',
    visitCount: kept.length,
    typedCount,
    lastVisitTime,
    visits: kept,
  };
}

async function mapConcurrent(list, limit, fn, signal) {
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && next < list.length) {
      signal?.throwIfAborted();
      const index = next++;
      try {
        await fn(list[index], index);
      } catch (err) {
        stopped = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
}
