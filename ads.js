/* Колесо — места под рекламу.
   В разметке стоят пустые блоки .adslot (data-slot = game | start | over).
   Блок остаётся скрытым, пока сеть не отдала баннер, — пустой рамки игрок не видит.
   Сеть подключается одним адаптером в PROVIDERS и строкой в config.js:
     ads: { provider: 'имя' }
   Пока сети нет, места можно посмотреть: «Для теста → Показать места рекламы» или ?ads=demo. */
(function (g) {
  'use strict';
  const DEMO_KEY = 'koleso-ads-demo';
  const cfg = (g.KolesoConfig && g.KolesoConfig.ads) || {};
  const demoOn = () => /[?&]ads=demo/.test(location.search) || (() => { try { return localStorage.getItem(DEMO_KEY) === '1'; } catch (e) { return false; } })();
  const provider = () => (demoOn() ? 'demo' : cfg.provider || null);

  // адаптер: (box, slot) → Promise<true, если баннер показан>
  const PROVIDERS = {
    demo: box => { box.innerHTML = '<div class="ad-demo">Здесь будет баннер 320×50</div>'; return Promise.resolve(true); },
  };

  const MIN_H = 720;
  let paused = false; // обучение: рекламы нет
  function mount(el) {
    if (!el) return;
    const box = el.querySelector('.adbox'), name = provider(), fn = name && PROVIDERS[name];
    // на низких экранах баннер в партии отнял бы стол — там реклама только в меню и в конце партии
    const tooShort = el.dataset.slot === 'game' && (g.innerHeight || 800) < MIN_H;
    if (paused || !fn || tooShort) { el.classList.remove('on'); if (box) box.innerHTML = ''; return; }
    if (el.dataset.filled === name && box.childNodes.length) { el.classList.add('on'); return; } // уже стоит — не перезапрашиваем
    el.dataset.filled = '';
    Promise.resolve().then(() => fn(box, el.dataset.slot)).then(ok => {
      el.classList.toggle('on', !!ok && !paused);
      if (ok) el.dataset.filled = name;
    }, () => el.classList.remove('on'));
  }
  function refresh() { document.querySelectorAll('.adslot').forEach(mount); }
  function pause(on) { paused = !!on; refresh(); }
  function setDemo(on) { try { localStorage.setItem(DEMO_KEY, on ? '1' : '0'); } catch (e) { /* ignore */ } document.querySelectorAll('.adslot').forEach(el => { el.dataset.filled = ''; }); refresh(); }
  const html = slot => `<div class="adslot" data-slot="${slot}"><div class="adlbl">Реклама</div><div class="adbox"></div></div>`;

  setTimeout(() => {
    refresh();
    const b = document.getElementById('adsDemoBtn'); if (b && demoOn()) b.textContent = 'Скрыть места рекламы';
  }, 0);
  let rt; g.addEventListener && g.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => document.querySelectorAll('.adslot[data-slot="game"]').forEach(mount), 300); });
  g.KolesoAds = { mount, refresh, pause, setDemo, demo: demoOn, html, PROVIDERS };
})(typeof window !== 'undefined' ? window : globalThis);
