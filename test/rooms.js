#!/usr/bin/env node
'use strict';
/* Real-socket test of custom rooms: create with settings, join by code, host-only start, unknown code, full room. */
const { spawn } = require('child_process'); const path = require('path'); const WebSocket = require('ws');
const PORT = 3250 + ((Math.random() * 400) | 0), ROOT = path.join(__dirname, '..'), sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0, total = 0; const check = (n, ok, d) => { total++; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); };
const SK = ['jet', 'bomb', 'burst'];
function client() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`), c = { ws, msgs: [], hello: null, room: null, err: null, phase: null };
  ws.on('message', d => { const m = JSON.parse(d); c.msgs.push(m); if (m.t === 'hello') { c.hello = m; c.room = m.ri; c.phase = m.ph; } if (m.t === 'room') c.room = m; if (m.t === 'err') c.err = m.msg; if (m.t === 'phase') c.phase = m.ph; if (m.t === 's') c.phase = m.ph; });
  c.open = new Promise(r => ws.on('open', r)); c.send = o => ws.send(JSON.stringify(o)); return c;
}
const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(30); } return false; };
(async () => {
  const srv = spawn('node', ['server.js'], { cwd: ROOT, env: Object.assign({}, process.env, { PORT, ZONE_SCALE: '0.2' }), stdio: 'ignore' });
  await sleep(900);
  const host = client(); await host.open; host.send({ t: 'join', name: 'Host', skills: SK, room: '', create: { players: 3, bots: 4 } });
  await until(() => host.hello);
  const code = host.hello && host.hello.code;
  check('create: server hands the host a 4-letter room code', /^[A-Z]{4}$/.test(code || ''), code);
  check('create: host is told it is a custom room with its settings', host.room && host.room.m === 1 && host.room.max === 3 && host.room.bots === 4 && host.room.host === host.hello.id, JSON.stringify(host.room));
  const g1 = client(); await g1.open; g1.send({ t: 'join', name: 'Guest1', skills: SK, room: code.toLowerCase() });
  await until(() => g1.hello);
  check('join by code works (case-insensitive) and sees the same room', g1.hello && g1.hello.code === code && g1.room.m === 1, g1.hello && g1.hello.code);
  await until(() => host.room && host.room.hn === 2);
  check('host is told when someone joins', host.room.hn === 2, 'humans=' + host.room.hn);
  g1.send({ t: 'start' }); await sleep(1500);
  check('a guest cannot start the match', g1.phase === 0 && host.phase === 0);
  g1.send({ t: 'ready' }); host.send({ t: 'ready' }); await sleep(20000 > 0 ? 3500 : 0);
  check('nothing starts automatically (even when everyone readies up)', host.phase === 0 && g1.phase === 0);
  const g2 = client(); await g2.open; g2.send({ t: 'join', name: 'Guest2', skills: SK, room: code }); await until(() => g2.hello);
  const g3 = client(); await g3.open; g3.send({ t: 'join', name: 'Guest3', skills: SK, room: code }); await until(() => g3.err, 2000);
  check('room is full at the chosen player limit', /full/i.test(g3.err || ''), g3.err);
  const nf = client(); await nf.open; nf.send({ t: 'join', name: 'Lost', skills: SK, room: 'ZZZZ' }); await until(() => nf.err, 2000);
  check('unknown room code gives a clear error (no silent room creation)', /no room/i.test(nf.err || ''), nf.err);
  host.send({ t: 'cfg', players: 3, bots: 2 }); await until(() => host.room.bots === 2);
  check('host can change CPUs in the lobby', host.room.bots === 2 && g1.room.bots === 2, JSON.stringify(g1.room));
  host.send({ t: 'start' });
  await until(() => host.phase === 1 && g1.phase === 1 && g2.phase === 1, 5000);
  check('host start puts everyone into the match', host.phase === 1 && g1.phase === 1 && g2.phase === 1);
  await sleep(500);
  const roster = host.msgs.filter(m => m.t === 'phase' && m.add).flatMap(m => m.add).concat(host.hello.roster), bots = new Set(roster.filter(r => r.b).map(r => r.id)).size;
  check('exactly the chosen number of CPUs (2) joined', bots === 2, 'bots=' + bots);
  for (const c of [host, g1, g2]) c.ws.close(); srv.kill('SIGTERM');
  console.log(failed ? `\n${failed}/${total} FAILED` : `\nall ${total} custom-room checks passed`); process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
