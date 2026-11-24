/*
 * Логика одной комнаты: лобби, ходы, боты, автоход.
 * Не зависит от Cloudflare: тот же код крутится в локальном сервере для тестов (dev.mjs).
 *
 * io = {
 *   send(conn, msg), conns() → [conn], uidOf(conn), setUid(conn, uid),
 *   save(data), setAlarm(ms | null), now()
 * }
 */
import E from '../engine.js';

export const AFK_MS = 60000;      // столько ждём хода человека
export const BOT_MS = 1100;       // пауза между ходами ботов, чтобы все успели увидеть анимацию
const MAX_SEATS = 4;

/* ---------- проверка подписи Telegram ---------- */
const enc = new TextEncoder();
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
}
const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
export async function checkTelegram(initData, botToken, maxAgeSec = 7 * 86400) {
  if (!initData || !botToken) return null;
  const p = new URLSearchParams(initData), hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = await hmac('WebAppData', botToken);
  if (hex(await hmac(secret, dcs)) !== hash) return null;
  const age = Date.now() / 1000 - Number(p.get('auth_date') || 0);
  if (age > maxAgeSec) return null;
  try {
    const u = JSON.parse(p.get('user'));
    return { uid: 'tg' + u.id, name: cleanName(u.first_name) };
  } catch (e) { return null; }
}

// имя попадает в разметку у всех за столом: без угловых скобок и кавычек
export const cleanName = n => String(n || '').replace(/[<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20) || 'Игрок';
export const IDLE_MS = 24 * 3600 * 1000; // пустую комнату без движения удаляем через сутки

/* ---------- комната ---------- */
export class RoomCore {
  constructor(io, data, opts) {
    this.io = io;
    this.afkMs = (opts && opts.afkMs) || AFK_MS;
    this.d = data || null; // { code, host, seats:[{uid,name,bot}], diff, state, afk:{uid:n}, deadline }
  }
  save() {
    if (this.d) { this.d.ts = this.io.now(); if (!this.d.state) this.io.setAlarm(IDLE_MS); } // в лобби — только будильник на уборку
    this.io.save(this.d);
  }
  send(conn, msg) { this.io.send(conn, msg); }
  all(msg) { for (const c of this.io.conns()) if (this.io.uidOf(c)) this.io.send(c, msg); }
  online() { return new Set(this.io.conns().map(c => this.io.uidOf(c)).filter(Boolean)); }
  lobbyMsg() {
    const on = this.online();
    return { t: 'lobby', code: this.d.code, host: this.d.host, diff: this.d.diff, profMode: this.d.profMode || 'random',
      seats: this.d.seats.map(x => ({ uid: x.uid, name: x.name, bot: !!x.bot, online: !!x.bot || on.has(x.uid), prof: x.prof || null })) };
  }
  seatOf(uid) { return this.d.state ? this.d.state.players.findIndex(p => p.uid === uid) : -1; }
  gameMsg(uid, extra) {
    return Object.assign({ t: 'game', state: this.d.state, seat: this.seatOf(uid), host: this.d.host, deadline: this.d.deadline || 0, code: this.d.code }, extra || {});
  }

  /* первое сообщение от клиента: кто он и что хочет */
  hello(conn, who, msg) {
    who = { uid: who.uid, name: cleanName(who.name) };
    msg = Object.assign({}, msg, { dice: E.D.DICE.some(k => k.id === msg.dice) ? msg.dice : 'classic' });
    if (!this.d) {
      if (!msg.create) return this.send(conn, { t: 'fatal', text: 'Комната не найдена. Попроси друга прислать новую ссылку.' });
      this.d = { code: msg.code, host: who.uid, seats: [], diff: D_DIFF(msg.diff), state: null, afk: {}, deadline: 0 };
    }
    this.io.setUid(conn, who.uid);
    const st = this.d.state;
    if (!st) {
      let s = this.d.seats.find(x => x.uid === who.uid);
      if (!s) {
        if (this.d.seats.length >= MAX_SEATS) {
          const bi = this.d.seats.findIndex(x => x.bot); // живой игрок вытесняет бота
          if (bi < 0) { this.io.setUid(conn, null); return this.send(conn, { t: 'fatal', text: 'За столом уже 4 игрока.' }); }
          this.d.seats.splice(bi, 1);
        }
        this.d.seats.push({ uid: who.uid, name: who.name, dice: msg.dice });
      } else { s.name = who.name; s.dice = msg.dice; }
      this.save();
      return this.all(this.lobbyMsg());
    }
    if (this.d.paused) { this.d.paused = false; this.schedule(); this.save(); }
    const seat = this.seatOf(who.uid);
    if (seat >= 0) {
      const p = st.players[seat];
      if (E.D.DICE.some(k => k.id === msg.dice)) p.dice = msg.dice;
      if (p.auto) { p.auto = false; p.bot = false; this.d.afk[who.uid] = 0; this.sys(`${p.name} вернулся(ась) за стол`); this.schedule(); this.save(); this.broadcastGame(); return; }
    }
    this.send(conn, this.gameMsg(who.uid)); // зритель получает seat = -1
  }

  message(conn, m) {
    const uid = this.io.uidOf(conn);
    if (!uid || !this.d) return;
    const isHost = uid === this.d.host, st = this.d.state;
    const err = text => this.send(conn, { t: 'err', text });
    switch (m.t) {
      case 'addBot':
        if (st || !isHost) return;
        if (this.d.seats.length >= MAX_SEATS) return err('Мест нет');
        this.d.seats.push({ uid: 'bot' + Math.random().toString(36).slice(2, 8), name: 'Бот', bot: true });
        this.save(); return this.all(this.lobbyMsg());
      case 'kick': {
        if (st || !isHost) return;
        const x = this.d.seats[m.i];
        if (!x || x.uid === this.d.host) return;
        this.d.seats.splice(m.i, 1);
        if (!x.bot) for (const c of this.io.conns()) if (this.io.uidOf(c) === x.uid) { this.send(c, { t: 'fatal', text: 'Хозяин убрал тебя из комнаты.' }); this.io.setUid(c, null); }
        this.save(); return this.all(this.lobbyMsg());
      }
      case 'diff':
        if (st || !isHost) return;
        this.d.diff = D_DIFF(m.k); this.save(); return this.all(this.lobbyMsg());
      case 'profMode':
        if (st || !isHost) return;
        this.d.profMode = m.k === 'pick' ? 'pick' : 'random'; this.save(); return this.all(this.lobbyMsg());
      case 'prof': {
        if (st) return;
        const x = this.d.seats.find(y => y.uid === uid);
        if (!x || !E.D.PROFS.some(p => p.id === m.id)) return;
        x.prof = m.id; this.save(); return this.all(this.lobbyMsg());
      }
      case 'leave': {
        if (st) return;
        const i = this.d.seats.findIndex(x => x.uid === uid);
        if (i >= 0) this.d.seats.splice(i, 1);
        this.io.setUid(conn, null);
        if (uid === this.d.host) { const h = this.d.seats.find(x => !x.bot); this.d.host = h ? h.uid : null; }
        this.save(); return this.all(this.lobbyMsg());
      }
      case 'start': {
        if (st || !isHost) return;
        if (!this.d.seats.length) return err('Нет игроков');
        this.d.state = E.newGame({ diff: this.d.diff, seed: (Date.now() ^ Math.floor(Math.random() * 1e9)) | 0, seats: this.d.seats.map(x => ({ uid: x.uid, name: x.name, bot: x.bot, dice: x.dice, prof: this.d.profMode === 'pick' && !x.bot ? x.prof : null })) });
        this.d.afk = {};
        this.schedule(); this.save();
        return this.broadcastGame();
      }
      case 'rematch': {
        if (!st || st.phase !== 'over' || !isHost) return;
        this.d.state = null; this.d.deadline = 0; this.io.setAlarm(null);
        // ботов, заменявших ушедших людей, в лобби не берём
        this.save(); return this.all(this.lobbyMsg());
      }
      case 'act': {
        if (!st) return;
        const seat = this.seatOf(uid);
        if (seat < 0) return err('Ты смотришь партию');
        const a = Object.assign({}, m.a, { pid: seat });
        delete a._bot;
        const p = st.players[seat];
        if (p.auto) { p.auto = false; p.bot = false; }
        this.d.afk[uid] = 0;
        return this.apply(a, conn);
      }
    }
  }

  apply(a, conn) {
    const r = E.act(this.d.state, a);
    if (!r.ok) { if (conn) this.send(conn, { t: 'err', text: r.events[0].text }); return false; }
    this.d.state = r.state;
    this.schedule(); this.save();
    this.all({ t: 'step', state: r.state, events: r.events, a: { type: a.type, pid: a.pid }, deadline: this.d.deadline });
    return true;
  }
  sys(text) { const s = this.d.state; s.uid++; s.log.push({ k: 'sys', text, id: s.uid }); if (s.log.length > 80) s.log.shift(); }
  broadcastGame() { for (const c of this.io.conns()) { const u = this.io.uidOf(c); if (u) this.send(c, this.gameMsg(u)); } }

  /* кто ходит следующим и когда разбудить комнату */
  schedule() {
    const s = this.d.state;
    if (!s || s.phase === 'over') { this.d.deadline = 0; return this.io.setAlarm(IDLE_MS); }
    const p = s.players[E.actorId(s)];
    if (p.bot) { this.d.deadline = 0; return this.io.setAlarm(BOT_MS); }
    this.d.deadline = this.io.now() + this.afkMs;
    this.io.setAlarm(this.afkMs);
  }
  // true — комнату можно удалить: давно никого и ничего не происходит
  idle() { return !this.d || (!this.online().size && this.io.now() - (this.d.ts || 0) >= IDLE_MS - 60000); }
  alarm() {
    const s = this.d && this.d.state;
    if (!s || s.phase === 'over' || this.d.paused) return;
    // за столом никого: не крутим партию впустую, ждём, пока кто-нибудь зайдёт
    if (!this.online().size) { this.d.paused = true; this.d.deadline = 0; this.io.setAlarm(IDLE_MS); this.save(); return; }
    const p = s.players[E.actorId(s)];
    if (p.bot) {
      const a = E.botAction(s);
      if (a && this.apply(a)) return;
      for (const t of ['pass', 'ok']) if (this.apply({ type: t, pid: p.id })) return;
      return this.schedule();
    }
    if (this.io.now() < this.d.deadline - 500) return this.io.setAlarm(this.d.deadline - this.io.now());
    // человек молчит: ходим за него осторожно; после двух пропусков подряд включаем автопилот
    const n = (this.d.afk[p.uid] || 0) + 1; this.d.afk[p.uid] = n;
    if (n >= 2 && s.phase === 'roll') { p.bot = true; p.auto = true; this.sys(`${p.name} не отвечает · играет автопилот, пока не вернётся`); }
    const a = E.afkAction(s);
    if (a && this.apply(a)) return;
    for (const t of ['pass', 'ok']) if (this.apply({ type: t, pid: p.id })) return;
    this.schedule();
  }
  closed() { if (this.d && !this.d.state) this.all(this.lobbyMsg()); }
}
const D_DIFF = k => (E.D.DIFF[k] ? k : 'normal');
