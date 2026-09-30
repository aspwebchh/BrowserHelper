// 设置读写，存放在 chrome.storage.local。

export const DEFAULTS = Object.freeze({
  groupBy: 'domain', // 'domain' | 'url'
  sortBy: 'visits', // 'visits' | 'typed' | 'recent' | 'frecency'
  range: 'all', // 'all' | '30d' | '7d' | 'today'
  popupLimit: 20,
  openIn: 'newTab', // 'newTab' | 'currentTab'
  stripTracking: true,
  localOnly: false,
  excludeDomains: [],
  hiddenKeys: [],
  pinnedKeys: [],
});

export const POPUP_LIMIT_MIN = 5;
export const POPUP_LIMIT_MAX = 100;

export async function loadSettings() {
  // 以对象作为参数时，缺失的键会用这里给的默认值补齐。
  return chrome.storage.local.get({ ...DEFAULTS });
}

export function saveSettings(patch) {
  return chrome.storage.local.set(patch);
}

// 以下辅助函数同时更新传入的 settings 对象和存储。
export async function addToList(settings, listName, value) {
  if (settings[listName].includes(value)) return;
  settings[listName] = [...settings[listName], value];
  await saveSettings({ [listName]: settings[listName] });
}

export async function removeFromList(settings, listName, value) {
  settings[listName] = settings[listName].filter((v) => v !== value);
  await saveSettings({ [listName]: settings[listName] });
}

export async function toggleInList(settings, listName, value) {
  const present = settings[listName].includes(value);
  if (present) await removeFromList(settings, listName, value);
  else await addToList(settings, listName, value);
  return !present;
}
