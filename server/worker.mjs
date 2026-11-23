/*
 * Сервер «Колеса» на Cloudflare Workers.
 * Каждая комната — отдельный Durable Object: он держит соединения игроков и хранит партию.
 * Адрес комнаты: wss://<сервер>/room/<КОД>
 *
 * Настройки (Cloudflare → Workers → koleso → Settings → Variables):
 *   BOT_TOKEN    — секрет, токен бота из @BotFather (нужен для проверки игроков)
 *   ALLOW_GUESTS — "1", чтобы пускать без Telegram (только для тестов в браузере)
 */
import { DurableObject } from 'cloudflare:workers';
import { RoomCore, checkTelegram } from './room.mjs';
import E from '../engine.js';

const SERVER_VERSION = '0.13.2';

const CODE_RE = /^[A-Z0-9]{4,8}$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]+)$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!CODE_RE.test(code)) return new Response('bad code', { status: 400 });
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }
    if (url.pathname === '/version') return new Response(JSON.stringify({ server: SERVER_VERSION, debug: !!E.D.RULES.debug, dice: E.D.DICE.map(d => d.id) }), { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
    return new Response((env.BOT_TOKEN ? 'Колесо: сервер работает' : 'Колесо: сервер работает, но BOT_TOKEN не задан') + ' · версия ' + SERVER_VERSION, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    const io = {
      send: (ws, msg) => { try { ws.send(JSON.stringify(msg)); } catch (e) { /* соединение уже закрыто */ } },
      conns: () => ctx.getWebSockets(),
      uidOf: ws => (ws.deserializeAttachment() || {}).uid || null,
      setUid: (ws, uid) => ws.serializeAttachment({ uid }),
      save: d => { ctx.storage.put('room', d); },
      setAlarm: ms => { if (ms == null) ctx.storage.deleteAlarm(); else ctx.storage.setAlarm(Date.now() + ms); },
      now: () => Date.now(),
    };
    this.core = new RoomCore(io, null);
    ctx.blockConcurrencyWhile(async () => { this.core.d = (await ctx.storage.get('room')) || null; });
  }
  async fetch(req) {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ uid: null });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketMessage(ws, raw) {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'hello') {
      let who = await checkTelegram(m.initData, this.env.BOT_TOKEN);
      if (!who && this.env.ALLOW_GUESTS === '1' && /^[a-z0-9]{6,20}$/.test(m.guest || '')) who = { uid: 'g' + m.guest, name: String(m.name || 'Гость').slice(0, 20) };
      if (!who) {
        const text = !this.env.BOT_TOKEN ? 'Сервер не настроен: не задан токен бота.' : 'Не получилось проверить Telegram. Открой игру через бота.';
        return ws.send(JSON.stringify({ t: 'fatal', text }));
      }
      return this.core.hello(ws, who, { create: !!m.create, code: m.code, diff: m.diff, dice: typeof m.dice === 'string' ? m.dice : 'classic' });
    }
    this.core.message(ws, m);
  }
  async webSocketClose(ws) { this.drop(ws); }
  async webSocketError(ws) { this.drop(ws); }
  drop(ws) {
    try { ws.serializeAttachment({ uid: null }); } catch (e) { /* ignore */ }
    try { ws.close(1000, 'bye'); } catch (e) { /* ignore */ }
    this.core.closed();
  }
  async alarm() { this.core.alarm(); }
}
