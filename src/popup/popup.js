import { faviconUrl, formatCount, formatDateTime, formatRelativeTime } from '../core/format.js';
import { createHistoryLoader } from '../core/history-loader.js';
import { buildList } from '../core/pipeline.js';
import { addToList, loadSettings, saveSettings, toggleInList } from '../core/settings.js';

const RANGE_LABELS = { all: '全部历史', '30d': '近 30 天', '7d': '近 7 天', today: '今天' };
const AVATAR_COLORS = ['#e8710a', '#1a73e8', '#188038', '#d93025', '#9334e6', '#12848e', '#b06000', '#c5221f'];

const $ = (id) => document.getElementById(id);
const els = {
  search: $('search'),
  openOptions: $('open-options'),
  groupBy: $('group-by'),
  range: $('range'),
  sortBy: $('sort-by'),
  scroller: $('scroller'),
  list: $('list'),
  empty: $('empty'),
  status: $('status'),
  menu: $('menu'),
  toast: $('toast'),
};

const state = {
  settings: null,
  history: createHistoryLoader(),
  records: [],
  list: { pinned: [], ranked: [] },
  rows: [], // 当前渲染的 { entry, rank }，rank 为 0 表示置顶项
  selected: -1,
  menuEntry: null,
  menuButton: null,
  loadToken: 0,
  loadController: null,
  loading: false,
};

init().catch(showFatal);

async function init() {
  state.settings = await loadSettings();
  syncControls();
  bindEvents();
  els.search.focus();
  await reload();
}

// ---------- 数据 ----------

async function reload() {
  const token = ++state.loadToken;
  state.loadController?.abort();
  const controller = new AbortController();
  state.loadController = controller;
  const { range, localOnly } = state.settings;
  let lastProgress = 0;
  let records;
  try {
    records = await state.history.load(range, {
      localOnly,
      signal: controller.signal,
      // 命中缓存时不进入加载状态，避免列表闪一下。
      onFetchStart: () => {
        if (token === state.loadToken) setLoading(true);
      },
      onProgress: (done, total) => {
        const now = performance.now();
        if (token === state.loadToken && (done === total || now - lastProgress >= 100)) {
          lastProgress = now;
          els.status.textContent = `正在统计访问记录… ${done}/${total}`;
        }
      },
    });
  } catch (err) {
    if (token === state.loadToken && !controller.signal.aborted) showFatal(err);
    return;
  }
  if (token !== state.loadToken) return;
  setLoading(false);
  state.records = records;
  rebuild();
}

function rebuild() {
  state.list = buildList(state.records, state.settings);
  render();
}

// ---------- 渲染 ----------

function render() {
  closeMenu();
  const query = els.search.value.trim().toLowerCase();
  const { pinned, ranked } = state.list;
  const matches = (e) => !query
    || e.title.toLowerCase().includes(query)
    || e.url.toLowerCase().includes(query)
    || e.domain.includes(query)
    || e.hint.toLowerCase().includes(query);

  const rows = pinned.filter(matches).map((entry) => ({ entry, rank: 0 }));
  let matchCount = 0;
  ranked.forEach((entry, i) => {
    if (!matches(entry)) return;
    matchCount++;
    if (matchCount <= state.settings.popupLimit) rows.push({ entry, rank: i + 1 });
  });

  // 长度条相对全局第一名，搜索时也能看出和榜首的差距。
  const maxScore = Math.max(ranked[0]?.score ?? 0, ...pinned.map((e) => e.score));
  const fragment = document.createDocumentFragment();
  rows.forEach((row, index) => fragment.append(renderRow(row, index, maxScore)));
  els.list.replaceChildren(fragment);

  state.rows = rows;
  state.selected = query && rows.length ? 0 : -1;
  updateSelection();

  if (rows.length) {
    els.empty.hidden = true;
  } else if (query) {
    showEmpty(`没有匹配“${els.search.value.trim()}”的结果`);
  } else {
    showEmpty(state.records.length ? '列表为空：记录可能都被隐藏或屏蔽了' : '这段时间内没有浏览记录');
  }
  if (!state.loading) renderStatus(query, matchCount);
}

function renderRow({ entry, rank }, index, maxScore) {
  const li = el('li', rank ? 'row' : 'row pinned');
  li.id = `row-${index}`;
  li.dataset.index = String(index);
  li.setAttribute('role', 'option');
  li.setAttribute('aria-selected', 'false');
  li.title = tooltip(entry);

  const main = el('div', 'main');
  main.append(el('div', 'title', entry.title), el('div', 'sub', subtitle(entry)));
  if (state.settings.sortBy !== 'recent' && maxScore > 0) {
    const bar = el('div', 'bar');
    bar.style.width = `${Math.max(2, Math.min(100, (entry.score / maxScore) * 100))}%`;
    main.append(bar);
  }

  const more = el('button', 'more', '⋯');
  more.type = 'button';
  more.setAttribute('aria-label', '更多操作');
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');

  li.append(
    el('span', 'rank', rank ? String(rank) : '📌'),
    createIcon(entry),
    main,
    el('span', 'metric', metricText(entry)),
    more,
  );
  return li;
}

function subtitle(entry) {
  if (state.settings.groupBy === 'url') return displayUrl(entry.url);
  return entry.hint ? `常看：${entry.hint}` : entry.domain;
}

function metricText(entry) {
  switch (state.settings.sortBy) {
    case 'typed':
      return `${formatCount(entry.typedCount)} 次`;
    case 'recent':
      return formatRelativeTime(entry.lastVisitTime);
    default:
      return `${formatCount(entry.visitCount)} 次`;
  }
}

function tooltip(entry) {
  return [
    entry.title,
    entry.url,
    `访问 ${formatCount(entry.visitCount)} 次 · 手动输入 ${formatCount(entry.typedCount)} 次`,
    `最后访问：${formatDateTime(entry.lastVisitTime)}`,
  ].join('\n');
}

function renderStatus(query, matchCount) {
  const { range, groupBy, localOnly } = state.settings;
  const unit = groupBy === 'domain' ? '个网站' : '个网址';
  const parts = [
    query ? `匹配 ${formatCount(matchCount)} ${unit}` : `共 ${formatCount(state.list.ranked.length)} ${unit}`,
    RANGE_LABELS[range],
  ];
  if (localOnly && range !== 'all') parts.push('仅本机');
  els.status.textContent = parts.join(' · ');
  els.status.title = range === 'all' ? 'Chrome 默认保留约 90 天的浏览历史' : '';
}

function createIcon(entry) {
  const img = document.createElement('img');
  img.className = 'favicon';
  img.alt = '';
  img.width = 16;
  img.height = 16;
  img.decoding = 'async';
  img.addEventListener('error', () => img.replaceWith(createAvatar(entry)), { once: true });
  img.src = faviconUrl(entry.iconUrl);
  return img;
}

function createAvatar(entry) {
  const name = entry.domain || entry.title || '?';
  const avatar = el('span', 'avatar', name.charAt(0).toUpperCase());
  avatar.style.background = AVATAR_COLORS[hashString(name) % AVATAR_COLORS.length];
  return avatar;
}

function syncControls() {
  const { groupBy, range, sortBy } = state.settings;
  for (const [container, value] of [[els.groupBy, groupBy], [els.range, range]]) {
    for (const button of container.querySelectorAll('button[data-value]')) {
      button.setAttribute('aria-checked', String(button.dataset.value === value));
    }
  }
  els.sortBy.value = sortBy;
}

function setLoading(on) {
  state.loading = on;
  els.scroller.classList.toggle('loading', on);
  if (on) {
    els.status.textContent = '正在读取历史记录…';
    if (!state.rows.length) showEmpty('正在读取历史记录…');
  }
}

function showEmpty(text) {
  els.empty.textContent = text;
  els.empty.hidden = false;
}

function showFatal(err) {
  console.error(err);
  state.loading = false;
  els.scroller.classList.remove('loading');
  els.list.replaceChildren();
  state.rows = [];
  showEmpty(`读取历史记录失败：${err?.message ?? err}`);
  els.status.textContent = '读取失败';
}

let toastTimer = 0;
function showToast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 1600);
}

// ---------- 交互 ----------

function bindEvents() {
  bindSegmented(els.groupBy, 'groupBy', rebuild);
  bindSegmented(els.range, 'range', reload);
  els.sortBy.addEventListener('change', () => updateSetting('sortBy', els.sortBy.value, rebuild));
  els.search.addEventListener('input', render);
  els.openOptions.addEventListener('click', () => chrome.runtime.openOptionsPage());

  els.list.addEventListener('click', onListClick);
  // 中键：后台打开；先阻止默认的自动滚动。
  els.list.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
  els.list.addEventListener('auxclick', (e) => {
    const row = rowFromEvent(e);
    if (e.button === 1 && row && !e.target.closest('.more')) openEntry(row.entry, { background: true });
  });

  els.menu.addEventListener('click', onMenuClick);
  document.addEventListener('mousedown', (e) => {
    if (!els.menu.hidden && !els.menu.contains(e.target) && !e.target.closest('.more')) closeMenu();
  });
  els.scroller.addEventListener('scroll', closeMenu, { passive: true });
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('pagehide', () => state.loadController?.abort());
}

function bindSegmented(container, name, after) {
  container.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-value]');
    if (button && button.dataset.value !== state.settings[name]) updateSetting(name, button.dataset.value, after);
  });
}

function updateSetting(name, value, after) {
  state.settings[name] = value;
  syncControls();
  saveSettings({ [name]: value }).catch((err) => showToast(`保存设置失败：${err.message}`));
  after();
}

function rowFromEvent(e) {
  const rowEl = e.target.closest('.row');
  return rowEl ? state.rows[Number(rowEl.dataset.index)] : null;
}

function onListClick(e) {
  const row = rowFromEvent(e);
  if (!row) return;
  const more = e.target.closest('.more');
  if (more) toggleMenu(row.entry, more);
  else openEntry(row.entry, { background: e.ctrlKey || e.metaKey });
}

async function openEntry(entry, { background = false } = {}) {
  try {
    if (background) {
      await chrome.tabs.create({ url: entry.url, active: false });
      showToast('已在后台标签页打开');
      return;
    }
    if (state.settings.openIn === 'currentTab') await chrome.tabs.update({ url: entry.url });
    else await chrome.tabs.create({ url: entry.url });
    window.close();
  } catch (err) {
    showToast(`打开失败：${err.message}`);
  }
}

function toggleMenu(entry, button) {
  if (state.menuEntry === entry) {
    closeMenu();
    return;
  }
  closeMenu();
  state.menuEntry = entry;
  state.menuButton = button;
  button.setAttribute('aria-expanded', 'true');

  const pinned = state.settings.pinnedKeys.includes(entry.key);
  els.menu.querySelector('[data-action="pin"]').textContent = pinned ? '取消置顶' : '置顶';
  els.menu.querySelector('[data-action="block"]').textContent = `屏蔽 ${entry.domain}`;
  els.menu.hidden = false;

  // 默认在按钮下方右对齐，下方放不下就放到上方，并限制在窗口内。
  const anchor = button.getBoundingClientRect();
  const { width, height } = els.menu.getBoundingClientRect();
  let top = anchor.bottom + 4;
  if (top + height > window.innerHeight - 4) top = anchor.top - 4 - height;
  top = Math.min(Math.max(4, top), window.innerHeight - height - 4);
  els.menu.style.top = `${Math.max(4, top)}px`;
  els.menu.style.left = `${Math.max(4, anchor.right - width)}px`;
}

function closeMenu() {
  if (els.menu.hidden) return;
  els.menu.hidden = true;
  state.menuButton?.setAttribute('aria-expanded', 'false');
  state.menuEntry = null;
  state.menuButton = null;
}

async function onMenuClick(e) {
  const action = e.target.closest('button[data-action]')?.dataset.action;
  const entry = state.menuEntry;
  if (!action || !entry) return;
  closeMenu();
  try {
    switch (action) {
      case 'copy':
        await navigator.clipboard.writeText(entry.url);
        showToast('链接已复制');
        break;
      case 'pin': {
        const pinned = await toggleInList(state.settings, 'pinnedKeys', entry.key);
        rebuild();
        showToast(pinned ? '已置顶' : '已取消置顶');
        break;
      }
      case 'hide':
        await addToList(state.settings, 'hiddenKeys', entry.key);
        rebuild();
        showToast('已隐藏，可在设置中恢复');
        break;
      case 'block':
        await addToList(state.settings, 'excludeDomains', entry.domain);
        rebuild();
        showToast(`已屏蔽 ${entry.domain}，可在设置中恢复`);
        break;
    }
  } catch (err) {
    showToast(`操作失败：${err.message}`);
  }
}

function onKeyDown(e) {
  if (e.isComposing) return; // 输入法组字中
  const onSelect = e.target === els.sortBy;
  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      if (onSelect || !state.rows.length) return;
      e.preventDefault();
      closeMenu();
      const n = state.rows.length;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      state.selected = state.selected < 0 ? (step > 0 ? 0 : n - 1) : (state.selected + step + n) % n;
      updateSelection(true);
      break;
    }
    case 'Enter': {
      if (onSelect || e.target.closest?.('button')) return; // 按钮自己处理回车
      const row = state.rows[Math.max(0, state.selected)];
      if (!row) return;
      e.preventDefault();
      openEntry(row.entry, { background: e.ctrlKey || e.metaKey });
      break;
    }
    case 'Escape':
      if (!els.menu.hidden) {
        e.preventDefault();
        closeMenu();
      } else if (els.search.value) {
        e.preventDefault();
        els.search.value = '';
        render();
      }
      // 都没有时不拦截，Chrome 会关闭弹窗。
      break;
    default:
      // 焦点不在搜索框时直接打字，转到搜索框。
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !onSelect
        && document.activeElement !== els.search) {
        els.search.focus();
      }
  }
}

function updateSelection(scroll = false) {
  const previous = els.list.querySelector('.row.selected');
  previous?.classList.remove('selected');
  previous?.setAttribute('aria-selected', 'false');
  const current = state.selected >= 0 ? els.list.children[state.selected] : null;
  if (current) {
    current.classList.add('selected');
    current.setAttribute('aria-selected', 'true');
    els.search.setAttribute('aria-activedescendant', current.id);
    if (scroll) current.scrollIntoView({ block: 'nearest' });
  } else {
    els.search.removeAttribute('aria-activedescendant');
  }
}

// ---------- 工具 ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function displayUrl(url) {
  const text = url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/^([^/?#]+)\/$/, '$1');
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}

function hashString(text) {
  let hash = 0;
  for (const ch of text) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return hash;
}
