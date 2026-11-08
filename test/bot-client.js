'use strict';
/* Headless "human" players for testing multiplayer. Each bot joins a room with its own generated PNG avatar and plays.
 *   node test/bot-client.js [ROOM] [COUNT] [SECONDS] [PORT]
 * e.g. node test/bot-client.js VIS 2 120 */
const zlib = require('zlib');
const WebSocket = require('ws');
const FBR = require('../shared/shared.js');
const { C } = FBR;

const ROOM = process.argv[2] || 'VIS', COUNT = +process.argv[3] || 1, SECS = +process.argv[4] || 90, PORT = +process.argv[5] || 3000;
const NAMES = ['Pixel Pete', 'Gus', 'Wendy', 'Bean', 'Moxie', 'Tofu', 'Zed', 'Poppy'];
const COLORS = [[255, 123, 110], [108, 200, 255], [183, 140, 255], [99, 230, 210], [255, 214, 92], [255, 146, 208]];

/* ---- tiny PNG encoder (128x128 RGBA) ---- */
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function avatar(col, seed) {
  const S = 128, px = Buffer.alloc(S * S * 4);
  const set = (x, y, r, g, b, a = 255) => { if (x < 0 || y < 0 || x >= S || y >= S) return; const i = (y * S + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x - 64, dy = y - 70, d = Math.hypot(dx, dy * 1.1);
    if (d < 40) set(x, y, 27, 26, 31);              // ink outline
    if (d < 35) set(x, y, col[0], col[1], col[2]);   // body
    for (const ex of [-14, 14]) if (Math.hypot(x - 64 - ex, y - 62) < 6) set(x, y, 255, 255, 255), Math.hypot(x - 64 - ex - 1.5, y - 62) < 3 && set(x, y, 27, 26, 31);
    if (Math.abs(Math.hypot(x - 64, y - 78) - 14) < 2 && y > 78) set(x, y, 27, 26, 31); // smile
    if (seed % 2 && ((x - 40) ** 2 + (y - 30) ** 2 < 70 || (x - 88) ** 2 + (y - 30) ** 2 < 70)) set(x, y, 27, 26, 31); // ears
  }
  const raw = Buffer.alloc((S * 4 + 1) * S);
  for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return 'data:image/png;base64,' + png.toString('base64');
}

function run(i) {
  const name = NAMES[i % NAMES.length], skills = [['flame', 'boom', 'bubble'], ['bomb', 'slap', 'jet'], ['burst', 'vanish', 'jet']][i % 3];
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  let seq = 0, last = null, step = 0, ready = false; const me = {};
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name, skills, room: ROOM, img: avatar(COLORS[i % COLORS.length], i) })));
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'hello') { console.log(`${name} joined ${m.code} as #${m.id} (phase ${m.ph})`); }
    if (m.t === 's') { last = m; if (!ready && m.ph === 0) { ready = true; setTimeout(() => ws.send(JSON.stringify({ t: 'ready' })), 1500 + i * 400); } if (m.ph === 0) ready = ready; if (m.ph !== 0) ready = false; }
    if (m.t === 'over') console.log(`${name}: match over, winner id ${m.w}`);
  });
  let acc = 0, prev = Date.now();
  const timer = setInterval(() => {
    const now = Date.now(); acc += (now - prev) / 1000; prev = now;
    const batch = [];
    while (acc >= C.STEP) {
      acc -= C.STEP; step++;
      let mx = Math.cos(step / 70 + i), my = Math.sin(step / 53 + i * 2), aim = step / 30 + i, fire = 0, cast = -1;
      if (last && last.me) {
        let best = null, bd = 1e12;
        for (const e of last.e) { const d = Math.hypot(e[2] - last.me[0], e[3] - last.me[1]); if (d < bd) { bd = d; best = [e[2], e[3]]; } }
        for (const p of last.p) { const d = Math.hypot(p[1] - last.me[0], p[2] - last.me[1]); if (d < bd) { bd = d; best = [p[1], p[2]]; } }
        if (best) { aim = Math.atan2(best[1] - last.me[1], best[0] - last.me[0]); fire = bd < 520 ? 1 : 0; const rad = bd > 260 ? 1 : -0.5; mx = Math.cos(aim) * rad - Math.sin(aim) * 0.6; my = Math.sin(aim) * rad + Math.cos(aim) * 0.6; if (step % 100 === 0) cast = (step / 100) % 3; }
        else if (last.z) { const a = Math.atan2(last.z[4] - last.me[1], last.z[3] - last.me[0]); if (Math.hypot(last.z[3] - last.me[0], last.z[4] - last.me[1]) > last.z[5] * 0.6) { mx = Math.cos(a); my = Math.sin(a); } }
      }
      batch.push([++seq, +mx.toFixed(2), +my.toFixed(2), +aim.toFixed(3), fire, cast, 0, 0]);
    }
    if (batch.length && ws.readyState === 1) ws.send(JSON.stringify({ t: 'in', c: batch }));
  }, 16);
  setTimeout(() => { clearInterval(timer); ws.close(); }, SECS * 1000);
}
for (let i = 0; i < COUNT; i++) run(i);
setTimeout(() => process.exit(0), SECS * 1000 + 500);
