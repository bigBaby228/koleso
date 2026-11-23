/*
 * КОЛЕСО — интерфейс.
 * Только отображение: берёт состояние из движка, рисует его и отправляет действия игрока в KolesoEngine.act().
 * Здесь же интеграция с Telegram (тема, вибрация, имя игрока) и сохранение партии.
 */
(function () {
'use strict';
const E = window.KolesoEngine, D = E.D, C = E.calc, { money, pct, fmtP } = E.fmt;
let ME = 0; const SAVE = 'koleso-save-v1', FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const $ = id => document.getElementById(id);
const tgRaw = window.Telegram && window.Telegram.WebApp;
const tg = tgRaw && tgRaw.initData ? tgRaw : null; // null, если открыто не в Telegram

let S = null, busy = false, view = 'board', diffSel = 'normal', profMode = 'random';
let stageUI = null, seenLog = 0, seenNews = 0, tradeUI = null, qtyUI = null, anim = null, lastCash = null, builtKey = null, botTimer = null, overlayKey = null, restartArm = false;

/* ---------- сохранение ---------- */
function save() { if (tut || NET.on) return; try { localStorage.setItem(SAVE, JSON.stringify({ S, seenLog, seenNews })); } catch (e) { /* хранилище недоступно */ } }
function load() { try { const x = JSON.parse(localStorage.getItem(SAVE)); return x && x.S && x.S.v === 4 ? x : null; } catch (e) { return null; } }
function clearSave() { try { localStorage.removeItem(SAVE); } catch (e) { /* ignore */ } }

/* ---------- Telegram ---------- */
/* ---------- кошелёк и темы ---------- */
const WALLET = 'koleso-wallet-v1';
function wallet() {
  try { const w = JSON.parse(localStorage.getItem(WALLET)); if (w && typeof w.coins === 'number') return Object.assign({ owned: ['classic'], theme: 'classic', paid: [], dice: 'classic', ownedDice: ['classic'] }, w); } catch (e) { /* ignore */ }
  return { coins: 0, owned: ['classic'], theme: 'classic', paid: [], dice: 'classic', ownedDice: ['classic'] };
}
function walletSave(w) { try { localStorage.setItem(WALLET, JSON.stringify(w)); } catch (e) { /* ignore */ } }
function addCoins(n) { const w = wallet(); w.coins += n; walletSave(w); }
function applyTheme(id) {
  const th = D.THEMES.find(t => t.id === id) || D.THEMES[0];
  D.THEMES.forEach(t => document.body.classList.remove('th-' + t.id));
  if (th.id !== 'classic') document.body.classList.add('th-' + th.id);
  try { if (tg && tg.setHeaderColor) tg.setHeaderColor(th.hdr); if (tg && tg.setBackgroundColor) tg.setBackgroundColor(th.bg); } catch (e) { /* ignore */ }
}
function gameReward() {
  const me = S.players[ME], r = S.result, won = r && r.type === 'win' && r.pid === ME, K = D.COINS;
  let n = won ? K.win : me.bankrupt ? K.bankrupt : K.play;
  if (!won) n += me.mode === 'fast' ? K.fast : me.mode === 'mid' ? K.mid : 0;
  const friends = S.players.some(q => !q.bot && !q.auto && q.id !== ME);
  return Math.max(5, Math.round(n * (K.diff[S.diff] || 1) * (friends ? K.friends : 1) / 5) * 5);
}
// начисляется один раз за партию; возвращает сумму, чтобы показать на финальном экране
function awardGame() {
  if (tut || !S || S.seed == null) return 0;
  const me = S.players[ME];
  if (me.bot && !me.auto) return 0;
  const id = (NET.on ? NET.code : 'solo') + ':' + S.seed + ':' + ME, w = wallet(), n = gameReward();
  if (!w.paid.includes(id)) { w.paid.push(id); w.paid = w.paid.slice(-40); w.coins += n; walletSave(w); }
  return n;
}
const coinLine = n => n ? `<div class="coinwin">+${n} <span class="coin">К</span> КолесоКоинов</div>` : '';
let shopTab = 'themes';
function showShop(tab) {
  if (tab) shopTab = tab;
  const w = $('win'), wl = wallet();
  w.className = 'win';
  const tabs = `<div class="seg" style="width:100%;margin-bottom:10px">${[['themes', 'Темы'], ['dice', 'Кубики']].map(([k, n]) => `<button class="${shopTab === k ? 'on' : ''}" onclick="UI.showShop('${k}')">${n}</button>`).join('')}</div>`;
  if (shopTab === 'dice') {
    w.innerHTML = `<h2 style="margin-top:4px">Магазин</h2><div class="wallet"><span class="coin">К</span> ${wl.coins.toLocaleString('ru-RU')} КолесоКоинов</div>${tabs}
    <div class="note" style="margin:0 0 10px;text-align:center">Скин кубика видят все игроки за столом, когда ты бросаешь.</div>
    <div class="shop">${D.DICE.map(t => {
      const own = wl.ownedDice.includes(t.id), on = wl.dice === t.id;
      const b = on ? '<button class="b sec" disabled>Выбран</button>'
        : own ? `<button class="b" onclick="UI.wearDice('${t.id}')">Выбрать</button>`
        : `<button class="b ${wl.coins >= t.price ? 'warn' : ''}" ${wl.coins >= t.price ? '' : 'disabled'} onclick="UI.buyDice('${t.id}')"><span class="coin">К</span> ${t.price}</button>`;
      return `<div class="theme ${on ? 'on' : ''}"><div class="dice sk-${t.id} dprev">${KolesoTable.dieHTML(5)}</div>
        <div class="ti"><div class="tn">${t.n}</div><div class="td">${t.d}</div></div>${b}</div>`;
    }).join('')}</div>
    <button class="b sec" style="width:100%;margin-top:10px" onclick="UI.closeAch()">Закрыть</button>`;
    return w.classList.remove('hidden');
  }
  w.innerHTML = `<h2 style="margin-top:4px">Магазин</h2><div class="wallet"><span class="coin">К</span> ${wl.coins.toLocaleString('ru-RU')} КолесоКоинов</div>${tabs}
    <div class="note" style="margin:0 0 10px;text-align:center">Коины дают за каждую партию: победа ${D.COINS.win}, участие ${D.COINS.play}, достижение ${D.COINS.ach}. Хардкор ×${D.COINS.diff.hard}, игра с друзьями ×${D.COINS.friends}.</div>
    <div class="shop">${D.THEMES.map(t => {
      const own = wl.owned.includes(t.id), on = wl.theme === t.id;
      const b = on ? '<button class="b sec" disabled>Надета</button>'
        : own ? `<button class="b" onclick="UI.wearTheme('${t.id}')">Надеть</button>`
        : `<button class="b ${wl.coins >= t.price ? 'warn' : ''}" ${wl.coins >= t.price ? '' : 'disabled'} onclick="UI.buyTheme('${t.id}')"><span class="coin">К</span> ${t.price}</button>`;
      return `<div class="theme ${on ? 'on' : ''}"><div class="tsw" style="background:linear-gradient(135deg,${t.sw[0]} 0 45%,${t.sw[1]} 45% 70%,${t.sw[2]} 70%)"></div>
        <div class="ti"><div class="tn">${t.n}</div><div class="td">${t.d}</div></div>${b}</div>`;
    }).join('')}</div>
    <button class="b sec" style="width:100%;margin-top:10px" onclick="UI.closeAch()">Закрыть</button>`;
  w.classList.remove('hidden');
}
function buyTheme(id) {
  const t = D.THEMES.find(x => x.id === id), w = wallet();
  if (!t || w.owned.includes(id)) return;
  if (w.coins < t.price) return toast('Не хватает КолесоКоинов');
  w.coins -= t.price; w.owned.push(id); w.theme = id; walletSave(w);
  applyTheme(id); haptic('ok'); toast(`Тема «${t.n}» куплена и надета`); showShop(); drawStart();
}
function buyDice(id) {
  const t = D.DICE.find(x => x.id === id), w = wallet();
  if (!t || w.ownedDice.includes(id)) return;
  if (w.coins < t.price) return toast('Не хватает КолесоКоинов');
  w.coins -= t.price; w.ownedDice.push(id); w.dice = id; walletSave(w);
  if (S && !NET.on) S.players[ME].dice = id;
  haptic('ok'); toast(`Кубик «${t.n}» куплен`); showShop(); drawStart();
}
function wearDice(id) { const w = wallet(); if (!w.ownedDice.includes(id)) return; w.dice = id; walletSave(w); if (S && !NET.on) S.players[ME].dice = id; showShop(); }
function wearTheme(id) { const w = wallet(); if (!w.owned.includes(id)) return; w.theme = id; walletSave(w); applyTheme(id); showShop(); }

function initTg() {
  if (!tg) return;
  document.body.classList.add('in-tg');
  try {
    tg.ready(); tg.expand();
    if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
  } catch (e) { /* старый клиент Telegram */ }
}
const tgName = () => (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.first_name) || 'Ты';
function haptic(kind) {
  try { if (!tg || !tg.HapticFeedback) return; if (kind === 'ok') tg.HapticFeedback.notificationOccurred('success'); else tg.HapticFeedback.impactOccurred(kind || 'light'); } catch (e) { /* ignore */ }
}

/* ---------- стартовый экран ---------- */
function drawStart(msg) {
  const sv = load(), room = lsGet(ROOMKEY);
  $('shopBtn').innerHTML = `Магазин · <span class="coin">К</span> ${wallet().coins.toLocaleString('ru-RU')}`;
  $('onBox').innerHTML = (msg ? `<div class="note" style="color:#ff9b9b;margin-bottom:6px">${msg}</div>` : '')
    + `<button class="b" style="width:100%;background:#7a4fd6" onclick="UI.online()">Играть с друзьями</button>`
    + (room ? `<button class="b sec" style="width:100%;margin-top:8px" onclick="UI.rejoin()">Вернуться в комнату ${room}</button>` : '')
    + `<details class="qh" style="margin-top:8px"><summary>Войти по коду комнаты</summary><div class="joinrow"><input id="joinInp" maxlength="8" placeholder="КОД"><button class="b" onclick="UI.joinCode()">Войти</button></div></details>`;
  $('contBox').innerHTML = sv && sv.S.phase !== 'over'
    ? `<button class="b contbtn" onclick="UI.resume()">▶ Продолжить партию (${sv.S.players[0].profName}, ход ${sv.S.players[0].turns})</button>` : '';
  $('diffSeg').innerHTML = Object.entries(D.DIFF).map(([k, v]) => `<button class="${k === diffSel ? 'on' : ''}" onclick="UI.setDiff('${k}')">${v.n}</button>`).join('');
  $('diffNote').textContent = D.DIFF[diffSel].note;
  $('modeSeg').innerHTML = [['random', 'Случайно'], ['pick', 'Выбрать']].map(([k, n]) => `<button class="${k === profMode ? 'on' : ''}" onclick="UI.setMode('${k}')">${n}</button>`).join('');
  const got = achGot(); $('achBtn').textContent = `Достижения ${D.ACH.filter(a => got[a.id]).length}/${D.ACH.length}`;
  if (profMode === 'random') {
    $('profList').innerHTML = `<button class="b" style="width:100%;margin:6px 0 4px;font-size:16px;padding:15px" onclick="UI.startRandom()">Бросить кубик профессии</button>`;
    return;
  }
  $('profList').innerHTML = D.PROFS.map(p => {
    const ex = p.exp.reduce((s, e) => s + e[1], 0);
    return `<button class="prof" onclick="UI.start('${p.id}')"><div class="pe">${p.e}</div><div><div class="pn">${p.n}</div>
    <div class="pd">Поток +${money(p.salary - ex)} · ${p.bonus}</div></div></button>`;
  }).join('');
}
function showStart(msg) {
  clearTimeout(botTimer); S = null; busy = false; tradeUI = null; overlayKey = null; ME = 0;
  if (NET.on) { NET.bye = true; NET.on = false; netClose(); }
  $('scrLobby').classList.add('hidden');
  closeSheet(); $('win').classList.add('hidden'); $('app').classList.remove('fast');
  $('scrGame').classList.add('hidden'); $('scrStart').classList.remove('hidden');
  drawStart(msg);
}
function showGame() {
  $('scrStart').classList.add('hidden'); $('scrLobby').classList.add('hidden'); $('scrGame').classList.remove('hidden');
  builtKey = null; lastCash = null; overlayKey = null; $('win').classList.add('hidden');
  switchView('board');
}
function start(prof) {
  S = E.newGame({ prof, diff: diffSel, seed: (Date.now() ^ Math.floor(Math.random() * 1e9)) | 0, name: tgName() });
  S.players[0].dice = wallet().dice;
  seenLog = 0; seenNews = 0;
  showGame(); setLast('Нажми на кубик, чтобы начать'); save(); render();
}
function showRules() {
  const w = $('win'); w.className = 'win';
  w.innerHTML = `<h2 style="margin-top:4px">Правила</h2><div class="rules">
    <p><b>1. Колесо.</b> Покупай активы, пока пассивный доход не покроет расходы.</p>
    <p><b>2. Средний круг.</b> Расти бизнесом до потока $100 000 в месяц.</p>
    <p><b>3. Большая игра.</b> Купи мечту или нарасти поток на $80 000 раньше соперников. Цены одни для всех.</p>
    <p><b>Кредит.</b> Банк даёт до 70% взноса, остальное — свои. За свои целиком скидка 10%. Доход в карточке — обещание продавца. Длинный кредит дорожает в кризис.</p>
    <p>Перейти на следующий круг можно только без долгов. Темки — риск: куш или долг коллекторам. Учёба занимает ход. Биржа живёт на новостях.</p></div>
    <button class="b sec" style="width:100%" onclick="UI.closeAch()">Понятно</button>`;
  w.classList.remove('hidden');
}
function startRandom() {
  const box = $('profList'); let k = 0;
  const iv = setInterval(() => {
    const p = D.PROFS[Math.floor(Math.random() * D.PROFS.length)];
    box.innerHTML = `<div class="prof" style="justify-content:center"><div class="pe">${p.e}</div><div class="pn">${p.n}</div></div>`;
    haptic('light');
    if (++k > 14) { clearInterval(iv); setTimeout(() => { start(p.id); toast(`🎲 Ты — ${p.n}. Бонус: ${p.bonus}`); }, 600); }
  }, 90);
}
function resume() {
  const sv = load(); if (!sv) return;
  S = sv.S; seenLog = sv.seenLog || 0; seenNews = sv.seenNews || 0;
  showGame(); setLast('Партия продолжается'); render(); kickBots();
}
function debugMid() {
  start('teacher');
  const me = S.players[ME];
  me.assets.push({ t: 'prop', cat: 'house', e: '🏘', n: 'Портфель недвижимости', flow: C.expenses(S, me), down: 60000, id: ++S.uid });
  me.mode = 'mid'; me.mstart = C.cashflow(S, me); me.midAt = me.turns = 30; me.pos = 0;
  stageUI = 'mid'; save(); render();
}
function debugFast() {
  start('teacher');
  const me = S.players[ME];
  me.assets.push({ t: 'biz', cat: 'mbiz', e: '🏭', n: 'Холдинг среднего бизнеса', flow: 100000 + C.expenses(S, me), down: 900000, id: ++S.uid });
  me.mode = 'mid'; me.mstart = 3000; me.midAt = 30; me.turns = 45; S.phase = 'exit'; S.exitPid = ME;
  render();
}

/* ---------- действия ---------- */
const nameOf = pid => pid === ME ? 'Ты' : S.players[pid].name;
function A(type, extra) { if (tut) return toast('Это обучение — кнопки только для примера'); dispatch(Object.assign({ type, pid: ME }, extra || {})); }
function dispatch(a) {
  if (busy && !a._bot && a.type !== 'dbg') { toast('Подожди, сейчас ход другого игрока'); return; }
  if (NET.on) {
    if (NET.pend) return;
    if (!NET.ws || NET.ws.readyState !== 1) return toast('Нет связи с сервером, переподключаюсь…');
    NET.pend = true; setTimeout(() => { NET.pend = false; }, 4000);
    return NET.ws.send(JSON.stringify({ t: 'act', a }));
  }
  run(E.act(S, a), a);
}
function run(r, a) {
  if (!r.ok) { if (a.pid === ME) toast(r.events[0].text); busy = false; return; }
  const roll = r.events.find(e => e.t === 'roll' || e.t === 'skip');
  const myToasts = r.events.filter(e => e.t === 'toast' && e.pid === ME).map(e => e.text);
  if (r.events.some(e => e.t === 'stage' && e.pid === ME)) stageUI = 'mid';
  if (a.type === 'trade' || a.type === 'buyStock') { tradeUI = null; qtyUI = null; }
  const finish = () => {
    S = r.state; busy = false;
    if (roll && roll.t === 'roll') {
      const p = S.players[roll.pid];
      const T = roll.mode === 'fast' ? D.FT[D.FCELLS[p.pos]] : roll.mode === 'mid' ? D.MT[D.MCELLS[p.pos]] : D.CT[D.CELLS[p.pos]];
      setLast(roll.pid === ME ? `<b>${T.h.split(':')[0]}</b>` : `${p.name}: ${roll.steps} → ${T.n}`);
    }
    if (roll && roll.t === 'skip') setLast(`${nameOf(roll.pid)}: <b>пропуск хода</b>`);
    save(); render(); achCheck();
    if (myToasts.length) toast(myToasts[myToasts.length - 1]);
    if (S.phase === 'over' && S.result.type === 'win' && S.result.pid === ME) haptic('ok');
    kickBots(); netPump();
  };
  if (roll && roll.t === 'roll') { busy = true; render(); animateRoll(roll, finish); }
  else finish();
}
function kickBots() {
  clearTimeout(botTimer);
  if (!S || S.phase === 'over' || stageUI || tut || NET.on) return;
  const a = E.botAction(S);
  if (!a) return;
  busy = true; render();
  botTimer = setTimeout(() => { a._bot = true; dispatch(a); }, a.type === 'roll' ? 600 : 450);
}
function animateRoll(e, cb) {
  const p = S.players[e.pid], mine = e.pid === ME, me = S.players[ME];
  const visible = e.mode === me.mode;
  if (mine) haptic('medium');
  let k = 0;
  const iv = setInterval(() => {
    KolesoTable.dice(e.dice.map(() => 1 + Math.floor(Math.random() * 6)), true, p.dice);
    if (++k > (mine ? 8 : 4)) {
      clearInterval(iv);
      KolesoTable.dice(e.dice, false, p.dice);
      setLast(mine ? `Выпало <b>${e.steps}</b>` : `${p.name}: <b>${e.steps}</b>`);
      if (!visible) return setTimeout(cb, 200);
      step(0);
    }
  }, 70);
  function step(i) {
    anim = { pid: e.pid, pos: (e.from + i + 1) % ringOf(p)[0].length }; renderTokens();
    if (i + 1 < e.steps) setTimeout(() => step(i + 1), mine ? 150 : 80);
    else setTimeout(() => { anim = null; cb(); }, mine ? 250 : 150);
  }
}

/* ---------- отрисовка ---------- */
function render() {
  if (!S) return;
  const me = S.players[ME], fast = me.mode === 'fast', mid = me.mode === 'mid';
  $('app').classList.toggle('fast', fast); $('app').classList.toggle('mid', mid);
  if (builtKey !== me.mode + '|' + me.dream) buildBoard();
  $('hAva').textContent = me.emoji; $('hProf').textContent = me.profName; $('hTurn').textContent = me.turns; $('hDiff').textContent = D.DIFF[S.diff].n + (me.free ? ' · без работы' : '');
  $('hMode').innerHTML = fast ? '<span class="modetag">БОЛЬШАЯ ИГРА</span>' : mid ? '<span class="modetag mid">СРЕДНИЙ КРУГ</span>' : '';
  const hm = v => Math.abs(v) >= 1e5 ? shortMoney(v) : money(v);
  $('hCash').textContent = hm(me.cash);
  if (!fast) {
    const f = C.cashflow(S, me), fr = C.progress(S, me);
    $('hFlow').textContent = (f >= 0 ? '+' : '') + hm(f); $('hFlow').className = 'v ' + (f >= 0 ? 'g' : 'r'); $('hFlowL').textContent = 'поток / мес';
    $('hGoalTxt').innerHTML = mid ? `Цель: поток ${money(D.RULES.fastFlow)}` : `Цель: пассивный ${money(C.passive(S, me))} из ${money(C.expenses(S, me))}`;
    $('hPct').textContent = fr + '%'; $('hBar').style.width = fr + '%';
    const goal = mid ? f >= D.RULES.fastFlow : C.passive(S, me) >= C.expenses(S, me);
    $('hAdvice').textContent = advice(me);
    $('hGoalSub').innerHTML = C.loanTotal(me) ? (goal ? `<span class="gate">🔒 Закрой долги ${money(C.loanTotal(me))}, чтобы перейти</span>` : `Долг ${money(C.loanTotal(me))} · −${money(C.loanPay(me))}/мес`) : '';
  } else {
    const dr = D.DREAMS[me.dream], fp = C.fProgress(S, me);
    $('hFlow').textContent = '+' + hm(me.fflow); $('hFlow').className = 'v y'; $('hFlowL').textContent = 'за выплату';
    $('hGoalTxt').innerHTML = `${dr.n}: ${shortMoney(me.cash)} из ${shortMoney(me.dreamCost)}`;
    $('hPct').textContent = fp + '%'; $('hBar').style.width = fp + '%';
    $('hGoalSub').textContent = `или поток ${shortMoney(C.fTarget(me))}`; $('hAdvice').textContent = '';
  }
  if (lastCash !== null && lastCash !== me.cash && !anim) floatTxt(me.cash - lastCash);
  lastCash = me.cash;
  renderTokens(); renderRace(); renderNewsbar(); renderCycle();
  if (view === 'ex') renderEx();
  if (view === 'report') renderReport();
  if (view === 'edu') renderEdu();
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
  else if (S.phase === 'exit') { rb.disabled = true; rb.textContent = S.exitPid === ME ? 'Выбери мечту' : `${nameOf(S.exitPid)} выбирает мечту…`; }
  else if (stageUI) { rb.disabled = true; rb.textContent = 'Средний круг'; }
  else if (me.bankrupt) { rb.disabled = true; rb.textContent = `Ты выбыл(а) · ходит ${S.players[S.cur].name}`; }
  else if (S.cur !== ME) { rb.disabled = true; rb.textContent = `Ходит ${S.players[S.cur].name}…`; }
  else if (S.phase === 'card') { rb.disabled = true; rb.textContent = 'Реши по карточке'; }
  else { rb.disabled = busy; rb.textContent = me.skip > 0 ? `Пропустить ход (${me.skip})` : me.charity > 0 ? 'Нажми на кубики на столе' : 'Нажми на кубик на столе'; }
  if (!NET.on && !tut) me.dice = wallet().dice; // скин из магазина действует и в продолженной партии
  // бросок — нажатием на кубик в центре стола
  const dz = document.getElementById('dice');
  if (dz) {
    const tap = !rb.disabled && S.cur === ME && S.phase === 'roll' && !busy && !stageUI && !tut;
    if (tap && (!dz.children.length || !dz.classList.contains('tap'))) KolesoTable.dice(me.charity > 0 ? [5, 2] : [5], false, me.dice);
    dz.classList.toggle('tap', tap);
  }
  renderSheet();
  renderOverlay();
}

/* ---------- стол ---------- */
const shortMoney = n => { const a = Math.abs(n), sg = n < 0 ? '−' : ''; return a >= 1e6 ? `${sg}$${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',')}M` : a >= 1e4 ? `${sg}$${Math.round(a / 1000)}k` : a >= 1000 ? `${sg}$${(a / 1000).toFixed(1).replace('.', ',')}k` : `${sg}$${Math.round(a)}`; };
const ringOf = me => me.mode === 'fast' ? [D.FCELLS, D.FT] : me.mode === 'mid' ? [D.MCELLS, D.MT] : [D.CELLS, D.CT];
let lastHTML = '';

/* ---------- онлайн ---------- */
const CFG = window.KolesoConfig || {}, ROOMKEY = 'koleso-room', QS = new URLSearchParams(location.search);
const SERVER = (QS.get('server') || CFG.server || '').replace(/\/$/, '');
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ignore */ } };
const NET = { on: false, ws: null, code: null, lobby: null, host: null, deadline: 0, q: [], pend: false, watch: false, bye: false, tries: 0 };
function guestId() { let g = lsGet('koleso-guest'); if (!g) { g = Math.random().toString(36).slice(2, 12).padEnd(10, '0'); lsSet('koleso-guest', g); } return g; }
function myUid() { const u = tg && tg.initDataUnsafe && tg.initDataUnsafe.user; return u && tg.initData ? 'tg' + u.id : 'g' + guestId(); }
function netOpen(code) {
  if (!SERVER) return toast('Онлайн ещё не настроен');
  const create = !code;
  if (create) { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; code = Array.from({ length: 5 }, () => A[Math.floor(Math.random() * A.length)]).join(''); }
  netClose();
  Object.assign(NET, { on: true, code, lobby: null, q: [], pend: false, watch: false, bye: false, create, tries: 0 });
  lsSet(ROOMKEY, code);
  showLobby('Подключаюсь…');
  netConnect();
}
function netConnect() {
  const ws = new WebSocket(SERVER.replace(/^http/, 'ws') + '/room/' + NET.code);
  NET.ws = ws;
  ws.onopen = () => { NET.tries = 0; ws.send(JSON.stringify({ t: 'hello', initData: (tg && tg.initData) || '', guest: guestId(), dice: wallet().dice, name: tg ? tgName() : 'Гость ' + guestId().slice(0, 3).toUpperCase(), create: NET.create, code: NET.code, diff: diffSel })); NET.create = false; };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } netMsg(m); };
  ws.onclose = () => {
    if (NET.ws !== ws || NET.bye || !NET.on) return;
    NET.tries++;
    if (NET.tries === 2) toast('Связь потеряна, переподключаюсь…');
    setTimeout(() => { if (NET.on && NET.ws === ws) netConnect(); }, Math.min(8000, 800 * NET.tries));
  };
}
function netClose() { if (NET.ws) { const w = NET.ws; NET.ws = null; try { w.close(); } catch (e) { /* ignore */ } } }
function netSend(m) { if (NET.ws && NET.ws.readyState === 1) NET.ws.send(JSON.stringify(m)); else toast('Нет связи с сервером'); }
function netLeave() {
  if (NET.lobby && !S) netSend({ t: 'leave' });
  NET.bye = true; NET.on = false; netClose(); lsSet(ROOMKEY, null);
  S = null; ME = 0; showStart();
}
function netMsg(m) {
  if (m.t === 'fatal') { toast(m.text); NET.bye = true; NET.on = false; netClose(); lsSet(ROOMKEY, null); S = null; ME = 0; return showStart(m.text); }
  if (m.t === 'err') { NET.pend = false; return toast(m.text); }
  if (m.t === 'lobby') {
    NET.lobby = m; NET.host = m.host;
    if (S) { S = null; ME = 0; clearTimeout(botTimer); busy = false; overlayKey = null; closeSheet(); $('win').classList.add('hidden'); }
    return showLobby();
  }
  if (m.t === 'game') {
    const fresh = !S;
    NET.q = []; NET.pend = false; NET.host = m.host; NET.deadline = m.deadline; NET.lobby = null;
    S = m.state; ME = Math.max(0, m.seat); busy = false; anim = null;
    if (fresh) { seenLog = 0; seenNews = 0; showGame(); setLast(m.seat < 0 ? 'Ты смотришь партию' : 'Партия идёт'); }
    return render();
  }
  if (m.t === 'step') { NET.q.push(m); netPump(); }
}
function netPump() {
  if (!NET.on || busy || !NET.q.length || !S) return;
  const m = NET.q.shift();
  NET.deadline = m.deadline;
  if (m.a.pid === ME) NET.pend = false;
  if (m.a.type === 'trade' || m.a.type === 'buyStock') { if (m.a.pid !== ME) { /* чужая сделка не сбрасывает мой выбор */ } }
  run({ ok: true, state: m.state, events: m.events }, m.a);
}
function invite() {
  const link = CFG.app ? `${CFG.app}?startapp=${NET.code}` : '';
  const text = `Садись за мой стол в «Колесе»${link ? '' : `: код комнаты ${NET.code}`}`;
  const share = 'https://t.me/share/url?url=' + encodeURIComponent(link || text) + (link ? '&text=' + encodeURIComponent(text) : '');
  try { if (tg && tg.openTelegramLink) return tg.openTelegramLink(share); } catch (e) { /* ignore */ }
  try { navigator.clipboard.writeText(link || NET.code); toast('Ссылка скопирована'); } catch (e) { toast(link || NET.code); }
}
function showLobby(wait) {
  clearTimeout(botTimer); closeSheet(); $('win').classList.add('hidden');
  ['scrStart', 'scrGame'].forEach(x => $(x).classList.add('hidden')); $('scrLobby').classList.remove('hidden');
  const L = NET.lobby, box = $('lobby');
  if (!L) { box.innerHTML = `<h1 style="margin-top:30px">Комната ${NET.code}</h1><p class="sub">${wait || 'Подключаюсь…'}</p><button class="b sec" style="width:100%" onclick="UI.leaveRoom()">Отмена</button>`; return; }
  const me = myUid(), host = L.host === me, humans = L.seats.filter(x => !x.bot).length;
  const rows = [0, 1, 2, 3].map(i => {
    const x = L.seats[i];
    if (!x) return `<div class="lseat empty"><span class="ldot"></span><span class="lname">Свободно</span>${host ? `<button class="lbtn" onclick="UI.addBot()">+ бот</button>` : ''}</div>`;
    const col = x.bot ? '#8a96a3' : D.HUMAN_COLORS[L.seats.slice(0, i).filter(y => !y.bot).length % 4];
    const tag = x.uid === L.host ? 'хозяин' : x.bot ? 'бот' : x.online ? '' : 'не в сети';
    return `<div class="lseat"><span class="ldot" style="background:${col}"></span><span class="lname">${x.bot ? 'Бот' : x.name}${x.uid === me ? ' (ты)' : ''}</span>${tag ? `<span class="ltag">${tag}</span>` : ''}
      ${host && x.uid !== me ? `<button class="lbtn" onclick="UI.kick(${i})">убрать</button>` : ''}</div>`;
  }).join('');
  box.innerHTML = `<div class="lbl" style="margin-top:6px">Комната</div><div class="lcode">${L.code}</div>
    <button class="b" style="width:100%;margin:8px 0 4px" onclick="UI.invite()">Пригласить друга</button>
    <div class="lbl">За столом · ${L.seats.length} из 4</div><div class="lseats">${rows}</div>
    <div class="lbl">Сложность</div>
    ${host ? `<div class="seg">${Object.entries(D.DIFF).map(([k, v]) => `<button class="${k === L.diff ? 'on' : ''}" onclick="UI.lobbyDiff('${k}')">${v.n}</button>`).join('')}</div>` : `<div class="note">${D.DIFF[L.diff].n}</div>`}
    <div class="note" style="margin-top:8px">Профессии раздаются случайно. Если игрок не ходит 60 секунд, за него сходит компьютер.</div>
    ${host ? `<button class="b" style="width:100%;margin-top:14px;background:#2f7d55" onclick="UI.lobbyStart()">Начать игру · ${humans} ${humans === 1 ? 'человек' : humans < 5 ? 'человека' : 'человек'}${L.seats.length > humans ? ` и ${L.seats.length - humans} ${L.seats.length - humans === 1 ? 'бот' : 'бота'}` : ''}</button>`
      : `<div class="note" style="text-align:center;margin-top:14px">Ждём, когда хозяин начнёт игру</div>`}
    <button class="b sec" style="width:100%;margin-top:8px" onclick="UI.leaveRoom()">Выйти</button>`;
}

/* ---------- обучение ---------- */
let tut = null;
const legendHTML = (cells, T) => `<div class="tlegend">${[...new Set(cells)].map(t => `<span><i style="--cc:${T[t].c}">${KolesoTable.svgIcon(KolesoTable.CELL_ICON[t])}</i>${T[t].n}</span>`).join('')}</div>`;
const TUT = [
  { sel: '#tableWrap', t: 'Твой стол', d: 'Ты и два соперника за одним столом. Кто первым купит мечту в Большой игре — победил.' },
  { sel: '.seat.s-bl', top: 1, t: 'Твоё место', d: 'Здесь твои деньги и полоска прогресса к цели круга. У соперников — то же самое.' },
  { sel: '.tcells', t: 'Клетки', d: 'Ходишь по кругу. Нажми на клетку в игре — увидишь, что она делает.', legend: 'rat' },
  { sel: '.hud', t: 'Цель круга', d: 'На колесе: пассивный доход должен покрыть расходы. Перейти дальше можно только без долгов.' },
  { sel: '#cyc', t: 'Экономика', d: 'Рост → пик → кризис → восстановление. В кризис сделки дешёвые, но поток падает и банк строже.' },
  { sel: '#dice', t: 'Ход', d: 'Нажми на кубик в центре стола, чтобы бросить. Скин кубика видят все за столом. Иногда перед броском бизнес просит принять решение.' },
  { card: 'deal', t: 'Сделки и кредиты', d: 'Банк даёт до 70% взноса, остальное — свои. За свои целиком скидка 10%. Доход в карточке — обещание продавца, реальный может быть ниже. Длинный кредит без срока, но в кризис ставка растёт.' },
  { card: 'auction', t: 'Торги', d: 'За крупные сделки торгуются соперники. Перебивай ставку или пасуй.' },
  { card: 'dilemma', t: 'Решения по бизнесу', d: 'У каждого варианта свои последствия. Иногда это лотерея.' },
  { card: 'gamble', t: 'Темки', d: 'Быстрые деньги или долг коллекторам. Видно, что выпадет на каждой грани.' },
  { view: 'ex', sel: '#v-ex', t: 'Биржа', d: 'Акции двигаются на новостях. ХомякКоин — лотерея, держать его долго невыгодно.' },
  { view: 'edu', sel: '#v-edu', t: 'Учёба', d: 'Навыки за деньги и ход: аналитика сделок, переговоры, менеджмент и другие.' },
  { view: 'report', sel: '#v-report', t: 'Отчёт', d: 'Доходы, расходы, долги. Здесь гасишь кредиты и продаёшь бизнесы — за 80% цены.' },
  { view: 'chat', sel: '#v-chat', t: 'Чат', d: 'Соперники отказываются от сделок — их можно забрать в свой ход.' },
  { mode: 'mid', sel: '#tableWrap', t: 'Средний круг', d: 'Покерный клуб. Растишь бизнес до потока $100 000 в месяц. До 3 бизнесов ведёшь сам, дальше нужен управляющий.', legend: 'mid' },
  { mode: 'fast', sel: '#tableWrap', t: 'Большая игра', d: 'VIP-стол. Выкупай компании, двигай рынок и купи мечту раньше всех. Осторожно: иски, рейдеры, санкции.', legend: 'fast' },
  { t: 'Готово!', d: 'Начни с «Нормальной» сложности. Удачи!' },
];
function startTutorial() {
  start('teacher'); clearTimeout(botTimer);
  const me = S.players[ME];
  me.assets.push(Object.assign({}, D.SBIZ[5], { flow: 270, id: ++S.uid, loan: 3000, loanRate: 0.035 }));
  me.loans.push({ amt: 3000, rate: 0.035, kind: 'short', due: 8 }); me.cash = 3000;
  tut = { i: 0, base: JSON.parse(JSON.stringify(S)) };
  tutShow();
}
function tutShow() {
  const st = TUT[tut.i];
  document.querySelectorAll('.tut-hl').forEach(e => e.classList.remove('tut-hl'));
  S = JSON.parse(JSON.stringify(tut.base));
  const me = S.players[ME];
  if (st.mode === 'mid') { me.mode = 'mid'; me.mstart = 3000; }
  if (st.mode === 'fast') { me.mode = 'fast'; me.dream = 4; me.fstart = me.fflow = 120000; me.dreamCost = C.dreamPrice(4); }
  const deal = Object.assign({}, D.BIG[0], { down: 15000, price: 150000, flow: 1300 });
  if (st.card === 'deal') { S.phase = 'card'; S.card = { kind: 'deal', deal: Object.assign({}, D.SBIZ[0], { flow: 260, est: 300 }), tier: 'sbiz' }; }
  if (st.card === 'auction') { S.phase = 'card'; S.card = { kind: 'deal', big: true, deal, auction: { price: 15000, leader: 1, bids: [{ pid: 1, max: 0 }], log: [[1, 15000]], done: false } }; }
  if (st.card === 'dilemma') { S.phase = 'card'; S.card = { kind: 'dilemma', di: 0, aid: me.assets[0].id }; }
  if (st.card === 'gamble') { S.phase = 'card'; S.card = { kind: 'gamble', g: D.GAMBLES[0], stake: 2000, scale: 1, tier: 'rat', result: null }; }
  switchView(st.view || 'board');
  const T = st.legend === 'mid' ? [D.MCELLS, D.MT] : st.legend === 'fast' ? [D.FCELLS, D.FT] : [D.CELLS, D.CT];
  const box = $('coach');
  box.innerHTML = `<div class="ct">${st.t}<span>${tut.i + 1}/${TUT.length}</span></div><div class="cd">${st.d}</div>${st.legend ? legendHTML(T[0], T[1]) : ''}
    <div class="cb">${tut.i ? '<button class="b sec" onclick="UI.tutGo(-1)">Назад</button>' : '<button class="b sec" onclick="UI.tutEnd()">Пропустить</button>'}
    <button class="b" onclick="${tut.i === TUT.length - 1 ? 'UI.tutEnd()' : 'UI.tutGo(1)'}">${tut.i === TUT.length - 1 ? 'Начать игру' : 'Далее'}</button></div>`;
  box.classList.toggle('top', !!(st.card || st.top));
  box.classList.remove('hidden');
  setTimeout(() => { if (st.sel === '#dice') KolesoTable.dice([5], false, wallet().dice); const el = st.sel && document.querySelector(st.sel); if (el) el.classList.add('tut-hl'); }, 50);
}
function tutEnd() { tut = null; $('coach').classList.add('hidden'); document.querySelectorAll('.tut-hl').forEach(e => e.classList.remove('tut-hl')); clearSave(); showStart(); }

/* ---------- достижения ---------- */
const ACH_KEY = 'koleso-ach-v1';
const achGot = () => { try { return JSON.parse(localStorage.getItem(ACH_KEY)) || {}; } catch (e) { return {}; } };
function achCheck() {
  if (!S) return;
  const me = S.players[ME], st = me.stats || {}, r = S.result, won = r && r.type === 'win' && r.pid === ME;
  const ok = {
    mid: me.mode !== 'rat', fast: me.mode === 'fast', win: won, hard: won && S.diff === 'hard',
    magnate: won && r.how === 'flow', smart: D.SKILLS.every(k => C.has(me, k.id)),
    broker: (st.sp || 0) >= 50000, hamster: !!st.hmk, gambler: (st.gw || 0) >= 5,
    quick: me.mode !== 'rat' && me.midAt <= 25, noloan: !!st.midNoLoan && me.mode !== 'rat',
    collector: !!st.shady && me.mode !== 'rat', raider: (st.co || 0) >= 3, manip: (st.camp || 0) >= 3, fas: !!st.fas,
    bankrupt: r && r.type === 'bankrupt' && r.pid === ME,
  };
  D.DREAMS.forEach((d, i) => { ok['dream' + i] = won && r.how === 'dream' && me.dream === i; });
  const got = achGot(); let fresh = null;
  let nNew = 0;
  D.ACH.forEach(a => { if (ok[a.id] && !got[a.id]) { got[a.id] = Date.now(); fresh = a; nNew++; } });
  if (nNew) addCoins(nNew * D.COINS.ach);
  if (fresh) { try { localStorage.setItem(ACH_KEY, JSON.stringify(got)); } catch (e) { /* ignore */ } setTimeout(() => toast(`${fresh.e} Достижение: ${fresh.n} · +${nNew * D.COINS.ach} коинов`), 900); haptic('ok'); }
}
function showAch() {
  const got = achGot(), n = D.ACH.filter(a => got[a.id]).length, w = $('win');
  w.className = 'win';
  w.innerHTML = `<h2 style="margin-top:4px">Достижения</h2><p>${n} из ${D.ACH.length}</p>
    <div class="achgrid">${D.ACH.map(a => `<div class="ach ${got[a.id] ? 'got' : ''}"><div class="ae">${got[a.id] ? a.e : '🔒'}</div><div><div class="an">${a.n}</div><div class="ad">${a.d}</div></div></div>`).join('')}</div>
    <button class="b sec" style="width:100%" onclick="UI.closeAch()">Закрыть</button>`;
  w.classList.remove('hidden');
}
function buildBoard() {
  const me = S.players[ME], [cells, T] = ringOf(me);
  builtKey = me.mode + '|' + me.dream;
  KolesoTable.build($('tableWrap'), { mode: me.mode, cells, T, dreamCells: D.DREAM_CELLS, dreams: D.DREAMS, myDream: me.mode === 'fast' ? me.dream : null, onCell: cellInfo });
  setLast(lastHTML);
}
function cellInfo(i) {
  const me = S.players[ME], [cells, T] = ringOf(me), t = cells[i];
  if (t === 'dream') { const di = D.DREAM_CELLS.indexOf(i), dr = D.DREAMS[di]; return toast(me.dream === di ? `Твоя мечта: ${dr.n}, ${money(me.dreamCost)}` : `Чужая мечта: ${dr.n}`); }
  toast(T[t].h);
}
function renderTokens() {
  const me = S.players[ME];
  const list = S.players.filter(q => !q.bankrupt && q.mode === me.mode)
    .map(q => ({ pos: anim && anim.pid === q.id ? anim.pos : q.pos, color: q.color, me: q.id === ME }));
  KolesoTable.tokens(list, anim && anim.pid === ME ? anim.pos : me.pos);
}
function renderRace() {
  const act = S.phase === 'exit' ? S.exitPid : S.cur;
  const n = S.players.length, order = S.players.map((_, i) => S.players[(ME + i) % n]); // я всегда в левом нижнем углу
  const left = NET.on && NET.deadline ? Math.max(0, Math.ceil((NET.deadline - Date.now()) / 1000)) : null;
  KolesoTable.seats(order.map(q => ({
    name: q.id === ME ? 'Ты' : q.name + (q.auto ? ' · авто' : ''), emoji: q.emoji, color: q.color,
    cashTxt: q.bankrupt ? 'банкрот' : act === q.id && left != null && !q.bot && S.phase !== 'over' ? `⏱ ${left} c` : shortMoney(q.cash), progress: q.bankrupt ? 0 : C.progress(S, q),
    active: act === q.id && S.phase !== 'over', out: q.bankrupt, badge: q.mode === 'fast' ? '★' : q.mode === 'mid' ? '◆' : '', cash: q.cash,
  })));
}
function cycleInfo() {
  const c = S.cycle, ph = C.phase(S), alive = S.players.filter(q => !q.bankrupt).length || 1;
  const exact = C.has(S.players[ME], 'trading');
  const left = exact ? Math.max(1, Math.ceil(c.left / alive)) : Math.max(1, c.est - Math.floor((S.tick - c.start) / alive));
  const next = D.CYCLE[(c.i + 1) % D.CYCLE.length];
  return { ph, left, next, exact };
}
function renderCycle() {
  const el = $('cyc'); if (!el) return;
  const ci = cycleInfo();
  el.className = 'cyc ph-' + ci.ph.id;
  el.textContent = `${ci.ph.n} · ${ci.exact ? '' : '~'}${ci.left} ход.`;
}
function renderNewsbar() {
  const n = S.news[S.news.length - 1];
  $('newsbar').innerHTML = n ? `<span class="nt ${n.rum ? 'rum' : 'off'}">${n.rum ? '🗣 СЛУХ' : '📰'}</span><span>${n.t}</span>`
    : '<span class="nt off">📰</span><span style="color:var(--hint)">Новостей пока нет. Следи за биржей</span>';
}
function setLast(h) { lastHTML = h || ''; const el = $('lastMsg'); if (el) el.innerHTML = lastHTML; }
function floatTxt(d) {
  const el = $('cashBox'), r = el.getBoundingClientRect(), a = $('app').getBoundingClientRect();
  const f = document.createElement('div'); f.className = 'float' + (d < 0 ? ' neg' : ''); f.textContent = (d > 0 ? '+' : '') + money(d);
  f.style.left = (r.left - a.left + r.width - 90) + 'px'; f.style.top = (r.top - a.top + 4) + 'px'; $('app').appendChild(f);
  setTimeout(() => f.remove(), 1100);
}
const riskTag = r => !r ? '' : (r >= 0.35 ? '<span class="risk hi">риск высокий</span>' : '<span class="risk md">риск средний</span>');
const qh = (text, title) => `<details class="qh"><summary>${title || 'Подробнее'}</summary><div>${text}</div></details>`;
const dieBox = v => `<div class="dice sk-${(S && S.players[ME].dice) || 'classic'}" style="justify-content:center;margin:6px 0">${KolesoTable.dieHTML(v)}</div>`;
const rowsHTML = r => `<div class="rows">${r.map(x => `<div class="ln"><span class="s">${x[0]}</span><span class="${x[2] || ''}">${x[1]}</span></div>`).join('')}</div>`;

/* ---------- отчёт ---------- */
function assetLine(a, man) {
  const me = S.players[ME], inc = C.assetIncome(S, me, a, man), managed = man.has(a.id);
  const pay = a.loan ? Math.round(a.loan * a.loanRate) : 0, net = inc - pay;
  const canSell = S.cur === ME && S.phase === 'roll' && !busy && me.mode !== 'fast';
  const sub = [(D.SECTORS[C.secOf(a)] || {}).n, managed ? 'управляющий −25%' : '', a.loan ? `банку −${money(pay)}` : ''].filter(Boolean).join(' · ');
  return `<div class="ln"><span class="s">${a.e} ${a.n}${riskTag(a.risk)}${net < 0 ? '<span class="lossTag">в минусе</span>' : ''}<br><small>${sub}</small></span>
    <span style="text-align:right"><span class="${net >= 0 ? 'g' : 'r'}">${net >= 0 ? '+' : ''}${money(net)}</span>
    ${canSell ? `<br><button class="sellmini" onclick="UI.A('sellBiz',{id:${a.id}})">продать ${money(C.salePrice(S, a))}</button>` : ''}</span></div>`;
}
let repayAmt = null;
function repayBox(me) {
  const max = Math.floor(Math.min(me.cash, C.loanTotal(me)));
  if (repayAmt == null || repayAmt > max) repayAmt = max;
  const opt = [[0.25, '25%'], [0.5, '50%'], [1, 'Всё']].map(([k, n]) => `<button class="${repayAmt === Math.floor(max * k) ? 'on' : ''}" onclick="UI.setRepay(${Math.floor(max * k)})">${n}</button>`).join('');
  return `<div class="repay"><div class="qty" style="margin:8px 0 6px">${opt}</div>
    <div style="display:flex;gap:8px"><input type="number" inputmode="numeric" min="1" max="${max}" value="${repayAmt}" onchange="UI.setRepay(Math.max(0,Math.min(${max},Math.floor(+this.value||0))))">
    <button class="b" style="padding:9px 14px;font-size:14px" onclick="UI.A('repay',{n:${repayAmt}})" ${repayAmt > 0 ? '' : 'disabled'}>Погасить</button></div></div>`;
}
const loanName = l => l.shady ? 'Коллекторы' : l.kind === 'cash' ? 'Потребкредит' : l.kind === 'edu' ? 'За учёбу' : l.kind === 'short' ? `Короткий (до хода ${l.due})` : 'Длинный · плавающая ставка';
function renderReport() {
  const me = S.players[ME];
  if (me.mode === 'fast') return renderFastReport(me);
  const midLine = me.mode === 'mid' ? `<div class="note">Бизнесы растут вместе с твоим потоком.</div>` : '';
  const pas = C.passive(S, me), ex = C.expenses(S, me), f = C.cashflow(S, me), fr = C.freedom(S, me);
  const inc = me.assets.filter(a => a.t !== 'stock'), st = me.assets.filter(a => a.t === 'stock');
  const ml = C.maxLoan(S, me);
  $('rep').innerHTML = `
  <div class="card"><h3>Денежный поток в месяц</h3>
    <div class="big-flow ${f >= 0 ? 'g' : 'r'}">${f >= 0 ? '+' : ''}${money(f)}</div>
    <div class="ln"><span class="s">${me.mode === 'mid' ? 'Путь к Большой игре' : 'Свобода'}</span><b class="y">${C.progress(S, me)}%</b></div>
    <div class="bar"><i style="width:${C.progress(S, me)}%"></i></div>${midLine}
  </div>
  ${workCard(me)}
  <div class="card"><h3>Доходы</h3>
    <div class="ln"><span>Зарплата</span><span>${me.free ? '<span class="s">без работы</span>' : money(me.salary)}</span></div>
    ${(() => { const man = C.managedIds(me); return inc.map(a => assetLine(a, man)).join(''); })()}
    ${inc.length ? `<div class="note">Бизнесов ${inc.filter(C.isBiz).length} из ${C.slots(me)} без управляющего · отраслей ${C.sectorsCount(me)}${C.sectorsCount(me) >= D.RULES.diversifySectors ? ' — риск ниже' : ''}</div>` : ''}
    ${st.filter(a => C.divOf(S, a)).map(a => `<div class="ln"><span class="s">${D.TICK[a.tk].e} Дивиденды ${a.tk} × ${a.shares}</span><span class="g">+${money(C.divOf(S, a))}</span></div>`).join('')}
    ${!pas ? '<div class="empty">Пассивного дохода пока нет</div>' : ''}
    <div class="ln tot"><span>Пассивный доход</span><span class="g">${money(pas)}</span></div>
  </div>
  <div class="card"><h3>Расходы</h3>
    ${me.exp.map(e => `<div class="ln"><span class="s">${e[0]}</span><span>${money(e[1])}</span></div>`).join('')}
    ${me.children ? `<div class="ln"><span class="s">Дети (${me.children})</span><span>${money(me.children * me.child)}</span></div>` : ''}
    ${me.loans.map(l => `<div class="ln"><span class="s">${loanName(l)} ${money(l.amt)} · ${pct(l.rate)}</span><span class="r">${money(l.amt * l.rate)}</span></div>`).join('')}
    <div class="ln tot"><span>Итого</span><span class="r">${money(ex)}</span></div>
    ${D.DIFF[S.diff].infl ? `<div class="note">Инфляция: +${D.DIFF[S.diff].infl * 100}% каждые ${D.RULES.inflEvery} ходов.</div>` : ''}
  </div>
  <div class="card"><h3>Активы</h3>
    ${inc.map(a => `<div class="ln"><span class="s">${a.e} ${a.n}</span><span>взнос ${money(a.down)}</span></div>`).join('')}
    ${st.map(a => `<div class="ln"><span class="s">${D.TICK[a.tk].e} ${a.tk} × ${a.shares}</span><span>${money(a.shares * S.prices[a.tk].p)}</span></div>`).join('')}
    ${!me.assets.length ? '<div class="empty">Пусто. Ищи сделки на 🏠 и 🏢 или зайди на биржу</div>' : ''}
    
  </div>
  <div class="card"><h3>Банк</h3>
    <div class="ln"><span class="s">Короткий · длинный</span><b class="y">${pct(C.rateFor(S, me, 'short'))} · ${pct(C.rateFor(S, me))}/мес</b></div>
    <div class="ln"><span class="s">Потребкредит</span><b class="r">${pct(C.rateFor(S, me, 'cash'))}/мес</b></div>
    <div class="ln"><span class="s">Долг · платёж</span><span>${money(C.loanTotal(me))} · ${money(C.loanPay(me))}/мес</span></div>
    <div class="loanbtns">
      <button class="sbtn" onclick="UI.A('loan',{n:1000})" ${C.canBorrow(S, me, 1000, 'cash') ? '' : 'disabled'}>Потребкредит $1 000</button>
    </div>
    ${C.loanTotal(me) ? repayBox(me) : ''}
    ${qh('Кредит под бизнес выдаётся при покупке сделки. Потребкредит — просто деньги на руки, он очень дорогой. Чем больше уже должен, тем выше ставка. Гасится сначала самый дорогой долг. На следующий круг можно перейти только без долгов.', 'Как работают кредиты')}
  </div>
  <button class="testlink" onclick="UI.restart(this)">↺ Бросить партию и начать заново</button>${dbgBox()}`;
}
function workCard(me) {
  if (me.mode === 'fast') return '';
  const myRoll = S.cur === ME && S.phase === 'roll' && !busy, cd = me.rehiredAt != null ? D.RULES.rehireCooldown - (me.turns - me.rehiredAt) : 0;
  if (me.free) return `<div class="card"><h3>Работа</h3>
    <div class="note" style="margin:0 0 8px">Ты свободен: зарплаты нет, банк даёт на ${Math.round(D.RULES.ltvFree * 100)}% меньше. Зато на сделках два варианта на выбор, +${D.RULES.freeSlots} бизнеса без управляющего, подработка ×${String(D.RULES.freeGig).replace('.', ',')}, сокращение не страшно.</div>
    <button class="sbtn" style="width:100%" onclick="UI.A('rehire')" ${myRoll ? '' : 'disabled'}>Вернуться на работу · ${money(Math.round(me.jobSalary * D.RULES.rehireK / 10) * 10)}/мес</button></div>`;
  return `<div class="card"><h3>Работа</h3>
    <div class="ln"><span class="s">${me.profName}</span><span>${money(me.salary)}/мес</span></div>
    <button class="sbtn" style="width:100%;margin-top:6px" onclick="UI.quitJob(this)" ${myRoll && cd <= 0 ? '' : 'disabled'}>${cd > 0 ? `Уволиться можно через ${cd} ход.` : 'Уволиться'}</button>
    ${qh(`Без зарплаты поток упадёт на ${money(me.salary)}, а банк даст на ${Math.round(D.RULES.ltvFree * 100)}% меньше. Взамен: на каждой сделке можно посмотреть второй вариант, +${D.RULES.freeSlots} бизнеса без управляющего, подработка в ${String(D.RULES.freeGig).replace('.', ',')} раза больше, сокращение не грозит. Вернуться можно с зарплатой −${Math.round((1 - D.RULES.rehireK) * 100)}%.`, 'Что даёт увольнение')}</div>`;
}
function dbgBox() {
  if (!D.RULES.debug) return '';
  return `<details class="dbg"><summary>ТЕСТ</summary><div class="dbgb">
    ${[10000, 1000, -1000, -10000].map(n => `<button onclick="UI.dbg('cash',${n})">${n > 0 ? '+' : '−'}${Math.abs(n) / 1000}к</button>`).join('')}
    <button onclick="UI.dbg('debt')">Списать долг</button></div></details>`;
}
function renderFastReport(me) {
  const dr = D.DREAMS[me.dream];
  $('rep').innerHTML = `
  <div class="card"><h3>Поток Большой игры</h3>
    <div class="big-flow y">+${money(me.fflow)}</div>
    <div class="ln"><span class="s">Стартовый поток</span><span>${money(me.fstart)}</span></div>
    <div class="ln"><span class="s">Цель по потоку</span><span>${money(C.fTarget(me))}</span></div>
    <div class="bar"><i style="width:${Math.max(0, Math.min(100, (me.fflow - me.fstart) / (C.fTarget(me) - me.fstart) * 100))}%"></i></div>
    
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
    <div class="note" style="margin:0">Без кредитов. Иск −50% наличных, налоговая −30%, развод −100%, санкции и обвал бьют по потоку и кэшу.</div>
  </div>
  <button class="testlink" onclick="UI.restart(this)">↺ Бросить партию и начать заново</button>`;
}

/* ---------- учёба ---------- */
function renderEdu() {
  const me = S.players[ME], myMove = !busy && S.cur === ME && S.phase === 'roll';
  const P = D.PROFS.find(x => x.id === me.prof);
  $('edu').innerHTML = `<div class="hint">${me.profName}: ${P ? P.bonus : ''}. Учёба стоит денег и занимает ход.</div>
  ${D.SKILLS.map(sk => {
    const got = C.has(me, sk.id), cost = C.skillCost(S, me, sk.id);
    return `<div class="skill ${got ? 'has' : ''}"><div class="se">${sk.e}</div><div style="flex:1"><div class="sn">${sk.n}</div><div class="sd">${sk.d}</div>
      ${got ? '<span class="badge-ok">✓ Изучено</span>' : `<button onclick="UI.A('study',{skill:'${sk.id}'})" ${myMove && me.cash >= cost ? '' : 'disabled'}>Учиться за ${money(cost)} · 1 ход</button>${me.cash < cost ? ` <span style="font-size:12px;color:var(--hint)">не хватает ${money(cost - me.cash)}</span>` : ''}`}</div></div>`;
  }).join('')}`;
}
const strength = m => { const a = Math.abs(m); return a < 0.15 ? 'слабо' : a < 0.35 ? 'заметно' : 'сильно'; };
function newsHint(n) {
  const me = S.players[ME];
  if (!C.has(me, 'trading') || !n.fx || !n.fx.length) return '';
  const all = n.fx.length >= 5;
  const moves = all ? `${n.fx[0].m > 0 ? '↗' : '↘'} весь рынок, ${strength(n.fx[0].m)}` : n.fx.map(f => `${f.m > 0 ? '↗' : '↘'} ${f.tk}: ${f.m > 0 ? 'рост' : 'падение'}, ${strength(f.m)}${f.div ? (f.div > 1 ? ', дивиденды ↑' : ', дивиденды ↓') : ''}`).join(' · ');
  const opin = n.rum && !n.status ? ` · аналитик: <b>${n.hint ? 'скорее правда' : 'скорее фейк'}</b>` : '';
  return `<div class="nhint">📈 ${moves}${opin}</div>`;
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
  const ci = cycleInfo(), ph = ci.ph;
  $('ex').innerHTML = `<div class="card"><div class="rate"><div><h3 style="margin:0">Экономика: ${ph.n}</h3>
    <div class="note" style="margin-top:3px">Дальше — ${ci.next.n.toLowerCase()} через ${ci.exact ? '' : '~'}${ci.left} ход.${ci.exact ? '' : ' (точно — с «Биржевой торговлей»)'}</div></div>
    <div class="cyc ph-${ph.id}" style="position:static">${ph.flowK >= 1 ? '+' : ''}${Math.round((ph.flowK - 1) * 100)}% поток</div></div>
    ${qh('Рост: поток выше. Пик: бизнес продаётся дороже всего, новые сделки дороже. Кризис: поток падает, сделки дешёвые, ставки выше, банк строже. Восстановление: сделки со скидкой. Отрасли реагируют по-разному: еда слабее, IT и производство сильнее.', 'Как работает цикл')}</div>
  <div class="card"><div class="rate"><div><h3 style="margin:0">Ставка по новым кредитам</h3>
    <div class="note" style="margin-top:3px">Под бизнес. Меняется решениями ЦБ.</div></div>
    <div class="bigr y">${pct(C.rateFor(S, me))}<div class="note" style="margin:0;text-align:right">в месяц</div></div></div></div>
  <div class="lbl">Новости</div>
  ${C.has(me, 'trading') ? '' : ''}
  ${S.news.slice(-6).reverse().map(n => `<div class="news"><span class="nt ${n.rum ? 'rum' : 'off'}">${n.rum ? '🗣 СЛУХ' : '📰 НОВОСТЬ'}</span> ${n.t}${n.status ? '' : newsHint(n)}<div class="meta">${n.status || '⏳ рынок ещё реагирует'}</div></div>`).join('') || '<div class="empty">Пока тихо</div>'}
  <div class="lbl">Котировки</div>
  ${Object.keys(D.TICK).map(tk => {
    const t = D.TICK[tk], q = S.prices[tk], ch = (q.p / q.prev - 1) * 100, own = me.assets.find(a => a.tk === tk);
    const pl = own ? (q.p - own.buy) * own.shares : 0;
    return `<div class="tick"><div class="tick-top"><div class="te">${t.e}</div><div><div class="tn">${tk}</div><div class="tsub">${t.full}</div></div>
      <div class="tp"><b>${fmtP(q.p)}</b><span class="${ch >= 0 ? 'g' : 'r'}">${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch).toFixed(1)}%</span></div></div>
      ${spark(q.hist)}
      <div class="hold"><span>${q.div ? `Дивиденд ${fmtP(q.div)} за 💼 · ${(q.div / q.p * 100).toFixed(1)}%` : 'Без дивидендов'}</span>
      <span>${own ? `У тебя ${own.shares.toLocaleString('ru-RU')} шт · <b class="${pl >= 0 ? 'g' : 'r'}">${pl >= 0 ? '+' : ''}${money(pl)}</b>` : ''}</span></div>
      <div class="tbtns"><button class="tb-buy" onclick="UI.trade('${tk}','buy')">Купить</button><button class="tb-sell" onclick="UI.trade('${tk}','sell')" ${own ? '' : 'disabled'}>Продать</button></div>${bigPanel(tk)}</div>`;
  }).join('')}
  ${me.mode === 'fast' ? qh(`В свой ход до броска: одна кампания (разгон или обвал на ${Math.round(D.RULES.pumpEffect * 100)}%, риск штрафа ФАС ${Math.round(D.RULES.pumpCatch * 100)}%) или выкуп контрольного пакета. Сначала обвал — потом выкуп.`, 'Влияние на рынок') : ''}
  ${qh('Комиссия 1%, у крипты 3%. Акции не падают ниже 40% справедливой цены и потом восстанавливаются. ХомякКоин без ограничений и в среднем дешевеет. Новость отыгрывается за 2 броска, слухи сбываются не всегда.', 'Как устроена биржа')}`;
}
function bigPanel(tk) {
  const me = S.players[ME], q = S.prices[tk];
  if (D.TICK[tk].crypto) return '';
  const ownerTxt = q.owner != null ? `<div class="hold" style="margin-top:6px"><span>🏢 Владелец: <b>${q.owner === ME ? 'ты' : S.players[q.owner].name}</b></span><span>капитализация ${money(C.cap(S, tk))}</span></div>`
    : `<div class="hold" style="margin-top:6px"><span>Капитализация ${money(C.cap(S, tk))}</span><span></span></div>`;
  if (me.mode !== 'fast') return q.owner != null ? ownerTxt : '';
  const myMove = !busy && S.cur === ME && S.phase === 'roll', used = me.infTick === S.tick;
  const ic = C.influenceCost(S, me, tk), tc = C.takeoverCost(S, tk), tf = C.takeoverFlow(S, tk);
  const dis = c => (!myMove || used || me.cash < c) ? 'disabled' : '';
  return ownerTxt + `<div class="tbtns">
    <button class="tb-buy" style="background:#3b2f6b;color:#cbb8ff" onclick="UI.A('pump',{tk:'${tk}'})" ${dis(ic)}>📣 Разогнать<br><small>${money(ic)}</small></button>
    <button class="tb-sell" style="background:#4d2a14;color:#ffc48a" onclick="UI.A('dump',{tk:'${tk}'})" ${dis(ic)}>📉 Обвалить<br><small>${money(ic)}</small></button></div>
    ${q.owner == null ? `<div class="tbtns"><button class="tb-buy" style="background:#5a4a12;color:#f5d04a" onclick="UI.A('takeover',{tk:'${tk}'})" ${(!myMove || me.cash < tc) ? 'disabled' : ''}>🏢 Выкупить 51% за ${money(tc)} · поток +${money(tf)}</button></div>` : ''}`;
}
function trade(tk, side) {
  if (busy || !S || S.phase === 'over') return toast('Подожди, сейчас ход другого игрока');
  const me = S.players[ME], own = me.assets.find(a => a.tk === tk), price = S.prices[tk].p;
  tradeUI = { tk, side, price, label: side === 'buy' ? '📈 Покупка на бирже' : '📉 Продажа на бирже' };
  qtyUI = null;
  render();
}
function maxBuy(price, cash, tk) { let n = Math.floor(cash / (price * 1.04)); while (n > 0 && n * price + C.feeFor(tk, n * price) > cash) n = Math.floor(n * 0.995) - 1; return Math.max(0, n); }
function stockSheet(tk, price, side, label, confirm) {
  const me = S.players[ME], t = D.TICK[tk], q = S.prices[tk], own = me.assets.find(a => a.tk === tk), buy = side === 'buy';
  const max = buy ? maxBuy(price, me.cash, tk) : (own ? own.shares : 0);
  // варианты количества: по сумме в долларах для покупки, по доле — для продажи
  const opts = (buy ? [500, 2000, 10000, 50000, 250000, 1000000].map(a => [Math.floor(a / price), money(a)]) : [[Math.floor(max / 4), '25%'], [Math.floor(max / 2), '50%']])
    .filter(o => o[0] > 0 && o[0] < max).slice(-4).concat(max > 0 ? [[max, buy ? 'Макс' : 'Все']] : []);
  if (qtyUI == null || qtyUI > max) qtyUI = buy ? (opts.length > 1 ? opts[Math.min(1, opts.length - 1)][0] : max) : max;
  const val = qtyUI * price, f = qtyUI ? C.feeFor(tk, val) : 0, cr = D.TICK[tk].crypto;
  return `<div class="kind" style="color:${buy ? '#4fd17b' : '#ff7a80'}">${label}</div>
  <div class="sh-e">${t.e}</div><div class="sh-t">${tk} по ${fmtP(price)}</div><div class="sh-d">${t.full}${price < q.p ? ` · на бирже ${fmtP(q.p)}` : ''}</div>
  ${rowsHTML([...(cr ? [] : [['Дивиденд на акцию', q.div ? fmtP(q.div) + ' за 💼' : 'нет'], ['Дивидендная доходность', q.div ? (q.div / price * 100).toFixed(1) + '% в мес' : '—', 'y'], ['Ставка банка', pct(C.rateFor(S, me)) + ' в мес']]), ...(own ? [['У тебя', own.shares.toLocaleString('ru-RU') + ' шт по ' + fmtP(own.buy)]] : [])])}
  ${cr ? '<div class="hint">Крипта без дна и потолка и в среднем дешевеет. Держать долго невыгодно.</div>' : ''}
  <div class="qty">${opts.map(o => `<button class="${o[0] === qtyUI ? 'on' : ''}" onclick="UI.setQty(${o[0]})">${o[1]}</button>`).join('') || `<div class="sh-d" style="margin:0;width:100%">${buy ? 'Не хватает денег' : 'Нечего продавать'}</div>`}</div>
  ${rowsHTML([['Количество', qtyUI.toLocaleString('ru-RU') + ' шт'], ['Сумма', money(val)], [`Комиссия ${Math.round((D.TICK[tk].fee || D.RULES.fee) * 100)}%`, money(f)], [buy ? 'Спишется' : 'Получишь', money(buy ? val + f : val - f), 'y'], ['Наличные', money(me.cash)]])}
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
        const sameMode = (o.mode || 'rat') === me.mode, can = S.cur === ME && S.phase === 'roll' && sameMode && !busy;
        btn = `<button class="act" ${can ? '' : 'disabled'} onclick="UI.A('takeOffer',{id:${o.id}})">${can ? 'Забрать сделку' : !sameMode ? (o.mode === 'mid' ? 'Сделка среднего круга' : 'Сделка малого круга') : 'Забрать можно в свой ход до броска'}</button>`;
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

// оценка сделки для новичка: звёзды, окупаемость и вклад в цель круга
function dealGrade(me, d, fl, rate, ana) {
  const ratio = fl / Math.max(1, d.down) / rate;
  let n = ratio >= 2.2 ? 3 : ratio >= 1.3 ? 2 : 1;
  if ((d.risk || 0) >= 0.3 && n > 1) n--;
  const pb = Math.ceil(d.down / Math.max(1, fl));
  const goal = me.mode === 'mid' ? D.RULES.fastFlow : C.expenses(S, me);
  const share = Math.max(1, Math.round(fl / Math.max(1, goal) * 100));
  const lbl = ['', 'Слабая', 'Нормальная', 'Отличная'][n];
  return `<div class="grade g${n}"><span class="stars">${'★'.repeat(n)}${'☆'.repeat(3 - n)}</span> ${lbl}${ana || d.est == null ? '' : ' (по словам продавца)'} · окупится за ${pb} мес · <b>+${share}%</b> ${me.mode === 'mid' ? 'к Большой игре' : 'к свободе'}</div>`;
}
// что сейчас важно: одна строка в шапке
function advice(me) {
  if (me.mode === 'fast' || me.bankrupt) return '';
  const f = C.cashflow(S, me), pas = C.passive(S, me), ex = C.expenses(S, me), debt = C.loanTotal(me);
  const due = me.loans.filter(l => l.kind === 'short' && l.due - me.turns <= 2).sort((a, b) => a.due - b.due)[0];
  const shady = me.loans.find(l => l.shady), cash = me.loans.filter(l => l.kind === 'cash').reduce((t, l) => t + l.amt * l.rate, 0);
  if (f < 0) return `Поток в минусе: −${money(-f)} каждый месяц. Погаси дорогой кредит или продай убыточный бизнес.`;
  if (due) { const n = Math.max(0, due.due - me.turns); return `Через ${n} ${n === 1 ? 'ход' : 'хода'} вернуть короткий кредит ${money(due.amt)}. Держи деньги, иначе перекредитуют дороже.`; }
  if (shady) return `Долг коллекторам под ${pct(shady.rate)} в месяц. Гаси его первым (Отчёт → Банк).`;
  if (cash > 0 && me.cash > 2000) return `Потребкредит съедает ${money(cash)}/мес. Погаси его, деньги есть.`;
  if (me.mode === 'rat') {
    if (pas >= ex && debt) return `Расходы покрыты! Закрой долги ${money(debt)}, и ты на среднем круге.`;
    const need = ex - pas;
    if (me.cash < 1500) return `Не хватает ${money(need)} пассивного дохода. Денег мало: копи до зарплаты, на сделку нужна своя доля 30%.`;
    return `Не хватает ${money(need)} пассивного дохода в месяц. Покупай бизнесы на клетках сделок, смотри на звёзды в карточке.`;
  }
  if (f >= D.RULES.fastFlow && debt) return `Поток набран! Закрой долги ${money(debt)}, и ты в Большой игре.`;
  return `До Большой игры не хватает ${money(D.RULES.fastFlow - f)} потока в месяц.`;
}
// разбор после партии: лучшие и худшие решения, упущенные сделки, темки и кредиты
function showReview() {
  const me = S.players[ME], h = me.hist || [], w = $('win');
  const buys = h.filter(x => x.k === 'buy'), pass = h.filter(x => x.k === 'pass'), gam = h.filter(x => x.k === 'gamble'), cash = h.filter(x => x.k === 'cash');
  const yld = x => x.flow / Math.max(1, x.down);
  const line = (x, v, cls, sub) => `<div class="rv"><span>${x.e || '•'}</span><div class="rt">${x.n}<div class="rs">ход ${x.t}${sub ? ' · ' + sub : ''}</div></div><span class="rv-v ${cls}">${v}</span></div>`;
  const best = buys.slice().sort((a, b) => yld(b) - yld(a)).slice(0, 3);
  const worst = buys.filter(x => !best.includes(x)).sort((a, b) => (a.flow - a.pay) - (b.flow - b.pay)).slice(0, 3);
  const lied = buys.filter(x => x.est && x.flow < x.est * 0.8);
  const goodPass = buys.length ? Math.max(...buys.map(yld)) * 0.9 : 0.06;
  const missed = pass.filter(x => yld(x) >= Math.max(0.06, goodPass)).sort((a, b) => yld(b) - yld(a)).slice(0, 3);
  const gNet = gam.reduce((t, x) => t + x.net, 0), cSum = cash.reduce((t, x) => t + x.amt, 0);
  const tips = [];
  if (buys.some(x => x.flow - x.pay < 0)) tips.push('Часть бизнесов в кредит приносила меньше, чем платёж банку. Смотри на звёзды и строку «В кредит» в карточке.');
  if (lied.length) tips.push(`${lied.length} ${lied.length === 1 ? 'сделка оказалась' : 'сделки оказались'} хуже обещанного. «Бизнес-аналитика» показывает реальный доход заранее.`);
  if (missed.length) tips.push('Ты пропустил(а) выгодные сделки. Если денег не хватало, держи запас наличных под свою долю 30%.');
  if (gam.length >= 3 && gNet < 0) tips.push(`Темки в сумме: ${money(gNet)}. Они редко окупаются.`);
  if (cash.length) tips.push(`Потребкредитов взято на ${money(cSum)}. Это самый дорогой кредит.`);
  if (!tips.length) tips.push(buys.length ? 'Чистая партия: без грубых ошибок.' : 'Ты почти ничего не покупал(а). Пассивный доход растёт только от активов.');
  w.innerHTML = `<h2 style="margin-top:4px">Разбор партии</h2><div class="review">
    <div class="note">Покупок ${buys.length} · пропущено сделок ${pass.length} · темок ${gam.length}${gam.length ? ` (${gNet >= 0 ? '+' : '−'}${money(Math.abs(gNet))})` : ''}</div>
    ${best.length ? `<h3>Лучшие покупки</h3>${best.map(x => line(x, `+${money(x.flow)}/мес`, 'g', `взнос ${money(x.down)} · окупается за ${Math.ceil(x.down / Math.max(1, x.flow))} мес`)).join('')}` : ''}
    ${worst.length ? `<h3>Слабые покупки</h3>${worst.map(x => line(x, `${x.flow - x.pay >= 0 ? '+' : '−'}${money(Math.abs(x.flow - x.pay))}/мес`, x.flow - x.pay >= 0 ? 'y' : 'r', x.L ? `доход ${money(x.flow)} − платёж ${money(x.pay)}` : `доход ${money(x.flow)}${x.est && x.flow < x.est * 0.8 ? `, обещали ${money(x.est)}` : ''}`)).join('')}` : ''}
    ${missed.length ? `<h3>Упущено</h3>${missed.map(x => line(x, `+${money(x.flow)}/мес`, 'y', `взнос ${money(x.down)}`)).join('')}` : ''}
    <h3>Что улучшить</h3>${tips.map(t => `<div class="rv"><div class="rt">${t}</div></div>`).join('')}
  </div><button class="b sec" style="width:100%;margin-top:10px" onclick="UI.reviewBack()">Назад</button>`;
  w.scrollTop = 0;
}
function cardHTML(c) {
  const me = S.players[ME];
  const btn = (txt, act, cls, dis) => `<button class="b ${cls || ''}" onclick="${act}" ${dis ? 'disabled' : ''}>${txt}</button>`;
  switch (c.kind) {
    case 'deal': {
      const d = c.deal, au = c.auction, cp = C.cashPrice(d), can = me.cash >= cp, ana = C.has(me, 'analytics');
      const maxL = C.maxDealLoan(S, me, d), need = Math.max(100, Math.ceil((d.down - me.cash) / 100) * 100);
      // кредит: если своих хватает — предлагаем максимум банка (сохранить наличные), иначе — сколько не хватает
      const L = Math.min(maxL, can ? maxL : need), own = d.down - L, ownOk = me.cash >= own && L > 0;
      const rate = C.rateFor(S, me), rateS = C.rateFor(S, me, 'short');
      const okL = ownOk && C.canBorrow(S, me, L), okS = ownOk && C.canBorrow(S, me, L, 'short');
      const fl = C.seen(me, d), ltv = Math.round(C.ltvOf(S, me) * 100);
      const nBiz = me.assets.filter(C.isBiz).length, isB = d.cat !== 'flat' && d.cat !== 'house';
      const head = `<div class="kind" style="color:${c.tier === 'mid' ? '#5fe0c4' : c.tier === 'sbiz' ? '#5fc8e0' : c.big ? '#a58cff' : '#6ab3f3'}">${c.tier === 'mid' ? 'Средний бизнес' : c.tier === 'sbiz' ? 'Малый бизнес' : c.big ? 'Крупная сделка' : 'Малая сделка'}${c.fromOffer ? ' · из чата' : ''}</div>
      <div class="sh-e">${d.e}</div><div class="sh-t">${d.n}</div><div class="sh-d">${d.d}</div>${dealGrade(me, d, fl, rate, ana)}`;
      const rows = rowsHTML([['Взнос', money(d.down) + (au && au.done && au.price > (au.log[0] || [0, 0])[1] ? ' (торги)' : '')],
        ana || d.est == null ? ['Поток', '+' + money(d.flow) + '/мес', 'g'] : ['Поток (обещают)', `≈ +${money(d.est)}/мес`, 'g'],
        ['Отрасль', (D.SECTORS[C.secOf(d)] || {}).n || '—'],
        ...(d.risk ? [['Риск прогореть', d.risk >= 0.35 ? 'высокий' : 'средний', d.risk >= 0.35 ? 'r' : 'y']] : []),
        ...(isB && nBiz >= C.slots(me) ? [['Управляющий', '−25% потока', 'r']] : []),
        ...(d.nego ? [['Переговоры', `взнос −${Math.round((1 - D.RULES.negoDiscount) * 100)}%`, 'g']] : []),
        ['На руках', money(me.cash)],
        ...(L > 0 ? [['В кредит', `банк ${money(L)} + свои ${money(own)}`, ownOk ? '' : 'r']] : [])]);
      if (au && !au.done) {
        const leader = au.leader == null ? null : au.leader === ME ? 'ты' : S.players[au.leader].name;
        const next = au.leader == null ? au.price : Math.round(au.price * (1 + D.RULES.auctionStep) / 100) * 100;
        const rivals = au.bids.map(b => S.players[b.pid].name).join(' и ');
        return head + rows + `<div class="verdict"><div class="vt y">Торги</div>${rivals} тоже хотят эту сделку.<br>
          Ставка: <b>${money(au.price)}</b>${leader ? ` · лидер: <b>${leader}</b>` : ''}</div>
          <div class="btns">${btn(au.leader == null ? `Беру за ${money(next)}` : `Ставлю ${money(next)}`, "UI.A('bid')", 'warn')}${btn('Пас', "UI.A('pass')", 'sec')}</div>
          ${qh('Шаг торгов +10% к взносу. Выиграешь — заплатишь свою ставку как взнос. Спасуешь — сделку заберёт соперник.', 'Как идут торги')}`;
      }
      const fog = !ana && d.est != null ? `<div class="hint">Реальный доход может быть от ${money(Math.round(d.est * D.RULES.fog[0] / 10) * 10)} до ${money(Math.round(d.est * D.RULES.fog[1] / 10) * 10)}. Точно покажет «Бизнес-аналитика».</div>` : '';
      const hint = ana ? analyticsBlock(d, L, rate, can)
        : (D.DIFF[S.diff].hints && L ? `<div class="hint">В кредит: банку ${money(L * rate)}/мес → при обещанном доходе итог <b class="${fl - L * rate >= 0 ? 'g' : 'r'}">${fl - L * rate >= 0 ? '+' : ''}${money(fl - L * rate)}/мес</b></div>` : '') + fog;
      return head + rows + (au && au.done ? `<div class="hint g">Торги выиграны за ${money(d.down)}</div>` : '') + hint + `
      <div class="btns">
        ${can ? btn(`Купить за свои ${money(cp)} · скидка ${Math.round((1 - D.RULES.cashDisc) * 100)}%`, "UI.A('buy',{loan:0})") : ''}
        ${okS ? btn(`Короткий ${money(L)} · ${pct(rateS)} · ${D.RULES.shortTerm} ходов`, `UI.A('buy',{loan:${L},lkind:'short'})`, can ? 'sec' : 'warn') : ''}
        ${okL ? btn(`Длинный ${money(L)} · от ${pct(rate)}`, `UI.A('buy',{loan:${L},lkind:'deal'})`, 'sec') : ''}
        ${!can && !okL && !okS ? btn(L > 0 && me.cash < own ? `Банк даёт ${money(L)} (${ltv}%) · своих нужно ${money(own)}` : `Не хватает ${money(cp - me.cash)}`, '', '', true) : ''}
        ${c.alt && (!au || !au.log.length) ? btn(`Другой вариант: ${c.alt.e || ''} ${c.alt.n}`, "UI.A('swap')", 'sec') : ''}
        ${btn('Отказаться', "UI.A('pass')", 'sec')}
      </div>
      ${qh(`Банк даёт не больше ${ltv}% взноса${S.cycle && D.CYCLE[S.cycle.i].tight ? ' (кризис)' : ''}, остальное — свои деньги. За свои целиком — скидка ${Math.round((1 - D.RULES.cashDisc) * 100)}%. Короткий кредит с фиксированной ставкой, его надо вернуть через ${D.RULES.shortTerm} ходов. Длинный без срока, но ставка плавающая: в кризис платёж вырастет.`, 'Как купить')}`;
    }
    case 'dilemma': {
      const dl = D.DILEMMAS[c.di], as = me.assets.find(x => x.id === c.aid);
      return `<div class="kind" style="color:#f5a623">Решение по бизнесу</div>
      <div class="sh-e">${as ? as.e : ''}</div><div class="sh-t">${dl.t}</div><div class="sh-d">${as ? as.n + ' · поток ' + money(as.flow) : ''}</div>
      <div class="btns">${btn(`${dl.a[0]}<br><small style="opacity:.8;font-weight:500">${dl.a[2]}</small>`, "UI.A('choose',{opt:'a'})")}${btn(`${dl.b[0]}<br><small style="opacity:.8;font-weight:500">${dl.b[2]}</small>`, "UI.A('choose',{opt:'b'})", 'sec')}</div>`;
    }
    case 'stock':
      return stockSheet(c.tk, c.price, 'buy', '💼 Брокер: пакет со скидкой 20%', 'UI.A(\'buyStock\',{qty:UI.qty()})') + btn('Отказаться', "UI.A('pass')", 'sec') + '</div>';
    case 'market': {
      const e = c.ev;
      let body = '';
      if (e.k === 'sell') {
        body = sellList(c, me);
      } else body = `<div class="sh-d ${c.cls}">${c.note}</div>`;
      return `<div class="kind" style="color:#f5a623">📈 Событие рынка · для всех</div>
      <div class="sh-e">${e.e}</div><div class="sh-t">${e.n}</div><div class="sh-d">${e.d}</div>${body}
      <div class="btns">${btn('Готово', "UI.A('ok')")}</div>`;
    }
    case 'mevent': {
      const e = c.ev;
      const body = c.sellable ? sellList(c, me) : `<div class="sh-d ${c.cls}">${c.note}</div>`;
      return `<div class="kind" style="color:#f5a623">⚡ Бизнес-событие</div>
      <div class="sh-e">${e.e}</div><div class="sh-t">${e.n}</div><div class="sh-d">${e.d}</div>${body}
      <div class="btns">${btn('Готово', "UI.A('ok')")}</div>`;
    }
    case 'gamble': {
      const g = c.g, rs = c.result;
      const unit = c.tier === 'mid' ? (x => money(Math.round(x * c.scale / 500) * 500)) : (x => money(Math.round(x * 1000 * c.scale / 500) * 500));
      const head = `<div class="kind" style="color:#ff5fb0">🎲 ${c.tier === 'mid' ? 'Крупная темка' : 'Темка'}</div><div class="sh-e">${g.e}</div><div class="sh-t">${g.n}</div>`;
      if (rs) {
        const txt = { win: ['g', `Темка зашла! +${money(rs.prize)}`], even: ['', 'Вышел в ноль, ставку вернули'], lose: ['r', `Не зашло: −${money(c.stake)}`],
          zero: ['r', `Сгорели все наличные: −${money(rs.lost)}`], debt: ['r', `Всё сгорело + долг ${money(rs.debt)}`] }[rs.o];
        return head + `<div class="bubdie">${dieBox(rs.raw || rs.die)}</div>${rs.raw && rs.raw !== rs.die ? `<div class="sh-d" style="margin:-4px 0 4px">мышление: 1 → ${rs.die}</div>` : ''}<div class="sh-t ${txt[0]}" style="margin-bottom:10px;font-size:17px">${txt[1]}</div>
        ${rs.o === 'debt' ? `<div class="hint">Платёж коллекторам −${money(rs.debt * D.RULES.shadyRate)}/мес. Гаси в «Отчёте».</div>` : ''}
        <div class="btns">${btn('Дальше', "UI.A('ok')", 'sec')}</div>`;
      }
      const names = { win: 'куш', even: 'ноль', lose: '−вход', zero: 'всё', debt: 'долг' };
      const crit = C.has(me, 'critical');
      return head + `<div class="sh-d">${g.d}</div>
      ${rowsHTML([['Вход', money(c.stake)], ['Куш', `${unit(g.win[0])}–${unit(g.win[1])}`, 'g'], ['Долг', `${unit(g.debt[0])}–${unit(g.debt[1])}`, 'r'], ['На руках', money(me.cash)]])}
      <div class="ostrip">${g.out.map((o, i) => { const oo = g.out[crit && i === 0 ? 1 : i]; return `<span class="o-${oo}">${i + 1}<small>${names[oo]}</small></span>`; }).join('')}</div>
      ${qh(`Исход зависит от броска. «Всё» — сгорают все наличные. «Долг» — ещё и долг коллекторам под ${pct(D.RULES.shadyRate)} в месяц.${crit ? ' Мышление превращает единицу в двойку: худший исход не выпадет.' : ''}`, 'Как это работает')}
      <div class="btns">${me.cash >= c.stake ? btn(`Зайти за ${money(c.stake)}`, "UI.A('gamble')", 'warn') : btn(`Не хватает ${money(c.stake - me.cash)}`, '', '', true)}${btn('Пас', "UI.A('pass')", 'sec')}</div>`;
    }
    case 'gig':
      return `<div class="kind" style="color:#7fd16a">🛠 Подработка</div><div class="sh-e">🛠</div><div class="sh-t">Подвернулась подработка</div>
      <div class="sh-d">Деньги сразу на руки.</div>
      ${rowsHTML([['Заработано', '+' + money(c.amt), 'g'], ['На руках', money(me.cash)]])}<div class="btns">${btn('Отлично 💪', "UI.A('ok')")}</div>`;
    case 'course':
      return `<div class="kind" style="color:#6ab3f3">🎓 Курсы</div><div class="sh-e">🎓</div><div class="sh-t">Повышение квалификации</div>
      <div class="sh-d">Зарплата вырастет навсегда. Окупится за ${Math.ceil(c.cost / c.raise)} зарплат.</div>
      ${rowsHTML([['Стоимость', money(c.cost)], ['Прибавка к зарплате', '+' + money(c.raise) + '/мес', 'g'], ['На руках', money(me.cash)]])}
      <div class="btns">${btn(`Учиться за ${money(c.cost)}`, "UI.A('buy')", '', me.cash < c.cost)}${btn('Некогда', "UI.A('pass')", 'sec')}</div>`;
    case 'expand': {
      const list = c.opts.map(o => { const a = me.assets.find(x => x.id === o.id); if (!a) return '';
        const done = c.done.includes(o.id);
        return `<div class="asset-sell"><span>${a.e} ${a.n}<br><small style="color:var(--hint)">поток ${money(a.flow)} → ${money(a.flow + (done ? 0 : o.add))}</small></span><button ${done || me.cash < o.cost ? 'disabled' : ''} onclick="UI.A('expand',{id:${o.id}})">${done ? 'Готово' : 'Вложить ' + money(o.cost)}</button></div>`; }).join('');
      return `<div class="kind" style="color:#5fc8e0">📐 Расширение</div><div class="sh-e">📐</div><div class="sh-t">Можно расшириться</div>
      <div class="sh-d">Новые точки, второй цех, больше машин. Вложись в любой свой бизнес, и его поток вырастет на ${Math.round(D.RULES.expandFlow * 100)}%.</div>
      ${list ? `<div class="rows">${list}</div>` : '<div class="sh-d">У тебя пока нет бизнесов среднего круга.</div>'}
      <div class="btns">${btn('Готово', "UI.A('ok')")}</div>`;
    }
    case 'ipo':
      return `<div class="kind" style="color:#7fd16a">🔔 IPO</div><div class="sh-e">🔔</div>
      ${c.inv ? `<div class="sh-t">${c.inv.e} ${c.inv.n} выходит на биржу</div><div class="sh-d">Продаёшь часть акций инвесторам, а поток остаётся твоим.</div>${rowsHTML([['Выплата', '+' + money(c.amt), 'g'], ['Наличные', money(me.cash)]])}`
        : '<div class="sh-t">IPO не случилось</div><div class="sh-d">Нужна хотя бы одна инвестиция (🏭), чтобы вывести её на биржу.</div>'}
      <div class="btns">${btn('Дальше', "UI.A('ok')")}</div>`;
    case 'media':
      return `<div class="kind" style="color:#a58cff">📺 Медиа</div><div class="sh-e">📺</div><div class="sh-t">Свой сюжет в прайм-тайм</div>
      <div class="sh-d">Бесплатно и без риска ФАС: выбери компанию и сдвинь её цену на ${Math.round(D.RULES.pumpEffect * 100)}% за два броска.</div>
      <div class="rows">${Object.keys(D.TICK).map(tk => `<div class="asset-sell"><span>${D.TICK[tk].e} ${tk} · ${fmtP(S.prices[tk].p)}</span><span style="display:flex;gap:6px"><button onclick="UI.A('media',{tk:'${tk}',up:true})">📣 Вверх</button><button style="background:#c0434a;color:#fff" onclick="UI.A('media',{tk:'${tk}',up:false})">📉 Вниз</button></span></div>`).join('')}</div>
      <div class="btns">${btn('Не нужно', "UI.A('ok')", 'sec')}</div>`;
    case 'raid':
      return `<div class="kind" style="color:var(--red)">🥷 Рейдеры</div><div class="sh-e">🥷</div>
      ${c.inv ? `<div class="sh-t">Рейдеры нацелились на ${c.inv.tk}</div><div class="sh-d">Заплати юристам за защиту, иначе потеряешь контроль над компанией и её поток.</div>
        ${rowsHTML([['Защита', money(c.cost), 'y'], ['Под угрозой поток', money(c.inv.flow), 'r'], ['Наличные', money(me.cash)]])}
        <div class="btns">${btn(`Защититься за ${money(c.cost)}`, "UI.A('buy')", 'gold', me.cash < c.cost)}${btn('Отдать компанию', "UI.A('pass')", 'sec')}</div>`
        : `<div class="sh-t">Рейдерам нечего забирать</div><div class="sh-d">У тебя нет контрольных пакетов. Пока.</div><div class="btns">${btn('Дальше', "UI.A('ok')")}</div>`}`;
    case 'acq': {
      const t = D.TICK[c.tk], ok = me.cash >= c.cost;
      return `<div class="kind" style="color:#5fe0c4">🏢 Поглощение</div><div class="sh-e">${t.e}</div><div class="sh-t">Контрольный пакет ${c.tk}</div>
      <div class="sh-d">${t.full}. Акционеры готовы продать 51% со скидкой 15% к рынку. Компания станет твоей и будет давать поток.</div>
      ${rowsHTML([['Капитализация', money(C.cap(S, c.tk))], ['Цена пакета', money(c.cost), 'y'], ['Поток', `+${money(c.flow)} за 💰`, 'g'], ['Окупится за', Math.ceil(c.cost / c.flow) + ' дивидендов'], ['Наличные', money(me.cash)]])}
      <div class="btns">${ok ? btn(`Выкупить за ${money(c.cost)}`, "UI.A('buy')", 'gold') : btn(`Не хватает ${money(c.cost - me.cash)}`, '', '', true)}${btn('Пропустить', "UI.A('pass')", 'sec')}</div>`;
    }
    case 'tempt':
      if (c.lux) return `<div class="kind" style="color:#ff6b81">💎 Роскошь</div><div class="sh-e">${c.t.e}</div><div class="sh-t">${c.t.n}</div><div class="sh-d">${c.t.d}</div>
      ${rowsHTML([['Оплачено', money(c.cost), 'r'], ['Осталось на руках', money(me.cash)]])}<div class="btns">${btn('Положение обязывает 😎', "UI.A('ok')", 'warn')}</div>`;
      return `<div class="kind" style="color:#ff6b81">🛍 Соблазн</div><div class="sh-e">${c.t.e}</div><div class="sh-t">${c.t.n}</div><div class="sh-d">${c.t.d}</div>
      ${rowsHTML([['Оплачено', money(c.cost), 'r'], ['Осталось на руках', money(me.cash)]])}
      <div class="btns">${btn('Эх 😩', "UI.A('ok')", 'warn')}</div>`;
    case 'child':
      return c.added ? `<div class="kind" style="color:#d68cff">👶 Пополнение</div><div class="sh-e">👶</div><div class="sh-t">У тебя родился ребёнок!</div>
      <div class="sh-d">Поздравляем! Расходы выросли на ${money(me.child)}/мес навсегда.</div><div class="btns">${btn('Ура! 🍼', "UI.A('ok')")}</div>`
        : `<div class="kind" style="color:#d68cff">👶 Пополнение</div><div class="sh-e">👨‍👩‍👧‍👦</div><div class="sh-t">У тебя уже трое детей</div><div class="sh-d">Больше не надо, спасибо.</div><div class="btns">${btn('Дальше', "UI.A('ok')")}</div>`;
    case 'down':
      if (c.nofire) return `<div class="kind" style="color:#aab">🚫 Увольнение</div><div class="sh-e">🚕</div><div class="sh-t">Заказов почти нет</div>
      <div class="sh-d">Тебя не уволить. Половина расходов из кармана, ходы не пропускаешь.</div>
      ${rowsHTML([['Оплачено', money(c.paid), 'r']])}<div class="btns">${btn('Прорвёмся', "UI.A('ok')", 'sec')}</div>`;
      return `<div class="kind" style="color:#aab">🚫 Увольнение</div><div class="sh-e">📦</div><div class="sh-t">Тебя сократили</div>
      <div class="sh-d">Месяц расходов без зарплаты и 2 хода пропуска.</div>
      ${rowsHTML([['Оплачено', money(c.paid), 'r']])}<div class="btns">${btn('Эх…', "UI.A('ok')", 'sec')}</div>`;
    case 'charity':
      return `<div class="kind" style="color:#ff7ab6">❤️ Помощь</div><div class="sh-e">🤲</div><div class="sh-t">Поддержать фонд?</div>
      <div class="sh-d">10% зарплаты — и 3 хода бросаешь два кубика.</div>
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
        <div class="bubdie">${dieBox(c.result.die)}</div>
        <div class="sh-t ${w ? 'g' : 'r'}" style="margin-bottom:10px">${w ? 'Выиграл ' + money(w) + '!' : 'Стартап закрылся 💀'}</div>
        <div class="btns">${btn('Дальше', "UI.A('ok')", 'sec')}</div>`;
      }
      return `<div class="kind" style="color:#a58cff">🎰 Венчур</div><div class="sh-e">${c.v.e}</div><div class="sh-t">${c.v.n}</div>
      <div class="sh-d">Брось кубик: 6 — ×8, 5 — ×4, иначе всё сгорит.</div>
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
    case 'hit': {
      const t = D.FT[c.key];
      return `<div class="kind" style="color:var(--red)">Удар по бизнесу</div><div class="sh-e">${KolesoTable.svgIcon(KolesoTable.CELL_ICON[c.key], 'bigic')}</div><div class="sh-t">${t.n}</div><div class="sh-d">${t.h.split(': ')[1] || ''}</div>
      <div class="sh-d r">${c.note}</div><div class="btns">${btn('Дальше', "UI.A('ok')", 'sec')}</div>`;
    }
    case 'crisis':
      return `<div class="kind" style="color:#aab">🌪 Кризис</div><div class="sh-e">🌪</div><div class="sh-t">Экономический кризис</div>
      ${c.lost ? `<div class="sh-d r">${c.lost.e} ${c.lost.n} разорился. Поток −${money(c.lost.flow)}</div>` : '<div class="sh-d g">У тебя нет инвестиций, кризис прошёл мимо.</div>'}
      <div class="btns">${btn('Дальше', "UI.A('ok')", 'sec')}</div>`;
  }
  return `<div class="btns">${btn('Дальше', "UI.A('ok')")}</div>`;
}

function analyticsBlock(d, L, rate, can) {
  const r = d.risk || 0, eff = Math.round(d.flow * (1 - r * 0.5) / 10) * 10, pay = Math.round(L * rate), net = d.flow - pay, netEff = eff - pay;
  const lie = d.est != null && Math.abs(d.flow - d.est) >= d.est * 0.1 ? `<br>Продавец обещает ${money(d.est)}/мес — ${d.flow < d.est ? '<b class="r">завышает</b>' : '<b class="g">занижает</b>'}` : '';
  const payback = Math.ceil(d.down / Math.max(1, d.flow));
  let vt, cls;
  if (netEff > 0) { vt = can ? '✅ Выгодно и за свои, и в кредит' : '✅ Выгодно даже в кредит'; cls = 'g'; }
  else if (net > 0) { vt = can ? '⚠️ За свои выгодно, в кредит — на грани' : '⚠️ В кредит на грани: риск съест доход'; cls = 'y'; }
  else { vt = can ? '✅ За свои выгодно · ❌ в кредит убыточно' : '❌ В кредит убыточно: платёж больше дохода'; cls = can ? 'y' : 'r'; }
  return `<div class="verdict"><div class="vt ${cls}">📊 ${vt}</div>
    Реальный доход: <b>${money(d.flow)}</b>/мес${lie}<br>
    Окупаемость взноса: <b>${payback} мес</b>${r ? ` · с учётом риска ≈ <b>${money(eff)}</b>/мес` : ''}<br>
    В кредит ${money(L)} под ${pct(rate)}: банку ${money(pay)}/мес → итог <b class="${net >= 0 ? 'g' : 'r'}">${net >= 0 ? '+' : ''}${money(net)}/мес</b></div>`;
}
function sellList(c, me) {
  const list = me.assets.filter(a => (c.sellable || []).includes(a.id));
  return (list.length ? `<div class="rows">${list.map(a => `<div class="asset-sell"><span>${a.e} ${a.n}<br><small style="color:var(--hint)">−${money(a.flow)}/мес</small></span><button onclick="UI.A('sell',{id:${a.id}})">Продать ${money(a.down * c.mult)}</button></div>`).join('')}</div>` : '')
    + (c.sold.length ? `<div class="sh-d g" style="margin-top:0">Продано: ${c.sold.length}</div>` : '')
    + `<div class="sh-d" style="margin-top:0">${c.note}</div>`;
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
  else if (!busy && stageUI && S.phase !== 'over') key = 'stage';
  else if (!busy && S.phase === 'over') key = 'over';
  else if (!busy && me.bankrupt && !NET.watch) key = 'out';
  if (key === overlayKey) return;
  overlayKey = key;
  if (!key) { w.classList.add('hidden'); return; }
  closeSheet();
  const againBtn = label => NET.on
    ? (NET.host === myUid() ? `<button class="b" onclick="UI.rematch()">Сыграть ещё раз этим столом</button>` : `<div class="note" style="text-align:center">Новую партию запускает хозяин комнаты</div>`) + `<button class="b sec" onclick="UI.leaveRoom()">Выйти из комнаты</button>`
    : `<button class="b${label === 'Новая партия' ? ' sec' : ''}" onclick="UI.newGame()">${label}</button>`;
  if (key === 'out') {
    w.className = 'win lose';
    w.innerHTML = `<div class="big">💀</div><h2>Ты банкрот</h2><p>Партия продолжается без тебя. Можешь досмотреть, кто победит.</p>
    ${coinLine(awardGame())}<div class="btns"><button class="b" onclick="UI.watch()">Смотреть партию</button>${(me.hist || []).length ? '<button class="b sec" onclick="UI.review()">Разбор партии</button>' : ''}<button class="b sec" onclick="UI.leaveRoom()">Выйти из комнаты</button></div>`;
    w.classList.remove('hidden'); return;
  }
  if (key === 'stage') {
    w.className = 'win';
    w.innerHTML = `<div class="big">🎉</div><h2>Ты вышел из колеса!</h2>
    <p>Капитал работает на тебя. Добро пожаловать в покерный клуб.</p>
    <div class="storycard" style="background:linear-gradient(135deg,#1aa38a,#2e6bff)"><div class="k">Колесо · ${me.emoji} ${me.profName} · ${D.DIFF[S.diff].n}</div><div class="v">Свобода за ${me.midAt || me.turns} ходов</div>
      <div class="grid"><div><div class="k">Пассивный доход</div><div class="v">${money(C.passive(S, me))}</div></div><div><div class="k">Поток</div><div class="v">${money(C.cashflow(S, me))}</div></div></div></div>
    <div class="note" style="margin:0 0 14px;text-align:center">Цель — поток <b>${money(D.RULES.fastFlow)}</b> в месяц без долгов.</div>
    <div class="btns"><button class="b" onclick="UI.closeStage()">Вперёд ◆</button><button class="b sec" onclick="UI.share()">📤 Поделиться в сторис</button></div>`;
    confetti(); haptic('ok');
  } else if (key === 'exit') {
    w.className = 'win';
    w.innerHTML = `<div class="big">🏆</div><h2>Поток $100 000 в месяц!</h2>
    <p>Ты в Большой игре. Выбери мечту.</p>
    <div class="storycard"><div class="k">Колесо · ${me.emoji} ${me.profName} · ${D.DIFF[S.diff].n}</div><div class="v">Большая игра за ${me.turns} ходов</div>
      <div class="grid"><div><div class="k">Поток</div><div class="v">${money(C.cashflow(S, me))}</div></div><div><div class="k">Активов</div><div class="v">${me.assets.length}</div></div></div></div>
    <div class="lbl" style="align-self:flex-start">Выбери мечту</div>
    <div class="dreams">${D.DREAMS.map((d, i) => `<button class="dream" onclick="UI.A('dream',{i:${i}})"><div class="de">${d.e}</div><div><div class="dn">${d.n}</div><div class="dp">${d.d}</div></div><div class="dc">${money(C.dreamPrice(i))}</div></button>`).join('')}</div>
    <button class="b sec" style="width:100%" onclick="UI.share()">📤 Поделиться в сторис</button>`;
    confetti(); haptic('ok');
  } else {
    const r = S.result;
    if (r.type === 'win' && r.pid === ME) {
      const dr = D.DREAMS[me.dream];
      w.className = 'win';
      w.innerHTML = `<div class="big">${dr.e}</div><h2>${r.how === 'dream' ? 'Мечта исполнена!' : 'Ты стал магнатом!'}</h2>
      <p>${r.how === 'dream' ? `Ты купил: ${dr.n}.` : `Твой поток вырос до ${money(C.fTarget(me))}.`} ${S.players.length > 1 ? `Победа над: ${S.players.filter(q => q.id !== ME).map(q => q.name).join(', ')}.` : ''}</p>
      <div class="storycard gold"><div class="k">Колесо · ${me.emoji} ${me.profName} · ${D.DIFF[S.diff].n}</div><div class="v">Победа за ${me.turns} ходов</div>
        <div class="grid"><div><div class="k">Поток БИ</div><div class="v">${money(me.fflow)}</div></div><div><div class="k">Наличные</div><div class="v">${money(me.cash)}</div></div>
        <div><div class="k">Инвестиций</div><div class="v">${me.finv.length}</div></div><div><div class="k">Мечта</div><div class="v">${dr.e}</div></div></div></div>
      <div class="btns"><button class="b gold" onclick="UI.share()">📤 Поделиться в сторис</button>${againBtn('Новая партия')}</div>`;
      confetti();
    } else if (r.type === 'bankrupt') {
      w.className = 'win lose';
      w.innerHTML = `<div class="big">💀</div><h2>Банкротство</h2>
      <p>Денег нет, банк отказал, активов на продажу не осталось. Колесо победило.</p>
      <div class="storycard" style="background:linear-gradient(135deg,#5a1f26,#2a3240)"><div class="k">Итог · ${D.DIFF[S.diff].n}</div><div class="v">Продержался ${me.turns} ходов</div>
      <div class="grid"><div><div class="k">Долг банку</div><div class="v">${money(C.loanTotal(me))}</div></div><div><div class="k">Детей</div><div class="v">${me.children}</div></div></div></div>
      <p style="margin-bottom:14px">Совет: не бери кредиты под сделки, где платёж съедает поток, и держи подушку на соблазны.</p>
      <div class="btns">${againBtn('Ещё раз')}</div>`;
    } else {
      const b = S.players[r.pid] || { name: 'Никто', emoji: '🤷' };
      w.className = 'win lose';
      w.innerHTML = `<div class="big">${b.emoji}</div><h2>${b.name} ${r.how === 'dream' ? 'купил(а) мечту' : 'стал(а) магнатом'} первым</h2>
      <p>Партия окончена. ${me.mode === 'rat' ? `Ты так и не выбрался из колеса: свобода ${C.freedom(S, me)}%.` : `Ты был в Большой игре: ${C.fProgress(S, me)}% до мечты.`}</p>
      <div class="storycard" style="background:linear-gradient(135deg,#444c58,#2a3240)"><div class="k">Твой результат · ${D.DIFF[S.diff].n}</div><div class="v">${me.turns} ходов</div>
      <div class="grid"><div><div class="k">Наличные</div><div class="v">${money(me.cash)}</div></div><div><div class="k">Долг</div><div class="v">${money(C.loanTotal(me))}</div></div></div></div>
      <div class="btns">${againBtn('Реванш')}</div>`;
    }
    const n = awardGame(), bt = w.querySelector('.btns');
    if (n && bt) bt.insertAdjacentHTML('beforebegin', coinLine(n));
    if (bt && (me.hist || []).length) bt.insertAdjacentHTML('beforeend', '<button class="b sec" onclick="UI.review()">Разбор партии</button>');
  }
  w.classList.remove('hidden');
}

/* ---------- мелочи ---------- */
let tt;
function toast(t) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => e.classList.remove('on'), 2400); }
function switchView(v) {
  view = v;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.v === v));
  ['board', 'ex', 'edu', 'report', 'chat'].forEach(x => $('v-' + x).classList.toggle('hidden', x !== v));
  if (v === 'chat') $('v-chat').dataset.init = '';
  render();
}
document.querySelectorAll('.tab').forEach(t => { t.onclick = () => switchView(t.dataset.v); });
$('rollBtn').onclick = () => A('roll');
document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#dice.tap')) A('roll'); });

window.UI = {
  A, toast, switchView, start, resume, debugFast, trade,
  setDiff: k => { diffSel = k; drawStart(); },
  startTutorial, tutEnd, tutGo: d => { tut.i = Math.max(0, Math.min(TUT.length - 1, tut.i + d)); tutShow(); },
  setRepay: n => { repayAmt = n; render(); },
  showAch, showRules, closeAch: () => { $('win').classList.add('hidden'); overlayKey = null; if (S) render(); else drawStart(); },
  setMode: k => { profMode = k; drawStart(); },
  review: showReview, reviewBack: () => { overlayKey = null; render(); },
  startRandom, showShop, buyTheme, wearTheme, buyDice, wearDice,
  testCoins: () => { addCoins(1000); toast('+1000 КолесоКоинов'); drawStart(); },
  quitJob: el => { if (el.dataset.arm) return A('quit'); el.dataset.arm = 1; el.textContent = 'Точно уволиться? Нажми ещё раз'; },
  dbg: (k, n) => { if (S) dispatch({ type: 'dbg', pid: ME, k, n }); },
  online: () => netOpen(null), joinCode: () => { const c = ($('joinInp').value || '').trim().toUpperCase(); if (c) netOpen(c); },
  rejoin: () => { const c = lsGet(ROOMKEY); if (c) netOpen(c); },
  addBot: () => netSend({ t: 'addBot' }), kick: i => netSend({ t: 'kick', i }), lobbyDiff: k => netSend({ t: 'diff', k }),
  lobbyStart: () => netSend({ t: 'start' }), invite, leaveRoom: () => netLeave(), rematch: () => netSend({ t: 'rematch' }),
  _dbg: () => ({ S, ME, busy, NET }),
  watch: () => { NET.watch = true; overlayKey = null; render(); },
  setQty: n => { qtyUI = n; render(); },
  qty: () => qtyUI,
  confirmTrade: () => { if (tradeUI) A('trade', { tk: tradeUI.tk, side: tradeUI.side, qty: qtyUI }); },
  closeTrade: () => { tradeUI = null; qtyUI = null; render(); },
  closeStage: () => { stageUI = null; render(); kickBots(); },
  debugMid,
  newGame: () => { clearSave(); showStart(); },
  share: () => toast(tg ? 'Здесь откроется редактор сторис Telegram с этой карточкой' : 'В Telegram здесь откроется редактор сторис'),
  restart: el => {
    if (!restartArm) { restartArm = true; el.textContent = 'Точно? Нажми ещё раз'; setTimeout(() => { restartArm = false; }, 3000); return; }
    restartArm = false; if (NET.on) return netLeave(); clearSave(); showStart();
  },
};

initTg();
applyTheme(wallet().theme);
// самообновление: Telegram держит страницу в кэше до 10 минут — если на сервере версия новее, перезагружаемся
const APP_V = '0.13.1';
try {
  fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json()).then(j => {
    if (!j || !j.v || j.v === APP_V) return;
    const key = 'koleso-upd-' + j.v;
    if (sessionStorage.getItem(key)) return; // уже пробовали — не зацикливаемся
    sessionStorage.setItem(key, '1');
    const q = new URLSearchParams(location.search); q.set('v', j.v);
    location.replace(location.pathname + '?' + q.toString() + location.hash);
  }).catch(() => {});
} catch (e) { /* ignore */ }
drawStart();
{ const sp = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || new URLSearchParams(location.search).get('room');
  if (sp && /^[A-Za-z0-9]{4,8}$/.test(sp)) netOpen(sp.toUpperCase()); }
setInterval(() => { if (NET.on && S && NET.deadline && !busy && $('scrGame') && !$('scrGame').classList.contains('hidden')) renderRace(); }, 1000);
})();
