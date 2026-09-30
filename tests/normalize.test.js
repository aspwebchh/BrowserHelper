import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getDomain, isTrackable, matchesDomain, normalizeDomainPattern, normalizeUrl,
} from '../src/core/normalize.js';

test('isTrackable 只接受 http(s) 网址', () => {
  assert.equal(isTrackable('https://github.com/'), true);
  assert.equal(isTrackable('http://localhost:3000/a'), true);
  for (const url of ['chrome://settings', 'chrome-extension://abc/popup.html', 'file:///C:/a.txt', 'about:blank', 'not a url', '']) {
    assert.equal(isTrackable(url), false, url);
  }
});

test('normalizeUrl 去掉普通锚点，保留 hash 路由', () => {
  assert.equal(normalizeUrl('https://a.com/doc#section'), 'https://a.com/doc');
  assert.equal(normalizeUrl('https://app.com/#/dashboard'), 'https://app.com/#/dashboard');
  assert.equal(normalizeUrl('https://app.com/#!/inbox'), 'https://app.com/#!/inbox');
});

test('normalizeUrl 按设置去掉追踪参数', () => {
  assert.equal(normalizeUrl('https://a.com/p?id=1&utm_source=x&UTM_Medium=y&gclid=z'), 'https://a.com/p?id=1');
  assert.equal(normalizeUrl('https://a.com/p?utm_source=x'), 'https://a.com/p');
  assert.equal(normalizeUrl('https://a.com/p?utm_source=x', { stripTracking: false }), 'https://a.com/p?utm_source=x');
  assert.equal(normalizeUrl('https://a.com/s?q=a+b&spm=1.2'), 'https://a.com/s?q=a+b');
});

test('normalizeUrl 统一结尾斜杠', () => {
  assert.equal(normalizeUrl('https://a.com/docs/'), 'https://a.com/docs');
  assert.equal(normalizeUrl('https://a.com'), 'https://a.com/');
  assert.equal(normalizeUrl('https://a.com/'), 'https://a.com/');
});

test('getDomain 转小写并去掉 www.', () => {
  assert.equal(getDomain('https://WWW.GitHub.com/x'), 'github.com');
  assert.equal(getDomain('https://gist.github.com/'), 'gist.github.com');
  assert.equal(getDomain('http://localhost:8080/'), 'localhost');
  assert.equal(getDomain('bad'), '');
});

test('normalizeDomainPattern 接受各种写法', () => {
  assert.equal(normalizeDomainPattern(' https://www.Google.com/search?q=1 '), 'google.com');
  assert.equal(normalizeDomainPattern('*.baidu.com'), 'baidu.com');
  assert.equal(normalizeDomainPattern('example.com/path'), 'example.com');
  assert.equal(normalizeDomainPattern('localhost:3000'), 'localhost');
  assert.equal(normalizeDomainPattern('   '), '');
});

test('matchesDomain 匹配子域名，但不误伤相似域名', () => {
  assert.equal(matchesDomain('google.com', 'google.com'), true);
  assert.equal(matchesDomain('mail.google.com', 'google.com'), true);
  assert.equal(matchesDomain('notgoogle.com', 'google.com'), false);
  assert.equal(matchesDomain('google.com', ''), false);
});
