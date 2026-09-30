// 排序策略：给每个 SiteEntry 写入 score，按 score 降序排列。

export const SORTS = ['visits', 'typed', 'recent', 'frecency'];

const DAY = 24 * 60 * 60 * 1000;
const HALF_LIFE_DAYS = 14;
const TYPED_BONUS = 1.5;
const TRANSITION_WEIGHT = { typed: 2, reload: 0 };

function decay(time, now) {
  const ageDays = Math.max(0, now - time) / DAY;
  return 0.5 ** (ageDays / HALF_LIFE_DAYS);
}

// 有逐次访问明细时逐次累加；只有汇总数据（"全部"范围）时用近似公式。
export function frecency(entry, now = Date.now()) {
  if (entry.visits) {
    let score = 0;
    for (const v of entry.visits) score += decay(v.time, now) * (TRANSITION_WEIGHT[v.transition] ?? 1);
    return score;
  }
  return (entry.visitCount + TYPED_BONUS * entry.typedCount) * decay(entry.lastVisitTime, now);
}

const SCORERS = {
  visits: (e) => e.visitCount,
  typed: (e) => e.typedCount,
  recent: (e) => e.lastVisitTime,
  frecency,
};

export function rank(entries, sortBy = 'visits', now = Date.now()) {
  const score = SCORERS[sortBy] ?? SCORERS.visits;
  for (const e of entries) e.score = score(e, now);
  return entries.sort((a, b) =>
    b.score - a.score || b.visitCount - a.visitCount || b.lastVisitTime - a.lastVisitTime);
}
