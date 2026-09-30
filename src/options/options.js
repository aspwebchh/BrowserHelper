import { normalizeDomainPattern } from '../core/normalize.js';
import {
  DEFAULTS, POPUP_LIMIT_MAX, POPUP_LIMIT_MIN, loadSettings, removeFromList, saveSettings,
} from '../core/settings.js';

const $ = (id) => document.getElementById(id);
const els = {
  popupLimit: $('popup-limit'),
  openIn: $('open-in'),
  stripTracking: $('strip-tracking'),
  localOnly: $('local-only'),
  excludeDomains: $('exclude-domains'),
  saveExcludes: $('save-excludes'),
  hiddenList: $('hidden-list'),
  hiddenEmpty: $('hidden-empty'),
  pinnedList: $('pinned-list'),
  pinnedEmpty: $('pinned-empty'),
  toast: $('toast'),
};

let settings;

init().catch((err) => {
  console.error(err);
  showToast(`读取设置失败：${err.message}`);
});

async function init() {
  settings = await loadSettings();
  render();
  bindEvents();
  // 弹窗里置顶、隐藏、屏蔽后，这里同步刷新。
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [name, { newValue }] of Object.entries(changes)) {
      if (name in DEFAULTS) settings[name] = newValue ?? DEFAULTS[name];
    }
    render();
  });
}

function render() {
  els.popupLimit.value = settings.popupLimit;
  els.openIn.value = settings.openIn;
  els.stripTracking.checked = settings.stripTracking;
  els.localOnly.checked = settings.localOnly;
  if (document.activeElement !== els.excludeDomains) {
    els.excludeDomains.value = settings.excludeDomains.join('\n');
  }
  renderKeyList(els.hiddenList, els.hiddenEmpty, 'hiddenKeys', '恢复');
  renderKeyList(els.pinnedList, els.pinnedEmpty, 'pinnedKeys', '取消置顶');
}

function renderKeyList(listEl, emptyEl, listName, actionLabel) {
  const keys = settings[listName];
  listEl.replaceChildren(...keys.map((key) => {
    const split = key.indexOf(':');
    const type = key.slice(0, split);
    const value = key.slice(split + 1);

    const text = el('span', 'key-text', value);
    text.title = value;
    const button = el('button', 'link', actionLabel);
    button.type = 'button';
    button.addEventListener('click', async () => {
      try {
        await removeFromList(settings, listName, key);
        render();
        showToast('已保存');
      } catch (err) {
        showToast(`保存失败：${err.message}`);
      }
    });

    const li = document.createElement('li');
    li.append(el('span', 'tag', type === 'domain' ? '域名' : '网址'), text, button);
    return li;
  }));
  emptyEl.hidden = keys.length > 0;
}

function bindEvents() {
  els.popupLimit.addEventListener('change', () => {
    const n = Math.round(Number(els.popupLimit.value));
    const value = Number.isFinite(n) && n > 0
      ? Math.min(POPUP_LIMIT_MAX, Math.max(POPUP_LIMIT_MIN, n))
      : DEFAULTS.popupLimit;
    els.popupLimit.value = value;
    save({ popupLimit: value });
  });
  els.openIn.addEventListener('change', () => save({ openIn: els.openIn.value }));
  els.stripTracking.addEventListener('change', () => save({ stripTracking: els.stripTracking.checked }));
  els.localOnly.addEventListener('change', () => save({ localOnly: els.localOnly.checked }));
  els.saveExcludes.addEventListener('click', saveExcludes);
  els.excludeDomains.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveExcludes();
  });
}

function saveExcludes() {
  const domains = [...new Set(
    els.excludeDomains.value.split(/[\s,，]+/).map(normalizeDomainPattern).filter(Boolean),
  )];
  els.excludeDomains.value = domains.join('\n');
  save({ excludeDomains: domains }, `已保存，共屏蔽 ${domains.length} 个域名`);
}

async function save(patch, message = '已保存') {
  Object.assign(settings, patch);
  try {
    await saveSettings(patch);
    showToast(message);
  } catch (err) {
    showToast(`保存失败：${err.message}`);
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

let toastTimer = 0;
function showToast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, 1800);
}
