import { HISTORY_CACHE_KEY, HISTORY_REVISION_KEY } from './core/history-loader.js';

// 顶层注册，让弹窗关闭时的新增、删除历史也能使会话缓存失效。
function invalidateHistory() {
  if (!chrome.storage.session) return;
  void chrome.storage.session.set({
    [HISTORY_REVISION_KEY]: crypto.randomUUID(),
    [HISTORY_CACHE_KEY]: null,
  }).catch((err) => console.warn('清理历史缓存失败', err));
}

chrome.history.onVisited.addListener(invalidateHistory);
chrome.history.onVisitRemoved.addListener(invalidateHistory);
