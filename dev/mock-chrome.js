// 开发预览用的假 chrome API（普通脚本，需在页面脚本之前加载）。
// 提供：合成的浏览历史（history.search / getVisits）、存在 localStorage 里的 storage.local、
// 只打日志的 tabs.create / update，以及 runtime.getURL / openOptionsPage。
(() => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.now();

  let seed = 20260930;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };

  // [站点, 大致访问量, 手动输入概率, 平均距今天数, 页面列表 [路径, 标题]]
  const SITES = [
    ['https://github.com', 260, 0.35, 6, [['/', 'GitHub'], ['/aspwebchh/browser-helper', 'aspwebchh/browser-helper'], ['/pulls', 'Pull requests'], ['/notifications', 'Notifications']]],
    ['https://www.bilibili.com', 190, 0.4, 3, [['/', '哔哩哔哩 (゜-゜)つロ 干杯~-bilibili'], ['/video/BV1xx411c7mD', '【官方】年度盘点'], ['/video/BV1GJ411x7h7', '十分钟看懂浏览器插件开发']]],
    ['https://www.zhihu.com', 140, 0.1, 8, [['/question/19550225', '如何系统地学习前端开发？ - 知乎'], ['/question/20899988', '有哪些好用的 Chrome 插件？ - 知乎']]],
    ['https://stackoverflow.com', 120, 0.05, 10, [['/questions/12345/how-to-sort-array', 'How to sort an array of objects - Stack Overflow'], ['/questions/67890/chrome-extension-history', 'Chrome extension history API - Stack Overflow']]],
    ['https://developer.mozilla.org', 95, 0.05, 12, [['/zh-CN/docs/Web/JavaScript', 'JavaScript | MDN'], ['/zh-CN/docs/Web/API/URL', 'URL - Web API | MDN']]],
    ['https://www.google.com', 110, 0.05, 4, [['/search?q=chrome+history+api', 'chrome history api - Google 搜索'], ['/search?q=mv3+favicon', 'mv3 favicon - Google 搜索']]],
    ['https://mail.google.com', 80, 0.6, 2, [['/mail/u/0/#inbox', '收件箱 - Gmail']]],
    ['https://www.baidu.com', 70, 0.5, 5, [['/', '百度一下，你就知道'], ['/s?wd=chrome%E6%8F%92%E4%BB%B6', 'chrome插件_百度搜索']]],
    ['https://juejin.cn', 55, 0.2, 9, [['/', '稀土掘金'], ['/post/7300000000000000001', '从零开发一个 Chrome 扩展 - 掘金']]],
    ['https://weibo.com', 50, 0.5, 20, [['/', '微博'], ['/u/1234567890', '某某的微博']]],
    ['https://www.taobao.com', 35, 0.4, 25, [['/', '淘宝'], ['/item.htm?id=123&spm=a21bo.1', '机械键盘 - 淘宝网']]],
    ['https://www.v2ex.com', 45, 0.6, 7, [['/', 'V2EX'], ['/t/1000001', '大家都用什么浏览器插件？ - V2EX']]],
    ['https://blog.csdn.net', 40, 0.02, 30, [['/someone/article/details/1', 'Chrome 插件开发入门_CSDN博客']]],
    ['https://claude.ai', 85, 0.7, 1, [['/', 'Claude'], ['/new', 'Claude']]],
    ['https://docs.qq.com', 30, 0.3, 6, [['/desktop/#/recent', '腾讯文档'], ['/doc/DWXYZ', '周报 - 腾讯文档']]],
    ['https://www.youtube.com', 60, 0.3, 40, [['/', 'YouTube'], ['/watch?v=dQw4w9WgXcQ&utm_source=share', 'Some video - YouTube']]],
    ['http://localhost:5173', 75, 0.8, 2, [['/', 'Vite App'], ['/settings', 'Vite App - 设置']]],
    ['https://news.ycombinator.com', 35, 0.7, 55, [['/', 'Hacker News'], ['/item?id=1', 'Show HN: Something | Hacker News']]],
    ['https://translate.google.com', 25, 0.4, 15, [['/?sl=en&tl=zh-CN', 'Google 翻译']]],
    ['https://www.douban.com', 20, 0.3, 35, [['/', '豆瓣']]],
    ['https://chrome.google.com', 10, 0.1, 18, [['/webstore/category/extensions', 'Chrome 网上应用店']]],
  ];

  const history = [];
  for (const [origin, volume, typedRate, meanAge, pages] of SITES) {
    pages.forEach(([path, title], index) => {
      // 越靠前的页面访问越多。
      const count = Math.max(1, Math.round((volume * (0.55 ** index) * (0.6 + random() * 0.8)) / 1.6));
      const visits = [];
      for (let i = 0; i < count; i++) {
        const ageDays = Math.min(89, -Math.log(1 - random()) * meanAge);
        const roll = random();
        visits.push({
          id: String(history.length),
          visitId: `${history.length}-${i}`,
          referringVisitId: '0',
          visitTime: NOW - ageDays * DAY,
          transition: roll < typedRate ? 'typed' : roll < typedRate + 0.08 ? 'reload' : 'link',
          isLocal: random() < 0.85,
        });
      }
      visits.sort((a, b) => a.visitTime - b.visitTime);
      history.push({ url: origin + path, title, visits });
    });
  }
  // 这些应被插件过滤掉。
  for (const url of ['chrome://settings/', 'chrome-extension://abcdefg/popup.html', 'file:///C:/Users/me/notes.txt']) {
    history.push({ url, title: url, visits: [{ visitTime: NOW - DAY, transition: 'typed', isLocal: true }] });
  }

  const toItem = (h, i) => ({
    id: String(i),
    url: h.url,
    title: h.title,
    visitCount: h.visits.length,
    typedCount: h.visits.filter((v) => v.transition === 'typed').length,
    lastVisitTime: h.visits.at(-1).visitTime,
  });
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---------- storage ----------
  const STORE_KEY = 'mock-chrome-storage';
  const listeners = new Set();
  const readStore = () => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch {
      return {};
    }
  };
  const emit = (changes, area = 'local') => {
    for (const fn of listeners) fn(structuredClone(changes), area);
  };
  // 另一个预览标签页改了设置时，同步通知本页。
  window.addEventListener('storage', (e) => {
    if (e.key !== STORE_KEY) return;
    const oldData = JSON.parse(e.oldValue || '{}');
    const newData = JSON.parse(e.newValue || '{}');
    const changes = {};
    for (const key of new Set([...Object.keys(oldData), ...Object.keys(newData)])) {
      if (JSON.stringify(oldData[key]) !== JSON.stringify(newData[key])) {
        changes[key] = { oldValue: oldData[key], newValue: newData[key] };
      }
    }
    if (Object.keys(changes).length) emit(changes);
  });

  // 普通网页里 Chrome 自带一个 window.chrome，用 defineProperty 覆盖掉。
  const mock = {
    history: {
      async search({ startTime = NOW - DAY, maxResults = 100 } = {}) {
        await delay(20);
        return history
          .map(toItem)
          .filter((item) => item.lastVisitTime >= startTime)
          .sort((a, b) => b.lastVisitTime - a.lastVisitTime)
          .slice(0, maxResults);
      },
      async getVisits({ url }) {
        await delay(5 + random() * 15);
        return structuredClone(history.find((h) => h.url === url)?.visits ?? []);
      },
    },
    storage: {
      session: {
        async get(keys) {
          const data = JSON.parse(sessionStorage.getItem('mock-chrome-session') || '{}');
          if (keys == null) return structuredClone(data);
          if (typeof keys === 'string') keys = [keys];
          return structuredClone(Object.fromEntries(keys.filter((key) => key in data).map((key) => [key, data[key]])));
        },
        async set(items) {
          const data = JSON.parse(sessionStorage.getItem('mock-chrome-session') || '{}');
          const changes = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: data[key], newValue: value };
            data[key] = value;
          }
          sessionStorage.setItem('mock-chrome-session', JSON.stringify(data));
          emit(changes, 'session');
        },
        async clear() {
          sessionStorage.removeItem('mock-chrome-session');
        },
      },
      local: {
        async get(keys) {
          const data = readStore();
          if (keys == null) return structuredClone(data);
          if (typeof keys === 'string') keys = [keys];
          if (Array.isArray(keys)) {
            return structuredClone(Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])));
          }
          return structuredClone(Object.fromEntries(
            Object.entries(keys).map(([k, fallback]) => [k, k in data ? data[k] : fallback]),
          ));
        },
        async set(items) {
          const data = readStore();
          const changes = {};
          for (const [key, value] of Object.entries(items)) {
            changes[key] = { oldValue: data[key], newValue: value };
            data[key] = value;
          }
          localStorage.setItem(STORE_KEY, JSON.stringify(data));
          emit(changes);
        },
        async clear() {
          localStorage.removeItem(STORE_KEY);
        },
      },
      onChanged: {
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
      },
    },
    tabs: {
      async create(props) {
        console.info('[mock] tabs.create', props);
        (window.__mockTabs ??= []).push({ method: 'create', ...props });
        return { id: Date.now(), ...props };
      },
      async update(props) {
        console.info('[mock] tabs.update', props);
        (window.__mockTabs ??= []).push({ method: 'update', ...props });
        return { id: 1, ...props };
      },
    },
    runtime: {
      // 预览服务器没有 /_favicon/，图片会加载失败，正好走首字母头像的兜底逻辑。
      getURL: (path) => `${location.origin}/dev${path}`,
      openOptionsPage: async () => {
        window.open('/dev/preview.html?page=options', '_blank');
      },
    },
  };
  Object.defineProperty(window, 'chrome', { value: mock, configurable: true, writable: true });

  // 弹窗打开网址后会调用 window.close()，预览里只打日志。
  window.close = () => console.info('[mock] window.close()');
})();
