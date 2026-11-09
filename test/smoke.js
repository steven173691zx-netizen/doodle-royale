'use strict';
/* Headless smoke test: boots the real server, connects real WebSocket clients and plays a full match.
 *   npm test
 * Checks protocol, prediction determinism (shared stepMove), enemies, combat events, zone, bots, match end + restart. */
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');
const FBR = require('../shared/shared.js');
const { C } = FBR;

const ROOT = path.join(__dirname, '..');
const PORT = 3991;
const results = [];
const check = (name, ok, info) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== undefined ? '  (' + info + ')' : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Bot {
  constructor(name, room, skills) {
    this.name = name; this.room = room; this.skills = skills;
    this.stats = { snaps: 0, bytes: 0, ev: {}, maxEnemies: 0, maxProj: 0, maxClouds: 0, maxPickups: 0, phases: [], zoneR: [], roster: 0, rm: 0, over: null, dead: null, maxErr: 0, cmpN: 0, bf: 0, sawOther: false, pings: 0 };
    this.seq = 0; this.hist = new Map(); this.local = null; this.obs = []; this.last = null; this.step = 0;
    this.ready = false; this.autoplay = false; this.ack = 0; this.id = 0; this.roster = new Map();
  }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
      this.ws.on('open', () => { this.ws.send(JSON.stringify({ t: 'join', name: this.name, skills: this.skills, room: this.room })); });
      this.ws.on('message', (d) => { this.stats.bytes += d.length; this.onMsg(JSON.parse(d)); if (this.id) res(); });
      this.ws.on('error', rej);
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  onMsg(m) {
    const S = this.stats;
    if (m.t === 'hello') { this.id = m.id; this.obs = m.obs.map(o => ({ x: o[0], y: o[1], r: o[2] })); m.roster.forEach(r => this.roster.set(r.id, r)); S.roster = this.roster.size; S.phases.push('hello:' + m.ph); }
    else if (m.t === 'roster') { (m.add || []).forEach(r => this.roster.set(r.id, r)); S.roster = this.roster.size; }
    else if (m.t === 'rm') { m.ids.forEach(i => this.roster.delete(i)); S.rm += m.ids.length; }
    else if (m.t === 'phase') { S.phases.push('phase:' + m.ph); (m.rm || []).forEach(i => { this.roster.delete(i); S.rm++; }); if (m.obs) { this.obs = m.obs.map(o => ({ x: o[0], y: o[1], r: o[2] })); } (m.add || []).forEach(r => this.roster.set(r.id, r)); S.roster = this.roster.size; this.local = null; this.hist.clear(); }
    else if (m.t === 'over') S.over = m;
    else if (m.t === 'dead') S.dead = m;
    else if (m.t === 'pong') S.pings++;
    else if (m.t === 's') this.onSnap(m);
  }
  onSnap(s) {
    const S = this.stats; S.snaps++; this.last = s; this.ack = s.ack;
    if (s.ev) for (const e of s.ev) S.ev[e[0]] = (S.ev[e[0]] || 0) + 1;
    S.maxEnemies = Math.max(S.maxEnemies, s.e.length); S.maxProj = Math.max(S.maxProj, s.b.length);
    S.maxClouds = Math.max(S.maxClouds, s.c.length); S.maxPickups = Math.max(S.maxPickups, s.k2.length);
    if (s.z) S.zoneR.push(s.z[2]);
    if (s.bf && s.bf.length) S.bf++;
    if (s.p.length) S.sawOther = true;
    if (s.me) {
      const me = s.me;
      if (!this.local) {
        this.local = { x: me[0], y: me[1], vx: me[2], vy: me[3], kx: me[4], ky: me[5], dashT: me[6], dashDx: me[7], dashDy: me[8], r: me[9], spd: me[10], stun: !!me[11] };
        this.baseAck = s.ack; this.pendingFrom = this.seq;
      } else if (this.hist.has(s.ack) && s.ph === 0) {
        // movement-only comparison (lobby: no damage so only prediction determinism is under test)
        const h = this.hist.get(s.ack);
        const err = Math.hypot(h.x - me[0], h.y - me[1]);
        S.maxErr = Math.max(S.maxErr, err); S.cmpN++;
      }
    }
  }
  startInputs() {
    let acc = 0, prev = Date.now();
    const STEP = C.STEP;
    this.timer = setInterval(() => {
      const now = Date.now(); acc += (now - prev) / 1000; prev = now;
      const batch = [];
      while (acc >= STEP) { acc -= STEP; batch.push(this.makeCmd()); }
      if (batch.length) this.send({ t: 'in', c: batch });
    }, 16);
    this.ping = setInterval(() => this.send({ t: 'ping', n: 1 }), 500);
  }
  makeCmd() {
    this.step++;
    const s = this.last; let mx = 0, my = 0, aim = 0, fire = 0, cast = -1;
    const t = this.step / 60;
    if (!this.autoplay) { mx = Math.cos(t * 1.3); my = Math.sin(t * 0.9); aim = t; if (this.step % 150 === 70) cast = 0; }
    else if (s && s.me) {
      const me = this.local || { x: s.me[0], y: s.me[1] };
      let best = null, bd = 1e12;
      for (const e of s.e) { const d = Math.hypot(e[2] - s.me[0], e[3] - s.me[1]); if (d < bd) { bd = d; best = { x: e[2], y: e[3] }; } }
      for (const p of s.p) { const d = Math.hypot(p[1] - s.me[0], p[2] - s.me[1]); if (d < bd) { bd = d; best = { x: p[1], y: p[2] }; } }
      if (best) { aim = Math.atan2(best.y - s.me[1], best.x - s.me[0]); fire = 1; mx = Math.cos(aim + 1.4) * 0.7 + (bd > 300 ? Math.cos(aim) : -Math.cos(aim) * 0.4); my = Math.sin(aim + 1.4) * 0.7 + (bd > 300 ? Math.sin(aim) : -Math.sin(aim) * 0.4); }
      else { const z = s.z || [0, 0, 100]; const a = Math.atan2(z[1] - s.me[1], z[0] - s.me[0]); mx = Math.cos(a); my = Math.sin(a); aim = a; }
      if (this.step % 90 === 0) cast = (this.step / 90) % 3;
      this.lastTarget = best;
    }
    const cmd = { seq: ++this.seq, mx: +mx.toFixed(3), my: +my.toFixed(3), aim: +aim.toFixed(3), fire, cast, tx: best_x(this), ty: best_y(this) };
    // local prediction using the SAME shared code
    if (this.local) {
      if (cast >= 0 && this.skills[cast] === 'jet' && this.last && this.last.cd && this.last.cd[cast] <= 0 && !this.local.dashT) FBR.startDash(this.local, cmd.mx, cmd.my, cmd.aim), this.dashed = true;
      FBR.stepMove(this.local, cmd.mx, cmd.my, C.STEP, this.obs);
      this.hist.set(cmd.seq, { x: this.local.x, y: this.local.y });
      if (this.hist.size > 400) this.hist.delete(cmd.seq - 400);
    }
    return [cmd.seq, cmd.mx, cmd.my, cmd.aim, cmd.fire, cmd.cast, cmd.tx, cmd.ty];
  }
  close() { clearInterval(this.timer); clearInterval(this.ping); try { this.ws.close(); } catch {} }
}
const best_x = b => (b.lastTarget ? Math.round(b.lastTarget.x) : 0);
const best_y = b => (b.lastTarget ? Math.round(b.lastTarget.y) : 0);

async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(50); }
  console.log('  (timeout waiting for ' + label + ')');
  return false;
}

(async () => {
  const srv = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DR_OPEN_ROOMS: '1', ZONE_SCALE: '0.12', LOBBY_SECONDS: '3', OVER_SECONDS: '3' } });
  let srvLog = '';
  srv.stdout.on('data', d => { srvLog += d; }); srv.stderr.on('data', d => { srvLog += d; process.stderr.write(d); });
  await sleep(700);

  // ---- http
  const health = await fetch(`http://localhost:${PORT}/healthz`).then(r => r.text()).catch(() => '');
  check('http /healthz', health === 'ok');
  const stats = await fetch(`http://localhost:${PORT}/api/stats`).then(r => r.json()).catch(() => null);
  check('http /api/stats', stats && stats.online === 0, JSON.stringify(stats));
  const sh = await fetch(`http://localhost:${PORT}/shared.js`);
  check('http /shared.js served', sh.status === 200 && (await sh.text()).includes('stepMove'));
  const trav = await fetch(`http://localhost:${PORT}/..%2f..%2fetc/passwd`).catch(() => null);
  check('static path traversal blocked', !trav || trav.status === 403 || trav.status === 404, trav && trav.status);

  // ---- join validation
  const bad = new WebSocket(`ws://localhost:${PORT}/ws`);
  const badMsg = await new Promise(res => { bad.on('open', () => bad.send(JSON.stringify({ t: 'join', name: 'x', skills: ['jet', 'jet', 'boom'] }))); bad.on('message', d => res(JSON.parse(d))); setTimeout(() => res(null), 1500); });
  check('rejects duplicate skills', badMsg && badMsg.t === 'err', badMsg && badMsg.msg);
  bad.close();

  // ---- two real clients in a private room
  const A = new Bot('Alice <b>x</b>', 'TEST', ['jet', 'bomb', 'burst']);
  const B = new Bot('Bob', 'TEST', ['flame', 'slap', 'boom']);
  await A.connect(); await B.connect();
  check('both clients received hello', A.id > 0 && B.id > 0 && A.id !== B.id, `A=${A.id} B=${B.id}`);
  await waitFor(() => A.roster.size === 2 && B.roster.size === 2, 1500, 'roster');
  check('roster lists both players', A.roster.size === 2 && B.roster.size === 2);
  const nm = [...A.roster.values()].find(r => r.id === A.id).n;
  check('name sanitized', !/[<>]/.test(nm), JSON.stringify(nm));
  A.startInputs(); B.startInputs();
  await sleep(1400);
  check('snapshots flowing (~20Hz)', A.stats.snaps > 20, `${A.stats.snaps} in 1.4s`);
  check('players see each other in lobby', A.stats.sawOther && B.stats.sawOther);
  check('ack advances', A.ack > 60, 'ack=' + A.ack);
  check('prediction == server (shared stepMove, lobby)', A.stats.cmpN > 10 && A.stats.maxErr < 0.6, `n=${A.stats.cmpN} maxErr=${A.stats.maxErr.toFixed(3)}`);
  check('ping/pong', A.stats.pings > 0);

  // ---- match start
  A.send({ t: 'ready' }); B.send({ t: 'ready' });
  const live = await waitFor(() => A.stats.phases.includes('phase:1'), 6000, 'live phase');
  check('match goes live after ready', live, A.stats.phases.join(','));
  check('bots fill to 12 fighters', A.roster.size === C.MAX_FIGHTERS, 'roster=' + A.roster.size);
  A.autoplay = true; B.autoplay = true;

  await sleep(5000);
  check('calm opening: no NPC enemies in the first 5s', A.stats.maxEnemies === 0 && B.stats.maxEnemies === 0, `${A.stats.maxEnemies}/${B.stats.maxEnemies}`);
  await waitFor(() => A.stats.maxEnemies > 0 || B.stats.maxEnemies > 0, 20000, 'first enemy wave');
  const s = A.stats;
  check('enemies spawn (first wave after the opening)', s.maxEnemies + B.stats.maxEnemies > 0, 'max in view=' + s.maxEnemies + '/' + B.stats.maxEnemies);
  check('projectiles in flight', s.maxProj > 0, s.maxProj);
  check('pickups on the map', s.maxPickups > 0 || B.stats.maxPickups > 0, s.maxPickups);
  check('shot events (s)', (s.ev.s || 0) > 5, s.ev.s);
  check('cast events (c)', (s.ev.c || 0) > 0, s.ev.c);
  check('hit events (h)', (s.ev.h || 0) > 0 || (B.stats.ev.h || 0) > 0, `${s.ev.h || 0}/${B.stats.ev.h || 0}`);
  check('explosion/ring events (x)', (s.ev.x || 0) + (B.stats.ev.x || 0) > 0, `${s.ev.x || 0}/${B.stats.ev.x || 0}`);

  // ---- through the zone, to the end
  const over = await waitFor(() => A.stats.over && B.stats.over, 60000, 'match over');
  check('match ends (zone closes / last standing)', over);
  const zr = s.zoneR;
  check('zone shrinks live (snapshots)', zr.length > 10 && zr[0] > zr[zr.length - 1] + 300, `${zr[0]} -> ${zr[zr.length - 1]}`);
  {
    const { Room } = require('../game/room.js');
    const r = new Room('unit', true, { zoneScale: 1 }); r.buildZone();
    let mono = true, inside = true, prev = r.zoneAt(0);
    for (let t = 0; t <= 260; t += 0.25) {
      const z = r.zoneAt(t);
      if (z.r > prev.r + 1e-6) mono = false;
      if (Math.hypot(z.x, z.y) + z.r > C.ARENA_R + 1e-6) inside = false;
      prev = z;
    }
    const end = r.zoneAt(300);
    check('zone geometry: radius never grows, stays inside arena', mono && inside);
    check('zone final circle is tiny and DPS escalates', end.r <= 30 && end.dps >= 26, `r=${end.r} dps=${end.dps}`);
  }
  if (s.over) {
    const b = s.over.board;
    check('results board lists everyone with places', b.length >= 12 && b[0].p === 1, `rows=${b.length} winner=${b[0].n}${b[0].b ? ' (bot)' : ''}`);
    check('kill feed events (k)', (s.ev.k || 0) > 0, s.ev.k);
  }
  check('death notification for eliminated player(s)', !!(A.stats.dead || B.stats.dead) || !!(A.stats.over && A.stats.over.w === A.id), JSON.stringify(A.stats.dead || B.stats.dead || {}));
  const again = await waitFor(() => A.stats.phases.filter(p => p === 'phase:0').length >= 1, 8000, 'new lobby');
  check('room returns to lobby, bots removed', again && A.stats.rm >= 10, `removed=${A.stats.rm}`);
  const kb = (A.stats.bytes / 1024).toFixed(0);
  console.log(`  bandwidth: ${kb} KB over ${A.stats.snaps} snapshots`);

  A.close(); B.close();
  await sleep(300);
  const st2 = await fetch(`http://localhost:${PORT}/api/stats`).then(r => r.json()).catch(() => null);
  check('players removed on disconnect', st2 && st2.online === 0, JSON.stringify(st2));
  srv.kill('SIGTERM');
  if (/Error|error/.test(srvLog)) { console.log('---- server log ----\n' + srvLog); check('no server errors', false); } else check('no server errors', true);
  const failed = results.filter(r => !r).length;
  console.log(failed ? `\n${failed} FAILED` : `\nall ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
