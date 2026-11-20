/*
 * КОЛЕСО — интерфейс.
 * Только отображение: берёт состояние из движка, рисует его и отправляет действия игрока в KolesoEngine.act().
 * Здесь же интеграция с Telegram (тема, вибрация, имя игрока) и сохранение партии.
 */
(function () {
'use strict';
const E = window.KolesoEngine, D = E.D, C = E.calc, { money, pct, fmtP } = E.fmt;
const ME = 0, SAVE = 'koleso-save-v1', FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const $ = id => document.getElementById(id);
const tgRaw = window.Telegram && window.Telegram.WebApp;
const tg = tgRaw && tgRaw.initData ? tgRaw : null; // null, если открыто не в Telegram

let S = null, busy = false, view = 'board', diffSel = 'normal';
let seenLog = 0, seenNews = 0, tradeUI = null, qtyUI = null, anim = null, lastCash = null, builtKey = null, botTimer = null, overlayKey = null, restartArm = false;

/* ---------- сохранение ---------- */
function save() { try { localStorage.setItem(SAVE, JSON.stringify({ S, seenLog, seenNews })); } catch (e) { /* хранилище недоступно */ } }
function load() { try { const x = JSON.parse(localStorage.getItem(SAVE)); return x && x.S && x.S.v === 1 ? x : null; } catch (e) { return null; } }
function clearSave() { try { localStorage.removeItem(SAVE); } catch (e) { /* ignore */ } }

/* ---------- Telegram ---------- */
function initTg() {
  if (!tg) return;
  document.body.classList.add('in-tg');
  try {
    tg.ready(); tg.expand();
    if (tg.setHeaderColor) tg.setHeaderColor('#232e3c');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#17212b');
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
  } catch (e) { /* старый клиент Telegram */ }
}
const tgName = () => (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.first_name) || 'Ты';
function haptic(kind) {
  try { if (!tg || !tg.HapticFeedback) return; if (kind === 'ok') tg.HapticFeedback.notificationOccurred('success'); else tg.HapticFeedback.impactOccurred(kind || 'light'); } catch (e) { /* ignore */ }
}

/* ---------- стартовый экран ---------- */
function drawStart() {
  const sv = load();
  $('contBox').innerHTML = sv && sv.S.phase !== 'over'
    ? `<button class="b contbtn" onclick="UI.resume()">▶ Продолжить партию (${sv.S.players[0].profName}, ход ${sv.S.players[0].turns})</button>` : '';
  $('diffSeg').innerHTML = Object.entries(D.DIFF).map(([k, v]) => `<button class="${k === diffSel ? 'on' : ''}" onclick="UI.setDiff('${k}')">${v.n}</button>`).join('');
  $('diffNote').textContent = D.DIFF[diffSel].note;
  $('profList').innerHTML = D.PROFS.map(p => {
    const ex = p.exp.reduce((s, e) => s + e[1], 0);
    return `<button class="prof" onclick="UI.start('${p.id}')"><div class="pe">${p.e}</div><div><div class="pn">${p.n}</div>
    <div class="pd">Зарплата ${money(p.salary)} · расходы ${money(ex)}<br>Поток +${money(p.salary - ex)}/мес · на руках ${money(p.cash)}</div></div>
    <div class="tag">${p.tag}</div></button>`;
  }).join('');
}
function showStart() {
  clearTimeout(botTimer); S = null; busy = false; tradeUI = null; overlayKey = null;
  closeSheet(); $('win').classList.add('hidden'); $('app').classList.remove('fast');
  $('scrGame').classList.add('hidden'); $('scrStart').classList.remove('hidden');
  drawStart();
}
function showGame() {
  $('scrStart').classList.add('hidden'); $('scrGame').classList.remove('hidden');
  builtKey = null; lastCash = null; overlayKey = null; $('win').classList.add('hidden');
  switchView('board');
}
function start(prof) {
  S = E.newGame({ prof, diff: diffSel, seed: (Date.now() ^ Math.floor(Math.random() * 1e9)) | 0, name: tgName() });
  seenLog = 0; seenNews = 0;
  showGame(); setLast('Бросай кубик, чтобы начать'); save(); render();
}
function resume() {
  const sv = load(); if (!sv) return;
  S = sv.S; seenLog = sv.seenLog || 0; seenNews = sv.seenNews || 0;
  showGame(); setLast('Партия продолжается'); render(); kickBots();
}
function debugFast() {
  start('teacher');
  const me = S.players[ME];
  me.assets.push({ t: 'prop', cat: 'house', e: '🏘', n: 'Портфель недвижимости', flow: C.expenses(S, me), down: 60000, id: ++S.uid });
  me.turns = 38; S.phase = 'exit'; S.exitPid = ME;
  render();
}

/* ---------- действия ---------- */
const nameOf = pid => pid === ME ? 'Ты' : S.players[pid].name;
function A(type, extra) { dispatch(Object.assign({ type, pid: ME }, extra || {})); }
function dispatch(a) {
  if (busy && !a._bot) { toast('Подожди, сейчас ход другого игрока'); return; }
  const r = E.act(S, a);
  if (!r.ok) { if (a.pid === ME) toast(r.events[0].text); busy = false; return; }
  const roll = r.events.find(e => e.t === 'roll' || e.t === 'skip');
  const myToasts = r.events.filter(e => e.t === 'toast' && e.pid === ME).map(e => e.text);
  if (a.type === 'trade' || a.type === 'buyStock') { tradeUI = null; qtyUI = null; }
  const finish = () => {
    S = r.state; busy = false;
    if (roll && roll.t === 'roll') {
      const p = S.players[roll.pid];
      const T = roll.mode === 'fast' ? D.FT[D.FCELLS[p.pos]] : D.CT[D.CELLS[p.pos]];
      setLast(roll.pid === ME ? `${T.e} <b>${T.h.split(':')[0]}</b>` : `${p.name}: выпало ${roll.steps} → ${T.e} ${T.n}`);
    }
    if (roll && roll.t === 'skip') setLast(`${nameOf(roll.pid)}: <b>пропуск хода</b>`);
    save(); render();
    if (myToasts.length) toast(myToasts[myToasts.length - 1]);
    if (S.phase === 'over' && S.result.type === 'win' && S.result.pid === ME) haptic('ok');
    kickBots();
  };
  if (roll && roll.t === 'roll') { busy = true; render(); animateRoll(roll, finish); }
  else finish();
}
function kickBots() {
  clearTimeout(botTimer);
  if (!S || S.phase === 'over') return;
  const a = E.botAction(S);
  if (!a) return;
  busy = true; render();
  botTimer = setTimeout(() => { a._bot = true; dispatch(a); }, a.type === 'roll' ? 600 : 450);
}
function animateRoll(e, cb) {
  const p = S.players[e.pid], mine = e.pid === ME, me = S.players[ME];
  const visible = e.mode === me.mode;
  const dice = $('dice'); dice.classList.add('spin');
  if (mine) haptic('medium');
  let k = 0;
  const iv = setInterval(() => {
    dice.textContent = e.dice.map(() => FACES[Math.floor(Math.random() * 6)]).join('');
    if (++k > (mine ? 8 : 4)) {
      clearInterval(iv); dice.classList.remove('spin');
      dice.textContent = e.dice.map(d => FACES[d - 1]).join('');
      setLast(mine ? `Выпало <b>${e.steps}</b>` : `${p.name}: выпало <b>${e.steps}</b>`);
      if (!visible) return setTimeout(cb, 200);
      step(0);
    }
  }, 70);
  function step(i) {
    anim = { pid: e.pid, pos: (e.from + i + 1) % 24 }; renderTokens();
    if (i + 1 < e.steps) setTimeout(() => step(i + 1), mine ? 150 : 80);
    else setTimeout(() => { anim = null; cb(); }, mine ? 250 : 150);
  }
}

/* ---------- отрисовка ---------- */
function render() {
  if (!S) return;
  const me = S.players[ME], fast = me.mode === 'fast';
  $('app').classList.toggle('fast', fast);
  if (builtKey !== me.mode + '|' + me.dream) buildBoard();
  $('hAva').textContent = me.emoji; $('hProf').textContent = me.profName; $('hTurn').textContent = me.turns; $('hDiff').textContent = D.DIFF[S.diff].n;
  $('hMode').innerHTML = fast ? '<span class="modetag">БОЛЬШАЯ ИГРА</span>' : '';
  $('hCash').textContent = money(me.cash);
  if (!fast) {
    const f = C.cashflow(S, me), fr = C.freedom(S, me);
    $('hFlow').textContent = (f >= 0 ? '+' : '') + money(f); $('hFlow').className = 'v ' + (f >= 0 ? 'g' : 'r'); $('hFlowL').textContent = 'поток / мес';
    $('hGoalTxt').innerHTML = `Свобода: пассивный ${money(C.passive(S, me))} из ${money(C.expenses(S, me))}`;
    $('hPct').textContent = fr + '%'; $('hBar').style.width = fr + '%';
    $('hGoalSub').textContent = C.loanTotal(me) ? `Долг ${money(C.loanTotal(me))} · платёж ${money(C.loanPay(me))}/мес · ставка сейчас ${pct(S.rate)}` : `Ставка банка сейчас ${pct(S.rate)} в месяц`;
  } else {
    const dr = D.DREAMS[me.dream], fp = C.fProgress(S, me);
    $('hFlow').textContent = '+' + money(me.fflow); $('hFlow').className = 'v y'; $('hFlowL').textContent = 'за 💰';
    $('hGoalTxt').innerHTML = `Мечта ${dr.e} ${dr.n}: ${money(me.cash)} из ${money(me.dreamCost)}`;
    $('hPct').textContent = fp + '%'; $('hBar').style.width = fp + '%';
    $('hGoalSub').textContent = `или подними поток до ${money(C.fTarget(me))} (сейчас ${money(me.fflow)})`;
  }
  if (lastCash !== null && lastCash !== me.cash && !anim) floatTxt(me.cash - lastCash);
  lastCash = me.cash;
  renderTokens(); renderRace(); renderNewsbar();
  if (view === 'ex') renderEx();
  if (view === 'report') renderReport();
  if (view === 'chat') renderChat();
  // счётчики непрочитанного
  const lastLog = S.log.length ? S.log[S.log.length - 1].id : 0, lastNews = S.news.length ? S.news[S.news.length - 1].id : 0;
  if (view === 'chat') seenLog = lastLog;
  if (view === 'ex') seenNews = lastNews;
  const unread = S.log.filter(x => x.id > seenLog).length, exU = S.news.filter(n => n.id > seenNews).length;
  $('badge').textContent = unread; $('badge').classList.toggle('hidden', !unread);
  $('exbadge').textContent = exU; $('exbadge').classList.toggle('hidden', !exU);
  // главная кнопка
  const rb = $('rollBtn');
  if (S.phase === 'over') { rb.disabled = true; rb.textContent = 'Партия окончена'; }
  else if (S.phase === 'exit') { rb.disabled = true; rb.textContent = S.exitPid === ME ? 'Выбери мечту' : `⏳ ${nameOf(S.exitPid)} выбирает мечту…`; }
  else if (S.cur !== ME) { rb.disabled = true; rb.textContent = `⏳ Ходит ${S.players[S.cur].name}…`; }
  else if (S.phase === 'card') { rb.disabled = true; rb.textContent = 'Реши по карточке'; }
  else { rb.disabled = busy; rb.textContent = me.skip > 0 ? `⏭ Пропустить ход (осталось ${me.skip})` : me.charity > 0 ? `🎲🎲 Бросить 2 кубика (${me.charity})` : '🎲 Бросить кубик'; }
  renderSheet();
  renderOverlay();
}

function buildBoard() {
  const me = S.players[ME], fast = me.mode === 'fast', cells = fast ? D.FCELLS : D.CELLS, T = fast ? D.FT : D.CT;
  builtKey = me.mode + '|' + me.dream;
  const b = $('board'); b.querySelectorAll('.cell').forEach(c => c.remove());
  cells.forEach((t, i) => {
    const d = document.createElement('div'), rc = cellRC(i);
    d.className = 'cell'; d.id = 'c' + i; d.style.gridArea = `${rc[0]}/${rc[1]}`; d.style.background = T[t].c;
    let e = T[t].e, n = T[t].n, help = T[t].h;
    if (t === 'dream') {
      const di = D.DREAM_CELLS.indexOf(i), dr = D.DREAMS[di]; e = dr.e; n = dr.n.split(' ')[0];
      if (me.dream === di) { d.classList.add('mydream'); help = `Твоя мечта: ${dr.n}, ${money(me.dreamCost)}. Встань сюда с нужной суммой`; }
      else help = `Чужая мечта: ${dr.n}`;
    }
    d.innerHTML = `${e}<span>${n}</span>`;
    d.onclick = () => toast(`${e} ${help}`);
    b.appendChild(d);
  });
  $('legend').innerHTML = Object.values(T).map(c => `<span>${c.e} ${c.n}</span>`).join('');
  $('cTitle').textContent = fast ? '★ Большая игра' : 'Колесо';
}
function cellRC(i) { if (i <= 6) return [1, i + 1]; if (i <= 12) return [i - 5, 7]; if (i <= 18) return [7, 7 - (i - 12)]; return [7 - (i - 18), 1]; }
function renderTokens() {
  document.querySelectorAll('.tok').forEach(t => t.remove());
  document.querySelectorAll('.cell.here').forEach(c => c.classList.remove('here'));
  const me = S.players[ME];
  for (const q of S.players) {
    if (q.bankrupt || q.mode !== me.mode) continue;
    const pos = anim && anim.pid === q.id ? anim.pos : q.pos, cell = $('c' + pos); if (!cell) continue;
    if (q.id === ME) { cell.classList.add('here'); cell.insertAdjacentHTML('beforeend', `<div class="tok me">${q.emoji}</div>`); }
    else cell.insertAdjacentHTML('beforeend', `<div class="tok b${(q.id - 1) % 2}" style="background:${q.color}">${q.emoji}</div>`);
  }
}
function renderRace() {
  $('race').innerHTML = S.players.map(q => {
    const v = q.bankrupt ? 0 : C.progress(S, q), fast = q.mode === 'fast';
    const nm = (q.id === ME ? 'Ты' : q.name) + (q.bankrupt ? ' 💀' : '');
    return `<div class="race-row"><span class="nm">${fast ? '★ ' : ''}${nm}</span><div class="bar"><i style="width:${v}%;background:${fast ? 'linear-gradient(90deg,#f5a623,#f5d04a)' : (q.id === ME ? '#2ea6ff' : q.color)}"></i></div><span class="pc">${v}%</span></div>`;
  }).join('') + `<div class="race-row" style="justify-content:center;color:var(--hint);margin-top:6px">★ = в Большой игре, % до мечты</div>`;
}
function renderNewsbar() {
  const n = S.news[S.news.length - 1];
  $('newsbar').innerHTML = n ? `<span class="nt ${n.rum ? 'rum' : 'off'}">${n.rum ? '🗣 СЛУХ' : '📰'}</span><span>${n.t}</span>`
    : '<span class="nt off">📰</span><span style="color:var(--hint)">Новостей пока нет. Следи за биржей</span>';
}
function setLast(h) { $('lastMsg').innerHTML = h; }
function floatTxt(d) {
  const el = $('cashBox'), r = el.getBoundingClientRect(), a = $('app').getBoundingClientRect();
  const f = document.createElement('div'); f.className = 'float' + (d < 0 ? ' neg' : ''); f.textContent = (d > 0 ? '+' : '') + money(d);
  f.style.left = (r.left - a.left + r.width - 90) + 'px'; f.style.top = (r.top - a.top + 4) + 'px'; $('app').appendChild(f);
  setTimeout(() => f.remove(), 1100);
}
const riskTag = r => !r ? '' : (r >= 0.35 ? '<span class="risk hi">риск высокий</span>' : '<span class="risk md">риск средний</span>');
const rowsHTML = r => `<div class="rows">${r.map(x => `<div class="ln"><span class="s">${x[0]}</span><span class="${x[2] || ''}">${x[1]}</span></div>`).join('')}</div>`;

/* ---------- отчёт ---------- */
function renderReport() {
  const me = S.players[ME];
  if (me.mode === 'fast') return renderFastReport(me);
  const pas = C.passive(S, me), ex = C.expenses(S, me), f = C.cashflow(S, me), fr = C.freedom(S, me);
  const inc = me.assets.filter(a => a.t !== 'stock'), st = me.assets.filter(a => a.t === 'stock');
  const ml = C.maxLoan(S, me);
  $('rep').innerHTML = `
  <div class="card"><h3>Денежный поток в месяц</h3>
    <div class="big-flow ${f >= 0 ? 'g' : 'r'}">${f >= 0 ? '+' : ''}${money(f)}</div>
    <div class="ln"><span class="s">Свобода</span><b class="y">${fr}%</b></div>
    <div class="bar"><i style="width:${fr}%"></i></div>
  </div>
  <div class="card"><h3>Доходы</h3>
    <div class="ln"><span>Зарплата</span><span>${money(me.salary)}</span></div>
    ${inc.map(a => `<div class="ln"><span class="s">${a.e} ${a.n}${riskTag(a.risk)}</span><span class="g">+${money(a.flow)}</span></div>`).join('')}
    ${st.filter(a => C.divOf(S, a)).map(a => `<div class="ln"><span class="s">${D.TICK[a.tk].e} Дивиденды ${a.tk} × ${a.shares}</span><span class="g">+${money(C.divOf(S, a))}</span></div>`).join('')}
    ${!pas ? '<div class="empty">Пассивного дохода пока нет</div>' : ''}
    <div class="ln tot"><span>Пассивный доход</span><span class="g">${money(pas)}</span></div>
  </div>
  <div class="card"><h3>Расходы</h3>
    ${me.exp.map(e => `<div class="ln"><span class="s">${e[0]}</span><span>${money(e[1])}</span></div>`).join('')}
    ${me.children ? `<div class="ln"><span class="s">Дети (${me.children})</span><span>${money(me.children * me.child)}</span></div>` : ''}
    ${me.loans.map(l => `<div class="ln"><span class="s">Кредит ${money(l.amt)} под ${pct(l.rate)}</span><span class="r">${money(l.amt * l.rate)}</span></div>`).join('')}
    <div class="ln tot"><span>Итого</span><span class="r">${money(ex)}</span></div>
    ${D.DIFF[S.diff].infl ? `<div class="note">Инфляция: каждые ${D.RULES.inflEvery} ходов «Прочие расходы» растут на ${D.DIFF[S.diff].infl * 100}%.</div>` : ''}
  </div>
  <div class="card"><h3>Активы</h3>
    ${inc.map(a => `<div class="ln"><span class="s">${a.e} ${a.n}</span><span>взнос ${money(a.down)}</span></div>`).join('')}
    ${st.map(a => `<div class="ln"><span class="s">${D.TICK[a.tk].e} ${a.tk} × ${a.shares}</span><span>${money(a.shares * S.prices[a.tk].p)}</span></div>`).join('')}
    ${!me.assets.length ? '<div class="empty">Пусто. Ищи сделки на 🏠 и 🏢 или зайди на биржу</div>' : ''}
    <div class="note">Рискованные активы могут прогореть в любой день зарплаты.</div>
  </div>
  <div class="card"><h3>Банк</h3>
    <div class="ln"><span class="s">Ставка по новым кредитам</span><b class="y">${pct(S.rate)} в мес</b></div>
    <div class="ln"><span class="s">Общий долг</span><span>${money(C.loanTotal(me))}</span></div>
    <div class="ln"><span class="s">Платёж всего</span><span>${money(C.loanPay(me))}/мес</span></div>
    <div class="loanbtns">
      <button class="sbtn" onclick="UI.A('loan',{n:1000})" ${C.canBorrow(S, me, 1000) ? '' : 'disabled'}>+ Взять $1 000</button>
      <button class="sbtn" onclick="UI.A('repay',{n:1000})" ${C.loanTotal(me) && me.cash >= 1000 ? '' : 'disabled'}>− Погасить $1 000</button>
    </div>
    <div class="note">Каждый кредит сохраняет свою ставку. Гасится сначала самый дорогой. ${C.canBorrow(S, me, 1000) ? 'Банк одобрит ещё ' + (ml === Infinity ? 'сколько угодно' : money(ml)) + '.' : '🚫 Банк отказывает: после платежа поток уйдёт ниже нормы.'}</div>
  </div>
  <button class="testlink" onclick="UI.restart(this)">↺ Бросить партию и начать заново</button>`;
}
function renderFastReport(me) {
  const dr = D.DREAMS[me.dream];
  $('rep').innerHTML = `
  <div class="card"><h3>Поток Большой игры</h3>
    <div class="big-flow y">+${money(me.fflow)}</div>
    <div class="ln"><span class="s">Стартовый поток</span><span>${money(me.fstart)}</span></div>
    <div class="ln"><span class="s">Цель по потоку</span><span>${money(C.fTarget(me))}</span></div>
    <div class="bar"><i style="width:${Math.max(0, Math.min(100, (me.fflow - me.fstart) / (C.fTarget(me) - me.fstart) * 100))}%"></i></div>
    <div class="note">Поток начисляется на каждой клетке 💰, в том числе когда проходишь мимо.</div>
  </div>
  <div class="card"><h3>Мечта</h3>
    <div class="ln"><span>${dr.e} ${dr.n}</span><span class="y">${money(me.dreamCost)}</span></div>
    <div class="ln"><span class="s">Наличные</span><span>${money(me.cash)}</span></div>
    <div class="ln"><span class="s">Клетка мечты</span><span>№${D.DREAM_CELLS[me.dream] + 1} (с золотой рамкой)</span></div>
    <div class="bar"><i style="width:${Math.min(100, me.cash / me.dreamCost * 100)}%"></i></div>
  </div>
  <div class="card"><h3>Инвестиции</h3>
    ${me.finv.map(a => `<div class="ln"><span class="s">${a.e} ${a.n}</span><span class="g">+${money(a.flow)}</span></div>`).join('') || '<div class="empty">Пока нет. Ищи 🏭</div>'}
  </div>
  <div class="card"><h3>Правила Большой игры</h3>
    <div class="note" style="margin:0">Кредитов нет. Иск забирает половину наличных, налоговая 30%, развод всё. Кризис разоряет одну инвестицию. Копить на мечту или вкладывать в поток? Решать тебе.</div>
  </div>
  <button class="testlink" onclick="UI.restart(this)">↺ Бросить партию и начать заново</button>`;
}

/* ---------- биржа ---------- */
function spark(h) {
  const n = h.length; if (n < 2) return '';
  const mn = Math.min(...h), mx = Math.max(...h), w = 300, H = 34;
  const pts = h.map((v, i) => `${(i / (n - 1) * w).toFixed(1)},${(H - 3 - (mx === mn ? 0.5 : (v - mn) / (mx - mn)) * (H - 6)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${H}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${h[n - 1] >= h[0] ? '#4fd17b' : '#ff5a5f'}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}
function renderEx() {
  const me = S.players[ME];
  $('ex').innerHTML = `
  <div class="card"><div class="rate"><div><h3 style="margin:0">Ставка по новым кредитам</h3>
    <div class="note" style="margin-top:3px">Меняется решениями ЦБ. Твои кредиты: ${me.loans.map(l => money(l.amt) + ' под ' + pct(l.rate)).join(', ') || 'нет'}</div></div>
    <div class="bigr y">${pct(S.rate)}<div class="note" style="margin:0;text-align:right">в месяц</div></div></div></div>
  <div class="lbl">Новости</div>
  ${S.news.slice(-6).reverse().map(n => `<div class="news"><span class="nt ${n.rum ? 'rum' : 'off'}">${n.rum ? '🗣 СЛУХ' : '📰 НОВОСТЬ'}</span> ${n.t}<div class="meta">${n.status || '⏳ рынок ещё реагирует'}</div></div>`).join('') || '<div class="empty">Пока тихо</div>'}
  <div class="lbl">Котировки</div>
  ${Object.keys(D.TICK).map(tk => {
    const t = D.TICK[tk], q = S.prices[tk], ch = (q.p / q.prev - 1) * 100, own = me.assets.find(a => a.tk === tk);
    const pl = own ? (q.p - own.buy) * own.shares : 0;
    return `<div class="tick"><div class="tick-top"><div class="te">${t.e}</div><div><div class="tn">${tk}</div><div class="tsub">${t.full}</div></div>
      <div class="tp"><b>${fmtP(q.p)}</b><span class="${ch >= 0 ? 'g' : 'r'}">${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch).toFixed(1)}%</span></div></div>
      ${spark(q.hist)}
      <div class="hold"><span>${q.div ? `Дивиденд ${fmtP(q.div)} за 💼 · ${(q.div / q.p * 100).toFixed(1)}%` : 'Без дивидендов'}</span>
      <span>${own ? `У тебя ${own.shares} шт · <b class="${pl >= 0 ? 'g' : 'r'}">${pl >= 0 ? '+' : ''}${money(pl)}</b>` : ''}</span></div>
      <div class="tbtns"><button class="tb-buy" onclick="UI.trade('${tk}','buy')">Купить</button><button class="tb-sell" onclick="UI.trade('${tk}','sell')" ${own ? '' : 'disabled'}>Продать</button></div></div>`;
  }).join('')}
  <div class="note">Комиссия брокера 1% (минимум $5). Цены меняются при каждом броске кубика любого игрока. Новость отыгрывается в цене за два следующих броска. Официальные новости надёжны, слухи сбываются примерно в 60% случаев. Дивиденды приходят в день зарплаты и входят в пассивный доход.</div>`;
}
function trade(tk, side) {
  if (busy || !S || S.phase === 'over') return toast('Подожди, сейчас ход другого игрока');
  const me = S.players[ME], own = me.assets.find(a => a.tk === tk), price = S.prices[tk].p;
  tradeUI = { tk, side, price, label: side === 'buy' ? '📈 Покупка на бирже' : '📉 Продажа на бирже' };
  qtyUI = side === 'buy' ? Math.min(100, maxBuy(price, me.cash)) : (own ? own.shares : 0);
  render();
}
function maxBuy(price, cash) { let n = Math.floor(cash / (price * 1.01)); while (n > 0 && n * price + C.fee(n * price) > cash) n--; return Math.max(0, n); }
function stockSheet(tk, price, side, label, confirm) {
  const me = S.players[ME], t = D.TICK[tk], q = S.prices[tk], own = me.assets.find(a => a.tk === tk), buy = side === 'buy';
  const max = buy ? maxBuy(price, me.cash) : (own ? own.shares : 0);
  if (qtyUI == null || qtyUI > max) qtyUI = Math.min(buy ? 100 : max, max);
  const opts = [10, 100, 500, 1000, max].filter((v, i, a) => v > 0 && v <= max && a.indexOf(v) === i).sort((a, b) => a - b);
  const val = qtyUI * price, f = qtyUI ? C.fee(val) : 0;
  return `<div class="kind" style="color:${buy ? '#4fd17b' : '#ff7a80'}">${label}</div>
  <div class="sh-e">${t.e}</div><div class="sh-t">${tk} по ${fmtP(price)}</div><div class="sh-d">${t.full}${price < q.p ? ` · на бирже ${fmtP(q.p)}` : ''}</div>
  ${rowsHTML([['Дивиденд на акцию', q.div ? fmtP(q.div) + ' за 💼' : 'нет'], ['Дивидендная доходность', q.div ? (q.div / price * 100).toFixed(1) + '% в мес' : '—', 'y'], ['Ставка банка', pct(S.rate) + ' в мес'], ...(own ? [['У тебя', own.shares + ' шт по ' + fmtP(own.buy)]] : [])])}
  <div class="qty">${opts.map(v => `<button class="${v === qtyUI ? 'on' : ''}" onclick="UI.setQty(${v})">${v === max ? 'Все ' + v : v}</button>`).join('') || `<div class="sh-d" style="margin:0;width:100%">${buy ? 'Не хватает денег' : 'Нечего продавать'}</div>`}</div>
  ${rowsHTML([['Количество', qtyUI + ' шт'], ['Сумма', money(val)], ['Комиссия 1%', money(f)], [buy ? 'Спишется' : 'Получишь', money(buy ? val + f : val - f), 'y'], ['Наличные', money(me.cash)]])}
  <div class="btns"><button class="b" style="${buy ? '' : 'background:#c0434a'}" onclick="${confirm}" ${!qtyUI ? 'disabled' : ''}>${buy ? 'Купить' : 'Продать'} ${qtyUI} шт</button>`;
}

/* ---------- чат ---------- */
function renderChat() {
  const me = S.players[ME], box = $('v-chat'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  $('chat').innerHTML = S.log.map(x => {
    if (x.k === 'sys') return `<div class="sys">${x.text}</div>`;
    if (x.k === 'news') return `<div class="npost ${x.rum ? 'rum' : ''}"><div class="src">${x.rum ? '🗣 Слухи · инвест-чат' : '📰 Финансовые новости'}</div>${x.text}</div>`;
    const p = S.players[x.pid];
    if (x.pid === ME) return `<div class="msg me"><div class="a" style="background:var(--btn)">${p.emoji}</div><div class="bub">${x.text}</div></div>`;
    let btn = '';
    if (x.offerId) {
      const o = S.offers.find(q => q.id === x.offerId);
      if (!o) btn = '<button class="act" disabled>Сделку забрали или она истекла</button>';
      else {
        const can = S.cur === ME && S.phase === 'roll' && me.mode === 'rat' && !busy;
        btn = `<button class="act" ${can ? '' : 'disabled'} onclick="UI.A('takeOffer',{id:${o.id}})">${can ? 'Забрать сделку' : 'Забрать можно в свой ход до броска'}</button>`;
      }
    }
    return `<div class="msg"><div class="a" style="background:${p.color}">${p.emoji}</div><div class="bub"><div class="nm" style="color:${p.color}">${p.mode === 'fast' ? '★ ' : ''}${p.name}</div>${x.text}${btn}</div></div>`;
  }).join('');
  if (atBottom || !box.dataset.init) { box.scrollTop = 1e6; box.dataset.init = 1; }
}

/* ---------- карточки ---------- */
function renderSheet() {
  if (tradeUI) return openSheet(stockSheet(tradeUI.tk, tradeUI.price, tradeUI.side, tradeUI.label, 'UI.confirmTrade()') + '<button class="b sec" onclick="UI.closeTrade()">Отмена</button></div>');
  if (!busy && S.phase === 'card' && S.cur === ME && S.card) return openSheet(cardHTML(S.card));
  closeSheet();
}
function openSheet(html) {
  const sh = $('sheet');
  if (sh.dataset.h !== html) { sh.innerHTML = '<div class="grab"></div>' + html; sh.dataset.h = html; }
  sh.classList.add('on'); $('shade').classList.add('on');
}
function closeSheet() { const sh = $('sheet'); sh.classList.remove('on'); $('shade').classList.remove('on'); sh.dataset.h = ''; }

function cardHTML(c) {
  const me = S.players[ME];
  const btn = (txt, act, cls, dis) => `<button class="b ${cls || ''}" onclick="${act}" ${dis ? 'disabled' : ''}>${txt}</button>`;
  switch (c.kind) {
    case 'deal': {
      const d = c.deal, can = me.cash >= d.down;
      const need = Math.ceil((d.down - me.cash) / 1000) * 1000, full = Math.ceil(d.down / 1000) * 1000;
      const L = can ? full : need, okL = C.canBorrow(S, me, L);
      const hint = D.DIFF[S.diff].hints
        ? `<div class="hint">💡 <b>Подсказка (лёгкий режим):</b> кредит ${money(L)} × ${pct(S.rate)} = платёж ${money(L * S.rate)}/мес против потока +${money(d.flow)}. Итог: <b class="${d.flow - L * S.rate >= 0 ? 'g' : 'r'}">${d.flow - L * S.rate >= 0 ? '+' : ''}${money(d.flow - L * S.rate)}/мес</b></div>`
        : `<div class="hint">🧮 <b>Посчитай сам:</b> платёж по кредиту = сумма × ${pct(S.rate)} каждый месяц. Если платёж больше потока сделки, кредит съест доход.</div>`;
      return `<div class="kind" style="color:${c.big ? '#a58cff' : '#6ab3f3'}">${c.big ? '🏢 Крупная сделка' : '🏠 Малая сделка'}${c.fromOffer ? ' · из чата' : ''}</div>
      <div class="sh-e">${d.e}</div><div class="sh-t">${d.n}</div><div class="sh-d">${d.d}</div>
      ${rowsHTML([['Стоимость', money(d.price)], ['Первый взнос', money(d.down)],
        ...(d.price > d.down ? [['Ипотека объекта (уже в потоке)', money(d.price - d.down)]] : []),
        ['Денежный поток', '+' + money(d.flow) + '/мес', 'g'],
        ...(d.risk ? [['Риск прогореть', d.risk >= 0.35 ? 'высокий' : 'средний', d.risk >= 0.35 ? 'r' : 'y']] : []),
        ['Ставка банка сейчас', pct(S.rate) + ' в мес', 'y'], ['У тебя на руках', money(me.cash)]])}
      ${hint}
      <div class="btns">
        ${can ? btn(`Купить за свои ${money(d.down)}`, "UI.A('buy',{loan:0})") : ''}
        ${okL ? btn(`${can ? 'Купить в кредит' : 'Добавить кредит'} ${money(L)} под ${pct(S.rate)}`, `UI.A('buy',{loan:${L}})`, can ? 'sec' : 'warn')
              : (!can ? btn(`Не хватает ${money(d.down - me.cash)}`, '', '', true) + `<div class="sh-d" style="margin:0">🚫 Банк не даст ${money(L)}: поток слишком маленький.</div>` : '')}
        ${btn('Отказаться', "UI.A('pass')", 'sec')}
      </div>`;
    }
    case 'stock':
      return stockSheet(c.tk, c.price, 'buy', '💼 Брокер: пакет со скидкой 20%', 'UI.A(\'buyStock\',{qty:UI.qty()})') + btn('Отказаться', "UI.A('pass')", 'sec') + '</div>';
    case 'market': {
      const e = c.ev;
      let body = '';
      if (e.k === 'sell') {
        const list = me.assets.filter(a => (c.sellable || []).includes(a.id));
        body = (list.length ? `<div class="rows">${list.map(a => `<div class="asset-sell"><span>${a.e} ${a.n}<br><small style="color:var(--hint)">−${money(a.flow)}/мес</small></span><button onclick="UI.A('sell',{id:${a.id}})">Продать ${money(a.down * e.mult)}</button></div>`).join('')}</div>` : '')
          + (c.sold.length ? `<div class="sh-d g" style="margin-top:0">Продано: ${c.sold.length}</div>` : '')
          + `<div class="sh-d" style="margin-top:0">${c.note}</div>`;
      } else body = `<div class="sh-d ${c.cls}">${c.note}</div>`;
      return `<div class="kind" style="color:#f5a623">📈 Событие рынка · для всех</div>
      <div class="sh-e">${e.e}</div><div class="sh-t">${e.n}</div><div class="sh-d">${e.d}</div>${body}
      <div class="btns">${btn('Готово', "UI.A('ok')")}</div>`;
    }
    case 'tempt':
      return `<div class="kind" style="color:#ff6b81">🛍 Соблазн</div><div class="sh-e">${c.t.e}</div><div class="sh-t">${c.t.n}</div><div class="sh-d">${c.t.d}</div>
      ${rowsHTML([['Оплачено', money(c.cost), 'r'], ['Осталось на руках', money(me.cash)]])}
      <div class="btns">${btn('Эх 😩', "UI.A('ok')", 'warn')}</div><div class="sh-d" style="margin-top:10px;font-size:12px">Соблазны обязательны. Так работает колесо.</div>`;
    case 'child':
      return c.added ? `<div class="kind" style="color:#d68cff">👶 Пополнение</div><div class="sh-e">👶</div><div class="sh-t">У тебя родился ребёнок!</div>
      <div class="sh-d">Поздравляем! Расходы выросли на ${money(me.child)}/мес навсегда.</div><div class="btns">${btn('Ура! 🍼', "UI.A('ok')")}</div>`
        : `<div class="kind" style="color:#d68cff">👶 Пополнение</div><div class="sh-e">👨‍👩‍👧‍👦</div><div class="sh-t">У тебя уже трое детей</div><div class="sh-d">Больше не надо, спасибо.</div><div class="btns">${btn('Дальше', "UI.A('ok')")}</div>`;
    case 'down':
      return `<div class="kind" style="color:#aab">🚫 Увольнение</div><div class="sh-e">📦</div><div class="sh-t">Тебя сократили</div>
      <div class="sh-d">Оплати месяц расходов без зарплаты и пропусти 2 хода. Пассивный доход продолжает капать, поэтому он и нужен.</div>
      ${rowsHTML([['Оплачено', money(c.paid), 'r']])}<div class="btns">${btn('Эх…', "UI.A('ok')", 'sec')}</div>`;
    case 'charity':
      return `<div class="kind" style="color:#ff7ab6">❤️ Помощь</div><div class="sh-e">🤲</div><div class="sh-t">Поддержать фонд?</div>
      <div class="sh-d">Отдай 10% зарплаты и следующие 3 хода бросай два кубика. Будешь быстрее находить сделки.</div>
      ${rowsHTML([['Пожертвование', money(c.cost)], ['У тебя на руках', money(me.cash)]])}
      <div class="btns">${btn(`Помочь ${money(c.cost)}`, "UI.A('buy')", '', me.cash < c.cost)}${btn('Не сейчас', "UI.A('pass')", 'sec')}</div>`;
    case 'invest': {
      const v = c.inv, can = me.cash >= v.cost;
      return `<div class="kind" style="color:#6ab3f3">🏭 Инвестиция</div><div class="sh-e">${v.e}</div><div class="sh-t">${v.n}</div><div class="sh-d">${v.d}</div>
      ${rowsHTML([['Цена', money(v.cost)], ['Поток', `+${money(v.flow)} за 💰`, 'g'], ['Окупится за', Math.ceil(v.cost / v.flow) + ' дивидендов', 'y'], ['Наличные', money(me.cash)]])}
      <div class="btns">${can ? btn(`Купить за ${money(v.cost)}`, "UI.A('buy')", 'gold') : btn(`Не хватает ${money(v.cost - me.cash)}`, '', '', true)}${btn('Пропустить', "UI.A('pass')", 'sec')}</div>`;
    }
    case 'venture': {
      if (c.result) {
        const w = c.result.win;
        return `<div class="kind" style="color:#a58cff">🎰 Венчур</div><div class="sh-e">${c.v.e}</div><div class="sh-t">${c.v.n}</div>
        <div class="bigdie bubdie">${FACES[c.result.die - 1]}</div>
        <div class="sh-t ${w ? 'g' : 'r'}" style="margin-bottom:10px">${w ? 'Выиграл ' + money(w) + '!' : 'Стартап закрылся 💀'}</div>
        <div class="btns">${btn('Дальше', "UI.A('ok')", 'sec')}</div>`;
      }
      return `<div class="kind" style="color:#a58cff">🎰 Венчур</div><div class="sh-e">${c.v.e}</div><div class="sh-t">${c.v.n}</div>
      <div class="sh-d">Вложи и брось кубик. 🎲 6: ×8, 🎲 5: ×4, иначе деньги сгорают.</div>
      ${rowsHTML([['Ставка', money(c.cost)], ['Шанс выигрыша', '33%', 'y'], ['Наличные', money(me.cash)]])}
      <div class="btns">${me.cash >= c.cost ? btn(`Вложить ${money(c.cost)} и бросить`, "UI.A('venture')", 'gold') : btn(`Не хватает ${money(c.cost - me.cash)}`, '', '', true)}${btn('Не рисковать', "UI.A('pass')", 'sec')}</div>`;
    }
    case 'dream': {
      const dr = D.DREAMS[c.di], ok = me.cash >= c.cost;
      return `<div class="kind" style="color:var(--gold)">✨ Твоя мечта</div><div class="sh-e">${dr.e}</div><div class="sh-t">${dr.n}</div><div class="sh-d">${dr.d}</div>
      ${rowsHTML([['Цена', money(c.cost), 'y'], ['Наличные', money(me.cash), ok ? 'g' : 'r']])}
      <div class="btns">${ok ? btn('Купить мечту ✨', "UI.A('buy')", 'gold') : btn(`Не хватает ${money(c.cost - me.cash)}`, '', '', true)}${btn(ok ? 'Позже' : 'Эх, в следующий круг', "UI.A('pass')", 'sec')}</div>`;
    }
    case 'disaster': {
      const t = D.DISASTER_TEXT[c.key];
      return `<div class="kind" style="color:var(--red)">${t[0]} Удар судьбы</div><div class="sh-e">${t[0]}</div><div class="sh-t">${t[1]}</div><div class="sh-d">${t[2]}</div>
      ${rowsHTML([['Потеряно', money(c.loss), 'r'], ['Осталось', money(me.cash)]])}<div class="btns">${btn('Переживу', "UI.A('ok')", 'sec')}</div>`;
    }
    case 'crisis':
      return `<div class="kind" style="color:#aab">🌪 Кризис</div><div class="sh-e">🌪</div><div class="sh-t">Экономический кризис</div>
      ${c.lost ? `<div class="sh-d r">${c.lost.e} ${c.lost.n} разорился. Поток −${money(c.lost.flow)}</div>` : '<div class="sh-d g">У тебя нет инвестиций, кризис прошёл мимо.</div>'}
      <div class="btns">${btn('Дальше', "UI.A('ok')", 'sec')}</div>`;
  }
  return `<div class="btns">${btn('Дальше', "UI.A('ok')")}</div>`;
}

/* ---------- экраны выхода и финала ---------- */
function confetti() {
  for (let i = 0; i < 40; i++) {
    const c = document.createElement('div'); c.className = 'confetti'; c.textContent = ['🎉', '💸', '✨', '🪙', '🎊'][i % 5];
    c.style.left = Math.random() * 100 + '%'; c.style.animationDuration = (1.5 + Math.random() * 2) + 's'; c.style.animationDelay = Math.random() * 0.6 + 's';
    $('app').appendChild(c); setTimeout(() => c.remove(), 4000);
  }
}
function renderOverlay() {
  const w = $('win'), me = S.players[ME];
  let key = null;
  if (!busy && S.phase === 'exit' && S.exitPid === ME) key = 'exit';
  else if (!busy && S.phase === 'over') key = 'over';
  if (key === overlayKey) return;
  overlayKey = key;
  if (!key) { w.classList.add('hidden'); return; }
  closeSheet();
  if (key === 'exit') {
    const U = Math.max(1000, C.passive(S, me) * D.RULES.fastMult);
    w.className = 'win';
    w.innerHTML = `<div class="big">🎉</div><h2>Ты вышел из колеса!</h2>
    <p>Пассивный доход покрывает расходы. Пора в Большую игру: там твой поток ×100 и ставки другие.</p>
    <div class="storycard"><div class="k">Колесо · ${me.emoji} ${me.profName} · ${D.DIFF[S.diff].n}</div><div class="v">Свобода за ${me.turns} ходов</div>
      <div class="grid"><div><div class="k">Пассивный доход</div><div class="v">${money(C.passive(S, me))}</div></div><div><div class="k">Активов</div><div class="v">${me.assets.length}</div></div></div></div>
    <div class="lbl" style="align-self:flex-start">Выбери мечту</div>
    <div class="dreams">${D.DREAMS.map((d, i) => `<button class="dream" onclick="UI.A('dream',{i:${i}})"><div class="de">${d.e}</div><div><div class="dn">${d.n}</div><div class="dp">${d.d}</div></div><div class="dc">${money(Math.round(U * d.m / 1000) * 1000)}</div></button>`).join('')}</div>
    <button class="b sec" style="width:100%" onclick="UI.share()">📤 Поделиться в сторис</button>`;
    confetti(); haptic('ok');
  } else {
    const r = S.result;
    if (r.type === 'win' && r.pid === ME) {
      const dr = D.DREAMS[me.dream];
      w.className = 'win';
      w.innerHTML = `<div class="big">${dr.e}</div><h2>${r.how === 'dream' ? 'Мечта исполнена!' : 'Ты стал магнатом!'}</h2>
      <p>${r.how === 'dream' ? `Ты купил: ${dr.n}.` : 'Твой поток вырос на 50%.'} Победа над Аней и Максом.</p>
      <div class="storycard gold"><div class="k">Колесо · ${me.emoji} ${me.profName} · ${D.DIFF[S.diff].n}</div><div class="v">Победа за ${me.turns} ходов</div>
        <div class="grid"><div><div class="k">Поток БИ</div><div class="v">${money(me.fflow)}</div></div><div><div class="k">Наличные</div><div class="v">${money(me.cash)}</div></div>
        <div><div class="k">Инвестиций</div><div class="v">${me.finv.length}</div></div><div><div class="k">Мечта</div><div class="v">${dr.e}</div></div></div></div>
      <div class="btns"><button class="b gold" onclick="UI.share()">📤 Поделиться в сторис</button><button class="b sec" onclick="UI.newGame()">Новая партия</button></div>`;
      confetti();
    } else if (r.type === 'bankrupt') {
      w.className = 'win lose';
      w.innerHTML = `<div class="big">💀</div><h2>Банкротство</h2>
      <p>Денег нет, банк отказал, активов на продажу не осталось. Колесо победило.</p>
      <div class="storycard" style="background:linear-gradient(135deg,#5a1f26,#2a3240)"><div class="k">Итог · ${D.DIFF[S.diff].n}</div><div class="v">Продержался ${me.turns} ходов</div>
      <div class="grid"><div><div class="k">Долг банку</div><div class="v">${money(C.loanTotal(me))}</div></div><div><div class="k">Детей</div><div class="v">${me.children}</div></div></div></div>
      <p style="margin-bottom:14px">Совет: не бери кредиты под сделки, где платёж съедает поток, и держи подушку на соблазны.</p>
      <div class="btns"><button class="b" onclick="UI.newGame()">Ещё раз</button></div>`;
    } else {
      const b = S.players[r.pid] || { name: 'Никто', emoji: '🤷' };
      w.className = 'win lose';
      w.innerHTML = `<div class="big">${b.emoji}</div><h2>${b.name} ${r.how === 'dream' ? 'купил(а) мечту' : 'стал(а) магнатом'} первым</h2>
      <p>Партия окончена. ${me.mode === 'rat' ? `Ты так и не выбрался из колеса: свобода ${C.freedom(S, me)}%.` : `Ты был в Большой игре: ${C.fProgress(S, me)}% до мечты.`}</p>
      <div class="storycard" style="background:linear-gradient(135deg,#444c58,#2a3240)"><div class="k">Твой результат · ${D.DIFF[S.diff].n}</div><div class="v">${me.turns} ходов</div>
      <div class="grid"><div><div class="k">Наличные</div><div class="v">${money(me.cash)}</div></div><div><div class="k">Долг</div><div class="v">${money(C.loanTotal(me))}</div></div></div></div>
      <div class="btns"><button class="b" onclick="UI.newGame()">Реванш</button></div>`;
    }
  }
  w.classList.remove('hidden');
}

/* ---------- мелочи ---------- */
let tt;
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => e.classList.remove('on'), 2400); }
function switchView(v) {
  view = v;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.v === v));
  ['board', 'ex', 'report', 'chat'].forEach(x => $('v-' + x).classList.toggle('hidden', x !== v));
  if (v === 'chat') $('v-chat').dataset.init = '';
  render();
}
document.querySelectorAll('.tab').forEach(t => { t.onclick = () => switchView(t.dataset.v); });
$('rollBtn').onclick = () => A('roll');

window.UI = {
  A, toast, switchView, start, resume, debugFast, trade,
  setDiff: k => { diffSel = k; drawStart(); },
  setQty: n => { qtyUI = n; render(); },
  qty: () => qtyUI,
  confirmTrade: () => { if (tradeUI) A('trade', { tk: tradeUI.tk, side: tradeUI.side, qty: qtyUI }); },
  closeTrade: () => { tradeUI = null; qtyUI = null; render(); },
  newGame: () => { clearSave(); showStart(); },
  share: () => toast(tg ? 'Здесь откроется редактор сторис Telegram с этой карточкой' : 'В Telegram здесь откроется редактор сторис'),
  restart: el => {
    if (!restartArm) { restartArm = true; el.textContent = 'Точно? Нажми ещё раз'; setTimeout(() => { restartArm = false; }, 3000); return; }
    restartArm = false; clearSave(); showStart();
  },
};

initTg();
drawStart();
})();
