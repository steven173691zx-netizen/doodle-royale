/* Game client core: network, prediction/reconciliation, interpolation, input, events -> fx/sfx.
 * Rendering lives in render.js, DOM HUD in hud.js. Shared state: Game.G */
(function () {
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      r = Math.min(typeof r === 'number' ? r : (r && r[0]) || 0, w / 2, h / 2);
      this.moveTo(x + r, y); this.arcTo(x + w, y, x + w, y + h, r); this.arcTo(x + w, y + h, x, y + h, r);
      this.arcTo(x, y + h, x, y, r); this.arcTo(x, y, x + w, y, r); this.closePath();
    };
  }
})();

const Game = (() => {
  const { C, SKILLS, POWERUPS, PU_IDS, ENEMY_IDS } = FBR;
  const INTERP = 100; // ms of interpolation delay for remote entities
  const OTHER_COLORS = ['#6CC8FF', '#FF92D0', '#B78CFF', '#63E6D2', '#FFD65C', '#8FD36B', '#FF7B6E', '#9DB4FF', '#E3A857', '#F2F0E8'];
  const SELF_COLOR = '#FFA45C';
  const CLOUD_COL = ['#9B7BFF', '#5C6CFF', '#B9B8C0']; // poison ink, goo puddle, graphite trail
  const TAU = Math.PI * 2;
  const lerp = FBR.lerp, clamp = FBR.clamp;
  const lerpAng = (a, b, k) => a + FBR.angDiff(b, a) * k;

  const UNIT = 76 / 128;   // world units per sprite pixel (matches render.js)
  const G = {
    ws: null, open: false, running: false, id: 0, code: '', phase: 0, queued: false, skills: [],
    roster: new Map(), obs: [], zone: null, zoneD: null, alive: false, specId: 0,
    me: { x: 0, y: 0, vx: 0, vy: 0, kx: 0, ky: 0, dashT: 0, dashDx: 0, dashDy: 0, r: C.P_R, spd: 1, stun: false },
    off: { x: 0, y: 0 }, hp: 100, maxHp: 100, shield: 0, flags: 0, cd: [0, 0, 0], cdGuard: [0, 0, 0], bf: [],
    aliveN: 0, kills: 0, pve: 0, lobbyT: 0, matchT: 0,
    seq: 0, pending: [], outbox: [], lastSend: 0, acc: 0, rtt: 0,
    snaps: [], last: null, offset: null, projD: new Map(),
    fx: [], texts: [], feed: [], cam: { x: 0, y: 0, shake: 0, flash: 0, zoom: 0, white: 0 }, lastTs: 0,
    decals: [], cls: 'gun', lvPop: new Map(), lvl: 1, rebind: null, recoil: new Map(), hz: [], hzSeen: new Set(), deathHold: null, slow: 0, slowK: 0.3, streak: { n: 0, t: 0 }, celebrate: 0, autoTgt: null, hpd: new Map(),
    input: { keys: {}, castQ: [], aim: 0, mx: 0, my: 0, touch: null },
    dead: null, over: null, hooks: {}, hitFlash: new Map(), face: new Map(), spawnAt: new Map(), t0: 0,
    lastZoneMode: -1, lastStage: -1, lobbyTick: -1,
  };

  /* ------------------------------------------------------------------ roster / sprites */
  function ensureRoster(r) {
    if (G.roster.has(r.id)) return G.roster.get(r.id);
    const self = r.id === G.id;
    const ent = { id: r.id, n: r.n, b: !!r.b, k: r.k, c: r.c || 'gun', seed: r.s, img: r.i, color: self ? SELF_COLOR : OTHER_COLORS[r.id % OTHER_COLORS.length], spr: null, white: null };
    G.roster.set(r.id, ent);
    const finish = (spr) => { ent.spr = Doodle.sticker(spr, ent.color); };
    if (r.i) {
      if (self && G.mySprite) finish(G.mySprite);
      else Doodle.fromDataURL(r.i).then(c => { if (c) finish(c); else finish(Doodle.sprite(Doodle.creature(r.s))); });
    } else finish(Doodle.sprite(Doodle.creature(r.s)));
    return ent;
  }
  function whiteOf(ent) {
    if (!ent.spr) return null;
    if (!ent.white) {
      const c = document.createElement('canvas'); c.width = ent.spr.width; c.height = ent.spr.height;
      const x = c.getContext('2d'); x.drawImage(ent.spr, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      ent.white = c;
    }
    return ent.white;
  }
  const nameOf = (id) => { const r = G.roster.get(id); return r ? r.n : '?'; };

  /* ------------------------------------------------------------------ network */
  function wsURL() { return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; }

  function join({ name, img, skills, room, sprite, cls }) {
    return new Promise((resolve, reject) => {
      reset();
      G.skills = skills; G.mySprite = sprite || null; G.cls = cls || 'gun';
      let settled = false;
      const ws = new WebSocket(wsURL());
      G.ws = ws;
      const fail = (msg) => { if (!settled) { settled = true; reject(new Error(msg)); try { ws.close(); } catch (e) {} } };
      const timer = setTimeout(() => fail('Could not reach the server.'), 8000);
      ws.onopen = () => { G.open = true; ws.send(JSON.stringify({ t: 'join', name, img, skills, cls: cls || 'gun', room: room || '' })); };
      ws.onerror = () => fail('Connection failed.');
      ws.onclose = () => {
        const wasRunning = G.running; G.open = false;
        if (!settled) return fail('Connection closed.');
        if (wasRunning && G.hooks.disconnect) G.hooks.disconnect();
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'err') { clearTimeout(timer); if (!settled) return fail(m.msg || 'Error'); if (G.hooks.error) G.hooks.error(m.msg); return; }
        if (m.t === 'hello' && !settled) { settled = true; clearTimeout(timer); onHello(m); resolve(m); return; }
        onMessage(m);
      };
    });
  }

  function onHello(m) {
    G.id = m.id; G.code = m.code; G.phase = m.ph; G.queued = !!m.queued; G.lobbyT = m.lt;
    G.obs = m.obs.map(o => ({ x: o[0], y: o[1], r: o[2], g: o[3], i: o[4], hp: (o[5] || 100) / 100, hit: 0 }));
    m.roster.forEach(ensureRoster);
    G.running = true; G.lastTs = performance.now(); G.t0 = performance.now();
    G.alive = !G.queued;
    if (G.hooks.hello) G.hooks.hello(m);
    pingLoop();
  }

  let pingTimer = null;
  function pingLoop() { clearInterval(pingTimer); pingTimer = setInterval(() => send({ t: 'ping', n: performance.now() | 0 }), 2000); }
  function send(o) { if (G.ws && G.ws.readyState === 1) G.ws.send(JSON.stringify(o)); }

  function onMessage(m) {
    switch (m.t) {
      case 's': onSnap(m); break;
      case 'roster': m.add.forEach(ensureRoster); break;
      case 'rm': m.ids.forEach(id => G.roster.delete(id)); break;
      case 'phase': onPhase(m); break;
      case 'over': G.over = m; if (G.hooks.over) G.hooks.over(m); break;
      case 'dead': G.dead = m; if (G.hooks.dead) G.hooks.dead(m); break;
      case 'pong': G.rtt = Math.max(0, (performance.now() | 0) - m.n); break;
    }
  }

  function onPhase(m) {
    const prev = G.phase; G.phase = m.ph;
    if (m.rm) m.rm.forEach(id => G.roster.delete(id));
    if (m.add) m.add.forEach(ensureRoster);
    if (m.obs) G.obs = m.obs.map(o => ({ x: o[0], y: o[1], r: o[2], g: o[3], i: o[4], hp: (o[5] || 100) / 100, hit: 0 }));
    if (m.ph === 1) {
      G.fx.length = 0; G.texts.length = 0; G.decals.length = 0; G.hzSeen.clear(); G.deathHold = null; G.slow = 0; G.celebrate = 0; G.streak.n = 0; G.projD.clear(); G.dead = null; G.over = null; G.pending.length = 0; G.snaps.length = 0;
      G.lastZoneMode = -1; G.lastStage = -1; G.zoneD = null; G.spawnAt.clear();
      Sfx.play('go', { prio: 1 });
      if (G.hooks.phase) G.hooks.phase(1, prev);
    } else if (m.ph === 0) {
      G.fx.length = 0; G.texts.length = 0; G.decals.length = 0; G.hzSeen.clear(); G.deathHold = null; G.slow = 0; G.celebrate = 0; G.streak.n = 0; G.projD.clear(); G.dead = null; G.over = null; G.pending.length = 0; G.snaps.length = 0; G.zoneD = null; G.zone = null; G.queued = false;
      G.cd = [0, 0, 0]; G.bf = []; G.alive = true; G.spawnAt.clear();
      if (G.hooks.phase) G.hooks.phase(0, prev);
    }
  }

  /* ------------------------------------------------------------------ snapshots */
  function onSnap(s) {
    const now = performance.now();
    const sample = s.st - now;
    G.offset = G.offset == null ? sample : G.offset + (sample - G.offset) * (sample < G.offset ? 0.5 : 0.03);
    const wasAlive = G.alive;
    G.phase = s.ph; G.aliveN = s.al; G.kills = s.k; G.pve = s.pv; G.lvl = s.lv || 1; G.matchT = s.tm || 0;
    if (s.lt != null) G.lobbyT = s.lt;
    if (s.z) { G.zone = s.z; if (!G.zoneD) G.zoneD = { x: s.z[0], y: s.z[1], r: s.z[2], nx: s.z[3], ny: s.z[4], nr: s.z[5] }; }
    else if (s.ph !== 1) { G.zone = null; }

    if (s.me) {
      G.alive = true; G.queued = false;
      const m = s.me, me = G.me;
      while (G.pending.length && G.pending[0].seq <= s.ack) G.pending.shift();
      const ox = me.x + G.off.x, oy = me.y + G.off.y;
      const first = !wasAlive;
      me.x = m[0]; me.y = m[1]; me.vx = m[2]; me.vy = m[3]; me.kx = m[4]; me.ky = m[5];
      me.dashT = m[6]; me.dashDx = m[7]; me.dashDy = m[8]; me.r = m[9]; me.spd = m[10]; me.stun = !!m[11];
      for (const c of G.pending) {
        if (c.dash && me.dashT <= 0) FBR.startDash(me, c.mx, c.my, c.aim);
        FBR.stepMove(me, c.mx, c.my, C.STEP, G.obs);
      }
      if (first) { G.off.x = G.off.y = 0; G.cam.x = me.x; G.cam.y = me.y; G.spawnAt.set(G.id, now); }
      else {
        G.off.x = ox - me.x; G.off.y = oy - me.y;
        if (Math.hypot(G.off.x, G.off.y) > 160) G.off.x = G.off.y = 0;
      }
      G.hp = m[12]; G.maxHp = m[13]; G.shield = m[14]; G.flags = m[15];
      for (let i = 0; i < 3; i++) if (now > G.cdGuard[i]) G.cd[i] = s.cd[i];
      G.bf = s.bf;
    } else {
      if (wasAlive && G.hooks.lostAlive) G.hooks.lostAlive();
      G.alive = false; G.specId = s.sp || 0; G.queued = !!s.q;
    }

    const snap = { st: s.st, at: now, p: new Map(), e: new Map(), raw: s };
    for (const a of s.p) snap.p.set(a[0], a);
    for (const a of s.e) snap.e.set(a[0], a);
    G.snaps.push(snap); if (G.snaps.length > 14) G.snaps.shift();
    G.last = snap;
    if (s.hz) for (const h of s.hz) if (!G.hzSeen.has(h[0])) { G.hzSeen.add(h[0]); Sfx.play('meteorWarn', { x: h[1], y: h[2], v: 0.8 }); }
    if (G.hzSeen.size > 400) G.hzSeen.clear();
    if (s.ev) for (const e of s.ev) { try { onEvent(e); } catch (err) { console.error('event', e, err); } }
    if (G.hooks.snap) G.hooks.snap(s);
  }

  /* collect interpolated entities for rendering */
  function collect(now) {
    const out = { f: [], e: [], b: [], c: [], k: [], bo: [], hz: [] };
    const sn = G.snaps;
    if (!sn.length) return out;
    const rt = now + G.offset - INTERP;
    let i = sn.length - 1; while (i > 0 && sn[i].st > rt) i--;
    const s0 = sn[i], s1 = sn[i + 1] || null;
    const k = s1 ? clamp((rt - s0.st) / Math.max(1, s1.st - s0.st), 0, 1) : 0;
    const A = s1 || s0;
    for (const [id, b] of A.p) {
      const a = s0.p.get(id) || b;
      out.f.push({ id, x: lerp(a[1], b[1], k), y: lerp(a[2], b[2], k), aim: lerpAng(a[3] / 100, b[3] / 100, k), hp: b[4], maxHp: b[5], fl: b[6], sh: b[7], lv: b[8] || 1, self: false });
    }
    for (const [id, b] of A.e) {
      const a = s0.e.get(id) || b;
      const type = ENEMY_IDS[b[1]];
      out.e.push({ id, type, r: FBR.ENEMIES[type].r, x: lerp(a[2], b[2], k), y: lerp(a[3], b[3], k), hp: b[4], flags: b[5], ang: lerpAng(a[6] / 100, b[6] / 100, k) });
    }
    if (G.alive) out.f.push({ id: G.id, x: G.me.x + G.off.x, y: G.me.y + G.off.y, aim: G.input.aim, hp: G.hp, maxHp: G.maxHp, fl: G.flags, sh: G.shield, lv: G.lvl || 1, self: true });
    // projectiles are extrapolated from the newest snapshot (they move in straight lines)
    const L = G.last, dtp = clamp((now - L.at) / 1000, 0, 0.14);
    const seen = new Set();
    for (const p of L.raw.b) {
      // own straight-line motion every frame, gently steered to the server's newest position (no 20 Hz stepping)
      const tx = p[1] + p[3] * dtp, ty = p[2] + p[4] * dtp;
      let d = G.projD.get(p[0]);
      if (!d) { d = { x: tx, y: ty, t: now, trail: [] }; G.projD.set(p[0], d); }
      else {
        const fdt = clamp((now - d.t) / 1000, 0, 0.05); d.t = now;
        d.x += p[3] * fdt; d.y += p[4] * fdt;
        const ek = 1 - Math.exp(-14 * fdt); d.x += (tx - d.x) * ek; d.y += (ty - d.y) * ek;
      }
      d.trail.push({ x: d.x, y: d.y, t: now }); while (d.trail.length > 2 && now - d.trail[0].t > 170) d.trail.shift();
      seen.add(p[0]);
      out.b.push({ id: p[0], x: d.x, y: d.y, vx: p[3], vy: p[4], r: p[5], kind: p[6], o: p[7], trail: d.trail });
    }
    if (G.projD.size > seen.size + 40) for (const id of G.projD.keys()) if (!seen.has(id)) G.projD.delete(id);
    for (const c of L.raw.c) out.c.push({ id: c[0], kind: c[1], x: c[2], y: c[3], r: c[4], life: c[5] / 100 });
    for (const p of L.raw.k2) out.k.push({ id: p[0], t: p[1], x: p[2], y: p[3] });
    if (L.raw.hz) for (const h of L.raw.hz) out.hz.push({ id: h[0], x: h[1], y: h[2], r: h[3], t: Math.max(0, h[4] - (now - L.at) / 1000), T: h[5] });
    if (L.raw.bo) for (const b of L.raw.bo) out.bo.push({ id: b[0], x0: b[1], y0: b[2], x1: b[3], y1: b[4], k: clamp((b[5] + (now - L.at) / 1000) / b[6], 0, 1) });
    return out;
  }

  /* ------------------------------------------------------------------ events -> fx + sound */
  const puff = (x, y, color, o = {}) => {
    if (G.fx.length > 620) return;
    const a = o.ang != null ? o.ang : Math.random() * TAU, sp = (o.speed || 80) * (0.4 + Math.random() * 0.8);
    G.fx.push({ k: 'puff', x: x + (o.jx ? (Math.random() - 0.5) * o.jx : 0), y: y + (o.jx ? (Math.random() - 0.5) * o.jx : 0), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: (o.r || 9) * (0.7 + Math.random() * 0.6), gr: o.gr == null ? 14 : o.gr, t: 0, dur: (o.dur || 0.5) * (0.8 + Math.random() * 0.4), color, a: o.a == null ? 0.7 : o.a });
  };
  const ring = (x, y, r1, color, o = {}) => G.fx.push({ k: 'ring', x, y, r0: o.r0 || 10, r1, t: 0, dur: o.dur || 0.35, color, lw: o.lw || 5, fill: o.fill || 0, delay: o.delay || 0 });
  const text = (x, y, s, color, size, o = {}) => { if (G.texts.length < 60) G.texts.push({ x, y, vx: o.vx || 0, vy: o.vy == null ? -60 : o.vy, t: 0, dur: o.dur || 0.8, s, color, size }); };
  const shake = (x, y, amt) => { const d = Math.hypot(x - G.cam.x, y - G.cam.y); const k = Math.max(0, 1 - d / 900); G.cam.shake = Math.max(G.cam.shake, amt * k); };
  const colOf = (id) => { const r = G.roster.get(id); return r ? r.color : '#F2F0E8'; };
  const PAPER_COLS = ['#FFA45C', '#F2F0E8', '#6CC8FF', '#FF92D0', '#FFD65C', '#B78CFF', '#8FD36B'];

  /* paper confetti / ink drops / debris: flat coloured bits with a little gravity */
  function bits(x, y, n, cols, o = {}) {
    for (let i = 0; i < n && G.fx.length < 700; i++) {
      const a = o.ang != null ? o.ang + (Math.random() - 0.5) * (o.spread || 1) : Math.random() * TAU, sp = (o.speed || 300) * (0.35 + Math.random() * 0.9);
      G.fx.push({ k: 'bit', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.up || 0), g: o.g == null ? 520 : o.g, w: (o.w || 9) * (0.6 + Math.random() * 0.8), h: (o.h || 5) * (0.6 + Math.random() * 0.8), shape: o.shape || 0, rot: Math.random() * TAU, spin: (Math.random() - 0.5) * 18, t: 0, dur: (o.dur || 1) * (0.7 + Math.random() * 0.6), color: cols[(Math.random() * cols.length) | 0] });
    }
  }
  /* persistent ink splat on the paper (drawn under everything, fades out after ~20 s) */
  function splat(x, y, R, color, o = {}) {
    const blobs = [], n = o.n || 9;
    for (let i = 0; i < n; i++) { const a = Math.random() * TAU, d = Math.random() * R * 0.7; blobs.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d, r: R * (0.22 + Math.random() * 0.36) }); }
    const drops = []; for (let i = 0; i < 6; i++) { const a = Math.random() * TAU, d = R * (0.9 + Math.random() * 0.8); drops.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d, r: R * (0.06 + Math.random() * 0.1) }); }
    G.decals.push({ x, y, R, color, blobs, drops, born: performance.now(), a: o.a == null ? 0.5 : o.a });
    if (G.decals.length > 70) G.decals.shift();
  }

  /* the epic one: a fighter is eliminated */
  function fighterDeath(id, x, y, kx, ky, kid) {
    const now = performance.now(), ent = G.roster.get(id), self = id === G.id, byMe = kid === G.id;
    const col = ent ? ent.color : '#F2F0E8', face = G.face.get(id) || 1;
    const size = ent && ent.spr ? ent.spr.width * UNIT : 76, R = size * 0.52;
    const kl = Math.hypot(kx || 0, ky || 0), dx = kl > 40 ? kx / kl : 0, dy = kl > 40 ? ky / kl : 0, push = Math.min(420, kl * 0.5);
    const N = 8, base = Math.random() * TAU;
    for (let i = 0; i < N; i++) {
      const a0 = base + i / N * TAU, a1 = base + (i + 1) / N * TAU, am = (a0 + a1) / 2, cx = Math.cos(am) * R * 0.6, cy = Math.sin(am) * R * 0.6, sp = 240 + Math.random() * 330;
      G.fx.push({ k: 'shard', id, face, size, R, a0, a1, cx, cy, x: x + cx, y: y + cy, vx: Math.cos(am) * sp + dx * push, vy: Math.sin(am) * sp + dy * push - 140, a: 0, spin: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 9), t: 0, dur: 1.45 + Math.random() * 0.45, col });
    }
    G.fx.push({ k: 'ghostx', id, x, y, t: 0, dur: 1.7, face, size });
    ring(x, y, 190, col, { dur: 0.5, lw: 9, fill: 0.2 });
    ring(x, y, 120, '#F2F0E8', { dur: 0.4, lw: 4, delay: 0.05 });
    ring(x, y, 260, col, { dur: 0.7, lw: 3, delay: 0.14 });
    bits(x, y, 34, [col, '#F2F0E8', col, '#FFA45C'], { speed: 460, up: 140, w: 10, h: 6, dur: 1.4 });
    bits(x, y, 16, ['#0F0E12', col], { speed: 300, shape: 1, w: 8, h: 8, dur: 1.0, up: 60 });
    for (let i = 0; i < 12; i++) puff(x, y, col, { speed: 280, r: 14, dur: 0.6, a: 0.8 });
    splat(x, y, 86, col, { a: 0.6 });
    shake(x, y, self ? 20 : byMe ? 14 : 9);
    G.cam.zoom = Math.max(G.cam.zoom, self ? 0.14 : byMe ? 0.07 : Math.hypot(x - G.cam.x, y - G.cam.y) < 520 ? 0.03 : 0);
    if (self || byMe) { G.slow = Math.max(G.slow, self ? 0.85 : 0.4); G.slowK = self ? 0.22 : 0.4; G.cam.white = Math.max(G.cam.white, self ? 0.75 : 0.4); }
    if (self) { G.deathHold = { x, y, until: now + 1550 }; G.cam.flash = 1; }
    Sfx.play('death', { x, y, v: self ? 1 : 0.85, prio: 1 });
  }

  function registerKill() {
    const now = performance.now();
    G.streak.n = now - G.streak.t < 4500 ? G.streak.n + 1 : 1; G.streak.t = now;
    return G.streak.n;
  }

  function onEvent(e) {
    switch (e[0]) {
      case 's': {
        const [, id, x, y, a] = e, self = id === G.id;
        const c = colOf(id);
        G.recoil.set(id, performance.now());
        puff(x + Math.cos(a) * 28, y + Math.sin(a) * 28, c, { ang: a + (Math.random() - 0.5) * 0.8, speed: 70, r: 5, dur: 0.3, gr: 4 });
        Sfx.play('shot', { x, y, v: self ? 0.8 : 0.6, pitch: self ? 1 : 0.8 + (id % 7) * 0.06 });
        break;
      }
      case 'sw': {
        const [, id, x, y, a, reach, arc] = e, self = id === G.id, c = colOf(id);
        G.fx.push({ k: 'slash', x, y, ang: a, reach, arc, id, t: 0, dur: 0.3, color: c });
        G.recoil.set(id, performance.now());
        for (let i = 0; i < 5; i++) puff(x + Math.cos(a) * reach * 0.8, y + Math.sin(a) * reach * 0.8, '#F2F0E8', { ang: a + (Math.random() - 0.5) * arc, speed: 140, r: 4, dur: 0.25, gr: 0, a: 0.8 });
        Sfx.play('swing', { x, y, v: self ? 0.9 : 0.65 });
        if (self) G.cam.shake = Math.max(G.cam.shake, 2.5);
        break;
      }
      case 'od': {
        const [, id, pct, x, y] = e, o = G.obs.find(q => q.i === id);
        if (o) { o.hp = pct / 100; o.hit = performance.now(); }
        for (let i = 0; i < 3; i++) puff(x + (Math.random() - 0.5) * 50, y + (Math.random() - 0.5) * 50, '#6A6874', { speed: 90, r: 5, dur: 0.35, gr: 6, a: 0.8 });
        bits(x, y, 3, ['#4A4954', '#6A6874', '#2B2A32'], { speed: 220, w: 7, h: 5, dur: 0.6, g: 380, up: 60 });
        Sfx.play('chip', { x, y, v: 0.5 });
        break;
      }
      case 'ox': {
        const [, id, x, y, r] = e;
        G.obs = G.obs.filter(q => q.i !== id);
        ring(x, y, r * 1.9, '#9A98A4', { dur: 0.4, lw: 5, fill: 0.14 });
        for (let i = 0; i < 10; i++) puff(x + (Math.random() - 0.5) * r, y + (Math.random() - 0.5) * r, i % 2 ? '#6A6874' : '#4A4954', { speed: 210, r: r * 0.4, dur: 0.7, gr: 20, a: 0.75 });
        bits(x, y, 18, ['#2B2A32', '#3B3A44', '#6A6874', '#9A98A4'], { speed: 380, w: 14, h: 9, dur: 1.1, g: 460, up: 160 });
        splat(x, y, r * 0.9, '#3B3A44', { a: 0.5, n: 7 });
        shake(x, y, 7); Sfx.play('crumble', { x, y, v: 0.9 });
        break;
      }
      case 'es': Sfx.play('spit', { x: e[1], y: e[2], v: 0.8 }); puff(e[1], e[2], '#6C7BFF', { r: 8, speed: 60 }); break;
      case 'c': {
        const [, id, sk, x, y, a, tx, ty] = e, col = SKILLS[sk].color, self = id === G.id;
        if (sk === 'jet') { for (let i = 0; i < 8; i++) puff(x, y, i % 2 ? col : '#B9B8C0', { ang: a + Math.PI + (Math.random() - 0.5) * 0.9, speed: 170, r: 11, dur: 0.5 }); bits(x, y, 8, ['#B9B8C0', col], { ang: a + Math.PI, spread: 1.2, speed: 280, w: 7, h: 3, dur: 0.6, g: 0 }); Sfx.play('jet', { x, y, v: self ? 1 : 0.8 }); if (self) G.cam.shake = Math.max(G.cam.shake, 5); }
        else if (sk === 'vanish') { for (let i = 0; i < 12; i++) puff(x, y, '#9B7BFF', { speed: 120, r: 14, dur: 0.8, a: 0.5 }); ring(x, y, 90, '#9B7BFF', { dur: 0.45, lw: 3 }); Sfx.play('vanish', { x, y }); }
        else if (sk === 'boom') Sfx.play('boom', { x, y, v: 1 });
        else if (sk === 'flame') { G.fx.push({ k: 'cone', x, y, ang: a, range: 250, half: 0.7, t: 0, dur: 0.3, color: col }); for (let i = 0; i < 14; i++) puff(x + Math.cos(a) * 30, y + Math.sin(a) * 30, i % 3 === 0 ? '#FFE08A' : i % 3 === 1 ? '#FF7A59' : '#FFB45C', { ang: a + (Math.random() - 0.5) * 1.1, speed: 430, r: 9, dur: 0.38, gr: -4 }); Sfx.play('flame', { x, y }); if (self) G.cam.shake = Math.max(G.cam.shake, 4); }
        else if (sk === 'bomb') Sfx.play('bomb', { x, y });
        else if (sk === 'bubble') { ring(x, y, 60, col, { dur: 0.35, lw: 4 }); for (let i = 0; i < 6; i++) puff(x, y, '#CFFBF3', { speed: 90, r: 6, dur: 0.5, a: 0.6 }); Sfx.play('bubble', { x, y }); }
        else if (sk === 'slap') Sfx.play('slap', { x, y, v: 1 });
        break;
      }
      case 'x': {
        const [, kind, x, y, R] = e;
        if (kind === 'boom') { ring(x, y, R, '#FF92D0', { dur: 0.32, lw: 7, fill: 0.14 }); ring(x, y, R * 0.75, '#FFD3EC', { dur: 0.3, lw: 3, delay: 0.06 }); bits(x, y, 18, ['#FF92D0', '#FFD3EC', '#F2F0E8'], { speed: 520, w: 8, h: 6, dur: 0.7, g: 80 }); shake(x, y, 12); }
        else if (kind === 'bomb') { ring(x, y, R, '#6C7BFF', { dur: 0.3, lw: 6, fill: 0.32 }); for (let i = 0; i < 12; i++) puff(x, y, i % 2 ? '#4A55D6' : '#8D99FF', { speed: 240, r: 13, dur: 0.6 }); bits(x, y, 14, ['#4A55D6', '#6C7BFF', '#0F0E12'], { speed: 420, shape: 1, w: 8, h: 8, dur: 0.8, g: 360, up: 90 }); splat(x, y, R * 0.8, '#4A55D6', { a: 0.5 }); Sfx.play('bombBoom', { x, y }); shake(x, y, 9); }
        else if (kind === 'ignite') { ring(x, y, R, '#FFB45C', { dur: 0.3, lw: 6, fill: 0.4 }); for (let i = 0; i < 12; i++) puff(x, y, i % 2 ? '#FFB45C' : '#FF7A59', { speed: 270, r: 12, dur: 0.5 }); splat(x, y, R * 0.55, '#0F0E12', { a: 0.55, n: 6 }); Sfx.play('bombBoom', { x, y, pitch: 1.2 }); shake(x, y, 9); }
        else if (kind === 'slap') { ring(x, y, R, '#FFD65C', { dur: 0.35, lw: 5 }); ring(x, y, R * 0.7, '#FFF0A8', { dur: 0.3, lw: 3, delay: 0.08 }); bits(x, y, 12, ['#FFD65C', '#F2F0E8'], { speed: 380, w: 12, h: 3, dur: 0.6, g: 120 }); shake(x, y, 6); }
        else if (kind === 'stomp') { ring(x, y, R, '#B78CFF', { dur: 0.3, lw: 4 }); shake(x, y, 4); }
        else if (kind === 'puff') { for (let i = 0; i < 3; i++) puff(x, y, '#A7A5AE', { speed: 60, r: 5, dur: 0.3, gr: 4 }); }
        else if (kind === 'meteor') {
          ring(x, y, R, '#6C7BFF', { dur: 0.35, lw: 9, fill: 0.3 }); ring(x, y, R * 0.6, '#FFFFFF', { dur: 0.25, lw: 4 });
          for (let i = 0; i < 12; i++) puff(x, y, i % 2 ? '#2A2F6B' : '#6C7BFF', { speed: 300, r: 15, dur: 0.7 });
          bits(x, y, 16, ['#2A2F6B', '#6C7BFF', '#0F0E12'], { speed: 460, shape: 1, w: 9, h: 9, dur: 0.9, g: 420, up: 120 });
          splat(x, y, R * 0.92, '#2A2F6B', { a: 0.75, n: 11 });
          Sfx.play('meteor', { x, y, v: 1 }); shake(x, y, 13);
        }
        break;
      }
      case 'h': {
        const [, tid, dmg, x, y, fl] = e;
        const me = tid === G.id, enemy = !!(fl & 2), dot = !!(fl & 4), shield = !!(fl & 1);
        const col = me ? '#FF7B6E' : shield ? '#63E6D2' : enemy ? '#F2F0E8' : '#FFD9B8';
        text(x + (Math.random() - 0.5) * 18, y - 28, String(dmg), col, clamp(13 + dmg * 0.45, 13, 30) * (dot ? 0.85 : 1), { vy: -70 });
        if (!dot) G.hitFlash.set(tid, performance.now());
        if (me) { if (!dot) { G.cam.shake = Math.max(G.cam.shake, clamp(dmg * 0.5, 3, 12)); G.cam.flash = 1; Sfx.play('hitMe', { prio: 1 }); } }
        else if (!dot) Sfx.play('hit', { x, y, v: 0.7 });
        break;
      }
      case 'd': {
        if (e[1] === 'e') {
          const type = ENEMY_IDS[e[2]], x = e[3], y = e[4], col = Art.ENEMY_COL[type], R = FBR.ENEMIES[type].r;
          const dark = type === 'fly' ? ['#0F0E12', '#EDEAE0'] : [col, '#0F0E12'];
          bits(x, y, type === 'chonk' ? 22 : 10, dark.concat([col]), { speed: 300, shape: type === 'fly' ? 0 : 1, w: 7, h: 4, dur: 0.7, g: 300, up: 90 });
          for (let i = 0; i < 6; i++) puff(x, y, col, { speed: 190, r: R * 0.5, dur: 0.45, a: 0.7 });
          ring(x, y, R * 2.4, col, { dur: 0.25, lw: 4 });
          splat(x, y, R * 1.15, type === 'fly' ? '#EDEAE0' : col, { a: 0.28, n: 5 });
          if (type === 'chonk') shake(x, y, 6);
          Sfx.play('enemyDeath', { x, y, v: 0.9 });
        } else {
          fighterDeath(e[2], e[3], e[4], e[5] || 0, e[6] || 0, e[7] || 0);
        }
        break;
      }
      case 'k': {
        const [, kn, vn, cause, vid, kid, x, y, vbot] = e;
        const byMe = kid === G.id && vid !== G.id;
        let streak = 0;
        if (byMe) {
          streak = registerKill();
          text(x, y - 60, streak > 1 ? ['', '', 'DOUBLE!', 'TRIPLE!', 'MEGA!', 'UNSTOPPABLE!'][Math.min(5, streak)] : 'KO!', '#FFA45C', streak > 1 ? 40 : 36, { dur: 1.3, vy: -90 });
          Sfx.play('ko', { prio: 1, v: 0.9, pitch: 1 + 0.08 * Math.min(4, streak - 1) });
          if (streak > 1) Sfx.play('streak', { prio: 1, v: 0.7, pitch: 1 + 0.12 * Math.min(4, streak - 2) });
        }
        G.feed.push({ kn, vn, cause, vid, kid, vbot, t: performance.now() });
        if (G.hooks.kill) G.hooks.kill({ kn, vn, cause, vid, kid, vbot, x, y, streak });
        break;
      }
      case 'p': {
        const [, id, ti, x, y] = e, id2 = PU_IDS[ti], def = POWERUPS[id2];
        ring(x, y, 60, def.color, { dur: 0.4, lw: 4 });
        for (let i = 0; i < 6; i++) puff(x, y, def.color, { speed: 140, r: 7, dur: 0.45 });
        bits(x, y, 8, [def.color, '#F2F0E8'], { speed: 220, w: 7, h: 4, dur: 0.6, g: 200, up: 80 });
        if (id === G.id) { Sfx.play('pickup', { prio: 1 }); if (G.hooks.pickup) G.hooks.pickup(id2, def); text(x, y - 40, def.name.toUpperCase(), def.color, 16, { dur: 1.2, vy: -50 }); }
        break;
      }
      case 'lv': {
        const [, id, lv, x, y] = e, c = colOf(id), self = id === G.id;
        ring(x, y, 120, '#FFD65C', { dur: 0.5, lw: 6, fill: 0.16 }); ring(x, y, 70, '#FFFFFF', { dur: 0.35, lw: 3, delay: 0.05 });
        bits(x, y, 14, ['#FFD65C', '#FFA45C', c], { speed: 300, up: 220, w: 7, h: 5, dur: 0.9, g: 420 });
        text(x, y - 56, 'LEVEL ' + lv, '#FFD65C', self ? 24 : 18, { dur: 1.2, vy: -70 });
        Sfx.play('levelup', { x, y, v: self ? 1 : 0.7, prio: 1 });
        G.lvPop.set(id, performance.now());
        break;
      }
      case 'w': {          // global chaos event
        Sfx.play('event', { prio: 1, v: 0.9 });
        G.cam.shake = Math.max(G.cam.shake, 5);
        if (G.hooks.chaos) G.hooks.chaos(e[1]);
        break;
      }
    }
  }

  /* ------------------------------------------------------------------ input */
  /* Movement only: attacks are automatic (the server fires at the nearest target); skills are cast manually. */
  const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
  /* skill hotkeys: default J K L, rebindable (stored per browser) */
  const DEFAULT_BINDS = ['KeyJ', 'KeyK', 'KeyL'], RESERVED = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyM', 'Escape', 'Space', 'Tab', 'Enter']);
  let binds = DEFAULT_BINDS.slice();
  try { const b = JSON.parse(localStorage.getItem('dr.keys') || 'null'); if (Array.isArray(b) && b.length === 3 && b.every(x => typeof x === 'string' && !RESERVED.has(x))) binds = b; } catch (e) {}
  const keyLabel = (code) => code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ').replace('Semicolon', ';').replace('Comma', ',').replace('Period', '.').replace('Slash', '/').replace('Quote', "'").replace('BracketLeft', '[').replace('BracketRight', ']').replace('Minus', '-').replace('Equal', '=').replace('Backquote', '`').replace('Backslash', '\\').replace('ShiftLeft', 'Shift').replace('ShiftRight', 'Shift');
  const getBinds = () => binds.slice();
  /* returns false if the key is reserved; swaps with another slot if already used */
  function setBind(i, code) {
    if (RESERVED.has(code) || i < 0 || i > 2) return false;
    const j = binds.indexOf(code); if (j >= 0 && j !== i) binds[j] = binds[i];
    binds[i] = code; try { localStorage.setItem('dr.keys', JSON.stringify(binds)); } catch (e) {}
    if (G.hooks.binds) G.hooks.binds(); return true;
  }
  function resetBinds() { binds = DEFAULT_BINDS.slice(); try { localStorage.removeItem('dr.keys'); } catch (e) {} if (G.hooks.binds) G.hooks.binds(); }

  function queueCast(i) { if (G.alive && G.skills[i]) G.input.castQ.push(i); }

  function bindInput(cv) {
    window.addEventListener('keydown', (e) => {
      if (!G.running || e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
      if (G.rebind != null) return;
      const bi = binds.indexOf(e.code); if (bi >= 0) { if (!e.repeat) queueCast(bi); e.preventDefault(); return; }
      if (e.code === 'Space') { e.preventDefault(); return; }
      if (e.code === 'KeyM') { if (!e.repeat && G.hooks.mute) G.hooks.mute(); return; }
      if (!G.alive && (e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'KeyA' || e.code === 'KeyD') && !e.repeat) { send({ t: 'spec', d: e.code.endsWith('Left') || e.code === 'KeyA' ? -1 : 1 }); return; }
      if (e.code === 'Escape') { if (G.hooks.escape) G.hooks.escape(); return; }
      const k = KEYMAP[e.code]; if (k) { G.input.keys[k] = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) G.input.keys[k] = false; });
    window.addEventListener('blur', () => { G.input.keys = {}; });
    cv.addEventListener('mousedown', () => { Sfx.init(); });
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /* touch: one floating move stick anywhere on screen; skills are the on-screen buttons */
  function bindTouch(layer) {
    const T = G.input.touch = { l: null, lv: [0, 0], R: 56 };
    layer.addEventListener('pointerdown', (e) => {
      if (T.l) return;
      e.preventDefault(); try { layer.setPointerCapture(e.pointerId); } catch (err) {}
      T.l = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
      Sfx.init();
      if (G.hooks.stick) G.hooks.stick(T);
    });
    layer.addEventListener('pointermove', (e) => {
      const s = T.l; if (!s || s.id !== e.pointerId) return;
      s.x = e.clientX; s.y = e.clientY;
      const dx = s.x - s.x0, dy = s.y - s.y0, d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / T.R);
      T.lv = [dx / d * k, dy / d * k];
      if (G.hooks.stick) G.hooks.stick(T);
    });
    const up = (e) => {
      const s = T.l; if (!s || s.id !== e.pointerId) return;
      T.l = null; T.lv = [0, 0];
      if (G.hooks.stick) G.hooks.stick(T);
    };
    layer.addEventListener('pointerup', up); layer.addEventListener('pointercancel', up);
  }

  /* nearest valid target in range, from the newest snapshot: used for facing, the target marker and skill aim */
  function findAutoTarget(px, py) {
    const L = G.last && G.last.raw; if (!L) return null;
    const KR = (C.CLASSES[G.cls] || C.CLASSES.gun).reachAcquire;
    let best = null, bd = KR * KR;
    for (const e of L.e) { const dx = e[2] - px, dy = e[3] - py, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = { x: e[2], y: e[3], d: Math.sqrt(d2), enemy: true }; } }
    for (const p of L.p) {
      if (p[6] & 2048) continue;
      const dx = p[1] - px, dy = p[2] - py, d2 = dx * dx + dy * dy;
      if ((p[6] & 1) && d2 > 160 * 160) continue;
      if (d2 < bd) { bd = d2; best = { x: p[1], y: p[2], d: Math.sqrt(d2), enemy: false }; }
    }
    return best;
  }

  function readInput() {
    const I = G.input, K = I.keys, T = I.touch;
    let mx = (K.right ? 1 : 0) - (K.left ? 1 : 0), my = (K.down ? 1 : 0) - (K.up ? 1 : 0);
    if (T && T.l) { mx = T.lv[0]; my = T.lv[1]; }
    const px = G.me.x + G.off.x, py = G.me.y + G.off.y;
    const t = findAutoTarget(px, py);
    G.autoTgt = t;
    if (t) I.aim = Math.atan2(t.y - py, t.x - px);
    else if (mx || my) I.aim = Math.atan2(my, mx);
    return { mx, my };
  }

  function inputStep(inp) {
    const I = G.input, me = G.me;
    let cast = -1;
    if (I.castQ.length) cast = I.castQ.shift();
    const cmd = { seq: ++G.seq, mx: +inp.mx.toFixed(2), my: +inp.my.toFixed(2), aim: +I.aim.toFixed(3), fire: 0, cast, tx: 0, ty: 0, dash: 0 };
    if (cast >= 0 && G.skills[cast] === 'jet' && G.cd[cast] <= 0 && !me.stun && me.dashT <= 0) {
      FBR.startDash(me, cmd.mx, cmd.my, cmd.aim); cmd.dash = 1;
    }
    if (cast >= 0 && G.cd[cast] <= 0 && !me.stun) { G.cd[cast] = SKILLS[G.skills[cast]].cd; G.cdGuard[cast] = performance.now() + 350; }
    FBR.stepMove(me, cmd.mx, cmd.my, C.STEP, G.obs);
    G.pending.push(cmd); if (G.pending.length > 120) G.pending.shift();
    G.outbox.push([cmd.seq, cmd.mx, cmd.my, cmd.aim, cmd.fire, cmd.cast, cmd.tx, cmd.ty]);
  }

  /* ------------------------------------------------------------------ frame update */
  function update(dt, now, viewW, viewH, scale) {
    // local simulation + sending
    if (G.alive && G.open) {
      const inp = readInput();
      G.acc += dt;
      let n = 0;
      while (G.acc >= C.STEP && n < 6) { inputStep(inp); G.acc -= C.STEP; n++; }
      if (G.acc > C.STEP * 6) G.acc = 0;
      if (G.outbox.length && (G.outbox.length >= 2 || now - G.lastSend > 30) && G.ws.bufferedAmount < 200000) {
        send({ t: 'in', c: G.outbox }); G.outbox = []; G.lastSend = now;
      }
    } else { G.acc = 0; G.outbox = []; G.autoTgt = null; }

    const k = 1 - Math.exp(-12 * dt);
    G.off.x -= G.off.x * k; G.off.y -= G.off.y * k;
    const haste = (G.flags & 256) ? 2.5 : 1;
    for (let i = 0; i < 3; i++) if (G.cd[i] > 0) G.cd[i] = Math.max(0, G.cd[i] - dt * haste);
    if (G.zoneD && G.zone) {
      const z = G.zone, d = G.zoneD, zk = 1 - Math.exp(-10 * dt);
      d.x += (z[0] - d.x) * zk; d.y += (z[1] - d.y) * zk; d.r += (z[2] - d.r) * zk; d.nx += (z[3] - d.nx) * zk; d.ny += (z[4] - d.ny) * zk; d.nr += (z[5] - d.nr) * zk;
    }

    // camera: look-ahead in the direction of travel; on death it holds on the wreckage, then follows the spectate target
    const hold = G.deathHold && now < G.deathHold.until ? G.deathHold : null;
    let tx = G.cam.x, ty = G.cam.y;
    if (hold) { tx = hold.x; ty = hold.y; }
    else if (G.alive) {
      const px = G.me.x + G.off.x, py = G.me.y + G.off.y;
      tx = px + clamp(G.me.vx * 0.2, -90, 90); ty = py + clamp(G.me.vy * 0.2, -90, 90);
    } else if (G.last) {
      const f = G.last.p.get(G.specId); if (f) { tx = f[1]; ty = f[2]; }
    }
    const ck = 1 - Math.exp(-(hold ? 5 : 7) * dt);
    G.cam.x += (tx - G.cam.x) * ck; G.cam.y += (ty - G.cam.y) * ck;
    G.cam.shake *= Math.exp(-9 * dt); if (G.cam.shake < 0.2) G.cam.shake = 0;
    G.cam.flash = Math.max(0, G.cam.flash - dt * (hold ? 1.2 : 3.5));
    G.cam.white = Math.max(0, G.cam.white - dt * 3.2);
    if (hold) G.cam.zoom += (0.26 - G.cam.zoom) * (1 - Math.exp(-3.5 * dt)); else G.cam.zoom *= Math.exp(-4.2 * dt);
    Sfx.setListener(G.cam.x, G.cam.y);

    // fx run slower during slow-mo moments (big eliminations)
    const fdt = dt * (G.slow > 0 ? G.slowK : 1); G.slow = Math.max(0, G.slow - dt);
    for (let i = G.fx.length - 1; i >= 0; i--) {
      const f = G.fx[i];
      if (f.delay > 0) { f.delay -= fdt; continue; }
      f.t += fdt;
      if (f.t >= f.dur) { G.fx.splice(i, 1); continue; }
      if (f.k === 'puff') { const d = Math.exp(-3 * fdt); f.vx *= d; f.vy *= d; f.x += f.vx * fdt; f.y += f.vy * fdt; f.r += f.gr * fdt; }
      else if (f.k === 'bit') { f.vx *= Math.exp(-1.4 * fdt); f.vy = f.vy * Math.exp(-1.0 * fdt) + f.g * fdt; f.x += f.vx * fdt; f.y += f.vy * fdt; f.rot += f.spin * fdt; }
      else if (f.k === 'shard') { f.vx *= Math.exp(-2.0 * fdt); f.vy = f.vy * Math.exp(-1.2 * fdt) + 620 * fdt; f.x += f.vx * fdt; f.y += f.vy * fdt; f.a += f.spin * fdt; }
    }
    for (let i = G.texts.length - 1; i >= 0; i--) { const t = G.texts[i]; t.t += fdt; if (t.t >= t.dur) { G.texts.splice(i, 1); continue; } t.x += t.vx * fdt; t.y += t.vy * fdt; t.vy *= Math.exp(-2.2 * fdt); }
    for (let i = G.decals.length - 1; i >= 0; i--) if (now - G.decals[i].born > 24000) G.decals.splice(i, 1);
    while (G.feed.length > 6) G.feed.shift();

    // victory confetti rain
    if (G.celebrate > 0) {
      G.celebrate -= dt;
      const n = Math.random() < dt * 90 ? 2 : 0;
      for (let i = 0; i < n; i++) bits(G.cam.x + (Math.random() - 0.5) * 1500, G.cam.y - 520, 1, PAPER_COLS, { ang: Math.PI / 2, spread: 0.7, speed: 220, w: 12, h: 7, dur: 3.2, g: 90 });
    }

    // zone / lobby transitions
    if (G.zone && G.phase === 1) {
      const mode = G.zone[6], stage = G.zone[8];
      if (G.lastZoneMode !== -1 && mode !== G.lastZoneMode && G.hooks.zoneMode) G.hooks.zoneMode(mode, stage);
      G.lastZoneMode = mode; G.lastStage = stage;
    }
    if (G.phase === 0 && G.lobbyT <= 3 && G.lobbyT > 0 && G.lobbyTick !== G.lobbyT) { G.lobbyTick = G.lobbyT; Sfx.play('tick', { prio: 1 }); }
  }

  function celebrate() {
    G.celebrate = 3.2; G.cam.zoom = 0.1;
    bits(G.cam.x, G.cam.y, 90, PAPER_COLS, { speed: 700, up: 260, w: 13, h: 8, dur: 2.6, g: 380 });
    ring(G.cam.x, G.cam.y, 420, '#FFA45C', { dur: 0.7, lw: 8, fill: 0.1 });
  }

  /* ------------------------------------------------------------------ lifecycle */
  function reset() {
    clearInterval(pingTimer);
    Object.assign(G, { running: false, open: false, id: 0, phase: 0, queued: false, alive: false, specId: 0, zone: null, zoneD: null, dead: null, over: null, seq: 0, offset: null, last: null, acc: 0, lastZoneMode: -1, lobbyTick: -1 });
    G.roster.clear(); G.snaps.length = 0; G.pending.length = 0; G.outbox.length = 0; G.fx.length = 0; G.texts.length = 0; G.feed.length = 0; G.projD.clear(); G.spawnAt.clear();
    G.cd = [0, 0, 0]; G.cdGuard = [0, 0, 0]; G.bf = []; G.off.x = G.off.y = 0; G.input.castQ.length = 0;
    G.decals.length = 0; G.recoil.clear(); G.hzSeen.clear(); G.hpd.clear(); G.deathHold = null; G.slow = 0; G.celebrate = 0; G.streak.n = 0; G.cam.zoom = 0; G.cam.white = 0; G.autoTgt = null;
  }
  function leave() {
    try { send({ t: 'leave' }); G.ws && G.ws.close(); } catch (e) {}
    G.running = false; G.open = false; clearInterval(pingTimer);
  }

  return {
    G, getBinds, setBind, resetBinds, keyLabel, join, leave, send, update, collect, bindInput, bindTouch, queueCast, whiteOf, nameOf, ensureRoster, celebrate, onEvent,
    ready: () => send({ t: 'ready' }), spectate: (d) => send({ t: 'spec', d }),
    puff, ring, text, CLOUD_COL, SELF_COLOR, OTHER_COLORS,
  };
})();
