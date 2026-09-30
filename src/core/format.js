// 界面显示用的格式化函数。

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const numberFormat = new Intl.NumberFormat('zh-CN');

export function formatCount(n) {
  return numberFormat.format(n);
}

export function formatRelativeTime(time, now = Date.now()) {
  if (!time) return '—';
  const diff = Math.max(0, now - time);
  if (diff < MINUTE) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)} 天前`;
  const d = new Date(time);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatDateTime(time) {
  if (!time) return '—';
  return new Date(time).toLocaleString('zh-CN', { hour12: false });
}

// MV3 的 favicon 接口，需要 "favicon" 权限，不联网。
export function faviconUrl(pageUrl, size = 32) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', String(size));
  return u.href;
}
