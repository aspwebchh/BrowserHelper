// 弹窗内复用明细，跨弹窗只保存最近一次统计；会话缓存不写入磁盘。
import { fetchHistory, getRangeStart } from './history-source.js';

export const HISTORY_CACHE_KEY = 'history-cache-v1';
export const HISTORY_REVISION_KEY = 'history-revision';
const TTL = 30 * 1000;
const MAX_SNAPSHOT_SIZE = 4 * 1024 * 1024;

export function createHistoryLoader({ storage = globalThis.chrome?.storage?.session } = {}) {
  const recordsByRange = new Map();
  const visitCache = new Map();
  let revision = 'initial';
  let generation = 0;

  function clear() {
    generation++;
    recordsByRange.clear();
    visitCache.clear();
  }

  async function load(range, options = {}) {
    const now = options.now ?? Date.now();
    const key = range === 'all' ? range : `${range}|${Boolean(options.localOnly)}`;
    const dayStart = range === 'today' ? getRangeStart(range, now) : null;
    const inWindow = (snapshot) => snapshot?.key === key && snapshot.dayStart === dayStart
      && now >= snapshot.createdAt && now - snapshot.createdAt < TTL;
    options.signal?.throwIfAborted();
    let saved;
    let sessionAvailable = false;
    try {
      if (storage) {
        // 内存已有该范围时只查版本号，避免每次切换都反序列化整个会话快照。
        const keys = inWindow(recordsByRange.get(key))
          ? [HISTORY_REVISION_KEY] : [HISTORY_CACHE_KEY, HISTORY_REVISION_KEY];
        const data = await storage.get(keys);
        saved = data[HISTORY_CACHE_KEY];
        const currentRevision = data[HISTORY_REVISION_KEY] ?? 'initial';
        if (revision !== currentRevision) clear();
        revision = currentRevision;
        sessionAvailable = true;
      }
    } catch {
      // 旧浏览器或缓存读取失败时正常读取历史。
      clear();
    }
    options.signal?.throwIfAborted();
    const currentGeneration = generation;
    const currentRevision = revision;
    const fresh = (snapshot) => inWindow(snapshot)
      && snapshot.revision === currentRevision && Array.isArray(snapshot.records);
    const memory = recordsByRange.get(key);
    if (fresh(memory)) return memory.records;
    if (fresh(saved)) {
      recordsByRange.set(key, saved);
      return saved.records;
    }

    // 缓存都没命中，真的要读取历史了：让界面此时才进入加载状态。
    options.onFetchStart?.();
    const records = await fetchHistory(range, { ...options, now, visitCache });
    options.signal?.throwIfAborted();
    if (currentGeneration !== generation) return records;
    const snapshot = { key, dayStart, revision: currentRevision, createdAt: now, records };
    recordsByRange.set(key, snapshot);
    // 保存无需阻塞列表显示；版本号使历史变更期间写回的旧结果自动失效。
    if (sessionAvailable && snapshotFits(records)) {
      void storage.set({ [HISTORY_CACHE_KEY]: snapshot }).catch(() => {});
    }
    return records;
  }

  return { load, clear };
}

function snapshotFits(records) {
  let bytes = 0;
  for (const record of records) {
    bytes += 256 + 2 * (record.url.length + record.title.length) + (record.visits?.length ?? 0) * 128;
    if (bytes > MAX_SNAPSHOT_SIZE) return false;
  }
  return true;
}
