/*
 * КОЛЕСО — игровой стол.
 * Рисует вид сверху на круглый стол: клетки по краю, места игроков, кубики и аксессуары.
 * Для каждого круга свой стол: кухонный (колесо), покерный клуб (средний), VIP (Большая игра).
 * Только отображение: данные приходят из ui.js.
 */
(function (root) {
'use strict';

/* Векторные иконки клеток (24×24, линии). На клетках нет эмодзи. */
const ICON = {
  coin: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.4-.9-1.4-1.5-2.5-1.5-1.5 0-2.5.8-2.5 1.9 0 2.6 5 1.5 5 4.2 0 1.1-1.1 1.9-2.5 1.9-1.2 0-2.2-.6-2.6-1.5M12 6.5v11"/>',
  home: '<path d="M4 11l8-7 8 7M6.5 9.5V20h11V9.5M10 20v-5h4v5"/>',
  shop: '<path d="M4 9l1.5-4h13L20 9M4 9h16M5 9v11h14V9M9.5 20v-6h5v6"/>',
  tower: '<path d="M6 21V4h8v17M14 9h4v12M4 21h16M9 7.5h2M9 11h2M9 14.5h2"/>',
  chart: '<path d="M4 19l5-6 4 3 7-9M15 7h5v5"/>',
  bag: '<path d="M6 8h12l-1 12H7zM9 8V7a3 3 0 016 0v1"/>',
  dice: '<rect x="4.5" y="4.5" width="15" height="15" rx="3"/><path d="M9 9h.01M15 15h.01M12 12h.01M15 9h.01M9 15h.01"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/>',
  stroller: '<path d="M4 5h2l2 9h10l2-6H8M9 19.5a1.5 1.5 0 100-.01M17 19.5a1.5 1.5 0 100-.01"/>',
  exit: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>',
  wrench: '<path d="M14.5 5.5a4 4 0 00-5 5L4 16l4 4 5.5-5.5a4 4 0 005-5L16 12l-4-4z"/>',
  cap: '<path d="M2.5 9.5L12 5l9.5 4.5L12 14zM6.5 11.5V16c3 2 8 2 11 0v-4.5M21.5 9.5v5"/>',
  factory: '<path d="M3 20V10l5 3v-3l5 3v-3l5 3V4h3v16zM7 17h2M12 17h2"/>',
  bolt: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  gem: '<path d="M7 4h10l4 5-9 11L3 9zM3 9h18M10 4L8.5 9 12 20l3.5-11L14 4"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M9 9l-5-5M15 9l5-5M9 15l-5 5M15 15l5 5"/>',
  case: '<path d="M4 8h16v11H4zM9 8V5.5h6V8M4 13h16M11 13v2h2v-2"/>',
  rocket: '<path d="M12 3c3.5 2.5 5 6.5 4 11l-4 3-4-3c-1-4.5.5-8.5 4-11zM8.5 15.5L6 20l4-1.5M15.5 15.5L18 20l-4-1.5M12 10h.01"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  scales: '<path d="M12 4v16M7 20h10M5 7h14M5 7l-2.5 6h5zM19 7l-2.5 6h5zM2.5 13a2.5 2.5 0 005 0M16.5 13a2.5 2.5 0 005 0"/>',
  taxdoc: '<path d="M6 3h9l4 4v14H6zM15 3v4h4M9 17l6-6M9.5 11.5h.01M14.5 16.5h.01"/>',
  broken: '<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10zM12 7.4l-1.5 3.6 3 2-1.5 4"/>',
  storm: '<path d="M4 6h16M6 10h12M8 14h8M10 18h4"/>',
  buyout: '<path d="M4 20V9h7v11M11 13h7v7M3 20h18M15 4v6M12 7h6"/>',
  bell: '<path d="M6 17h12l-1.5-2.5V10a4.5 4.5 0 00-9 0v4.5zM10 20h4"/>',
  tv: '<path d="M4 7h16v11H4zM9 3l3 4 3-4M8 21h8"/>',
  mask: '<path d="M3 10c3-3.5 15-3.5 18 0-1 5-4 7.5-9 7.5S4 15 3 10zM7.5 11h3M13.5 11h3"/>',
  ban: '<circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/>',
  crash: '<path d="M4 5l6 6 4-3 6 9M20 11v6h-6"/>',
};
const CELL_ICON = {
  pay: 'coin', mpay: 'coin', fpay: 'coin', small: 'home', sbiz: 'shop', big: 'tower', market: 'chart', tempt: 'bag',
  gamble: 'dice', charity: 'heart', child: 'stroller', down: 'exit', gig: 'wrench', course: 'cap',
  mbiz: 'factory', mevent: 'bolt', lux: 'gem', expand: 'expand',
  invest: 'case', startup: 'rocket', dream: 'star', lawsuit: 'scales', tax: 'taxdoc', divorce: 'broken', crisis: 'storm',
  acq: 'buyout', ipo: 'bell', media: 'tv', raid: 'mask', sanctions: 'ban', crash: 'crash',
};
const svgIcon = (name, cls) => `<svg class="${cls || 'ic'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[name] || ICON.dice}</svg>`;

/* Аксессуары столов (SVG) */
const DECOR = {
  mug: `<svg viewBox="0 0 60 60"><ellipse cx="27" cy="33" rx="16" ry="16" fill="#e9e4d8" stroke="#b9ab90" stroke-width="2"/><ellipse cx="27" cy="33" rx="11" ry="11" fill="#7a4a24"/><path d="M42 30c7 0 7 9 0 9" stroke="#b9ab90" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M22 14c-3 4 3 5 0 9M30 12c-3 4 3 5 0 9" stroke="rgba(255,255,255,.35)" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`,
  note: `<svg viewBox="0 0 60 60"><rect x="12" y="8" width="34" height="44" rx="2" fill="#f4efe2" stroke="#c9bfa8" transform="rotate(-8 30 30)"/><path d="M18 20h20M18 26h20M18 32h14M18 38h17" stroke="#8aa0c0" stroke-width="1.5" transform="rotate(-8 30 30)"/><path d="M40 44l10-28" stroke="#d9a63a" stroke-width="3" stroke-linecap="round"/></svg>`,
  laptop: `<svg viewBox="0 0 60 60"><rect x="12" y="12" width="36" height="24" rx="2" fill="#2a3138" stroke="#59636e" stroke-width="2"/><rect x="15" y="15" width="30" height="18" fill="#3d6b8f"/><path d="M18 27l6-5 5 3 7-7" stroke="#8fe0b0" stroke-width="2" fill="none"/><path d="M6 38h48l-4 6H10z" fill="#59636e"/></svg>`,
  watch: `<svg viewBox="0 0 60 60"><rect x="24" y="4" width="12" height="52" rx="4" fill="#3a2a1c"/><circle cx="30" cy="30" r="12" fill="#d8dde2" stroke="#9aa3ab" stroke-width="3"/><path d="M30 22v8l5 3" stroke="#333" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`,
  champagne: `<svg viewBox="0 0 60 60"><path d="M18 6h10l-1 16a4 4 0 01-8 0z" fill="rgba(255,236,170,.85)" stroke="#e8c25a" stroke-width="1.5"/><path d="M23 26v20M17 48h12" stroke="#e8c25a" stroke-width="2"/><path d="M34 10h10l-1 16a4 4 0 01-8 0z" fill="rgba(255,236,170,.85)" stroke="#e8c25a" stroke-width="1.5" transform="rotate(10 39 28)"/><path d="M39 30v18M33 50h12" stroke="#e8c25a" stroke-width="2" transform="rotate(10 39 28)"/><circle cx="21" cy="14" r="1" fill="#fff"/><circle cx="24" cy="18" r="1" fill="#fff"/><circle cx="38" cy="16" r="1" fill="#fff"/></svg>`,
  goldchips: `<svg viewBox="0 0 60 60">${[0, 1, 2, 3, 4].map(k => `<ellipse cx="22" cy="${44 - k * 5}" rx="13" ry="5" fill="#e8c25a" stroke="#7a5a14" stroke-width="1.5"/>`).join('')}${[0, 1, 2].map(k => `<ellipse cx="42" cy="${46 - k * 5}" rx="12" ry="4.5" fill="#141414" stroke="#e8c25a" stroke-width="1.5"/>`).join('')}</svg>`,
};
const LEVEL = {
  rat:  { title: 'Колесо', decor: [['mug', 'br'], ['note', 'mid-l']], chip: ['#e05252', '#3a7bd5', '#f2c94c'] },
  mid:  { title: 'Средний круг', decor: [['laptop', 'br'], ['watch', 'mid-l']], chip: ['#e9e9e9', '#d94848', '#2f6fd1'] },
  fast: { title: 'Большая игра', decor: [['champagne', 'br'], ['goldchips', 'mid-l']], chip: ['#e8c25a', '#111', '#b8142c'] },
};

/* Геометрия: точки на эллипсе с равным шагом по длине дуги */
function ellipsePoints(n, cx, cy, rx, ry, start) {
  const K = 1440, pts = [], len = [0];
  for (let i = 0; i <= K; i++) { const a = start + i / K * Math.PI * 2; pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
  for (let i = 1; i <= K; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[K], out = []; let j = 0;
  for (let k = 0; k < n; k++) { const target = total * k / n; while (len[j] < target) j++; out.push(pts[j]); }
  return out;
}

let host = null, geo = null, cellCount = 0;

/* Построить стол заново (при смене круга) */
function build(el, o) {
  host = el; cellCount = o.cells.length;
  const W = el.clientWidth || 360;
  const par = el.parentElement, avail = par && par.clientHeight ? par.clientHeight - (el.getBoundingClientRect().top - par.getBoundingClientRect().top) - 16 : 0; // заполняем экран по высоте
  const H = Math.round(Math.max(W * 1.1, Math.min(W * 1.38, avail > 0 ? avail : W * 1.22)));
  el.style.height = H + 'px';
  const lv = LEVEL[o.mode];
  const cs = cellCount > 34 ? 25 : 29; // размер клетки
  const rx = W / 2 - 8, ry = H / 2 - 8, ringRX = rx - 13 - cs / 2, ringRY = ry - 13 - cs / 2;
  const pos = ellipsePoints(cellCount, W / 2, H / 2, ringRX, ringRY, -Math.PI * 0.75);
  geo = { W, H, cs, pos };
  const cells = o.cells.map((t, i) => {
    const T = o.T[t]; let cls = 'tc', label = T.n, ic = CELL_ICON[t] || 'dice';
    if (t === 'dream') { const di = o.dreamCells.indexOf(i); label = o.dreams[di].n; cls += ' tdream'; if (o.myDream === di) cls += ' mine'; }
    return `<div class="${cls}" id="tc${i}" data-i="${i}" style="left:${pos[i][0] - cs / 2}px;top:${pos[i][1] - cs / 2}px;width:${cs}px;height:${cs}px;--cc:${T.c}" title="${label}">${svgIcon(ic)}</div>`;
  }).join('');
  const decor = lv.decor.map(([k, p]) => `<div class="decor d-${p}">${DECOR[k]}</div>`).join('');
  el.className = 'tablewrap lvl-' + o.mode;
  el.innerHTML = `<div class="room"></div>
    <div class="ttable" style="left:${W / 2 - rx}px;top:${H / 2 - ry}px;width:${rx * 2}px;height:${ry * 2}px"><div class="felt"></div></div>
    ${decor}
    <div class="tcells">${cells}</div>
    <div class="tcenter" style="left:${W / 2 - (rx - 52)}px;top:${H / 2 - (ry - 70)}px;width:${(rx - 52) * 2}px;height:${(ry - 70) * 2}px">
      <div class="lvlname">${lv.title}</div>
      <div class="dice" id="dice"></div>
      <div class="lastmsg" id="lastMsg"></div>
    </div>
    <div class="seats" id="seats"></div>
    <div class="ttoks" id="ttoks"></div>`;
  el.querySelectorAll('.tc').forEach(c => c.onclick = () => o.onCell && o.onCell(+c.dataset.i));
  dice([1], false);
}

/* Фишки игроков на клетках */
function tokens(list, here) {
  if (!host) return;
  host.querySelectorAll('.tc.here').forEach(c => c.classList.remove('here'));
  const byCell = {};
  list.forEach(t => { (byCell[t.pos] = byCell[t.pos] || []).push(t); });
  let html = '';
  for (const k in byCell) {
    const [x, y] = geo.pos[k], arr = byCell[k];
    arr.forEach((t, j) => {
      const dx = (j - (arr.length - 1) / 2) * 9, dy = -geo.cs / 2 - 2;
      html += `<div class="ttok ${t.me ? 'me' : ''}" style="left:${x + dx - 7}px;top:${y + dy - 7}px;--pc:${t.color}"></div>`;
    });
  }
  host.querySelector('#ttoks').innerHTML = html;
  if (here != null) { const c = host.querySelector('#tc' + here); if (c) c.classList.add('here'); }
}

/* Места игроков в углах стола */
const SEAT_POS = ['bl', 'tl', 'tr'];
function seats(list) {
  if (!host) return;
  host.querySelector('#seats').innerHTML = list.map((p, i) => {
    const stack = Math.max(1, Math.min(6, Math.round(Math.log10(Math.max(10, p.cash)) - 1)));
    const chips = Array.from({ length: stack }, (_, k) => `<i style="bottom:${k * 3}px"></i>`).join('');
    return `<div class="seat s-${SEAT_POS[i]} ${p.active ? 'active' : ''} ${p.out ? 'out' : ''}" style="--pc:${p.color}">
      <div class="ava2">${p.emoji}${p.badge ? `<span class="sbadge">${p.badge}</span>` : ''}</div>
      <div class="sname">${p.name}</div>
      <div class="scash">${p.cashTxt}</div>
      <div class="sbar"><i style="width:${p.progress}%"></i></div>
      <div class="stack">${chips}</div>
    </div>`;
  }).join('');
}

/* Кубики с точками */
const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
function dieHTML(v) { return `<div class="die">${Array.from({ length: 9 }, (_, i) => `<span class="${PIPS[v].includes(i + 1) ? 'p' : ''}"></span>`).join('')}</div>`; }
function dice(vals, spin) {
  const el = host && host.querySelector('#dice'); if (!el) return;
  el.innerHTML = vals.map(dieHTML).join('');
  el.classList.toggle('spin', !!spin);
}

root.KolesoTable = { build, tokens, seats, dice, dieHTML, svgIcon, CELL_ICON };
})(this);
