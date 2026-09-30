// 从 chrome.history 读取数据，统一成 Record：
// { url, title, visitCount, typedCount, lastVisitTime, visits: [{ time, transition }] | null }

import { isTrackable } from './normalize.js';

export const RANGES = ['all', '30d', '7d', 'today'];

const DAY = 24 * 60 * 60 * 1000;
const MAX_RESULTS = 100000;
const CONCURRENCY = 32;

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

export async function fetchHistory(range, { localOnly = false, onProgress, now = Date.now() } = {}) {
  const startTime = getRangeStart(range, now);
  // 不传 startTime 时 history.search 只查最近 24 小时，所以始终显式传入。
  const items = (await chrome.history.search({ text: '', startTime, maxResults: MAX_RESULTS }))
    .filter((item) => isTrackable(item.url));

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
    const visits = await chrome.history.getVisits({ url: item.url });
    records[index] = toRangedRecord(item, visits, startTime, localOnly);
    done++;
    onProgress?.(done, items.length);
  });
  return records.filter((record) => record.visitCount > 0);
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

async function mapConcurrent(list, limit, fn) {
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next++;
      await fn(list[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
}
