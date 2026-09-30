// 网址解析与规范化：决定哪些历史记录参与统计，以及它们按什么 key 归并。

const TRACKING_PARAMS = new Set([
  'gclid', 'fbclid', 'msclkid', 'yclid', 'dclid', 'igshid',
  'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'spm',
]);

export function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isTrackable(url) {
  const u = parseUrl(url);
  return !!u && (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
}

function isTrackingParam(name) {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower);
}

// 单页应用的 hash 路由（#/path、#!/path）代表不同页面，保留；其余锚点去掉。
function isHashRoute(hash) {
  return hash.startsWith('#/') || hash.startsWith('#!');
}

export function normalizeUrl(url, { stripTracking = true } = {}) {
  const u = parseUrl(url);
  if (!u) return url;

  if (!isHashRoute(u.hash)) u.hash = '';

  if (stripTracking) {
    const tracking = [...u.searchParams.keys()].filter(isTrackingParam);
    for (const name of tracking) u.searchParams.delete(name);
  }

  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  }
  return u.href;
}

export function getDomain(url) {
  const u = parseUrl(url);
  return u ? u.hostname.toLowerCase().replace(/^www\./, '') : '';
}

// 把用户输入的屏蔽规则（可能是完整网址、*.example.com、www.example.com）统一成裸域名。
export function normalizeDomainPattern(input) {
  let text = String(input ?? '').trim().toLowerCase();
  if (!text) return '';
  if (text.includes('://')) text = parseUrl(text)?.hostname ?? '';
  text = text.split(/[/?#]/)[0].split(':')[0];
  return text.replace(/^\*\./, '').replace(/^www\./, '').replace(/^\.+|\.+$/g, '');
}

// host 与 pattern 均为 getDomain / normalizeDomainPattern 的结果；规则同时匹配子域名。
export function matchesDomain(host, pattern) {
  return !!pattern && (host === pattern || host.endsWith('.' + pattern));
}
