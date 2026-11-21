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
const fmtP = p => '$' + (p < 0.01 ? p.toFixed(5) : p < 1 ? p.toFixed(3) : p < 10 ? p.toFixed(2) : p.toFixed(1)).replace('.', ',');

class RuleError extends Error {}
const need = (cond, msg) => { if (!cond) throw new RuleError(msg); };
const diff = s => D.DIFF[s.diff];

/* ---------- расчёты по игроку ---------- */
const divOf = (s, a) => Math.round(a.shares * s.prices[a.tk].div);
// Цикл экономики, отрасли, управляющие
const phase = s => D.CYCLE[(s.cycle && s.cycle.i) || 0];
const secOf = a => a.sec || (a.cat === 'flat' || a.cat === 'house' ? 'realty' : 'retail');
const cycK = (s, sec) => 1 + (phase(s).flowK - 1) * ((D.SECTORS[sec] || { cyc: 1 }).cyc);
const isBiz = a => a.t !== 'stock' && a.cat !== 'flat' && a.cat !== 'house';
const slots = p => R.manageSlots + (has(p, 'management') ? R.managementBonus : 0);
function managedIds(p) { const b = p.assets.filter(isBiz).sort((x, y) => y.flow - x.flow); return new Set(b.slice(slots(p)).map(a => a.id)); }
const assetIncome = (s, p, a, man) => a.t === 'stock' ? divOf(s, a) : Math.round(a.flow * cycK(s, secOf(a)) * ((man || managedIds(p)).has(a.id) ? 1 - R.managerCut : 1));
const passive = (s, p) => { const man = managedIds(p); return p.assets.reduce((x, a) => x + assetIncome(s, p, a, man), 0); };
const sectorsCount = p => new Set(p.assets.filter(a => a.t !== 'stock').map(secOf)).size;
const salePrice = (s, a) => Math.max(100, Math.round(a.down * phase(s).saleK * R.saleDiscount / 100) * 100);
const loanTotal = p => p.loans.reduce((x, l) => x + l.amt, 0);
const loanPay = p => Math.round(p.loans.reduce((x, l) => x + l.amt * l.rate, 0));
const expenses = (s, p) => p.exp.reduce((x, e) => x + e[1], 0) + p.children * p.child + loanPay(p);
const cashflow = (s, p) => p.salary + passive(s, p) - expenses(s, p);
const freedom = (s, p) => Math.min(100, Math.round(passive(s, p) / expenses(s, p) * 100));
const has = (p, sk) => !!(p.skills && p.skills.includes(sk));
// Ставка: ЦБ + надбавка банка + надбавка за долговую нагрузку (+ ещё больше для потребкредита)
const bankDebt = p => p.loans.filter(l => !l.shady).reduce((x, l) => x + l.amt, 0);
const loadPremium = (s, p) => { const inc = Math.max(1, p.salary + passive(s, p)); return Math.min(R.loadCap, Math.floor(bankDebt(p) / inc / 6) * R.loadStep); };
// Виды кредита: short — короткий (дешевле, вернуть через 8 ходов), deal — длинный (по умолчанию), cash — потребкредит
const rateFor = (s, p, kind) => Math.max(0.01, Math.round((s.rate + R.bankSpread + phase(s).rateAdd + loadPremium(s, p)
  + (kind === 'cash' ? R.cashLoanExtra + R.longExtra : kind === 'short' ? 0 : R.longExtra) - (has(p, 'credit') ? R.creditBonus : 0)) * 1000) / 1000);
const canBorrow = (s, p, n, kind) => p.mode !== 'fast' && (diff(s).minF === null
  || cashflow(s, p) - n * rateFor(s, p, kind) >= p.salary * Math.max(diff(s).minF, phase(s).tight ? 0.1 : 0));
const debtFree = p => p.loans.length === 0;
const st = p => p.stats || (p.stats = {});
const skillCost = (s, p, sk) => scaleCost(s, p, D.SKILLS.find(x => x.id === sk).cost);
// Масштаб сделок малого круга: чем больше у профессии расходы, тем крупнее ей предлагают сделки
const dealScale = p => Math.max(0.45, p.exp.reduce((x, e) => x + e[1], 0) / R.dealScaleBase);
const scaleDeal = (s, p, base) => {
  const k = dealScale(p) * phase(s).priceK, kf = dealScale(p), r = x => Math.max(100, r100(x));
  return Object.assign({}, base, { price: r(base.price * k), down: nego(p, r(base.down * k)), nego: has(p, 'negotiation'),
    flow: Math.max(10, r10(base.flow * kf * diff(s).flow * yieldK(s))) });
};
const yieldK = s => R.yieldSpread[0] + rnd(s) * (R.yieldSpread[1] - R.yieldSpread[0]);
const perk = (p, k) => !!(p.perks && p.perks.includes(k));
const thrift = (p, v) => perk(p, 'thrift') ? Math.round(v * 0.7 / 50) * 50 : v;
const nego = (p, down) => has(p, 'negotiation') ? r100(down * R.negoDiscount) : down;
function maxLoan(s, p, kind) { if (diff(s).minF === null) return Infinity; let n = 0; while (canBorrow(s, p, n + 1000, kind) && n < 1e7) n += 1000; return n; }
const fTarget = p => Math.round(p.fstart * R.fastTarget);
const fProgress = (s, p) => Math.max(0, Math.min(100, Math.round(Math.max(p.cash / p.dreamCost, (p.fflow - p.fstart) / (fTarget(p) - p.fstart)) * 100)));
const profScale = p => 0.75 + p.salary / 12000;
// Траты (соблазны, сюрпризы, учёба) масштабируются так же, как сделки: от расходов профессии
const scaleCost = (s, p, c) => Math.max(50, Math.round(c * dealScale(p) * diff(s).tempt / 50) * 50);
const midF = (s, p) => Math.max(1000, cashflow(s, p));
// Доходность бизнесов среднего круга для игрока: ln(путь до цели) / ln(эталон). Курьеру расти дальше, чем врачу, — его бизнесы доходнее.
const midYield = p => { const M = Math.max(2, R.fastFlow / Math.max(1000, p.mstart)); return Math.min(1.6, Math.max(0.4, Math.log(M) / Math.log(R.midRefM))); };
const cap = (s, tk) => s.prices[tk].p * D.TICK[tk].shares;
const takeoverCost = (s, tk, disc) => Math.round(cap(s, tk) * R.takeoverShare * (disc || 1) / 1000) * 1000;
const takeoverFlow = (s, tk) => Math.round(cap(s, tk) * R.takeoverShare * R.takeoverYield / 100) * 100;
const influenceCost = (s, p, tk) => Math.round(cap(s, tk) * R.pumpCost * (s.prices[tk].owner === p.id ? 0.5 : 1) / 1000) * 1000;
const fee = v => Math.max(R.feeMin, Math.round(v * R.fee));
const feeFor = (tk, v) => Math.max(R.feeMin, Math.round(v * (D.TICK[tk].fee || R.fee)));
function gauss(s) { const u = Math.max(1e-9, rnd(s)), v = rnd(s); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
// прогресс среднего круга в логарифмах: путь от потока при входе до $100 000
const midProgress = (s, p) => { const f0 = Math.max(1000, p.mstart), f = Math.max(1, cashflow(s, p)); return Math.max(0, Math.min(100, Math.round(Math.log(f / f0) / Math.log(R.fastFlow / f0) * 100))); };
const progress = (s, p) => p.mode === 'fast' ? fProgress(s, p) : p.mode === 'mid' ? midProgress(s, p) : freedom(s, p);

/* ---------- чат и события ---------- */
function log(s, entry) { entry.id = ++s.uid; s.log.push(entry); if (s.log.length > 80) s.log.shift(); return entry; }
const sys = (s, text) => log(s, { k: 'sys', text });
const say = (s, pid, text, extra) => log(s, Object.assign({ k: 'msg', pid, text }, extra || {}));
const toast = (ev, pid, text) => ev.push({ t: 'toast', pid, text });

/* ---------- создание партии ---------- */
function makePlayer(id, profId, o) {
  const P = D.PROFS.find(x => x.id === profId);
  const eduLoan = P.eduLoan ? [{ amt: P.eduLoan, rate: R.startRate + R.bankSpread, kind: 'edu' }] : [];
  return { id, name: o.name, emoji: o.emoji || P.e, color: o.color, bot: !!o.bot, prof: P.id, profName: P.n,
    salary: P.salary, child: Math.round(P.exp.reduce((x, e) => x + e[1], 0) * 0.08 / 10) * 10, exp: P.exp.map(e => [e[0], e[1]]), cash: P.cash, children: 0, loans: eduLoan, assets: [],
    pos: 0, skip: 0, charity: 0, turns: 0, skills: (P.skills || []).slice(), perks: (P.perks || []).slice(), mode: 'rat', mstart: 0, midAt: 0, fastAt: 0, infTick: -1, fflow: 0, fstart: 0, finv: [], dream: null, dreamCost: 0, bankrupt: false };
}
function newGame(opt) {
  const seed = (opt.seed == null ? Date.now() : opt.seed) | 0;
  const s = { v: 4, diff: opt.diff || 'normal', rng: seed, tick: 0, cur: 0, phase: 'roll', card: null, exitPid: null, result: null,
    rate: R.startRate, pend: [], news: [], offers: [], log: [], uid: 0, players: [],
    prices: Object.fromEntries(Object.entries(D.TICK).map(([k, v]) => [k, { p: v.p, fv: v.p, div: v.div, prev: v.p, hist: [v.p] }])) };
  const rprof = () => D.PROFS[Math.floor(rnd(s) * D.PROFS.length)].id;
  if (opt.seats) {
    // онлайн: места по порядку, люди и боты вперемешку (1–4 места)
    let hi = 0, bi = 0;
    opt.seats.slice(0, 4).forEach((x, i) => {
      if (x.bot) { const b = D.BOTS[bi++ % D.BOTS.length]; s.players.push(makePlayer(i, b.fixedProf || rprof(), Object.assign({}, b, { bot: true, emoji: null }))); }
      else s.players.push(Object.assign(makePlayer(i, x.prof || rprof(), { name: x.name || 'Игрок', color: D.HUMAN_COLORS[hi++ % D.HUMAN_COLORS.length] }), { uid: x.uid }));
    });
  } else {
    s.players.push(makePlayer(0, opt.prof, { name: opt.name || 'Ты', color: '#2ea6ff', bot: !!opt.allBots }));
    // ботам каждую партию достаётся случайная профессия (если в BOTS не задана фиксированная через fixedProf)
    D.BOTS.slice(0, opt.bots == null ? 2 : opt.bots).forEach((b, i) => s.players.push(makePlayer(i + 1, b.fixedProf || rprof(), Object.assign({}, b, { bot: true, emoji: null }))));
  }
  const c0 = D.CYCLE[0]; s.cycle = { i: 0, left: ri(s, c0.len[0], c0.len[1]) * s.players.length };
  s.cycle.est = Math.round(s.cycle.left / s.players.length) + ri(s, -2, 2); s.cycle.start = 0;
  const n = s.players.length;
  sys(s, `🎡 Партия началась · сложность «${diff(s).n}» · ${n} ${n === 1 ? 'игрок' : n < 5 ? 'игрока' : 'игроков'}`);
  const hello = [p => `Привет! Я ${p}, погнали`, p => `Я ${p}. В этот раз без айфонов`, p => `${p[0].toUpperCase() + p.slice(1)} на месте. Кто первый в колесо?`];
  s.players.filter(q => q.bot).forEach((q, i) => say(s, q.id, hello[i % 3](q.profName.toLowerCase())));
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
      if (p.mode !== 'fast' && p.dilTick !== s.tick) {
        p.dilTick = s.tick;
        const cand = p.assets.filter(x => x.t !== 'stock');
        if (cand.length && rnd(s) < R.dilemmaChance) {
          const a0 = pick(s, cand), list = D.DILEMMAS.map((d, i) => i).filter(i => D.DILEMMAS[i].sec === 'any' || D.DILEMMAS[i].sec === secOf(a0));
          s.card = { kind: 'dilemma', di: pick(s, list), aid: a0.id, ret: 'roll' }; s.phase = 'card';
          return;
        }
      }
      return doRoll(s, p, ev);
    case 'choose': {
      need(s.phase === 'card' && myTurn && c && c.kind === 'dilemma', 'Нет решения');
      const dl = D.DILEMMAS[c.di], opt = a.opt === 'b' ? dl.b : dl.a, as = p.assets.find(x => x.id === c.aid);
      if (as) { const res = applyEff(s, p, as, opt[1], ev); if (s.phase === 'over') return; toast(ev, pid, `${opt[0]}: ${res || 'без изменений'}`); if (!p.bot) say(s, pid, `${as.n}: ${opt[0].toLowerCase()} → ${res || 'без изменений'}`); }
      return finishCard(s, p, ev);
    }
    case 'sellBiz': {
      need(s.phase === 'roll' && myTurn, 'Продать можно в свой ход до броска');
      need(p.mode !== 'fast', 'В Большой игре бизнесы не продаются');
      const as = p.assets.find(x => x.id === a.id && x.t !== 'stock'); need(as, 'Нет такого бизнеса');
      const v = salePrice(s, as); p.cash += v; p.assets = p.assets.filter(x => x !== as);
      say(s, pid, `Продал(а) ${as.n} за ${money(v)}`);
      return;
    }
    case 'bid': {
      need(s.phase === 'card' && myTurn && c && c.kind === 'deal' && c.auction && !c.auction.done, 'Торгов нет');
      const au = c.auction, step = x => r100(x * (1 + R.auctionStep));
      au.price = au.leader == null ? au.price : step(au.price); au.leader = pid; au.log.push([pid, au.price]);
      for (let guard = 0; guard < 30; guard++) {
        const cands = au.bids.filter(b => b.pid !== au.leader && b.max >= step(au.price)).sort((x, y) => y.max - x.max);
        if (!cands.length) break;
        au.price = step(au.price); au.leader = cands[0].pid; au.log.push([au.leader, au.price]);
        if (au.bids.filter(b => b.pid !== au.leader && b.max >= step(au.price)).length === 0) break;
      }
      if (au.leader === pid) { au.done = true; c.deal = Object.assign({}, c.deal, { down: au.price }); }
      return;
    }
    case 'study': {
      need(s.phase === 'roll' && myTurn, 'Учиться можно в свой ход вместо броска');
      const sk = D.SKILLS.find(x => x.id === a.skill); need(sk, 'Нет такого навыка');
      need(!has(p, sk.id), 'Этот навык уже есть');
      const cost = skillCost(s, p, sk.id); need(p.cash >= cost, 'Не хватает денег на учёбу');
      p.cash -= cost; p.skills = (p.skills || []).concat(sk.id);
      marketTick(s); p.turns++;
      say(s, pid, `🎓 Отучился(ась): ${sk.e} ${sk.n}`);
      toast(ev, pid, `🎓 Навык получен: ${sk.n}. Ход потрачен на учёбу`);
      ev.push({ t: 'study', pid });
      return endTurn(s, p, ev);
    }
    case 'takeOffer': {
      need(s.phase === 'roll' && myTurn, 'Забрать сделку можно в свой ход до броска');
      need(p.mode !== 'fast', 'В Большой игре мелкие сделки не нужны');
      const o = s.offers.find(x => x.id === a.id);
      need(o, 'Сделку уже забрали');
      need((o.mode || 'rat') === p.mode, o.mode === 'mid' ? 'Это сделка среднего круга' : 'Это сделка малого круга');
      need(o.from !== pid, 'Это твоя же сделка');
      s.offers = s.offers.filter(x => x !== o);
      s.card = { kind: 'deal', deal: o.deal, big: o.big, tier: o.mode, ret: 'roll', fromOffer: true };
      s.phase = 'card';
      say(s, pid, `Забрал(а) сделку <b>${o.deal.n}</b> у ${s.players[o.from].name}`);
      return;
    }
    case 'buy':
      need(s.phase === 'card' && myTurn && c, 'Нет активной карточки');
      return doBuy(s, p, a, ev);
    case 'buyStock': {
      need(s.phase === 'card' && myTurn && c && c.kind === 'stock', 'Нет предложения брокера');
      const qty = Math.floor(+a.qty || 0); need(qty > 0, 'Укажи количество');
      const total = qty * c.price, f = feeFor(c.tk, total);
      need(total + f <= p.cash, 'Не хватает денег');
      p.cash -= total + f; addShares(s, p, c.tk, qty, c.price);
      say(s, pid, `Взял(а) у брокера ${qty} ${c.tk} по ${fmtP(c.price)}`);
      return finishCard(s, p, ev);
    }
    case 'sell': {
      need(s.phase === 'card' && myTurn && c && c.sellable && c.mult, 'Сейчас нечего продавать');
      need(c.sellable.includes(a.id) && !c.sold.includes(a.id), 'Этот актив нельзя продать');
      const as = p.assets.find(x => x.id === a.id); need(as, 'Актива уже нет');
      const v = Math.round(as.down * c.mult);
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
    case 'gamble':
      need(s.phase === 'card' && myTurn && c && c.kind === 'gamble' && !c.result, 'Нет темки');
      return doGamble(s, p, c, ev);
    case 'takeover': {
      need(p.mode === 'fast', 'Выкупать компании можно только в Большой игре');
      need(s.phase === 'roll' && myTurn, 'Выкуп — в свой ход до броска');
      need(s.prices[a.tk] && !D.TICK[a.tk].crypto, 'Крипту выкупить нельзя: это не компания');
      return doTakeover(s, p, a.tk, takeoverCost(s, a.tk), takeoverFlow(s, a.tk));
    }
    case 'pump': case 'dump':
      return doInfluence(s, p, a, ev, myTurn);
    case 'expand': {
      need(s.phase === 'card' && myTurn && c && c.kind === 'expand', 'Сейчас нечего расширять');
      const o = c.opts.find(x => x.id === a.id); need(o && !c.done.includes(a.id), 'Этот бизнес уже расширен');
      const as = p.assets.find(x => x.id === a.id); need(as, 'Бизнеса уже нет');
      need(p.cash >= o.cost, 'Не хватает денег');
      p.cash -= o.cost; as.flow += o.add; as.down += o.cost; c.done.push(a.id);
      say(s, pid, `📐 Расширил(а) ${as.n}: поток +${money(o.add)}`);
      return;
    }
    case 'media': {
      need(s.phase === 'card' && myTurn && c && c.kind === 'media' && !c.used, 'Нет медиакампании');
      need(s.prices[a.tk], 'Нет такой компании');
      c.used = true;
      const n = { id: ++s.uid, t: a.up ? `Телеканалы взахлёб хвалят ${a.tk}` : `Громкое расследование против ${a.tk} в прайм-тайм`, rum: false, tick: s.tick, status: '', fx: [{ tk: a.tk, m: a.up ? R.pumpEffect : -R.pumpEffect }] };
      s.pend.push({ tk: a.tk, m: a.up ? R.pumpEffect : -R.pumpEffect, real: true, nid: n.id, i: 0 });
      s.news.push(n); if (s.news.length > 20) s.news.shift();
      log(s, { k: 'news', text: n.t, rum: false });
      toast(ev, pid, `📺 Сюжет вышел: ${a.tk} сдвинется на ${Math.round(R.pumpEffect * 100)}% за два броска`);
      return finishCard(s, p, ev);
    }
    case 'pass':
    case 'ok':
      need(s.phase === 'card' && myTurn && c, 'Нет активной карточки');
      if (c.kind === 'deal' && c.auction && !c.auction.done) { auctionToBot(s, c); return finishCard(s, p, ev); }
      if (c.kind === 'deal' && a.type === 'pass') makeOffer(s, p, c);
      if (c.kind === 'raid' && c.inv) loseCompany(s, p, c.inv);
      return finishCard(s, p, ev);
    case 'trade': return doTrade(s, p, a, ev);
    case 'loan': {
      const n = Math.floor(+a.n || 0); need(n > 0 && n % 1000 === 0, 'Кредит выдаётся по $1000');
      need(p.mode !== 'fast', 'В Большой игре кредитов нет');
      need(canBorrow(s, p, n, 'cash'), 'Банк отказал: поток слишком маленький');
      const rr = rateFor(s, p, 'cash'); borrow(s, p, n, 'cash');
      toast(ev, pid, `Потребкредит ${money(n)} под ${pct(rr)}: −${money(n * rr)}/мес`);
      return;
    }
    case 'repay': {
      const n = Math.floor(+a.n || 0); need(n > 0, 'Укажи сумму');
      need(loanTotal(p) > 0, 'Кредитов нет');
      const nn = Math.min(n, loanTotal(p)); need(p.cash >= nn, 'Не хватает наличных');
      let left = nn;
      const bankBefore = p.loans.filter(l => !l.shady).reduce((x, l) => x + l.amt, 0);
      for (const l of [...p.loans].sort((x, y) => y.rate - x.rate)) { const x = Math.min(left, l.amt); l.amt -= x; left -= x; if (!left) break; }
      p.cash -= nn - left; p.loans = p.loans.filter(l => l.amt > 0);
      const bankAfter = p.loans.filter(l => !l.shady).reduce((x, l) => x + l.amt, 0);
      if (bankBefore > bankAfter) { const k = bankAfter / bankBefore; p.assets.forEach(a => { if (a.loan) a.loan = Math.round(a.loan * k); }); }
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
function processDue(s, p, ev) {
  for (const l of p.loans.filter(x => x.kind === 'short' && p.turns >= x.due)) {
    if (p.cash >= l.amt) { p.cash -= l.amt; toast(ev, p.id, `Короткий кредит ${money(l.amt)} закрыт`); l.amt = 0; continue; }
    if (!phase(s).tight || loadPremium(s, p) === 0) {
      l.amt = Math.round(l.amt * (1 + R.refiFee)); l.rate = rateFor(s, p, 'short'); l.due = p.turns + R.shortTerm;
      toast(ev, p.id, `Срок кредита: перекредитовался, ${money(l.amt)} под ${pct(l.rate)}`); continue;
    }
    const amt = l.amt; l.amt = 0; p.loans = p.loans.filter(x => x.amt > 0);
    toast(ev, p.id, `Кризис: банк отказал в перекредитовании, верни ${money(amt)}`);
    sys(s, `🏦 ${p.name}: банк потребовал вернуть короткий кредит ${money(amt)}`);
    if (!pay(s, p, amt, ev)) return false;
  }
  p.loans = p.loans.filter(x => x.amt > 0);
  return true;
}
function doRoll(s, p, ev) {
  marketTick(s);
  p.turns++;
  if (!processDue(s, p, ev)) return afterBankrupt(s, p);
  if (p.skip > 0) {
    p.skip--; toast(ev, p.id, 'Пропуск хода: ищешь новую работу');
    ev.push({ t: 'skip', pid: p.id });
    return endTurn(s, p, ev);
  }
  const two = p.charity > 0; if (two) p.charity--;
  const dice = two ? [ri(s, 1, 6), ri(s, 1, 6)] : [ri(s, 1, 6)];
  const n = dice.reduce((x, y) => x + y, 0);
  ev.push({ t: 'roll', pid: p.id, dice, from: p.pos, steps: n, mode: p.mode });
  const cells = p.mode === 'fast' ? D.FCELLS : p.mode === 'mid' ? D.MCELLS : D.CELLS;
  for (let i = 0; i < n; i++) {
    p.pos = (p.pos + 1) % cells.length;
    if (cells[p.pos] === 'pay' || cells[p.pos] === 'mpay') { if (!payday(s, p, ev)) return afterBankrupt(s, p); }
    if (cells[p.pos] === 'fpay') p.cash += p.fflow;
  }
  return p.mode === 'fast' ? resolveFast(s, p, ev) : p.mode === 'mid' ? resolveMid(s, p, ev) : resolve(s, p, ev);
}

function payday(s, p, ev) {
  const f = cashflow(s, p);
  if (f >= 0) p.cash += f; else if (!pay(s, p, -f, ev)) return false;
  for (const a of p.assets.filter(x => x.risk)) {
    if (rnd(s) < a.risk * R.riskK * diff(s).risk * (has(p, 'risk') ? 0.5 : 1) * (sectorsCount(p) >= R.diversifySectors ? R.diversifyRisk : 1)) {
      p.assets = p.assets.filter(x => x !== a);
      sys(s, `💥 У игрока ${p.name}: ${a.e} ${a.n} прогорел(а), −${money(a.flow)}/мес`);
      toast(ev, p.id, `💥 ${a.n} прогорел(а)!`);
    }
  }
  if (rnd(s) < diff(s).surprise) {
    const x = pick(s, D.SURPRISE), cost = thrift(p, Math.round(scaleCost(s, p, x[2]) * (has(p, 'risk') ? 0.5 : 1) / 50) * 50);
    toast(ev, p.id, `${x[0]} Внезапно: ${x[1]} −${money(cost)}`);
    if (!p.bot) sys(s, `${x[0]} Внезапная трата: ${x[1]} (${money(cost)})`);
    if (!pay(s, p, cost, ev)) return false;
  }
  return true;
}

function resolve(s, p, ev) {
  const t = D.CELLS[p.pos];
  if (t === 'gamble') {
    const g = pick(s, D.GAMBLES), sc = dealScale(p) / 0.88; // у учителя ровно 10–20 тысяч, у остальных пропорционально
    s.card = { kind: 'gamble', g, stake: Math.round(g.stake * sc / 100) * 100, scale: sc, tier: 'rat', result: null };
    s.phase = 'card'; return;
  }
  switch (t) {
    case 'pay': toast(ev, p.id, `💼 Зарплата: ${money(cashflow(s, p))}`); return endTurn(s, p, ev);
    case 'small': case 'big': {
      const base = pick(s, t === 'small' ? D.SMALL : D.BIG);
      if (base.t === 'stock') {
        const tk = base.tk || pick(s, Object.keys(D.TICK)), pr = s.prices[tk].p * R.brokerDiscount;
        s.card = { kind: 'stock', tk, price: D.TICK[tk].crypto ? Math.max(R.cryptoMin, Math.round(pr * 1e6) / 1e6) : Math.max(0.01, Math.round(pr * 100) / 100) };
      } else {
        s.card = { kind: 'deal', deal: scaleDeal(s, p, base), big: t === 'big' };
        if (t === 'big') setupAuction(s, p, s.card);
      }
      break;
    }
    case 'market': return resolveMarket(s, p, ev);
    case 'tempt': {
      const x = pick(s, D.TEMPT), cost = thrift(p, scaleCost(s, p, x.cost));
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
      const nf = perk(p, 'nofire'), paid = nf ? Math.round(expenses(s, p) / 2) : expenses(s, p);
      if (!pay(s, p, paid, ev)) return afterBankrupt(s, p);
      p.skip = nf ? 0 : 2;
      if (p.bot) say(s, p.id, 'Уволили, пропускаю два хода 😩');
      s.card = { kind: 'down', paid, nofire: nf };
      break;
    }
    case 'charity': s.card = { kind: 'charity', cost: Math.round(p.salary * R.charityShare) }; break;
    case 'sbiz': {
      const base = pick(s, D.SBIZ);
      s.card = { kind: 'deal', deal: scaleDeal(s, p, base), big: false, tier: 'sbiz' };
      break;
    }
    case 'gig': {
      const amt = r10(p.salary * (R.gigShare[0] + rnd(s) * (R.gigShare[1] - R.gigShare[0])) * (perk(p, 'gig2') ? 2 : 1));
      p.cash += amt;
      s.card = { kind: 'gig', amt };
      break;
    }
    case 'course':
      s.card = { kind: 'course', cost: r100(p.salary * R.courseCost), raise: Math.max(10, r10(p.salary * R.courseRaise)) };
      break;
  }
  s.phase = 'card';
}

function resolveMid(s, p, ev) {
  const t = D.MCELLS[p.pos], m = midF(s, p);
  switch (t) {
    case 'mpay': toast(ev, p.id, `💼 Прибыль: ${money(cashflow(s, p))}`); return endTurn(s, p, ev);
    case 'mbiz': {
      const b = pick(s, D.MBIZ);
      const down = r1000(b.downF * m * phase(s).priceK * (0.9 + rnd(s) * 0.2));
      const deal = Object.assign({}, b, { t: 'biz', cat: 'mbiz', price: r1000(down * 2.5), down: nego(p, down), nego: has(p, 'negotiation'), flow: Math.max(10, r100(b.flowF * m * midYield(p) * diff(s).flow * yieldK(s))) });
      s.card = { kind: 'deal', deal, big: false, tier: 'mid' };
      setupAuction(s, p, s.card);
      break;
    }
    case 'mevent': return resolveMevent(s, p, ev, m);
    case 'gamble': {
      const g = pick(s, D.MGAMBLES);
      s.card = { kind: 'gamble', g, stake: r1000(g.stakeF * m), scale: m, tier: 'mid', result: null };
      break;
    }
    case 'lux': {
      const x = pick(s, D.LUX), cost = thrift(p, r100(x.costF * m * diff(s).tempt));
      if (!pay(s, p, cost, ev)) return afterBankrupt(s, p);
      if (p.bot && rnd(s) < 0.5) say(s, p.id, `Не удержался(ась): ${x.n} 💸 −${money(cost)}`);
      s.card = { kind: 'tempt', t: x, cost, lux: true };
      break;
    }
    case 'charity': s.card = { kind: 'charity', cost: Math.round(p.salary * R.charityShare) }; break;
    case 'child': {
      const added = p.children < R.maxChildren; if (added) p.children++;
      if (added) sys(s, `👶 У игрока ${p.name} родился ребёнок`);
      s.card = { kind: 'child', added };
      break;
    }
    case 'expand': {
      const opts = p.assets.filter(a => a.cat === 'mbiz').map(a => ({ id: a.id, cost: r100(a.down * R.expandCost), add: r10(a.flow * R.expandFlow) }));
      s.card = { kind: 'expand', opts, done: [] };
      break;
    }
  }
  s.phase = 'card';
}

function resolveMevent(s, p, ev, m) {
  const e = pick(s, D.MEVENTS), biz = p.assets.filter(a => a.cat === 'mbiz');
  const card = { kind: 'mevent', ev: e, note: '', cls: '', sold: [] };
  const none = 'У тебя пока нет средних бизнесов, тебя это не касается.';
  if (e.k === 'sector') {
    let mine = 0;
    for (const q of s.players.filter(q => !q.bankrupt && q.mode !== 'fast')) {
      const l = q.assets.filter(a => a.t !== 'stock' && secOf(a) === e.sec); l.forEach(a => { a.flow = Math.max(0, r10(a.flow * (1 + e.pct))); });
      if (q === p) mine = l.length;
    }
    card.note = mine ? `Задело твоих бизнесов: ${mine}` : 'Тебя это не касается'; card.cls = mine ? (e.pct > 0 ? 'g' : 'r') : '';
  } else if (!biz.length && e.k !== 'buyer') card.note = none;
  else if (e.k === 'payEach' || e.k === 'theft') {
    const amt = r100(e.amountF * m) * (e.k === 'payEach' ? biz.length : 1);
    card.note = `Оплачено ${money(amt)}`; card.cls = 'r';
    if (!pay(s, p, amt, ev)) return afterBankrupt(s, p);
  } else if (e.k === 'grant') {
    const amt = r100(e.amountF * m); p.cash += amt; card.note = `Получено ${money(amt)}`; card.cls = 'g';
  } else if (e.k === 'boost' || e.k === 'hit') {
    const a = pick(s, biz), old = a.flow; a.flow = Math.max(0, r10(a.flow * (1 + e.pct)));
    card.note = `${a.e} ${a.n}: поток ${money(old)} → ${money(a.flow)}`; card.cls = e.pct > 0 ? 'g' : 'r';
  } else if (e.k === 'buyer') {
    card.sellable = biz.map(a => a.id); card.mult = e.mult;
    card.note = biz.length ? 'Продажа даёт кэш, но пассивный доход уменьшится.' : none;
  } else if (e.k === 'fire') {
    const a = pick(s, biz), back = Math.round(a.down * 0.5);
    p.assets = p.assets.filter(x => x !== a); p.cash += back;
    card.note = `${a.e} ${a.n} сгорел(а). Страховка: +${money(back)}, поток −${money(a.flow)}/мес`; card.cls = 'r';
    sys(s, `🧯 У игрока ${p.name} сгорел бизнес: ${a.n}`);
  }
  s.card = card; s.phase = 'card';
}

function doGamble(s, p, c, ev) {
  need(p.cash >= c.stake, 'Не хватает денег на вход');
  p.cash -= c.stake;
  const raw = ri(s, 1, 6), die = Math.min(6, raw + (has(p, 'critical') ? 1 : 0));
  const o = c.g.out[die - 1], k = c.tier === 'mid' ? 1 : 1000; // малый круг: тысячи $, средний: месячные потоки
  const res = { die, raw, o, prize: 0, lost: 0, debt: 0 };
  if (o === 'win') st(p).gw = (st(p).gw || 0) + 1;
  if (o === 'win') { res.prize = Math.round(ri(s, c.g.win[0], c.g.win[1]) * k * c.scale / 500) * 500; p.cash += c.stake + res.prize; }
  else if (o === 'even') p.cash += c.stake;
  else if (o === 'zero' || o === 'debt') { res.lost = p.cash + c.stake; p.cash = 0; }
  if (o === 'debt') {
    res.debt = Math.round(ri(s, c.g.debt[0], c.g.debt[1]) * k * c.scale / 500) * 500;
    p.loans.push({ amt: res.debt, rate: R.shadyRate, shady: true }); st(p).shady = true;
  }
  c.result = res;
  const line = { win: `🎲 Темка «${c.g.n}» зашла: +${money(res.prize)} 🤑`, even: `🎲 Темка «${c.g.n}»: вышел(а) в ноль`, lose: `🎲 Темка «${c.g.n}» не зашла: −${money(c.stake)}`,
    zero: `🎲 Темка «${c.g.n}» провалилась: ${p.name} потерял(а) все наличные 💀`, debt: `🎲 Темка «${c.g.n}» провалилась: ${p.name} без денег и с долгом коллекторам ${money(res.debt)} 😱` }[o];
  if (o === 'win' || o === 'even' || o === 'lose') say(s, p.id, line); else sys(s, line);
}

function resolveMarket(s, p, ev) {
  const e = pick(s, D.MARKET);
  const card = { kind: 'market', ev: e, sold: [], note: '', cls: '' };
  sys(s, `📈 Рынок: ${e.n}`);
  const rats = s.players.filter(q => !q.bankrupt && q.mode !== 'fast');
  if (e.k === 'sell') {
    const l = p.assets.filter(a => a.cat === e.cat);
    card.sellable = l.map(a => a.id); card.mult = e.mult;
    card.note = l.length ? 'Продажа даёт кэш на крупную сделку, но пассивный доход уменьшится.' : 'У тебя нет подходящих активов. Сейчас на этом зарабатывают другие.';
  } else if (e.k === 'pay') {
    for (const q of rats) {
      const n = q.assets.filter(a => a.cat === e.cat).length;
      const amt = r100(e.amount * dealScale(q)) * n;
      if (q === p) { card.note = n ? `У тебя ${n} шт. Оплачено ${money(amt)}` : 'Тебя это не касается'; card.cls = n ? 'r' : ''; }
      if (n && !pay(s, q, amt, ev)) { if (q === p) return afterBankrupt(s, p); }
      if (s.phase === 'over') return;
    }
  } else if (e.k === 'sector') {
    for (const q of rats) {
      const l = q.assets.filter(a => a.t !== 'stock' && secOf(a) === e.sec);
      l.forEach(a => { a.flow = Math.max(0, r10(a.flow * (1 + e.pct))); });
      if (q === p) { card.note = l.length ? `Задело твоих бизнесов: ${l.length}` : 'Тебя это не касается'; card.cls = l.length ? (e.pct > 0 ? 'g' : 'r') : ''; }
    }
  } else if (e.k === 'flow') {
    for (const q of rats) {
      const l = q.assets.filter(a => a.cat === e.cat);
      l.forEach(a => { a.flow = Math.max(0, a.flow + r10(e.delta * dealScale(q))); });
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
    if (p.finv.length) {
      lost = pick(s, p.finv); p.finv = p.finv.filter(x => x !== lost); p.fflow -= lost.flow;
      if (lost.tk && s.prices[lost.tk].owner === p.id) s.prices[lost.tk].owner = null;
      sys(s, `🌪 Кризис: у игрока ${p.name} разорился ${lost.n}`);
    }
    s.card = { kind: 'crisis', lost };
  } else if (t === 'sanctions') {
    let cut = 0; p.finv.forEach(x => { const d = Math.round(x.flow * R.sanctionsCut / 100) * 100; x.flow -= d; cut += d; }); p.fflow -= cut;
    const fine = Math.round(p.cash * R.sanctionsFine); p.cash -= fine;
    s.card = { kind: 'hit', key: 'sanctions', note: `Поток −${money(cut)}, штраф −${money(fine)}` };
  } else if (t === 'crash') {
    for (const tk in D.TICK) if (!D.TICK[tk].crypto) s.pend.push({ tk, m: R.crashDrop, real: true, nid: -1, i: 0 });
    const loss = Math.round(p.cash * R.crashCash); p.cash -= loss;
    sys(s, `📉 Обвал рынка! Акции падают`);
    s.card = { kind: 'hit', key: 'crash', note: `Наличные −${money(loss)}, акции −35% за 2 броска` };
  } else if (t === 'ipo') {
    const cand = p.finv.filter(x => !x.tk);
    if (cand.length) { const x = pick(s, cand), amt = r1000(x.flow * R.ipoMult); p.cash += amt; s.card = { kind: 'ipo', inv: x, amt }; say(s, p.id, `🔔 ${x.n} вышел(а) на IPO: +${money(amt)}`); }
    else s.card = { kind: 'ipo', inv: null, amt: 0 };
  } else if (t === 'media') {
    s.card = { kind: 'media' };
  } else if (t === 'raid') {
    const own = p.finv.filter(x => x.tk);
    if (own.length) { const x = pick(s, own); s.card = { kind: 'raid', inv: x, cost: r1000(x.flow * R.raidDefense) }; }
    else s.card = { kind: 'raid', inv: null };
  } else if (t === 'acq') {
    const free = Object.keys(D.TICK).filter(tk => s.prices[tk].owner == null && !D.TICK[tk].crypto);
    if (!free.length) { toast(ev, p.id, 'Все компании уже кем-то куплены'); return endTurn(s, p, ev); }
    const tk = pick(s, free);
    s.card = { kind: 'acq', tk, cost: takeoverCost(s, tk, R.acqDiscount), flow: takeoverFlow(s, tk) };
  }
  s.phase = 'card';
}

function doBuy(s, p, a, ev) {
  const c = s.card;
  if (c.kind === 'deal') {
    need(!c.auction || c.auction.done, 'Сначала торги');
    const d = c.deal, L = Math.max(0, Math.floor(+a.loan || 0)), lk = a.lkind === 'short' ? 'short' : 'deal';
    need(L % 1000 === 0, 'Кредит выдаётся по $1000');
    if (L) need(canBorrow(s, p, L, lk), 'Банк отказал: поток слишком маленький');
    need(p.cash + L >= d.down, 'Не хватает денег');
    const rate = rateFor(s, p, lk), payL = Math.round(L * rate);
    if (L) borrow(s, p, L, lk);
    p.cash -= d.down;
    p.assets.push(Object.assign({}, d, { id: ++s.uid }, L ? { loan: L, loanRate: rate } : {}));
    say(s, p.id, `Купил(а) <b>${d.n}</b>${L ? ` в ${lk === 'short' ? 'короткий ' : ''}кредит ${money(L)}` : ''} +${money(d.flow)}/мес`);
    if (L && payL > d.flow) toast(ev, p.id, `⚠️ ${d.n}: платёж банку ${money(payL)} больше дохода ${money(d.flow)}. Бизнес в минусе на ${money(payL - d.flow)}/мес из-за кредита`);
    else toast(ev, p.id, `${d.e} Куплено! Поток +${money(d.flow)}${L ? `, платёж по кредиту ${money(payL)} → чистыми ${money(d.flow - payL)}` : ''}`);
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
  if (c.kind === 'course') {
    need(p.cash >= c.cost, 'Не хватает денег на курсы');
    p.cash -= c.cost; p.salary += c.raise;
    say(s, p.id, `🎓 Прошёл(а) курсы: зарплата +${money(c.raise)}`);
    return finishCard(s, p, ev);
  }
  if (c.kind === 'raid' && c.inv) {
    need(p.cash >= c.cost, 'Не хватает денег на защиту');
    p.cash -= c.cost; say(s, p.id, `🥷 Отбился(ась) от рейдеров за ${money(c.cost)}`);
    return finishCard(s, p, ev);
  }
  if (c.kind === 'acq') {
    doTakeover(s, p, c.tk, c.cost, c.flow);
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
  const qty = Math.floor(+a.qty || 0); need(qty > 0, 'Укажи количество');
  const total = qty * q.p, f = feeFor(a.tk, total);
  const own = p.assets.find(x => x.tk === a.tk);
  if (a.side === 'buy') {
    need(total + f <= p.cash, 'Не хватает денег');
    p.cash -= total + f; addShares(s, p, a.tk, qty, q.p);
    say(s, p.id, `Купил(а) ${qty} ${a.tk} по ${fmtP(q.p)}`);
  } else {
    need(own && own.shares >= qty, 'Столько акций нет');
    p.cash += total - f; own.shares -= qty;
    const pl = (q.p - own.buy) * qty;
    if (pl > 0) st(p).sp = (st(p).sp || 0) + pl;
    if (D.TICK[a.tk].crypto && own.buy > 0 && q.p / own.buy >= 10) st(p).hmk = true;
    if (!own.shares) p.assets = p.assets.filter(x => x !== own);
    say(s, p.id, `Продал(а) ${qty} ${a.tk} по ${fmtP(q.p)} (${pl >= 0 ? '+' : ''}${money(pl)})`);
  }
}
function doTakeover(s, p, tk, cost, flow) {
  const q = s.prices[tk];
  need(q.owner == null, `${tk} уже принадлежит игроку ${q.owner != null ? s.players[q.owner].name : ''}`);
  need(p.cash >= cost, 'Не хватает денег на контрольный пакет');
  p.cash -= cost; q.owner = p.id; p.fflow += flow;
  st(p).co = Math.max(st(p).co || 0, Object.values(s.prices).filter(x => x.owner === p.id).length);
  p.finv.push({ e: D.TICK[tk].e, n: `Контроль над ${tk}`, flow, tk });
  s.pend.push({ tk, m: 0.1, real: true, nid: -1, i: 0 });
  say(s, p.id, `🏢 Выкупил(а) контрольный пакет <b>${tk}</b> за ${money(cost)}. Поток +${money(flow)}`);
  sys(s, `🏢 ${p.name} теперь владеет ${tk}`);
}
function loseCompany(s, p, x) {
  p.finv = p.finv.filter(y => y.tk !== x.tk); p.fflow -= x.flow; // карточка хранит копию, сравниваем по тикеру
  if (s.prices[x.tk] && s.prices[x.tk].owner === p.id) s.prices[x.tk].owner = null;
  sys(s, `🥷 Рейдеры отобрали у игрока ${p.name} контроль над ${x.tk}. Поток −${money(x.flow)}`);
}
function doInfluence(s, p, a, ev, myTurn) {
  const up = a.type === 'pump', q = s.prices[a.tk];
  need(q, 'Нет такой компании');
  need(p.mode === 'fast', 'Влиять на рынок можно только в Большой игре');
  need(s.phase === 'roll' && myTurn, 'Кампанию можно запустить в свой ход до броска');
  need(p.infTick !== s.tick, 'Одна кампания за ход');
  const cost = influenceCost(s, p, a.tk);
  need(p.cash >= cost, 'Не хватает денег на кампанию');
  p.cash -= cost; p.infTick = s.tick;
  if (rnd(s) < R.pumpCatch) {
    const fine = Math.min(p.cash, cost * R.pumpFine); p.cash -= fine;
    st(p).fas = true;
    sys(s, `⚖️ ФАС поймала ${p.name} на манипуляции акциями ${a.tk}. Штраф ${money(fine)}, кампания сорвана`);
    toast(ev, p.id, `⚖️ ФАС заметила манипуляцию! Штраф ${money(fine)}`);
    return;
  }
  st(p).camp = (st(p).camp || 0) + 1;
  const n = { id: ++s.uid, t: up ? `В чатах пишут, что ${a.tk} ждёт крупный контракт` : `Анонимный канал: у ${a.tk} серьёзные проблемы с отчётностью`, rum: true, tick: s.tick, status: '', manip: p.id,
    fx: [{ tk: a.tk, m: up ? R.pumpEffect : -R.pumpEffect }], hint: rnd(s) < R.analystAccuracy };
  s.pend.push({ tk: a.tk, m: up ? R.pumpEffect : -R.pumpEffect, real: true, nid: n.id, i: 0 });
  s.news.push(n); if (s.news.length > 20) s.news.shift();
  log(s, { k: 'news', text: n.t, rum: true });
  toast(ev, p.id, `${up ? '📣' : '📉'} Кампания запущена: ${a.tk} сдвинется на ${Math.round(R.pumpEffect * 100)}% за два броска`);
}
function addShares(s, p, tk, qty, price) {
  const own = p.assets.find(x => x.tk === tk);
  if (own) { own.buy = (own.buy * own.shares + qty * price) / (own.shares + qty); own.shares += qty; }
  else p.assets.push({ t: 'stock', tk, e: D.TICK[tk].e, n: tk, shares: qty, buy: price, flow: 0, id: ++s.uid });
}

function applyEff(s, p, a, eff, ev) {
  const out = [];
  if (eff.chance) { const [pr, yes, no] = eff.chance; out.push(applyEff(s, p, a, rnd(s) < pr ? yes : no, ev) || 'обошлось'); }
  if (eff.cash || eff.cashF) {
    const v = Math.round(eff.cash ? a.down * eff.cash : a.flow * eff.cashF);
    if (v >= 0) { p.cash += v; out.push(`+${money(v)}`); } else { if (!pay(s, p, -v, ev)) return 'банкротство'; out.push(`−${money(-v)}`); }
  }
  if (eff.flow) { const old = a.flow; a.flow = Math.max(0, r10(a.flow * eff.flow)); out.push(`поток ${money(old)} → ${money(a.flow)}`); }
  if (eff.risk != null) { a.risk = eff.risk === 0 ? 0 : Math.min(0.9, (a.risk || 0.15) * eff.risk); out.push(eff.risk < 1 ? 'риск ниже' : 'риск выше'); }
  if (eff.sell) { const v = Math.round(a.down * eff.sell); p.cash += v; p.assets = p.assets.filter(x => x.id !== a.id); out.push(`продано за ${money(v)}`); }
  return out.join(', ');
}
function effEV(a, e) {
  let v = 0;
  if (e.chance) v += e.chance[0] * effEV(a, e.chance[1]) + (1 - e.chance[0]) * effEV(a, e.chance[2]);
  if (e.flow) v += (e.flow - 1) * a.flow * 12;
  if (e.cash) v += a.down * e.cash;
  if (e.cashF) v += a.flow * e.cashF;
  if (e.sell) v += a.down * e.sell - a.flow * 15;
  if (e.risk != null) v += ((a.risk || 0.15) - (e.risk === 0 ? 0 : (a.risk || 0.15) * e.risk)) * a.flow * 6;
  return v;
}
// Торги: соперники оценивают сделку по окупаемости относительно типичной
function botValue(s, q, d) {
  const pb = d.down / Math.max(1, d.flow), typical = d.cat === 'mbiz' ? 4 / diff(s).flow : 22 / diff(s).flow;
  const u = Math.min(1.4, Math.max(0.85, typical / pb)) * (0.92 + rnd(s) * 0.2) * (1 - (d.risk || 0) * 0.5);
  return r100(d.down * u);
}
function setupAuction(s, p, card) {
  if (p.bot) return;
  const d = card.deal, bids = [];
  for (const q of s.players) {
    if (q.id === p.id || q.bankrupt || !q.bot || q.mode !== p.mode) continue; // торгуются только боты
    const max = botValue(s, q, d), cap = Math.min(maxLoan(s, q), q.cash * 4 + 1);
    if (max >= d.down && q.cash + cap >= max) bids.push({ pid: q.id, max });
  }
  if (bids.length) card.auction = { price: d.down, leader: null, bids, log: [], done: false };
}
function auctionToBot(s, c) {
  const au = c.auction, win = au.leader != null && s.players[au.leader].bot ? au.bids.find(b => b.pid === au.leader) : au.bids.slice().sort((x, y) => y.max - x.max)[0];
  if (!win) return;
  const q = s.players[win.pid], price = au.leader === win.pid ? au.price : c.deal.down;
  if (q.cash < price) { const L = Math.ceil((price - q.cash) / 1000) * 1000; if (!canBorrow(s, q, L)) return; borrow(s, q, L, 'deal'); }
  q.cash -= price; q.assets.push(Object.assign({}, c.deal, { down: price, id: ++s.uid }));
  say(s, q.id, `Забрал(а) на торгах <b>${c.deal.n}</b> за ${money(price)}`);
}
function makeOffer(s, p, c) {
  const id = ++s.uid;
  s.offers.push({ id, deal: c.deal, big: c.big, mode: p.mode, from: p.id, tick: s.tick });
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
  if (p.mode !== 'fast' && !p.bankrupt) {
    if (diff(s).infl && p.turns > 0 && p.turns % R.inflEvery === 0) {
      const o = p.exp.find(e => e[0] === 'Прочие расходы');
      const add = Math.max(10, r10(p.exp.reduce((x, e) => x + e[1], 0) * 0.35 * diff(s).infl)); o[1] += add; // инфляция — от всех расходов
      toast(ev, p.id, `🎈 Инфляция: расходы +${money(add)}/мес`);
      if (!p.bot) sys(s, `🎈 Инфляция: прочие расходы +${money(add)}/мес`);
    }
    const ratGoal = p.mode === 'rat' && passive(s, p) >= expenses(s, p), midGoal = p.mode === 'mid' && cashflow(s, p) >= R.fastFlow;
    if ((ratGoal || midGoal) && !debtFree(p)) toast(ev, p.id, `🔒 Цель есть, но сначала закрой долги: ${money(loanTotal(p))}`);
    else if (ratGoal) enterMid(s, p, ev);
    else if (midGoal) {
      s.phase = 'exit'; s.exitPid = p.id;
      sys(s, `🏁 ${p.name} прошёл(а) средний круг за ${p.turns} ходов!`);
      return;
    }
  }
  if (p.mode === 'fast' && p.fflow >= fTarget(p)) return win(s, p, 'flow');
  advance(s);
}

function nextPhase(s) {
  const c = s.cycle, alive = s.players.filter(q => !q.bankrupt).length || 1;
  c.i = (c.i + 1) % D.CYCLE.length; const ph = D.CYCLE[c.i];
  c.left = ri(s, ph.len[0], ph.len[1]) * alive; c.est = Math.round(c.left / alive) + ri(s, -2, 2); c.start = s.tick;
  const txt = { growth: 'Экономика растёт: спрос и прибыли вверх', peak: 'Рынки на пике: аналитики говорят о перегреве', crisis: 'Кризис: компании режут расходы, банки ужесточают кредиты', recovery: 'Экономика восстанавливается после кризиса' }[ph.id];
  const n = { id: ++s.uid, t: txt, rum: false, tick: s.tick, status: '', fx: [] };
  for (const tk in D.TICK) if (!D.TICK[tk].crypto) { s.pend.push({ tk, m: ph.stock, real: true, nid: n.id, i: 0 }); n.fx.push({ tk, m: ph.stock }); }
  s.news.push(n); if (s.news.length > 20) s.news.shift();
  sys(s, `📊 Новая фаза экономики: ${ph.n}`); log(s, { k: 'news', text: txt, rum: false });
}
function advance(s) {
  s.tick++;
  if (s.cycle && --s.cycle.left <= 0) nextPhase(s);
  if (rnd(s) < R.newsChance) genNews(s);
  s.offers = s.offers.filter(o => s.tick - o.tick <= R.offerTTL);
  const n = s.players.length;
  s.card = null; s.exitPid = null;
  if (s.players.every(q => q.bankrupt)) { s.phase = 'over'; s.result = { type: 'allBankrupt' }; return; }
  for (let k = 1; k <= n; k++) { const j = (s.cur + k) % n; if (!s.players[j].bankrupt) { s.cur = j; break; } }
  s.phase = 'roll';
}

function enterMid(s, p, ev) {
  st(p).midNoLoan = !st(p).loan;
  p.mode = 'mid'; p.mstart = cashflow(s, p); p.midAt = p.turns; p.pos = 0; p.skip = 0; p.charity = 0;
  sys(s, `🏁 ${p.name} вышел(а) из колеса за ${p.turns} ходов → ◆ Средний круг`);
  if (p.bot) say(s, p.id, 'Вырвался(ась) из колеса! Теперь средний бизнес 💼');
  ev.push({ t: 'stage', pid: p.id, stage: 'mid' });
}
function enterFast(s, p, i, ev) {
  const U = Math.max(1000, passive(s, p) * R.fastMult);
  p.mode = 'fast'; p.fstart = U; p.fflow = U; p.dream = i; p.dreamCost = r1000(U * D.DREAMS[i].m);
  p.cash += U; p.pos = 0; p.skip = 0; p.charity = 0; p.finv = []; p.fastAt = p.turns;
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
function borrow(s, p, n, kind) {
  kind = kind || 'deal';
  const rate = rateFor(s, p, kind);
  if (kind === 'short') { p.loans.push({ amt: n, rate, kind, due: p.turns + R.shortTerm }); p.cash += n; st(p).loan = true; return; }
  const l = p.loans.find(x => x.rate === rate && x.kind === kind && !x.shady);
  if (l) l.amt += n; else p.loans.push({ amt: n, rate, kind });
  st(p).loan = true;
  p.cash += n;
}
function pay(s, p, n, ev) {
  if (p.cash >= n) { p.cash -= n; return true; }
  const needL = Math.ceil((n - p.cash) / 1000) * 1000;
  if (canBorrow(s, p, needL)) {
    const rr = rateFor(s, p); borrow(s, p, needL); p.cash -= n;
    toast(ev, p.id, `Не хватило денег: банк выдал кредит ${money(needL)} под ${pct(rr)}`);
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
  // партия заканчивается, когда не осталось живых людей; в онлайне выбывший смотрит дальше
  if (!p.bot && !s.players.some(q => !q.bot && !q.bankrupt)) { s.phase = 'over'; s.card = null; s.result = { type: 'bankrupt', pid: p.id }; }
}
function afterBankrupt(s, p) {
  if (s.phase === 'over') return;
  s.card = null;
  if (s.cur === p.id) advance(s);
}

/* ---------- биржа и новости ---------- */
function marketTick(s) {
  for (const tk in D.TICK) {
    const T = D.TICK[tk], q = s.prices[tk]; q.prev = q.p;
    if (q.fv == null) q.fv = T.p;
    if (T.crypto) q.p *= Math.exp(T.drift + T.vol * gauss(s)); // случайное блуждание с отрицательным дрейфом
    else {
      q.fv *= 1 + R.fvGrowth;
      q.p *= 1 + (rnd(s) * 2 - 1) * T.vol;
      q.p += (q.fv - q.p) * R.reversion;
    }
  }
  for (const e of s.pend) {
    const T = D.TICK[e.tk], q = s.prices[e.tk], k = e.real ? e.m : R.fakeEffect * e.m, step = R.newsSteps[e.i];
    q.p *= Math.max(0.05, 1 + k * step);
    if (e.real && !T.crypto) q.fv *= Math.max(0.3, 1 + e.m * step * R.fvNewsShare);
    if (e.i === 0 && e.div && e.real) q.div = Math.min(Math.round(q.div * e.div * 100) / 100, Math.round(q.fv * R.divCap * 100) / 100);
    e.i++;
    if (e.i >= R.newsSteps.length) {
      const n = s.news.find(x => x.id === e.nid);
      if (n) n.status = n.rum ? (e.real ? '✅ подтвердилось' : '❌ оказалось фейком') : '✔ отыграно рынком';
    }
  }
  s.pend = s.pend.filter(e => e.i < R.newsSteps.length);
  for (const tk in D.TICK) {
    const T = D.TICK[tk], q = s.prices[tk];
    if (T.crypto) q.p = Math.max(R.cryptoMin, Math.round(q.p * 1e6) / 1e6);
    else q.p = Math.round(Math.min(q.fv * R.stockCeil, Math.max(q.fv * R.stockFloor, q.p)) * 100) / 100;
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
  } else if (tpl.macro === 'bear') { for (const tk in D.TICK) if (!D.TICK[tk].crypto) eff.push({ tk, m: -0.15 }); }
  else if (tpl.macro === 'bull') { for (const tk in D.TICK) if (!D.TICK[tk].crypto) eff.push({ tk, m: 0.1 }); }
  else if (tpl.fx) tpl.fx.forEach(f => eff.push({ tk: f.tk, m: f.m }));
  else eff.push({ tk: tpl.tk, m: tpl.m, div: tpl.div });
  eff.forEach(e => s.pend.push(Object.assign({}, e, { real, nid: n.id, i: 0 })));
  n.fx = eff.map(e => ({ tk: e.tk, m: e.m, div: e.div }));
  if (n.rum) n.hint = (rnd(s) < R.analystAccuracy) === real; // мнение аналитика: правда ли слух
  s.news.push(n); if (s.news.length > 20) s.news.shift();
  log(s, { k: 'news', text: n.t, rum: n.rum });
  const bots = s.players.filter(q => q.bot && !q.bankrupt);
  if (bots.length && rnd(s) < 0.4) {
    const b = pick(s, bots), tk = tpl.tk || (tpl.fx && tpl.fx[0].tk) || 'ОКТО', pos = (tpl.m || (tpl.fx && tpl.fx[0].m) || (tpl.macro === 'bull' ? 1 : -1)) > 0;
    say(s, b.id, n.rum ? pick(s, ['Это фейк, 100%', 'Верю. Беру на всё 🚀', 'Слух уже в цене, поздно', 'Подожду подтверждения'])
      : pos ? pick(s, [`Закупаюсь ${tk} 🚀`, `Наконец-то хорошие новости по ${tk}`]) : pick(s, [`Сливаю ${tk}, пока не поздно`, `Мои ${tk}... 😭`]));
  }
}

/* ---------- ИИ ботов ----------
 * Бот не меняет состояние сам: он только выбирает действие, которое затем проходит через act(),
 * как действие живого игрока. Логика нарочно простая и честная.
 */
function aiDeal(s, p, d) {
  const atGoal = (p.mode === 'rat' && passive(s, p) >= expenses(s, p)) || (p.mode === 'mid' && cashflow(s, p) >= R.fastFlow);
  if (atGoal) return null; // цель достигнута: не набирать новых кредитов, а гасить долги
  const nearGoal = p.mode === 'rat' && passive(s, p) >= expenses(s, p) * 0.7;
  const reserve = scaleCost(s, p, R.botReserve);
  const eff = d.flow * (1 - (d.risk || 0) * 0.8);
  if (p.cash - d.down >= reserve) return { loan: 0 };
  const L = Math.ceil((d.down - Math.max(0, p.cash - reserve)) / 1000) * 1000;
  const cap = Math.max(1000, cashflow(s, p)) * (p.mode === 'mid' ? 3 : 4); // боты не берут кредит, который не отдать за пару зарплат
  if (L > 0 && !nearGoal && L <= cap && canBorrow(s, p, L) && eff - L * rateFor(s, p, 'deal') > eff * 0.3 && p.cash + L >= d.down) return { loan: L };
  if (p.cash >= d.down && eff > 0) return { loan: 0 };
  return null;
}
function botAction(s) {
  if (s.phase === 'over') return null;
  const pid = actorId(s), p = s.players[pid];
  if (!p || !p.bot) return null;
  return botMove(s, pid, p);
}
// ход за человека, который не отвечает: без покупок и рисков
function afkAction(s) {
  if (s.phase === 'over') return null;
  const pid = actorId(s);
  if (s.phase === 'exit') return { type: 'dream', pid, i: 0 };
  if (s.phase === 'roll') return { type: 'roll', pid };
  if (s.card && s.card.kind === 'dilemma') return { type: 'choose', pid, opt: 'a' };
  if (s.card && s.card.result) return { type: 'ok', pid };
  return { type: 'pass', pid };
}
function botMove(s, pid, p) {
  if (s.phase === 'exit') return { type: 'dream', pid, i: [1, 0, 2][pid % 3] };
  if (s.phase === 'roll') {
    if (p.mode !== 'fast' && p.loans.length) {
      const goal = (p.mode === 'rat' && passive(s, p) >= expenses(s, p) * 0.7) || (p.mode === 'mid' && cashflow(s, p) >= R.fastFlow * 0.7);
      const shady = p.loans.some(l => l.shady || l.kind === 'cash'), spare = p.cash - scaleCost(s, p, R.botReserve);
      if ((goal || shady) && spare >= 1000) return { type: 'repay', pid, n: Math.min(Math.floor(spare / 1000) * 1000, Math.ceil(loanTotal(p) / 1000) * 1000) };
    }
    if (p.mode !== 'fast') for (const sk of ['negotiation', 'risk', 'credit']) if (!has(p, sk) && p.cash > skillCost(s, p, sk) * 4) return { type: 'study', pid, skill: sk };
    if (p.mode !== 'fast') for (const o of s.offers) if (o.from !== pid && (o.mode || 'rat') === p.mode && aiDeal(s, p, o.deal)) return { type: 'takeOffer', pid, id: o.id };
    return { type: 'roll', pid };
  }
  const c = s.card;
  switch (c.kind) {
    case 'deal': {
      const ch = aiDeal(s, p, c.deal);
      const ph = phase(s).id, lk = (ph === 'growth' || ph === 'recovery') && s.cycle.left > s.players.length * 4 ? 'short' : 'deal';
      return ch ? { type: 'buy', pid, loan: ch.loan, lkind: lk } : { type: 'pass', pid };
    }
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
    case 'acq': return p.cash >= c.cost ? { type: 'buy', pid } : { type: 'pass', pid };
    case 'course': return p.cash > c.cost * 2 ? { type: 'buy', pid } : { type: 'pass', pid };
    case 'raid': return c.inv && p.cash >= c.cost ? { type: 'buy', pid } : { type: 'pass', pid };
    case 'expand': {
      const o = c.opts.find(x => !c.done.includes(x.id) && p.cash - x.cost >= scaleCost(s, p, R.botReserve));
      return o ? { type: 'expand', pid, id: o.id } : { type: 'ok', pid };
    }
    case 'gamble': return c.result ? { type: 'ok', pid } : ((p.turns % 5 === 0 && p.cash >= c.stake) ? { type: 'gamble', pid } : { type: 'pass', pid });
    case 'dilemma': {
      const dl = D.DILEMMAS[c.di], as = p.assets.find(x => x.id === c.aid);
      return { type: 'choose', pid, opt: !as || effEV(as, dl.a[1]) >= effEV(as, dl.b[1]) ? 'a' : 'b' };
    }
    case 'mevent': {
      if (c.sellable && c.mult >= 2.5) { const id = c.sellable.find(x => !c.sold.includes(x)); if (id) return { type: 'sell', pid, id }; }
      return { type: 'ok', pid };
    }
    case 'venture': return c.result ? { type: 'ok', pid } : (p.cash >= c.cost * 3 ? { type: 'venture', pid } : { type: 'pass', pid });
    case 'dream': return p.cash >= c.cost ? { type: 'buy', pid } : { type: 'pass', pid };
    default: return { type: 'ok', pid };
  }
}

const KolesoEngine = {
  newGame, act, botAction, afkAction, actorId, D,
  calc: { passive, expenses, cashflow, freedom, progress, fProgress, fTarget, canBorrow, maxLoan, loanTotal, loanPay, divOf, fee, feeFor, scaleCost,
          midF, midProgress, cap, has, rateFor, skillCost, debtFree, loadPremium,
          phase, secOf, cycK, assetIncome, managedIds, slots, sectorsCount, salePrice, isBiz, takeoverCost, takeoverFlow, influenceCost },
  fmt: { money, pct, fmtP },
};
if (typeof module === 'object' && module.exports) module.exports = KolesoEngine;
else root.KolesoEngine = KolesoEngine;
})(this);
