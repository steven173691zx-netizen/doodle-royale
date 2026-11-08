'use strict';
/* DOODLE ROYALE — HTTP static server + WebSocket game server.
 *   npm install && npm start      -> http://localhost:3000
 * Env: PORT, ZONE_SCALE (<1 = faster matches, for testing), LOBBY_SECONDS */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const FBR = require('./shared/shared.js');
const { C, SKILLS } = FBR;
const { Room } = require('./game/room.js');

const PORT = Number(process.env.PORT) || 3000;
const ZONE_SCALE = Number(process.env.ZONE_SCALE) || 1;
const LOBBY_SECONDS = Number(process.env.LOBBY_SECONDS) || C.LOBBY_SECONDS;
const OVER_SECONDS = Number(process.env.OVER_SECONDS) || C.OVER_SECONDS;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SHARED_FILE = path.join(__dirname, 'shared', 'shared.js');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
};

/* ------------------------------------------------------------------ rooms */
const rooms = new Map();
let pubCounter = 0;
function newRoom(code, priv) {
  const r = new Room(code, priv, { zoneScale: ZONE_SCALE, lobbySeconds: LOBBY_SECONDS, overSeconds: OVER_SECONDS });
  rooms.set(code, r);
  return r;
}
function quickRoom() {
  let best = null;
  for (const r of rooms.values()) {
    if (r.priv || r.humans() >= C.MAX_HUMANS || !r.joinable()) continue;
    if (!best || r.humans() > best.humans()) best = r;
  }
  return best || newRoom('PUB' + (++pubCounter), false);
}
function privateRoom(code) { return rooms.get(code) || newRoom(code, true); }
const onlineCount = () => { let n = 0; for (const r of rooms.values()) n += r.humans(); return n; };

/* ------------------------------------------------------------------ http */
function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream', 'ETag': etag,
      'Cache-Control': ext === '.woff2' || ext === '.ttf' ? 'public, max-age=604800, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ---- runtime metrics (GET /api/stats): tick cost, event-loop lag, memory, outgoing bandwidth ---- */
const { monitorEventLoopDelay } = require('perf_hooks');
const eld = monitorEventLoopDelay({ resolution: 10 }); eld.enable();
const M = { ticks: new Float64Array(2400), n: 0, bytes: 0, msgs: 0, since: Date.now(), roomErrors: 0, slowTicks: 0, joins: 0, peakOnline: 0 };
const pct = (arr, n, q) => { const a = Array.from(arr.subarray(0, Math.min(n, arr.length))).sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : 0; };
const statsJSON = () => {
  const n = Math.min(M.n, M.ticks.length), mem = process.memoryUsage(), secs = (Date.now() - M.since) / 1000;
  let fighters = 0, enemies = 0, projs = 0; for (const r of rooms.values()) { fighters += r.fighters.size; enemies += r.enemies.length; projs += r.projs.length; }
  return {
    online: onlineCount(), rooms: rooms.size, peakOnline: M.peakOnline, fighters, enemies, projectiles: projs,
    tickMs: { avg: +(M.ticks.subarray(0, n).reduce((a, b) => a + b, 0) / (n || 1)).toFixed(3), p95: +pct(M.ticks, n, 0.95).toFixed(3), p99: +pct(M.ticks, n, 0.99).toFixed(3), max: +Math.max(0, ...M.ticks.subarray(0, n)).toFixed(3), budget: +(1000 / C.TICK_HZ).toFixed(1) },
    slowTicks: M.slowTicks, loopLagMs: { mean: +(eld.mean / 1e6 || 0).toFixed(2), p99: +(eld.percentile(99) / 1e6 || 0).toFixed(2), max: +(eld.max / 1e6 || 0).toFixed(2) },
    memMB: { rss: Math.round(mem.rss / 1048576), heap: Math.round(mem.heapUsed / 1048576) }, outKBps: +((M.bytes / 1024) / Math.max(1, secs)).toFixed(1), msgsPerSec: Math.round(M.msgs / Math.max(1, secs)),
    roomErrors: M.roomErrors, uptimeSec: Math.round(process.uptime()),
  };
};

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); return res.end(); }
  if (p === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (p === '/api/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(statsJSON()));
  }
  if (p === '/shared.js') return serveFile(req, res, SHARED_FILE);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  serveFile(req, res, file);
});

/* ------------------------------------------------------------------ websocket */
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 160 * 1024 });

class Client {
  constructor(ws) { this.ws = ws; this.f = null; this.room = null; this.specId = 0; this.tokens = 200; this.lastRefill = Date.now(); }
  send(obj) { if (this.ws.readyState === 1) { const s = JSON.stringify(obj); M.bytes += s.length; M.msgs++; this.ws.send(s); } }
  allow() {
    const now = Date.now();
    this.tokens = Math.min(200, this.tokens + (now - this.lastRefill) * 0.12); // ~120 msgs/s sustained
    this.lastRefill = now;
    if (this.tokens < 1) return false;
    this.tokens--; return true;
  }
}

const sanitizeName = n => String(n || '').replace(/[\u0000-\u001f\u007f<>&"']/g, '').replace(/\s+/g, ' ').trim().slice(0, C.NAME_MAX) || 'Anonymous';
function validSkills(a) {
  if (!Array.isArray(a) || a.length !== 3) return null;
  const s = a.map(String);
  if (new Set(s).size !== 3 || !s.every(x => SKILLS[x])) return null;
  return s;
}
const validImg = (s) => {
  if (typeof s !== 'string' || s.length > 70000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s)) return false;
  const b = Buffer.from(s.slice(22, 22 + 48), 'base64');          // PNG signature + IHDR: reject decompression bombs
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') return false;
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  return w > 0 && h > 0 && w <= 256 && h <= 256;
};

wss.on('connection', (ws) => {
  const client = new Client(ws);
  ws.on('pong', () => { ws._dead = false; });
  ws.on('message', (raw) => {
    if (!client.allow()) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    try { handle(client, m); } catch (e) { console.error('handler error', e); }
  });
  ws.on('close', () => { if (client.room) client.room.removeClient(client); });
  ws.on('error', () => {});
});

function handle(c, m) {
  switch (m.t) {
    case 'join': {
      if (c.room) return;
      const skills = validSkills(m.skills);
      if (!skills) return c.send({ t: 'err', msg: 'Pick three different skills.' });
      const code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
      const room = code.length >= 3 ? privateRoom(code) : quickRoom();
      if (room.humans() >= C.MAX_HUMANS) return c.send({ t: 'err', msg: 'That room is full.' });
      room.addClient(c, { name: sanitizeName(m.name), skills, cls: FBR.C.CLASSES[m.cls] ? m.cls : FBR.C.DEFAULT_CLASS, img: validImg(m.img) ? m.img : null, seed: (Math.random() * 1e9) | 0 });
      break;
    }
    case 'in': {
      const f = c.f;
      if (!f || !Array.isArray(m.c)) return;
      for (const a of m.c.slice(0, 8)) {
        if (!Array.isArray(a)) continue;
        const seq = a[0] | 0;
        if (seq <= f.lastQSeq) continue;
        f.lastQSeq = seq;
        const num = (v, lo, hi) => { v = +v; return v === v ? Math.max(lo, Math.min(hi, v)) : 0; };
        f.cmdQ.push({ seq, mx: num(a[1], -1, 1), my: num(a[2], -1, 1), aim: num(a[3], -7, 7), fire: a[4] ? 1 : 0, cast: a[5] | 0, tx: num(a[6], -5000, 5000), ty: num(a[7], -5000, 5000) });
      }
      break;
    }
    case 'ready': if (c.room) c.room.setReady(c); break;
    case 'spec': if (c.room && c.f && !c.f.alive) c.room.cycleSpec(c, m.d < 0 ? -1 : 1); break;
    case 'leave': if (c.room) c.room.removeClient(c); break;
    case 'ping': c.send({ t: 'pong', n: m.n | 0 }); break;
  }
}

/* heartbeat: drop dead sockets */
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws._dead) return ws.terminate();
    ws._dead = true;
    ws.ping();
  });
}, 20000);

/* ------------------------------------------------------------------ main loop */
let last = process.hrtime.bigint(), acc = 0;
const STEP = 1 / C.TICK_HZ;
const loop = setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Number(now - last) / 1e9; last = now;
  if (acc > 0.25) acc = 0.25;
  while (acc >= STEP) {
    acc -= STEP;
    const t0 = process.hrtime.bigint();
    for (const [code, r] of rooms) {
      try { r.tick(); } catch (e) {
        console.error('room error', code, e);
        r.errors = (r.errors || 0) + 1; M.roomErrors++;
        if (r.errors > 5) { for (const c of [...r.clients]) { c.send({ t: 'err', msg: 'Room crashed. Please rejoin.' }); c.ws.close(); } rooms.delete(code); }
      }
      if (r.clients.size === 0 && r.emptyFor > 30) rooms.delete(code);
    }
    const dtMs = Number(process.hrtime.bigint() - t0) / 1e6; M.ticks[M.n++ % M.ticks.length] = dtMs; if (dtMs > 1000 / C.TICK_HZ) M.slowTicks++;
    const on = onlineCount(); if (on > M.peakOnline) M.peakOnline = on;
  }
}, 1000 / C.TICK_HZ / 2);

server.listen(PORT, () => {
  console.log(`\nDoodle Royale is running\n  local    http://localhost:${PORT}`);
  const nets = require('os').networkInterfaces();
  for (const list of Object.values(nets)) for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  network  http://${n.address}:${PORT}   (same Wi-Fi: share this with friends)`);
  if (ZONE_SCALE !== 1) console.log(`  zoneScale=${ZONE_SCALE} (test override)`);
  console.log('');
});

function shutdown() { clearInterval(loop); clearInterval(heartbeat); wss.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
