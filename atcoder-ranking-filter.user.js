// ==UserScript==
// @name         AtCoder 多场排名筛选
// @name:en      AtCoder Multi-contest Rank Filter
// @namespace    https://azusaaa.com/
// @version      1.1.0
// @description  筛选同时满足多场 AtCoder 比赛排名区间的用户，并导出名单。
// @description:en Find users whose standings ranks match a range in every selected contest.
// @match        https://atcoder.jp/contests/*/standings*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  const current = location.pathname.match(/^\/contests\/([a-z0-9_-]+)\/standings\/?$/i);
  if (!current || document.getElementById('azusa-ranking-filter')) return;

  const maxContests = 12;
  const cache = new Map();

  function element(tag, attributes = {}, label = '') {
    const node = document.createElement(tag);
    Object.assign(node, attributes);
    if (label) node.textContent = label;
    return node;
  }

  function button(label, style, type = 'button') {
    return element('button', { type, className: 'btn btn-' + style }, label);
  }

  function input(name, placeholder, value = '') {
    const node = element('input', { name, placeholder, value, required: true, className: 'form-control' });
    node.setAttribute('aria-label', placeholder);
    return node;
  }

  function parseContest(row) {
    const raw = row.querySelector('[name=contest]').value.trim();
    const link = raw.match(/^https:\/\/atcoder\.jp\/contests\/([a-z0-9_-]+)(?:[/?#]|$)/i);
    const id = (link?.[1] ?? raw).toLowerCase();
    const min = Number(row.querySelector('[name=min]').value);
    const max = Number(row.querySelector('[name=max]').value);
    if (!/^[a-z0-9_-]{1,80}$/.test(id)) throw new Error('请输入 AtCoder 比赛 ID 或比赛链接。');
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min) {
      throw new Error(id + ' 的名次范围无效，请填入从 1 开始的整数。');
    }
    return { id, min, max };
  }

  async function standings(id) {
    if (cache.has(id)) return cache.get(id);
    const response = await fetch('/contests/' + encodeURIComponent(id) + '/standings/json', {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(20000),
    });
    if (response.redirected && new URL(response.url).pathname === '/login') {
      throw new Error('请先在 AtCoder 登录，再返回榜单页重试。');
    }
    if (!response.ok) throw new Error(id + ' 的榜单读取失败（HTTP ' + response.status + '）。');
    const data = await response.json().catch(() => null);
    if (!Array.isArray(data?.StandingsData)) throw new Error(id + ' 未返回可识别的榜单，请确认比赛和登录状态。');
    cache.set(id, data.StandingsData);
    return data.StandingsData;
  }

  function matchingUsers(records, min, max) {
    const matches = new Map();
    for (const { Rank: rank, UserScreenName: name } of records) {
      if (typeof name === 'string' && name && Number.isSafeInteger(rank) && rank >= min && rank <= max) {
        matches.set(name, rank);
      }
    }
    return matches;
  }

  function intersect(groups) {
    return Array.from(groups[0].keys())
      .filter(name => groups.every(group => group.has(name)))
      .sort((a, b) => groups[0].get(a) - groups[0].get(b) || a.localeCompare(b));
  }

  const root = element('section', { id: 'azusa-ranking-filter', className: 'panel panel-default' });
  const content = element('div', { className: 'panel-body' });
  const title = element('h2', { id: 'azusa-ranking-filter-title', className: 'panel-title' }, '多场排名筛选');
  const toggle = button('收起', 'default btn-xs');
  root.setAttribute('aria-labelledby', title.id);
  content.id = 'azusa-ranking-filter-body';
  toggle.setAttribute('aria-controls', content.id);
  toggle.setAttribute('aria-expanded', 'true');
  toggle.addEventListener('click', () => {
    content.hidden = !content.hidden;
    toggle.textContent = content.hidden ? '展开' : '收起';
    toggle.setAttribute('aria-expanded', String(!content.hidden));
  });
  const heading = element('div', { className: 'panel-heading' });
  heading.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px';
  heading.append(title, toggle);
  const form = element('form');
  const rows = element('div');
  const add = button('添加比赛', 'default');
  const submit = button('筛选交集', 'primary', 'submit');
  const download = button('导出名单', 'default');
  download.disabled = true;
  const status = element('p', {}, '支持比赛 ID 或 AtCoder 比赛链接。名次范围包含起止名次。');
  status.setAttribute('aria-live', 'polite');
  status.style.marginTop = '12px';
  const result = element('pre', { hidden: true });
  result.style.maxHeight = '18rem';
  result.style.overflow = 'auto';
  let output = [];

  function numberInput(name, placeholder, value) {
    const node = input(name, placeholder, value);
    node.type = 'number';
    node.min = '1';
    node.step = '1';
    return node;
  }

  function addRow(id = '') {
    const row = element('div', { className: 'form-group' });
    const remove = button('移除', 'default');
    row.style.cssText = 'display:grid;grid-template-columns:minmax(0, 1fr) minmax(3em, 6em) minmax(3em, 6em) auto;gap:6px';
    row.append(
      input('contest', '比赛 ID 或链接', id),
      numberInput('min', '起始名次', '1'),
      numberInput('max', '结束名次', '100'),
      remove,
    );
    remove.addEventListener('click', () => {
      if (rows.children.length > 1) row.remove();
      add.disabled = rows.children.length >= maxContests;
    });
    rows.append(row);
    add.disabled = rows.children.length >= maxContests;
  }

  add.addEventListener('click', () => addRow());
  download.addEventListener('click', () => {
    if (!output.length) return;
    const url = URL.createObjectURL(new Blob([output.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' }));
    const link = element('a', { href: url, download: 'atcoder-qualified-users.txt' });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    output = [];
    submit.disabled = download.disabled = true;
    result.hidden = true;
    result.textContent = '';
    try {
      const contests = Array.from(rows.children, parseContest);
      const groups = [];
      for (const { id, min, max } of contests) {
        status.textContent = '正在读取 ' + id + '…';
        groups.push(matchingUsers(await standings(id), min, max));
      }
      output = intersect(groups);
      status.textContent = '符合条件：' + output.length + ' 人';
      result.textContent = output.join('\n');
      result.hidden = !output.length;
      if (output.length) download.disabled = false;
    } catch (error) {
      status.textContent = error.name === 'TimeoutError' ? '读取榜单超时，请稍后重试。' : error.message;
    } finally {
      submit.disabled = false;
    }
  });

  const actions = element('div');
  actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';
  actions.append(add, submit, download);
  addRow(current[1]);
  form.append(rows, actions, status, result);
  content.append(form);
  root.append(heading, content);
  const parent = document.querySelector('#main-container') || document.querySelector('main') || document.body;
  parent.prepend(root);
})();
