// 把 Record 按域名或规范化网址归并成 SiteEntry：
// { key, url, iconUrl, title, domain, hint, visitCount, typedCount, lastVisitTime, visits, score }
// key 带 "domain:" / "url:" 前缀，隐藏、置顶列表因此不会在两种模式间串。

import { getDomain, normalizeUrl, parseUrl } from './normalize.js';

export function aggregate(records, { groupBy = 'domain', stripTracking = true } = {}) {
  const byUrl = groupBy === 'url';
  const groups = new Map();
  for (const record of records) {
    const key = byUrl
      ? 'url:' + normalizeUrl(record.url, { stripTracking })
      : 'domain:' + getDomain(record.url);
    const members = groups.get(key);
    if (members) members.push(record);
    else groups.set(key, [record]);
  }

  const entries = [];
  for (const [key, members] of groups) {
    entries.push(byUrl ? toUrlEntry(key, members) : toDomainEntry(key, members));
  }
  return entries;
}

function combine(key, members) {
  let visitCount = 0;
  let typedCount = 0;
  let lastVisitTime = 0;
  let visits = null;
  let top = members[0];
  for (const m of members) {
    visitCount += m.visitCount;
    typedCount += m.typedCount;
    if (m.lastVisitTime > lastVisitTime) lastVisitTime = m.lastVisitTime;
    if (m.visits) {
      visits ??= [];
      for (const v of m.visits) visits.push(v);
    }
    if (m.visitCount > top.visitCount) top = m;
  }
  // 图标取访问最多的那个页面：Chrome 的图标库按页面记录，没访问过的首页可能没有图标。
  return { key, iconUrl: top.url, visitCount, typedCount, lastVisitTime, visits, score: 0, top };
}

function toUrlEntry(key, members) {
  const { top, ...entry } = combine(key, members);
  const titled = top.title ? top : members.find((m) => m.title);
  return {
    ...entry,
    url: top.url,
    title: titled?.title || key.slice('url:'.length),
    domain: getDomain(top.url),
    hint: '',
  };
}

function toDomainEntry(key, members) {
  const { top, ...entry } = combine(key, members);
  const domain = key.slice('domain:'.length);
  const home = members
    .filter((m) => m.title && parseUrl(m.url)?.pathname === '/')
    .reduce((best, m) => (!best || m.visitCount > best.visitCount ? m : best), null);
  const u = parseUrl(top.url);
  return {
    ...entry,
    // 用访问最多那条的真实 host（保留 www. 和端口）作为打开地址。
    url: `${u.protocol}//${u.host}/`,
    title: home?.title || domain,
    domain,
    // 没有首页标题时，界面用它提示该域名下最常看的页面。
    hint: home ? '' : top.title,
  };
}
