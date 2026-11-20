/*
 * КОЛЕСО — игровой движок.
 *
 * Чистая логика без интерфейса: act(состояние, действие) → { state, events }.
 * - Состояние — обычный JSON: его можно сохранить, отправить по сети, восстановить.
 * - Случайность детерминированная (seed хранится в состоянии), поэтому партию можно воспроизвести.
 * - Все игроки, включая ботов, играют по одним правилам. Для онлайна боты просто заменяются людьми,
 *   а этот файл запускается на сервере.
 */
(function (root) {
'use strict';
const D = (typeof module === 'object' && module.exports) ? require('./data.js') : root.KolesoData;
const R = D.RULES;

/* ---------- утилиты ---------- */
function rnd(s) { // mulberry32, состояние генератора лежит в s.rng
  s.rng = (s.rng + 0x6D2B79F5) | 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (s, a, b) => a + Math.floor(rnd(s) * (b - a + 1));
const pick = (s, arr) => arr[Math.floor(rnd(s) * arr.length)];
const r10 = n => Math.round(n / 10) * 10, r100 = n => Math.round(n / 100) * 100, r1000 = n => Math.round(n / 1000) * 1000;
const money = n => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('ru-RU');
const pct = r => (r * 100).toFixed(1).replace('.', ',') + '%';
const fmtP = p => '$' + (p < 10 ? p.toFixed(2) : p.toFixed(1)).replace('.', ',');

class RuleError extends Error {}
const need = (cond, msg) => { if (!cond) throw new RuleError(msg); };
const diff = s => D.DIFF[s.diff];

/* ---------- расчёты по игроку ---------- */
const divOf = (s, a) => Math.round(a.shares * s.prices[a.tk].div);
const passive = (s, p) => p.assets.reduce((x, a) => x + (a.t === 'stock' ? divOf(s, a) : a.flow), 0);
const loanTotal = p => p.loans.reduce((x, l) => x + l.amt, 0);
const loanPay = p => Math.round(p.loans.reduce((x, l) => x + l.amt * l.rate, 0));
const expenses = (s, p) => p.exp.reduce((x, e) => x + e[1], 0) + p.children * p.child + loanPay(p);
const cashflow = (s, p) => p.salary + passive(s, p) - expenses(s, p);
const freedom = (s, p) => Math.min(100, Math.round(passive(s, p) / expenses(s, p) * 100));
const canBorrow = (s, p, n) => p.mode === 'rat' && (diff(s).minF === null || cashflow(s, p) - n * s.rate >= p.salary * diff(s).minF);
function maxLoan(s, p) { if (diff(s).minF === null) return Infinity; let n = 0; while (canBorrow(s, p, n + 1000) && n < 1e7) n += 1000; return n; }
const fTarget = p => Math.round(p.fstart * R.fastTarget);
const fProgress = (s, p) => Math.max(0, Math.min(100, Math.round(Math.max(p.cash / p.dreamCost, (p.fflow - p.fstart) / (fTarget(p) - p.fstart)) * 100)));
const scaleCost = (s, p, c) => Math.round(c * (0.75 + p.salary / 12000) * diff(s).tempt / 50) * 50;
const fee = v => Math.max(R.feeMin, Math.round(v * R.fee));
const progress = (s, p) => p.mode === 'fast' ? fProgress(s, p) : freedom(s, p);

/* ---------- чат и события ---------- */
function log(s, entry) { entry.id = ++s.uid; s.log.push(entry); if (s.log.length > 80) s.log.shift(); return entry; }
const sys = (s, text) => log(s, { k: 'sys', text });
const say = (s, pid, text, extra) => log(s, Object.assign({ k: 'msg', pid, text }, extra || {}));
const toast = (ev, pid, text) => ev.push({ t: 'toast', pid, text });

/* ---------- создание партии ---------- */
function makePlayer(id, profId, o) {
  const P = D.PROFS.find(x => x.id === profId);
  return { id, name: o.name, emoji: o.emoji || P.e, color: o.color, bot: !!o.bot, prof: P.id, profName: P.n,
    salary: P.salary, child: P.child, exp: P.exp.map(e => [e[0], e[1]]), cash: P.cash, children: 0, loans: [], assets: [],
    pos: 0, skip: 0, charity: 0, turns: 0, mode: 'rat', fflow: 0, fstart: 0, finv: [], dream: null, dreamCost: 0, bankrupt: false };
}
function newGame(opt) {
  const seed = (opt.seed == null ? Date.now() : opt.seed) | 0;
  const s = { v: 1, diff: opt.diff || 'normal', rng: seed, tick: 0, cur: 0, phase: 'roll', card: null, exitPid: null, result: null,
    rate: R.startRate, pend: [], news: [], offers: [], log: [], uid: 0, players: [],
    prices: Object.fromEntries(Object.entries(D.TICK).map(([k, v]) => [k, { p: v.p, div: v.div, prev: v.p, hist: [v.p] }])) };
  s.players.push(makePlayer(0, opt.prof, { name: opt.name || 'Ты', color: '#2ea6ff', bot: !!opt.allBots }));
  D.BOTS.forEach((b, i) => s.players.push(makePlayer(i + 1, b.prof, Object.assign({}, b, { bot: true }))));
  sys(s, `🎡 Партия началась · сложность «${diff(s).n}» · ${s.players.length} игрока`);
  if (s.players[1]) say(s, 1, 'Всем привет! Врач, расходы конские 😅');
  if (s.players[2]) say(s, 2, 'Го. Я в этот раз без айфонов, обещаю');
  genNews(s);
  return s;
}

/* ---------- главная функция ---------- */
const actorId = s => s.phase === 'exit' ? s.exitPid : s.cur;
function act(state, a) {
  const s = JSON.parse(JSON.stringify(state));
  const ev = [];
  try { handle(s, a, ev); }
  catch (e) { if (e instanceof RuleError) return { ok: false, state, events: [{ t: 'error', pid: a.pid, text: e.message }] }; throw e; }
  return { ok: true, state: s, events: ev };
}

function handle(s, a, ev) {
  need(s.phase !== 'over', 'Партия окончена');
  const pid = a.pid == null ? actorId(s) : a.pid;
  const p = s.players[pid];
  need(p && !p.bankrupt, 'Игрок выбыл');
  const myTurn = pid === s.cur;
  const c = s.card;
  switch (a.type) {
    case 'roll':
      need(s.phase === 'roll' && myTurn, 'Сейчас не твой ход');
      return doRoll(s, p, ev);
    case 'takeOffer': {
      need(s.phase === 'roll' && myTurn, 'Забрать сделку можно в свой ход до броска');
      need(p.mode === 'rat', 'В Большой игре мелкие сделки не нужны');
      const o = s.offers.find(x => x.id === a.id);
      need(o, 'Сделку уже забрали');
      need(o.from !== pid, 'Это твоя же сделка');
      s.offers = s.offers.filter(x => x !== o);
      s.card = { kind: 'deal', deal: o.deal, big: o.big, ret: 'roll', fromOffer: true };
      s.phase = 'card';
      say(s, pid, `Забрал(а) сделку <b>${o.deal.n}</b> у ${s.players[o.from].name}`);
      return;
    }
    case 'buy':
      need(s.phase === 'card' && myTurn && c, 'Нет активной карточки');
      return doBuy(s, p, a, ev);
    case 'buyStock': {
      need(s.phase === 'card' && myTurn && c && c.kind === 'stock', 'Нет предложения брокера');
      const qty = a.qty | 0; need(qty > 0, 'Укажи количество');
      const total = qty * c.price, f = fee(total);
      need(total + f <= p.cash, 'Не хватает денег');
      p.cash -= total + f; addShares(s, p, c.tk, qty, c.price);
      say(s, pid, `Взял(а) у брокера ${qty} ${c.tk} по ${fmtP(c.price)}`);
      return finishCard(s, p, ev);
    }
    case 'sell': {
      need(s.phase === 'card' && myTurn && c && c.kind === 'market' && c.ev.k === 'sell', 'Сейчас нечего продавать');
      need((c.sellable || []).includes(a.id) && !c.sold.includes(a.id), 'Этот актив нельзя продать');
      const as = p.assets.find(x => x.id === a.id); need(as, 'Актива уже нет');
      const v = Math.round(as.down * c.ev.mult);
      p.cash += v; p.assets = p.assets.filter(x => x !== as); c.sold.push(a.id);
      say(s, pid, `Продал(а) ${as.n} за ${money(v)} 🤑`);
      return;
    }
    case 'venture': {
      need(s.phase === 'card' && myTurn && c && c.kind === 'venture' && !c.result, 'Нет венчурного предложения');
      need(p.cash >= c.cost, 'Не хватает денег');
      p.cash -= c.cost;
      const die = ri(s, 1, 6), mult = R.venture[die] || 0, win = c.cost * mult;
      p.cash += win; c.result = { die, win };
      if (win) say(s, pid, `🎰 ${c.v.n} выстрелил! +${money(win)} 🚀`);
      else sys(s, `🎰 ${c.v.n} у игрока ${p.name} не взлетел (−${money(c.cost)})`);
      return;
    }
    case 'pass':
    case 'ok':
      need(s.phase === 'card' && myTurn && c, 'Нет активной карточки');
      if (c.kind === 'deal' && a.type === 'pass') makeOffer(s, p, c);
      return finishCard(s, p, ev);
    case 'trade': return doTrade(s, p, a, ev);
    case 'loan': {
      const n = a.n | 0; need(n > 0 && n % 1000 === 0, 'Кредит выдаётся по $1000');
      need(p.mode === 'rat', 'В Большой игре кредитов нет');
      need(canBorrow(s, p, n), 'Банк отказал: поток слишком маленький');
      borrow(s, p, n); toast(ev, pid, `Кредит ${money(n)} под ${pct(s.rate)}: расходы +${money(n * s.rate)}/мес`);
      return;
    }
    case 'repay': {
      const n = a.n | 0; need(n > 0, 'Укажи сумму');
      need(loanTotal(p) > 0, 'Кредитов нет'); need(p.cash >= n, 'Не хватает наличных');
      let left = n;
      for (const l of [...p.loans].sort((x, y) => y.rate - x.rate)) { const x = Math.min(left, l.amt); l.amt -= x; left -= x; if (!left) break; }
      p.cash -= n - left; p.loans = p.loans.filter(l => l.amt > 0);
      return;
    }
    case 'dream': {
      need(s.phase === 'exit' && pid === s.exitPid, 'Сейчас нельзя выбрать мечту');
      need(D.DREAMS[a.i], 'Нет такой мечты');
      return enterFast(s, p, a.i, ev);
    }
    default: need(false, 'Неизвестное действие');
  }
}

/* ---------- ход ---------- */
function doRoll(s, p, ev) {
  marketTick(s);
  p.turns++;
  if (p.skip > 0) {
    p.skip--; toast(ev, p.id, 'Пропуск хода: ищешь новую работу');
    ev.push({ t: 'skip', pid: p.id });
    return endTurn(s, p, ev);
  }
  const two = p.charity > 0; if (two) p.charity--;
  const dice = two ? [ri(s, 1, 6), ri(s, 1, 6)] : [ri(s, 1, 6)];
  const n = dice.reduce((x, y) => x + y, 0);
  ev.push({ t: 'roll', pid: p.id, dice, from: p.pos, steps: n, mode: p.mode });
  const cells = p.mode === 'fast' ? D.FCELLS : D.CELLS;
  for (let i = 0; i < n; i++) {
    p.pos = (p.pos + 1) % cells.length;
    if (cells[p.pos] === 'pay') { if (!payday(s, p, ev)) return afterBankrupt(s, p); }
    if (cells[p.pos] === 'fpay') p.cash += p.fflow;
  }
  return p.mode === 'fast' ? resolveFast(s, p, ev) : resolve(s, p, ev);
}

function payday(s, p, ev) {
  const f = cashflow(s, p);
  if (f >= 0) p.cash += f; else if (!pay(s, p, -f, ev)) return false;
  for (const a of p.assets.filter(x => x.risk)) {
    if (rnd(s) < a.risk * R.riskK * diff(s).risk) {
      p.assets = p.assets.filter(x => x !== a);
      sys(s, `💥 У игрока ${p.name}: ${a.e} ${a.n} прогорел(а), −${money(a.flow)}/мес`);
      toast(ev, p.id, `💥 ${a.n} прогорел(а)!`);
    }
  }
  if (rnd(s) < diff(s).surprise) {
    const x = pick(s, D.SURPRISE), cost = scaleCost(s, p, x[2]);
    toast(ev, p.id, `${x[0]} Внезапно: ${x[1]} −${money(cost)}`);
    if (!p.bot) sys(s, `${x[0]} Внезапная трата: ${x[1]} (${money(cost)})`);
    if (!pay(s, p, cost, ev)) return false;
  }
  return true;
}

function resolve(s, p, ev) {
  const t = D.CELLS[p.pos];
  switch (t) {
    case 'pay': toast(ev, p.id, `💼 Зарплата: ${money(cashflow(s, p))}`); return endTurn(s, p, ev);
    case 'small': case 'big': {
      const base = pick(s, t === 'small' ? D.SMALL : D.BIG);
      if (base.t === 'stock') {
        s.card = { kind: 'stock', tk: base.tk, price: Math.max(0.01, Math.round(s.prices[base.tk].p * R.brokerDiscount * 100) / 100) };
      } else {
        const deal = Object.assign({}, base, { flow: Math.max(10, r10(base.flow * diff(s).flow)) });
        s.card = { kind: 'deal', deal, big: t === 'big' };
      }
      break;
    }
    case 'market': return resolveMarket(s, p, ev);
    case 'tempt': {
      const x = pick(s, D.TEMPT), cost = scaleCost(s, p, x.cost);
      if (!pay(s, p, cost, ev)) return afterBankrupt(s, p);
      if (p.bot && rnd(s) < 0.5) say(s, p.id, `Соблазн: ${x.n} 🤦 −${money(cost)}`);
      s.card = { kind: 'tempt', t: x, cost };
      break;
    }
    case 'child': {
      const added = p.children < R.maxChildren; if (added) p.children++;
      if (added) sys(s, `👶 У игрока ${p.name} родился ребёнок`);
      s.card = { kind: 'child', added };
      break;
    }
    case 'down': {
      const paid = expenses(s, p);
      if (!pay(s, p, paid, ev)) return afterBankrupt(s, p);
      p.skip = 2;
      if (p.bot) say(s, p.id, 'Уволили, пропускаю два хода 😩');
      s.card = { kind: 'down', paid };
      break;
    }
    case 'charity': s.card = { kind: 'charity', cost: Math.round(p.salary * R.charityShare) }; break;
  }
  s.phase = 'card';
}

function resolveMarket(s, p, ev) {
  const e = pick(s, D.MARKET);
  const card = { kind: 'market', ev: e, sold: [], note: '', cls: '' };
  sys(s, `📈 Рынок: ${e.n}`);
  const rats = s.players.filter(q => !q.bankrupt && q.mode === 'rat');
  if (e.k === 'sell') {
    const l = p.assets.filter(a => a.cat === e.cat);
    card.sellable = l.map(a => a.id);
    card.note = l.length ? 'Продажа даёт кэш на крупную сделку, но пассивный доход уменьшится.' : 'У тебя нет подходящих активов. Сейчас на этом зарабатывают другие.';
  } else if (e.k === 'pay') {
    for (const q of rats) {
      const n = q.assets.filter(a => a.cat === e.cat).length;
      if (q === p) { card.note = n ? `У тебя ${n} шт. Оплачено ${money(e.amount * n)}` : 'Тебя это не касается 😌'; card.cls = n ? 'r' : ''; }
      if (n && !pay(s, q, e.amount * n, ev)) { if (q === p) return afterBankrupt(s, p); }
      if (s.phase === 'over') return;
    }
  } else if (e.k === 'flow') {
    for (const q of rats) {
      const l = q.assets.filter(a => a.cat === e.cat);
      l.forEach(a => { a.flow = Math.max(0, a.flow + e.delta); });
      if (q === p) {
        card.note = l.length ? `${e.delta > 0 ? '+' : '−'}${money(Math.abs(e.delta) * l.length)}/мес к пассивному доходу` : 'У тебя нет квартир, тебя это не задело.';
        card.cls = l.length ? (e.delta > 0 ? 'g' : 'r') : '';
      }
    }
  }
  s.card = card; s.phase = 'card';
}

function resolveFast(s, p, ev) {
  const t = D.FCELLS[p.pos], U = p.fstart;
  if (t === 'fpay') { toast(ev, p.id, `💰 Дивиденды +${money(p.fflow)}`); return endTurn(s, p, ev); }
  if (t === 'invest') {
    const b = pick(s, D.FAST);
    s.card = { kind: 'invest', inv: Object.assign({}, b, { cost: r1000(U * b.c * (0.9 + rnd(s) * 0.2)), flow: r100(U * b.f * diff(s).flow) }) };
  } else if (t === 'startup') {
    s.card = { kind: 'venture', v: pick(s, D.VENTURE), cost: r1000(U * (0.4 + rnd(s) * 0.6)), result: null };
  } else if (t === 'dream') {
    const di = D.DREAM_CELLS.indexOf(p.pos);
    if (di !== p.dream) { toast(ev, p.id, `${D.DREAMS[di].e} Чужая мечта: ${D.DREAMS[di].n}`); return endTurn(s, p, ev); }
    s.card = { kind: 'dream', di, cost: p.dreamCost };
  } else if (D.RULES.disasters[t] != null) {
    const loss = Math.round(p.cash * R.disasters[t]); p.cash -= loss;
    sys(s, `${D.DISASTER_TEXT[t][0]} ${p.name}: ${D.DISASTER_TEXT[t][1]} (−${money(loss)})`);
    s.card = { kind: 'disaster', key: t, loss };
  } else if (t === 'crisis') {
    let lost = null;
    if (p.finv.length) { lost = pick(s, p.finv); p.finv = p.finv.filter(x => x !== lost); p.fflow -= lost.flow; sys(s, `🌪 Кризис: у игрока ${p.name} разорился ${lost.n}`); }
    s.card = { kind: 'crisis', lost };
  }
  s.phase = 'card';
}

function doBuy(s, p, a, ev) {
  const c = s.card;
  if (c.kind === 'deal') {
    const d = c.deal, L = Math.max(0, a.loan | 0);
    need(L % 1000 === 0, 'Кредит выдаётся по $1000');
    if (L) need(canBorrow(s, p, L), 'Банк отказал: поток слишком маленький');
    need(p.cash + L >= d.down, 'Не хватает денег');
    if (L) borrow(s, p, L);
    p.cash -= d.down;
    p.assets.push(Object.assign({}, d, { id: ++s.uid }));
    say(s, p.id, `Купил(а) <b>${d.n}</b>${L ? ` в кредит ${money(L)}` : ''} 💪 +${money(d.flow)}/мес`);
    toast(ev, p.id, `${d.e} Куплено! Поток +${money(d.flow)}${L ? `, платёж по кредиту ${money(L * s.rate)}` : ''}`);
    return finishCard(s, p, ev);
  }
  if (c.kind === 'charity') {
    need(p.cash >= c.cost, 'Не хватает наличных');
    p.cash -= c.cost; p.charity = R.charityTurns;
    return finishCard(s, p, ev);
  }
  if (c.kind === 'invest') {
    need(p.cash >= c.inv.cost, 'Не хватает денег');
    p.cash -= c.inv.cost; p.fflow += c.inv.flow; p.finv.push({ e: c.inv.e, n: c.inv.n, flow: c.inv.flow });
    say(s, p.id, `★ Купил(а) <b>${c.inv.n}</b>, поток +${money(c.inv.flow)}`);
    return finishCard(s, p, ev);
  }
  if (c.kind === 'dream') {
    need(p.cash >= c.cost, 'Не хватает денег');
    p.cash -= c.cost;
    return win(s, p, 'dream');
  }
  need(false, 'Здесь нечего покупать');
}

function doTrade(s, p, a, ev) {
  const q = s.prices[a.tk]; need(q, 'Нет такой бумаги');
  const qty = a.qty | 0; need(qty > 0, 'Укажи количество');
  const total = qty * q.p, f = fee(total);
  const own = p.assets.find(x => x.tk === a.tk);
  if (a.side === 'buy') {
    need(total + f <= p.cash, 'Не хватает денег');
    p.cash -= total + f; addShares(s, p, a.tk, qty, q.p);
    say(s, p.id, `Купил(а) ${qty} ${a.tk} по ${fmtP(q.p)}`);
  } else {
    need(own && own.shares >= qty, 'Столько акций нет');
    p.cash += total - f; own.shares -= qty;
    const pl = (q.p - own.buy) * qty;
    if (!own.shares) p.assets = p.assets.filter(x => x !== own);
    say(s, p.id, `Продал(а) ${qty} ${a.tk} по ${fmtP(q.p)} (${pl >= 0 ? '+' : ''}${money(pl)})`);
  }
}
function addShares(s, p, tk, qty, price) {
  const own = p.assets.find(x => x.tk === tk);
  if (own) { own.buy = (own.buy * own.shares + qty * price) / (own.shares + qty); own.shares += qty; }
  else p.assets.push({ t: 'stock', tk, e: D.TICK[tk].e, n: tk, shares: qty, buy: price, flow: 0, id: ++s.uid });
}

function makeOffer(s, p, c) {
  const id = ++s.uid;
  s.offers.push({ id, deal: c.deal, big: c.big, from: p.id, tick: s.tick });
  if (s.offers.length > R.maxOffers) s.offers.shift();
  say(s, p.id, p.bot ? `Мне не подходит <b>${c.deal.n}</b>. Кто заберёт?` : `Отказываюсь от <b>${c.deal.n}</b>. Кто заберёт?`, { offerId: id });
}

function finishCard(s, p, ev) {
  const ret = s.card && s.card.ret;
  s.card = null;
  if (ret === 'roll') { s.phase = 'roll'; return; }
  return endTurn(s, p, ev);
}

function endTurn(s, p, ev) {
  if (s.phase === 'over') return;
  s.card = null;
  if (p.mode === 'rat' && !p.bankrupt) {
    if (diff(s).infl && p.turns > 0 && p.turns % R.inflEvery === 0) {
      const o = p.exp.find(e => e[0] === 'Прочие расходы');
      const add = Math.max(10, r10(o[1] * diff(s).infl)); o[1] += add;
      toast(ev, p.id, `🎈 Инфляция: расходы +${money(add)}/мес`);
      if (!p.bot) sys(s, `🎈 Инфляция: прочие расходы +${money(add)}/мес`);
    }
    if (passive(s, p) >= expenses(s, p)) {
      s.phase = 'exit'; s.exitPid = p.id;
      sys(s, `🏁 ${p.name} вышел(а) из колеса за ${p.turns} ходов!`);
      return;
    }
  }
  if (p.mode === 'fast' && p.fflow >= fTarget(p)) return win(s, p, 'flow');
  advance(s);
}

function advance(s) {
  s.tick++;
  if (rnd(s) < R.newsChance) genNews(s);
  s.offers = s.offers.filter(o => s.tick - o.tick <= R.offerTTL);
  const n = s.players.length;
  s.card = null; s.exitPid = null;
  if (s.players.every(q => q.bankrupt)) { s.phase = 'over'; s.result = { type: 'allBankrupt' }; return; }
  for (let k = 1; k <= n; k++) { const j = (s.cur + k) % n; if (!s.players[j].bankrupt) { s.cur = j; break; } }
  s.phase = 'roll';
}

function enterFast(s, p, i, ev) {
  const U = Math.max(1000, passive(s, p) * R.fastMult);
  p.mode = 'fast'; p.fstart = U; p.fflow = U; p.dream = i; p.dreamCost = r1000(U * D.DREAMS[i].m);
  p.cash += U; p.pos = 0; p.skip = 0; p.charity = 0; p.finv = [];
  sys(s, `★ ${p.name} в Большой игре. Мечта: ${D.DREAMS[i].e} ${D.DREAMS[i].n}`);
  if (p.bot) say(s, p.id, 'Всё, я на Большой игре 😎 Кто следующий?');
  toast(ev, p.id, '★ Добро пожаловать в Большую игру');
  advance(s);
}

function win(s, p, how) {
  s.phase = 'over'; s.card = null;
  s.result = { type: 'win', pid: p.id, how };
  sys(s, `🏆 ${p.name} ${how === 'dream' ? 'купил(а) мечту' : 'поднял(а) поток на 50%'} и выиграл(а)!`);
}

/* ---------- деньги ---------- */
function borrow(s, p, n) {
  const l = p.loans.find(x => x.rate === s.rate);
  if (l) l.amt += n; else p.loans.push({ amt: n, rate: s.rate });
  p.cash += n;
}
function pay(s, p, n, ev) {
  if (p.cash >= n) { p.cash -= n; return true; }
  const needL = Math.ceil((n - p.cash) / 1000) * 1000;
  if (canBorrow(s, p, needL)) {
    borrow(s, p, needL); p.cash -= n;
    toast(ev, p.id, `Не хватило денег: банк выдал кредит ${money(needL)} под ${pct(s.rate)}`);
    return true;
  }
  const sold = [];
  for (const a of [...p.assets].sort((x, y) => x.flow - y.flow)) {
    if (p.cash >= n) break;
    const v = a.t === 'stock' ? Math.round(a.shares * s.prices[a.tk].p * R.forcedSale) : Math.round(a.down * R.forcedSale);
    p.cash += v; p.assets = p.assets.filter(x => x !== a); sold.push(`${a.e} ${a.n} (${money(v)})`);
  }
  if (sold.length) sys(s, `🔨 ${p.name}: банк отказал в кредите. Продано за полцены: ${sold.join(', ')}`);
  if (p.cash >= n) { p.cash -= n; toast(ev, p.id, '🔨 Пришлось распродать активы за полцены'); return true; }
  bankrupt(s, p);
  return false;
}
function bankrupt(s, p) {
  p.bankrupt = true; p.assets = [];
  sys(s, `💀 ${p.name} обанкротился(ась)`);
  if (!p.bot) { s.phase = 'over'; s.card = null; s.result = { type: 'bankrupt', pid: p.id }; }
}
function afterBankrupt(s, p) {
  if (s.phase === 'over') return;
  s.card = null;
  if (s.cur === p.id) advance(s);
}

/* ---------- биржа и новости ---------- */
function marketTick(s) {
  for (const tk in D.TICK) { const q = s.prices[tk]; q.prev = q.p; q.p *= 1 + (rnd(s) * 2 - 1) * D.TICK[tk].vol; }
  for (const e of s.pend) {
    const q = s.prices[e.tk], k = e.real ? e.m : R.fakeEffect * e.m;
    q.p *= 1 + k * R.newsSteps[e.i];
    if (e.i === 0 && e.div && e.real) q.div = Math.round(q.div * e.div * 100) / 100;
    e.i++;
    if (e.i >= R.newsSteps.length) {
      const n = s.news.find(x => x.id === e.nid);
      if (n) n.status = n.rum ? (e.real ? '✅ подтвердилось' : '❌ оказалось фейком') : '✔ отыграно рынком';
    }
  }
  s.pend = s.pend.filter(e => e.i < R.newsSteps.length);
  for (const tk in D.TICK) {
    const q = s.prices[tk];
    q.p = Math.max(D.TICK[tk].min, Math.round(q.p * 100) / 100);
    q.hist.push(q.p); if (q.hist.length > 24) q.hist.shift();
  }
}
function genNews(s) {
  const tpl = pick(s, D.NEWS);
  const n = { id: ++s.uid, t: tpl.t, rum: !!tpl.rum, tick: s.tick, status: '' };
  const real = !tpl.rum || rnd(s) < R.rumorTrue;
  const eff = [];
  if (tpl.macro === 'up' || tpl.macro === 'down') {
    const up = tpl.macro === 'up', old = s.rate;
    s.rate = Math.min(R.rateMax, Math.max(R.rateMin, Math.round((s.rate + (up ? 1 : -1) * ri(s, 5, 10) / 1000) * 1000) / 1000));
    if (s.rate === old) return;
    n.t += ` (${pct(old)} → ${pct(s.rate)})`;
    n.status = '✔ ставка уже изменилась, акции отреагируют';
    eff.push({ tk: 'ОКТО', m: up ? -0.12 : 0.12 }, { tk: 'ГРАН', m: up ? 0.06 : -0.04 });
  } else if (tpl.macro === 'bear') for (const tk in D.TICK) eff.push({ tk, m: -0.15 });
  else if (tpl.macro === 'bull') for (const tk in D.TICK) eff.push({ tk, m: 0.1 });
  else eff.push({ tk: tpl.tk, m: tpl.m, div: tpl.div });
  eff.forEach(e => s.pend.push(Object.assign({}, e, { real, nid: n.id, i: 0 })));
  s.news.push(n); if (s.news.length > 20) s.news.shift();
  log(s, { k: 'news', text: n.t, rum: n.rum });
  const bots = s.players.filter(q => q.bot && !q.bankrupt);
  if (bots.length && rnd(s) < 0.4) {
    const b = pick(s, bots), tk = tpl.tk || 'ОКТО', pos = (tpl.m || (tpl.macro === 'bull' ? 1 : -1)) > 0;
    say(s, b.id, n.rum ? pick(s, ['Это фейк, 100%', 'Верю. Беру на всё 🚀', 'Слух уже в цене, поздно', 'Подожду подтверждения'])
      : pos ? pick(s, [`Закупаюсь ${tk} 🚀`, `Наконец-то хорошие новости по ${tk}`]) : pick(s, [`Сливаю ${tk}, пока не поздно`, `Мои ${tk}... 😭`]));
  }
}

/* ---------- ИИ ботов ----------
 * Бот не меняет состояние сам: он только выбирает действие, которое затем проходит через act(),
 * как действие живого игрока. Логика нарочно простая и честная.
 */
function aiDeal(s, p, d) {
  const reserve = scaleCost(s, p, R.botReserve);
  const eff = d.flow * (1 - (d.risk || 0) * 0.8);
  if (p.cash - d.down >= reserve) return { loan: 0 };
  const L = Math.ceil((d.down - Math.max(0, p.cash - reserve)) / 1000) * 1000;
  if (L > 0 && canBorrow(s, p, L) && eff - L * s.rate > eff * 0.3 && p.cash + L >= d.down) return { loan: L };
  if (p.cash >= d.down && eff > 0) return { loan: 0 };
  return null;
}
function botAction(s) {
  if (s.phase === 'over') return null;
  const pid = actorId(s), p = s.players[pid];
  if (!p || !p.bot) return null;
  if (s.phase === 'exit') return { type: 'dream', pid, i: [1, 0, 2][pid % 3] };
  if (s.phase === 'roll') {
    if (p.mode === 'rat') for (const o of s.offers) if (o.from !== pid && aiDeal(s, p, o.deal)) return { type: 'takeOffer', pid, id: o.id };
    return { type: 'roll', pid };
  }
  const c = s.card;
  switch (c.kind) {
    case 'deal': { const ch = aiDeal(s, p, c.deal); return ch ? { type: 'buy', pid, loan: ch.loan } : { type: 'pass', pid }; }
    case 'stock': {
      const y = s.prices[c.tk].div / c.price;
      if (y > s.rate && p.cash > scaleCost(s, p, 2000)) { const qty = Math.floor(p.cash * 0.3 / (c.price * 1.01)); if (qty > 0) return { type: 'buyStock', pid, qty }; }
      return { type: 'pass', pid };
    }
    case 'market': {
      if (c.ev.k === 'sell' && c.ev.mult >= 2.2) { const id = (c.sellable || []).find(x => !c.sold.includes(x)); if (id) return { type: 'sell', pid, id }; }
      return { type: 'ok', pid };
    }
    case 'charity': return p.cash > c.cost * 4 ? { type: 'buy', pid } : { type: 'pass', pid };
    case 'invest': return p.cash >= c.inv.cost ? { type: 'buy', pid } : { type: 'pass', pid };
    case 'venture': return c.result ? { type: 'ok', pid } : (p.cash >= c.cost * 3 ? { type: 'venture', pid } : { type: 'pass', pid });
    case 'dream': return p.cash >= c.cost ? { type: 'buy', pid } : { type: 'pass', pid };
    default: return { type: 'ok', pid };
  }
}

const KolesoEngine = {
  newGame, act, botAction, actorId, D,
  calc: { passive, expenses, cashflow, freedom, progress, fProgress, fTarget, canBorrow, maxLoan, loanTotal, loanPay, divOf, fee, scaleCost },
  fmt: { money, pct, fmtP },
};
if (typeof module === 'object' && module.exports) module.exports = KolesoEngine;
else root.KolesoEngine = KolesoEngine;
})(this);
