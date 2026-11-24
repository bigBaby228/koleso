/* Колесо — перевод интерфейса.
   Игра пишет тексты по-русски (в том числе сервер в онлайне), а здесь они
   переводятся прямо в DOM: каждый текстовый узел и подписи (placeholder, title)
   прогоняются через словарь фрагментов. Так один и тот же стол может играть
   на разных языках. */
(function (g) {
  'use strict';
  const SETKEY = 'koleso-settings-v1';
  function lang() {
    try { return (JSON.parse(localStorage.getItem(SETKEY)) || {}).lang || 'ru'; } catch (e) { return 'ru'; }
  }
  const L = lang();
  const dict = g.KolesoI18N && g.KolesoI18N[L];
  const CYR = /[А-Яа-яЁё]/;
  // числа по-английски: «1,5» → «1.5», «$10 000» → «$10,000»
  const nums = s => s.replace(/\((?:ась|а)\)?(?![А-Яа-яЁё])/g, '').replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2').replace(/(\d)[   ](?=\d{3}(?!\d))/g, '$1,');
  let re = null, map = null;
  const cache = new Map();
  if (dict && L !== 'ru') {
    map = new Map();
    for (const k of Object.keys(dict)) map.set(nums(k), dict[k]);
    const keys = [...map.keys()].sort((a, b) => b.length - a.length)
      .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    re = new RegExp('(?<![А-Яа-яЁё])(?:' + keys.join('|') + ')(?![А-Яа-яЁё])', 'g');
  }
  function tr(s) {
    if (!re || !s || !CYR.test(s)) return re && s ? nums(s) : s;
    const hit = cache.get(s); if (hit !== undefined) return hit;
    let out = nums(s).replace(re, m => map.get(m));
    if (L === 'en') out = out
      .replace(/(\d+) turn\.(?=\s|$)/g, (m, n) => n + (n === '1' ? ' turn' : ' turns'))
      .replace(/\b(\d+) turn\b/g, (m, n) => n === '1' ? m : n + ' turns')
      .replace(/^Moving (.+)…$/, '$1 is moving…')
      .replace(/I'm (pilot|teacher|programmer|courier|taxi driver|lawyer|nurse|dentist|cook|vet|doctor|bank analyst|marketer|sales manager)/g, "I'm a $1")
      .replace(/\bI (courier|taxi driver|lawyer|cook|teacher|pilot|nurse|vet|doctor|dentist|programmer)\b/g, "I'm a $1");
    if (cache.size > 5000) cache.clear();
    cache.set(s, out);
    return out;
  }
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  function walk(root) {
    if (!re) return;
    if (root.nodeType === 3) { fix(root); return; }
    if (root.nodeType !== 1 || root.tagName === 'SCRIPT' || root.tagName === 'STYLE') return;
    fixAttrs(root);
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = it.nextNode())) {
      if (n.nodeType === 3) fix(n);
      else fixAttrs(n);
    }
  }
  function fixAttrs(el) {
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && CYR.test(v)) { const t = tr(v); if (t !== v) el.setAttribute(a, t); }
    }
  }
  function fix(n) {
    const v = n.data;
    if (!CYR.test(v) && !/\d[   ]\d{3}|\d,\d/.test(v)) return;
    const t = tr(v);
    if (t !== v) n.data = t;
  }
  function start() {
    if (!re) return;
    document.documentElement.lang = L;
    walk(document.body);
    if (CYR.test(document.title)) document.title = tr(document.title);
    new MutationObserver(ms => {
      for (const m of ms) {
        if (m.type === 'characterData') fix(m.target);
        else if (m.type === 'attributes') walk(m.target);
        else for (const n of m.addedNodes) walk(n);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  g.KolesoI18n = { lang: L, t: s => (re ? tr(s) : s) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(typeof window !== 'undefined' ? window : globalThis);
