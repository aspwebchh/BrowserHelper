// 从原始 Record 到界面列表：屏蔽 → 归并 → 排序 → 隐藏 → 置顶。

import { aggregate } from './aggregate.js';
import { getDomain, matchesDomain, normalizeDomainPattern } from './normalize.js';
import { rank } from './rank.js';

export function buildList(records, settings, now = Date.now()) {
  const patterns = settings.excludeDomains.map(normalizeDomainPattern).filter(Boolean);
  const kept = patterns.length
    ? records.filter((r) => {
      const host = getDomain(r.url);
      return !patterns.some((p) => matchesDomain(host, p));
    })
    : records;

  const entries = rank(aggregate(kept, settings), settings.sortBy, now);

  const hidden = new Set(settings.hiddenKeys);
  const pinOrder = new Map(settings.pinnedKeys.map((key, i) => [key, i]));
  const pinned = [];
  const ranked = [];
  for (const e of entries) {
    if (hidden.has(e.key)) continue;
    if (pinOrder.has(e.key)) pinned.push(e);
    else ranked.push(e);
  }
  pinned.sort((a, b) => pinOrder.get(a.key) - pinOrder.get(b.key));
  return { pinned, ranked };
}
