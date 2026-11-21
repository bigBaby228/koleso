/*
 * Локальный сервер для проверки онлайна без Cloudflare: node server/dev.mjs [порт]
 * Раздаёт файлы игры и держит комнаты в памяти. Пускает гостей без Telegram.
 * Открыть: http://localhost:8787/index.html?server=http://localhost:8787
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RoomCore } from './room.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +process.argv[2] || 8787;
const AFK = process.env.AFK_MS ? +process.env.AFK_MS : null;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };
const rooms = new Map();

function room(code) {
  if (rooms.has(code)) return rooms.get(code);
  const r = { conns: new Set(), timer: null, data: null };
  const io = {
    send: (c, m) => c.send(JSON.stringify(m)),
    conns: () => [...r.conns],
    uidOf: c => c.uid || null,
    setUid: (c, u) => { c.uid = u; },
    save: d => { r.data = d; },
    setAlarm: ms => { clearTimeout(r.timer); if (ms != null) r.timer = setTimeout(() => r.core.alarm(), AFK && ms > 5000 ? AFK : ms); },
    now: () => Date.now(),
  };
  r.core = new RoomCore(io, null);
  rooms.set(code, r);
  return r;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const f = path.join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

/* минимальный WebSocket: только текстовые кадры, этого достаточно */
server.on('upgrade', (req, sock) => {
  const m = req.url.match(/^\/room\/([A-Za-z0-9]{4,8})/);
  if (!m) return sock.destroy();
  const key = req.headers['sec-websocket-key'];
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
  const r = room(m[1].toUpperCase());
  const conn = {
    uid: null,
    send(txt) {
      const b = Buffer.from(txt), n = b.length;
      const h = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x81, 127, 0, 0, 0, 0]), Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])]);
      try { sock.write(Buffer.concat([h, b])); } catch (e) { /* closed */ }
    },
  };
  r.conns.add(conn);
  let buf = Buffer.alloc(0), parts = [];
  sock.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 15; let n = buf[1] & 127, off = 2;
      if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); off = 4; }
      else if (n === 127) { if (buf.length < 10) return; n = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + 4 + n) return;
      const mask = buf.slice(off, off + 4), pl = Buffer.from(buf.slice(off + 4, off + 4 + n));
      for (let i = 0; i < n; i++) pl[i] ^= mask[i & 3];
      buf = buf.slice(off + 4 + n);
      if (op === 8) { sock.end(); return; }
      if (op === 9) { sock.write(Buffer.from([0x8a, 0])); continue; }
      parts.push(pl);
      if (!fin) continue;
      const txt = Buffer.concat(parts).toString(); parts = [];
      let msg; try { msg = JSON.parse(txt); } catch (e) { continue; }
      if (msg.t === 'hello') {
        const g = /^[a-z0-9]{6,20}$/.test(msg.guest || '') ? msg.guest : null;
        if (!g) { conn.send(JSON.stringify({ t: 'fatal', text: 'Нужен гостевой id' })); continue; }
        r.core.hello(conn, { uid: 'g' + g, name: String(msg.name || 'Гость').slice(0, 20) }, msg);
      } else r.core.message(conn, msg);
    }
  });
  const drop = () => { if (!r.conns.delete(conn)) return; conn.uid = null; r.core.closed(); };
  sock.on('close', drop); sock.on('error', drop);
});

server.listen(PORT, () => console.log(`Колесо: http://localhost:${PORT}/index.html?server=http://localhost:${PORT}`));
