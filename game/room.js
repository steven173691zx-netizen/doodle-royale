'use strict';
/* One match room: lobby -> live battle royale -> results. Server-authoritative simulation. */
const FBR = require('../shared/shared.js');
const { C, SKILLS, POWERUPS, PU_IDS, ENEMIES, ENEMY_IDS, ZONE_PLAN } = FBR;
const { spawnEnemy, updateEnemy, separateEnemies } = require('./enemies.js');
const { BOT_NAMES, pickSkills, makeBotAI, botThink } = require('./bots.js');

const PHASE = { lobby: 0, live: 1, over: 2 };
const baseHp = (f) => C.MAX_HP + (C.CLASSES[f.cls] ? C.CLASSES[f.cls].hpBonus || 0 : 0) + C.LVL_HP * ((f.lvl || 1) - 1);
const CLOUD_KINDS = ['poison', 'goo', 'trail'];
const TAU = Math.PI * 2;
const r1 = v => Math.round(v * 10) / 10;
const r2 = v => Math.round(v * 100) / 100;
const rr = (a, b) => a + Math.random() * (b - a);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

function flagsOf(f) {
  return (f.invT > 0 ? 1 : 0) | (f.burnT > 0 ? 2 : 0) | (f.stun ? 4 : 0) | (f.dashT > 0 ? 8 : 0) |
    (f.bf.crayon > 0 ? 16 : 0) | (f.shield > 0 ? 32 : 0) | (f.bf.bolt > 0 ? 64 : 0) |
    (f.bf.redpen > 0 ? 128 : 0) | (f.bf.coffee > 0 ? 256 : 0) | (f.bf.triple > 0 ? 512 : 0) | (f.bf.magnet > 0 ? 1024 : 0) |
    (f.protT > 0 ? 2048 : 0);
}

function newFighter(id, o) {
  return {
    id, name: o.name, skills: o.skills, cls: C.CLASSES[o.cls] ? o.cls : C.DEFAULT_CLASS, bot: !!o.bot, img: o.img || null, seed: o.seed | 0,
    x: 0, y: 0, vx: 0, vy: 0, kx: 0, ky: 0, dashT: 0, dashDx: 0, dashDy: 0,
    r: C.P_R, spd: 1, stun: false, aim: 0,
    hp: C.MAX_HP + ((C.CLASSES[o.cls] || {}).hpBonus || 0), maxHp: C.MAX_HP + ((C.CLASSES[o.cls] || {}).hpBonus || 0), shield: 0, shieldT: 0,
    alive: true, dead: false, queued: false, ready: false,
    cd: [0, 0, 0], fireCd: 0, burstLeft: 0, burstT: 0, protT: 0,
    bf: { bolt: 0, redpen: 0, triple: 0, coffee: 0, magnet: 0, crayon: 0 },
    stunT: 0, stunImmune: 0, burnT: 0, burnBy: 0, slowT: 0, invT: 0, stompT: 0,
    lastHitBy: 0, lastHitKind: '', lastHitAt: 0, dotAcc: 0, dotMark: {},
    lvl: 1, kills: 0, pve: 0, dmg: 0, place: 0, diedAt: 0, killerId: 0,
    lastSeq: 0, lastQSeq: 0, cmdQ: [], budget: 0.1,
    trailing: false, trailX: 0, trailY: 0,
    ai: null, client: null, tgt: null, moveAim: 0,
  };
}

function rosterEntry(f) { return { id: f.id, n: f.name, i: f.img || 0, s: f.seed, k: f.skills, c: f.cls, b: f.bot ? 1 : 0 }; }

class Room {
  constructor(code, priv, opts = {}) {
    this.code = code;
    this.priv = !!priv;
    this.zoneScale = opts.zoneScale || 1;
    this.lobbySeconds = opts.lobbySeconds || C.LOBBY_SECONDS;
    this.overSeconds = opts.overSeconds || C.OVER_SECONDS;
    this.manual = !!opts.manual;                         // custom room: the host starts the match, nothing is automatic
    this.maxHumans = this.manual ? FBR.clamp(opts.maxHumans | 0 || 8, 1, C.ROOM_MAX_PLAYERS) : C.MAX_HUMANS;
    this.botCount = this.manual ? FBR.clamp(opts.bots == null ? 4 : opts.bots | 0, 0, C.ROOM_MAX_TOTAL - this.maxHumans) : null;
    this.host = null;
    this.manualAim = !!opts.manualAim;   // tests only: disable auto-attack so fighters are fully scripted
    this.clients = new Set();
    this.fighters = new Map();
    this.enemies = []; this.projs = []; this.clouds = []; this.pickups = []; this.bombs = [];
    this.events = []; this.dying = [];
    this.nid = 1; this.clock = 0; this.tickN = 0; this.emptyFor = 0;
    this.obs = [];
    this.zoneStages = []; this.zoneNow = this.zoneStatic(); this.zoneArr = null;
    this.phase = 'lobby'; this.lobbyT = this.lobbySeconds; this.overT = 0; this.time = 0;
    this.spawnT = 0; this.puT = 0;
    this.hazards = []; this.evT = 0; this.eventNow = null; this.lastEv = '';
    this.enterLobby();
  }

  humans() { return this.clients.size; }
  canDropIn() { return this.phase === 'live' && this.zoneNow.stage <= 2; }
  joinable() { return this.phase === 'lobby' || this.canDropIn(); }
  aliveList() { const a = []; for (const f of this.fighters.values()) if (f.alive) a.push(f); return a; }
  aliveCount() { let n = 0; for (const f of this.fighters.values()) if (f.alive) n++; return n; }
  /* destructible landscape: every obstacle circle has HP; shots, swords and explosions chip it away */
  initObs() { this.obs.forEach((o, i) => { o.i = i; o.maxhp = o.hp = Math.round(70 + o.r * 1.4); }); }
  obsPayload() { return this.obs.map(o => [o.x, o.y, o.r, o.g, o.i, Math.max(1, Math.round((o.hp / o.maxhp) * 100))]); }
  hitObs(o, dmg) {
    if (this.phase !== 'live' || o.hp <= 0) return;
    o.hp -= dmg;
    if (o.hp <= 0) {
      const k = this.obs.indexOf(o); if (k >= 0) this.obs.splice(k, 1);
      this.ev(['ox', o.i, o.x, o.y, o.r], o.x, o.y, true);
      if (Math.random() < 0.18) this.dropPickup(o.x, o.y);
    } else this.ev(['od', o.i, Math.max(1, Math.round((o.hp / o.maxhp) * 100)), o.x, o.y], o.x, o.y);
  }
  blocked(x, y, r) { for (const o of this.obs) if (Math.hypot(o.x - x, o.y - y) < o.r + r) return true; return false; }

  broadcast(obj) { for (const c of this.clients) c.send(obj); }
  ev(a, x, y, g) { this.events.push({ a, x, y, g: !!g }); }

  /* ------------------------------------------------------------ lifecycle */
  enterLobby() {
    const removed = [];
    for (const [id, f] of this.fighters) if (f.bot) { this.fighters.delete(id); removed.push(id); }
    this.enemies.length = 0; this.projs.length = 0; this.clouds.length = 0; this.pickups.length = 0; this.bombs.length = 0;
    this.dying.length = 0; this.hazards = []; this.eventNow = null;
    this.phase = 'lobby'; this.time = 0; this.lobbyT = this.lobbySeconds;
    this.zoneNow = this.zoneStatic(); this.zoneArr = null;
    this.obs = FBR.genObstacles((Math.random() * 2147483647) | 0); this.initObs();
    for (const f of this.fighters.values()) { this.resetFighter(f); this.placeLobby(f); f.ready = false; f.queued = false; }
    this.broadcast({ t: 'phase', ph: 0, obs: this.obsPayload(), rm: removed, lt: this.lobbySeconds });
  }

  resetFighter(f) {
    f.hp = f.maxHp = C.MAX_HP + (C.CLASSES[f.cls].hpBonus || 0); f.lvl = 1; f.shield = f.shieldT = 0; f.alive = true; f.dead = false;
    f.cd = [0, 0, 0]; f.fireCd = 0; f.burstLeft = 0;
    for (const k in f.bf) f.bf[k] = 0;
    f.stunT = f.stunImmune = f.burnT = f.slowT = f.invT = f.stompT = f.protT = 0; f.stun = false;
    f.vx = f.vy = f.kx = f.ky = 0; f.dashT = 0; f.trailing = false; f.r = C.P_R; f.spd = 1;
    f.kills = f.pve = f.dmg = f.place = 0; f.killerId = 0; f.lastHitBy = 0; f.lastHitKind = ''; f.dotAcc = 0; f.dotMark = {};
    f.cmdQ.length = 0;
  }

  placeLobby(f) {
    for (let i = 0; i < 30; i++) {
      const a = rr(0, TAU), d = Math.sqrt(Math.random()) * 280;
      f.x = Math.cos(a) * d; f.y = Math.sin(a) * d;
      if (!this.blocked(f.x, f.y, 40)) return;
    }
  }

  makeBot() {
    const used = new Set([...this.fighters.values()].map(f => f.name));
    const names = shuffle(BOT_NAMES.slice()).filter(n => !used.has(n));
    const skills = pickSkills();
    const cls = ['gun', 'gun', 'sniper', 'sword'][(Math.random() * 4) | 0];
    const b = newFighter(this.nid++, { name: names[0] || 'Bot ' + this.nid, skills, cls, bot: true, seed: (Math.random() * 1e9) | 0 });
    b.ai = makeBotAI(skills);
    b.ai.pr = cls === 'sword' ? 60 : cls === 'sniper' ? 430 : b.ai.pr;
    this.fighters.set(b.id, b);
    return b;
  }

  startMatch() {
    this.phase = 'live'; this.time = 0;
    const nBots = this.manual ? this.botCount : Math.max(0, C.MAX_FIGHTERS - this.fighters.size);
    const added = [];
    for (let i = 0; i < nBots; i++) added.push(this.makeBot());
    this.buildZone();
    this.zoneNow = this.zoneAt(0); this.zoneArr = this.zoneToArr(this.zoneNow);
    const list = shuffle([...this.fighters.values()]);
    list.forEach(f => { this.resetFighter(f); f.queued = false; });
    const used = [];
    list.forEach((f, i) => {
      let p = null;
      for (let t = 0; t < 40 && !p; t++) {
        const a = (i / list.length) * TAU + rr(-0.35, 0.35), d = rr(900, 1560);
        const x = Math.cos(a) * d, y = Math.sin(a) * d;
        if (this.blocked(x, y, 44) || used.some(u => Math.hypot(u.x - x, u.y - y) < 300)) continue;
        p = { x, y };
      }
      if (!p) p = { x: Math.cos(i * 2.4) * 1100, y: Math.sin(i * 2.4) * 1100 };
      f.x = p.x; f.y = p.y; used.push(p);
      f.protT = C.SPAWN_PROT;                                   // fair opening: protected until you attack (or 4 s)
      if (f.ai) f.ai.calmUntil = rr(9, 15);                      // bots loot first, they only fight back if hit
      for (let t = 0; t < 14; t++) {                             // one guaranteed power-up close to every spawn
        const a = Math.atan2(-p.y, -p.x) + rr(-1.1, 1.1), d = rr(140, 260);
        const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
        if (Math.hypot(x, y) < C.ARENA_R - 90 && !this.blocked(x, y, 30)) { this.dropPickup(x, y); break; }
      }
    });
    for (let i = 0; i < 26; i++) {
      for (let t = 0; t < 12; t++) {
        const a = rr(0, TAU), d = Math.sqrt(Math.random()) * (C.ARENA_R - 140);
        const x = Math.cos(a) * d, y = Math.sin(a) * d;
        if (!this.blocked(x, y, 30)) { this.dropPickup(x, y); break; }
      }
    }
    this.spawnT = 8; this.puT = 3; this.hazards = []; this.eventNow = null; this.evT = 24; this.lastEv = '';                              // first NPC wave after the opening
    this.broadcast({ t: 'phase', ph: 1, add: added.map(rosterEntry) });
  }

  endMatch() {
    const alive = this.aliveList().sort((a, b) => (b.kills - a.kills) || (b.hp - a.hp));
    alive.forEach((f, i) => { f.place = i + 1; });
    const winner = alive[0] || null;
    this.phase = 'over'; this.overT = this.overSeconds;
    const board = [...this.fighters.values()].map(f => ({ id: f.id, n: f.name, k: f.kills, pv: f.pve, p: f.place || 99, b: f.bot ? 1 : 0, d: Math.round(f.dmg) }));
    board.sort((a, b) => a.p - b.p);
    this.broadcast({ t: 'over', w: winner ? winner.id : 0, board, time: Math.round(this.time) });
  }

  checkEnd() {
    if (this.aliveCount() <= 1 || this.time > 330) this.endMatch();
  }

  /* ------------------------------------------------------------ clients */
  addClient(c, d) {
    const f = newFighter(this.nid++, d);
    f.client = c; c.f = f; c.room = this; c.specId = 0;
    this.clients.add(c);
    this.fighters.set(f.id, f);
    if (this.manual && !this.host) this.host = c;
    if (this.clients.size === 1 && this.phase !== 'lobby') this.enterLobby();
    if (this.phase === 'lobby') {
      this.placeLobby(f);
      if (this.lobbyT < 6) this.lobbyT = 6;
    } else if (this.phase === 'live' && this.canDropIn()) {
      this.dropIn(f);
    } else { f.alive = false; f.queued = true; }
    c.send({
      t: 'hello', id: f.id, code: this.code, ph: PHASE[this.phase], queued: f.queued, lt: Math.ceil(this.lobbyT),
      obs: this.obsPayload(), roster: [...this.fighters.values()].map(rosterEntry), ri: this.roomInfo(),
    });
    for (const o of this.clients) if (o !== c) o.send({ t: 'roster', add: [rosterEntry(f)] });
    this.pushInfo();
  }

  dropIn(f) {
    this.resetFighter(f); f.queued = false;
    const z = this.zoneNow;
    for (let t = 0; t < 40; t++) {
      const a = rr(0, TAU), d = Math.sqrt(Math.random()) * z.r * 0.7;
      const x = z.x + Math.cos(a) * d, y = z.y + Math.sin(a) * d;
      if (this.blocked(x, y, 44)) continue;
      let ok = true;
      for (const o of this.fighters.values()) if (o !== f && o.alive && Math.hypot(o.x - x, o.y - y) < 330) { ok = false; break; }
      if (ok || t === 39) { f.x = x; f.y = y; return; }
    }
  }

  removeClient(c) {
    const f = c.f;
    this.clients.delete(c);
    if (f) {
      if (f.alive && this.phase === 'live') this.ev(['k', '', f.name, 'left', f.id, 0, r1(f.x), r1(f.y), 0], f.x, f.y, true);
      this.fighters.delete(f.id);
      this.broadcast({ t: 'rm', ids: [f.id] });
    }
    c.f = null; c.room = null;
    if (this.host === c) this.host = this.clients.values().next().value || null;     // host left: the next player takes over
    if (this.clients.size === 0) { this.fighters.clear(); this.enterLobby(); }
    else this.pushInfo();
  }

  setReady(c) { if (c.f && this.phase === 'lobby') c.f.ready = true; }

  /* ------------------------------------------------------------ custom rooms: host controls */
  roomInfo() { return { t: 'room', m: this.manual ? 1 : 0, host: this.host && this.host.f ? this.host.f.id : 0, max: this.maxHumans, bots: this.botCount == null ? 0 : this.botCount, hn: this.humans() }; }
  pushInfo() { if (this.manual) this.broadcast(this.roomInfo()); }
  hostStart(c) {
    if (!this.manual || c !== this.host || this.phase !== 'lobby' || this.clients.size === 0) return false;
    this.startMatch(); return true;
  }
  hostConfig(c, cfg) {
    if (!this.manual || c !== this.host || this.phase !== 'lobby' || !cfg) return false;
    const players = FBR.clamp(cfg.players | 0 || this.maxHumans, Math.max(1, this.humans()), C.ROOM_MAX_PLAYERS);
    const bots = FBR.clamp(cfg.bots == null ? this.botCount : cfg.bots | 0, 0, C.ROOM_MAX_TOTAL - players);
    this.maxHumans = players; this.botCount = bots; this.pushInfo(); return true;
  }

  /* ------------------------------------------------------------ zone */
  zoneStatic() { return { x: 0, y: 0, r: C.ARENA_R, nx: 0, ny: 0, nr: C.ARENA_R, mode: 0, left: 99, stage: 0, dps: 0 }; }

  buildZone() {
    const S = this.zoneScale, st = [];
    let t = 0, cx = 0, cy = 0, r = C.ARENA_R;
    for (const [hold, shrink, nr, dps] of ZONE_PLAN) {
      const maxOff = Math.max(0, r - nr) * 0.8;
      const a = rr(0, TAU), d = Math.sqrt(Math.random()) * maxOff;
      const nx = cx + Math.cos(a) * d, ny = cy + Math.sin(a) * d;
      st.push({ t0: t + hold * S, t1: t + (hold + shrink) * S, fx: cx, fy: cy, fr: r, tx: nx, ty: ny, tr: nr, dps });
      t += (hold + shrink) * S; cx = nx; cy = ny; r = nr;
    }
    this.zoneStages = st;
  }

  zoneAt(time) {
    const st = this.zoneStages;
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      if (time < s.t0) return { x: s.fx, y: s.fy, r: s.fr, nx: s.tx, ny: s.ty, nr: s.tr, mode: 0, left: s.t0 - time, stage: i, dps: i ? st[i - 1].dps : 0 };
      if (time < s.t1) {
        const k = (time - s.t0) / (s.t1 - s.t0);
        return { x: FBR.lerp(s.fx, s.tx, k), y: FBR.lerp(s.fy, s.ty, k), r: FBR.lerp(s.fr, s.tr, k), nx: s.tx, ny: s.ty, nr: s.tr, mode: 1, left: s.t1 - time, stage: i + 1, dps: s.dps };
      }
    }
    const s = st[st.length - 1];
    return { x: s.tx, y: s.ty, r: s.tr, nx: s.tx, ny: s.ty, nr: s.tr, mode: 0, left: 0, stage: st.length + 1, dps: s.dps * 1.5 };
  }

  zoneToArr(z) { return [r1(z.x), r1(z.y), r1(z.r), r1(z.nx), r1(z.ny), r1(z.nr), z.mode, Math.ceil(z.left), z.stage, z.dps]; }

  /* ------------------------------------------------------------ main tick */
  tick() {
    const dt = 1 / C.TICK_HZ;
    this.clock += dt; this.tickN++;
    if (this.clients.size === 0) { this.emptyFor += dt; return; }
    this.emptyFor = 0;

    for (const c of this.clients) this.processCmds(c.f, dt);

    if (this.phase === 'lobby' && this.manual) {
      this.lobbyT = 0;                                    // custom rooms wait for the host, no countdown
    } else if (this.phase === 'lobby') {
      this.lobbyT -= dt;
      let all = true;
      for (const c of this.clients) if (!c.f.ready) { all = false; break; }
      if (all && this.lobbyT > 3) this.lobbyT = 3;
      if (this.lobbyT <= 0) this.startMatch();
    } else if (this.phase === 'over') {
      this.overT -= dt;
      if (this.overT <= 0) this.enterLobby();
    }

    let steps = 1;
    if (this.phase === 'live') {
      let humanAlive = false;
      for (const c of this.clients) if (c.f.alive) { humanAlive = true; break; }
      if (!humanAlive) steps = 4; // only bots left: fast-forward to a real winner
    }
    for (let i = 0; i < steps && (i === 0 || this.phase === 'live'); i++) this.simulate(dt);
    if (this.tickN % C.SNAP_EVERY === 0) { this.sendSnapshots(); this.events.length = 0; }
  }

  simulate(dt) {
    this.simN = (this.simN | 0) + 1;
    const live = this.phase === 'live';
    if (live) {
      this.time += dt;
      this.zoneNow = this.zoneAt(this.time);
      this.zoneArr = this.zoneToArr(this.zoneNow);
    }
    if (live) for (const f of this.fighters.values()) if (f.bot && f.alive) this.runCmd(f, botThink(this, f, dt), dt);
    for (const f of this.fighters.values()) this.updateFighter(f, dt);
    if (live) {
      for (const e of this.enemies) updateEnemy(this, e, dt);
      separateEnemies(this);
    }
    this.updateProjectiles(dt, live);
    this.updateBombs(dt);
    this.updateClouds(dt, live);
    if (live) {
      this.zoneDamage(dt);
      this.updatePickups(dt);
      this.spawns(dt);
    }
    this.processDeaths();
    if (live) this.checkEnd();
  }

  /* ------------------------------------------------------------ commands */
  processCmds(f, dt) {
    f.budget = Math.min(f.budget + dt, 0.25);
    const q = f.cmdQ;
    while (q.length && f.budget >= C.STEP - 1e-6) {
      f.budget -= C.STEP;
      this.runCmd(f, q.shift(), C.STEP);
    }
    if (q.length > 40) q.splice(0, q.length - 10);
  }

  runCmd(f, c, dt) {
    if (c.seq) f.lastSeq = c.seq;
    if (!f.alive) return;
    if (f.bot) f.aim = c.aim;                                   // bots aim themselves
    else if (c.mx || c.my) f.moveAim = Math.atan2(c.my, c.mx);   // humans: auto-aim at the nearest target, else face where you walk
    if (c.cast >= 0 && c.cast < 3) {
      if (!f.bot) {                                              // manual skills still fire at the auto target
        const t = f.tgt;
        if (t) { c.tx = t.x + (t.vx || 0) * 0.35; c.ty = t.y + (t.vy || 0) * 0.35; }
        else { c.tx = f.x + Math.cos(f.aim) * 300; c.ty = f.y + Math.sin(f.aim) * 300; }
      }
      this.cast(f, c.cast, c);
    }
    if (f.bot && c.fire) this.tryFire(f);
    FBR.stepMove(f, c.mx, c.my, dt, this.obs);
  }

  tryFire(f) {
    if (f.fireCd > 0 || f.stun || this.phase === 'over') return;
    const K = C.CLASSES[f.cls] || C.CLASSES.gun;
    f.fireCd = K.cd / (f.bf.coffee > 0 ? 1.4 : 1);
    f.invT = 0; f.protT = 0;
    if (K.kind === 'melee') return this.swing(f, K);
    const n = f.bf.triple > 0 ? 3 : 1;
    const mul = (f.bf.redpen > 0 ? 1.6 : 1) * (f.bf.crayon > 0 ? 1.25 : 1) * (n === 3 ? 0.72 : 1);
    for (let i = 0; i < n; i++) this.spawnShot(f, f.aim + (n === 3 ? (i - 1) * 0.2 : 0) + (Math.random() - 0.5) * 0.04, mul);
    this.ev(['s', f.id, r1(f.x), r1(f.y), r2(f.aim)], f.x, f.y);
  }

  /* sword: instant arc in front of the fighter. Hits every enemy / fighter inside, shoves them, and cuts enemy shots. */
  swing(f, K, power = 1) {
    const mul = power * (f.bf.redpen > 0 ? 1.6 : 1) * (f.bf.crayon > 0 ? 1.25 : 1) * (f.bf.triple > 0 ? 1.3 : 1);
    const reach = K.reach * (f.bf.crayon > 0 ? 1.25 : 1) * (f.bf.triple > 0 ? 1.2 : 1) * (f.lvl > 1 ? 1 + 0.02 * (f.lvl - 1) : 1), half = K.arc / 2, a = f.aim;
    const inArc = (t, tr) => {
      const dx = t.x - f.x, dy = t.y - f.y, d = Math.hypot(dx, dy);
      if (d > reach + tr) return false;
      if (d < tr + f.r) return true;
      let da = Math.atan2(dy, dx) - a; da = Math.atan2(Math.sin(da), Math.cos(da));
      return Math.abs(da) <= half + Math.min(0.5, tr / Math.max(d, 1));
    };
    const locked = f.tgt, done = new Set();
    for (const e of this.enemies.slice()) {
      if (e.dead || !(inArc(e, e.r || 20) || e === locked && Math.hypot(e.x - f.x, e.y - f.y) <= reach + (e.r || 20) + 30)) continue;
      done.add(e); this.hurt(e, K.dmg * mul, f.id, 'pencil'); this.knock(e, Math.cos(a), Math.sin(a), 260);
    }
    for (const o of this.fighters.values()) {
      if (o === f || !o.alive || o.protT > 0) continue;
      if (!(inArc(o, o.r) || o === locked && Math.hypot(o.x - f.x, o.y - f.y) <= reach + o.r + 30)) continue;
      if (o.invT > 0 && Math.hypot(o.x - f.x, o.y - f.y) > 160) continue;
      done.add(o); this.hurt(o, K.dmg * mul, f.id, 'pencil'); this.knock(o, Math.cos(a), Math.sin(a), 220);
    }
    for (const o of this.obs.slice()) if (inArc(o, o.r)) this.hitObs(o, K.dmg * mul * 1.3);
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const p = this.projs[i];
      if (p.o === f.id) continue;
      if (inArc({ x: p.x, y: p.y }, p.r)) { this.projs.splice(i, 1); this.ev(['x', 'puff', r1(p.x), r1(p.y), 12], p.x, p.y); }
    }
    this.ev(['sw', f.id, r1(f.x), r1(f.y), r2(a), Math.round(reach), r2(K.arc)], f.x, f.y);
  }

  spawnShot(f, a, mul) {
    let K = C.CLASSES[f.cls] || C.CLASSES.gun; if (K.kind === 'melee') K = C.CLASSES.gun;      // melee fighters never fire bullets
    const sp = K.speed, off = f.r + 6;
    this.projs.push({
      id: this.nid++, o: f.id, ot: 0, x: f.x + Math.cos(a) * off, y: f.y + Math.sin(a) * off,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: K.r * (f.bf.crayon > 0 ? 1.5 : 1),
      dmg: K.dmg * mul, life: K.life, pen: 1, burn: f.bf.redpen > 0, homing: f.bf.magnet > 0, kind: f.bf.redpen > 0 ? 2 : 1,
    });
  }

  cast(f, idx, cmd) {
    const id = f.skills[idx], def = SKILLS[id];
    if (!def || f.cd[idx] > 0 || f.stun || this.phase === 'over') return;
    f.cd[idx] = def.cd; f.protT = 0;
    if (id !== 'vanish' && id !== 'bubble' && id !== 'jet') f.invT = 0;
    const a = f.aim;
    this.ev(['c', f.id, id, r1(f.x), r1(f.y), r2(a), r1(cmd.tx || f.x), r1(cmd.ty || f.y)], f.x, f.y);
    switch (id) {
      case 'jet': {
        FBR.startDash(f, cmd.mx, cmd.my, (!f.bot && Number.isFinite(cmd.aim)) ? cmd.aim : a);
        f.trailing = true; f.trailX = f.x; f.trailY = f.y;
        break;
      }
      case 'vanish':
        f.invT = 3.2;
        this.addCloud(f, 'poison', f.x, f.y, 100, 4.5, 11, false);
        break;
      case 'boom':
        this.explode(f.x, f.y, 205, 22, 1000, f, 'boom', true);
        break;
      case 'flame': {
        const range = 250, half = 0.7;
        const inCone = (t, extra) => {
          const dx = t.x - f.x, dy = t.y - f.y, d = Math.hypot(dx, dy);
          if (d > range + extra) return false;
          if (d < 1) return true;
          return Math.abs(FBR.angDiff(Math.atan2(dy, dx), a)) <= half + extra / Math.max(d, extra);
        };
        for (const t of this.fighters.values()) {
          if (t === f || !t.alive || !inCone(t, t.r)) continue;
          this.hurt(t, 14, f.id, 'flame'); t.burnT = 3; t.burnBy = f.id;
        }
        for (const t of this.enemies) {
          if (!inCone(t, t.r)) continue;
          this.hurt(t, 14, f.id, 'flame'); t.burnT = 3; t.burnBy = f.id;
        }
        for (const c of this.clouds.slice()) if (c.life > 0 && inCone(c, c.r * 0.5)) this.ignite(f, c);
        break;
      }
      case 'bomb': {
        const maxR = 520;
        let dx = (cmd.tx || f.x + Math.cos(a) * 300) - f.x, dy = (cmd.ty || f.y + Math.sin(a) * 300) - f.y;
        let d = Math.hypot(dx, dy);
        if (d < 80) { dx = Math.cos(a) * 80; dy = Math.sin(a) * 80; d = 80; }
        const k = Math.min(1, maxR / d);
        this.bombs.push({ id: this.nid++, o: f.id, x0: f.x, y0: f.y, x1: f.x + dx * k, y1: f.y + dy * k, t: 0, T: 0.45 + 0.4 * Math.min(1, d / maxR) });
        break;
      }
      case 'burst':
        f.burstLeft = (C.CLASSES[f.cls] || {}).kind === 'melee' ? 5 : 7; f.burstT = 0;
        break;
      case 'bubble':
        f.shield = Math.max(f.shield, 45); f.shieldT = Math.max(f.shieldT, 6);
        break;
      case 'slap': {
        const R = 215;
        this.ev(['x', 'slap', r1(f.x), r1(f.y), R], f.x, f.y);
        for (const t of this.fighters.values()) {
          if (t === f || !t.alive || Math.hypot(t.x - f.x, t.y - f.y) > R + t.r) continue;
          this.hurt(t, 5, f.id, 'slap');
          if (t.stunImmune <= 0) { t.stunT = 1.3; t.stunImmune = 3; }
        }
        for (const t of this.enemies) {
          if (Math.hypot(t.x - f.x, t.y - f.y) > R + t.r) continue;
          this.hurt(t, 5, f.id, 'slap'); t.stunT = 1.8;
        }
        break;
      }
    }
  }

  /* ------------------------------------------------------------ per-entity updates */
  /* Auto-attack (survivor-style): humans always shoot the nearest valid target in range and aim at it.
   * Skills stay manual. Auto-fire pauses while spawn-protected, vanished or stunned. */
  autoAttack(f, live) {
    if (this.manualAim) return;
    let best = null;
    if (live) {
      const KR = (C.CLASSES[f.cls] || C.CLASSES.gun).reachAcquire; let bd = KR * KR;
      for (const e of this.enemies) { const dx = e.x - f.x, dy = e.y - f.y, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = e; } }
      for (const o of this.fighters.values()) {
        if (o === f || !o.alive || o.protT > 0) continue;
        const dx = o.x - f.x, dy = o.y - f.y, d2 = dx * dx + dy * dy;
        if (o.invT > 0 && d2 > 160 * 160) continue;
        if (d2 < bd) { bd = d2; best = o; }
      }
    }
    f.tgt = best;
    if (best) {
      const d = Math.hypot(best.x - f.x, best.y - f.y), lead = Math.min(0.6, d / (C.CLASSES[f.cls] || C.CLASSES.gun).speed);
      f.aim = Math.atan2(best.y + (best.vy || 0) * lead - f.y, best.x + (best.vx || 0) * lead - f.x);
      if (f.protT <= 0 && !(f.invT > 0) && !f.stun && f.fireCd <= 0) this.tryFire(f);
    } else f.aim = f.moveAim;
  }

  updateFighter(f, dt) {
    if (!f.alive) return;
    const live = this.phase === 'live';
    const haste = f.bf.coffee > 0 ? 2.5 : 1;
    for (let i = 0; i < 3; i++) if (f.cd[i] > 0) f.cd[i] = Math.max(0, f.cd[i] - dt * haste);
    if (f.fireCd > 0) f.fireCd -= dt;
    if (f.protT > 0) f.protT = Math.max(0, f.protT - dt);
    for (const k in f.bf) {
      if (f.bf[k] > 0) {
        f.bf[k] -= dt;
        if (f.bf[k] <= 0) { f.bf[k] = 0; if (k === 'crayon') { f.maxHp = baseHp(f); f.hp = Math.min(f.hp, f.maxHp); } }
      }
    }
    if (f.shieldT > 0) { f.shieldT -= dt; if (f.shieldT <= 0) { f.shield = 0; f.shieldT = 0; } }
    if (f.stunT > 0) f.stunT -= dt;
    if (f.stunImmune > 0) f.stunImmune -= dt;
    f.stun = f.stunT > 0;
    if (f.slowT > 0) f.slowT -= dt;
    if (f.invT > 0) f.invT -= dt;
    if (f.burnT > 0) { f.burnT -= dt; this.hurt(f, 5 * dt, f.burnBy, 'burn', true); }
    f.spd = (f.bf.bolt > 0 ? 1.45 : 1) * (f.slowT > 0 ? 0.6 : 1);
    f.r = f.bf.crayon > 0 ? C.P_R * 1.45 : C.P_R;
    if (!f.bot) this.autoAttack(f, live);

    // burst fire
    if (f.burstLeft > 0) {
      if (f.stun) f.burstLeft = 0;
      else {
        f.burstT -= dt;
        if (f.burstT <= 0) {
          const KK = C.CLASSES[f.cls] || C.CLASSES.gun;
          if (KK.kind === 'melee') { f.burstT = 0.11; f.burstLeft--; this.swing(f, KK, 0.8); }          // sword: a flurry of real swings, never a projectile
          else { f.burstT = 0.085; f.burstLeft--; this.spawnShot(f, f.aim + (Math.random() - 0.5) * 0.12, 0.9); this.ev(['s', f.id, r1(f.x), r1(f.y), r2(f.aim)], f.x, f.y); }
        }
      }
    }
    // jet trail
    if (f.trailing) {
      const dx = f.x - f.trailX, dy = f.y - f.trailY, d = Math.hypot(dx, dy), step = 55;
      if (d >= step) {
        const n = Math.floor(d / step);
        for (let i = 1; i <= n; i++) { const k = i * step / d; this.addCloud(f, 'trail', f.trailX + dx * k, f.trailY + dy * k, 38, 1.5, 15, false); }
        const adv = n * step / d; f.trailX += dx * adv; f.trailY += dy * adv;
      }
      if (f.dashT <= 0) f.trailing = false;
    }
    // giant stomp
    if (f.bf.crayon > 0 && live) {
      f.stompT -= dt;
      if (f.stompT <= 0) {
        let near = false;
        for (const e of this.enemies) if (Math.hypot(e.x - f.x, e.y - f.y) < 150) { near = true; break; }
        if (!near) for (const o of this.fighters.values()) if (o !== f && o.alive && Math.hypot(o.x - f.x, o.y - f.y) < 150) { near = true; break; }
        if (near) { f.stompT = 0.7; this.explode(f.x, f.y, 110, 9, 400, f, 'stomp'); }
        else f.stompT = 0.15;
      }
    }
  }

  updateProjectiles(dt, live) {
    const P = this.projs;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.life -= dt;
      if (p.life <= 0) { P.splice(i, 1); continue; }
      if (p.homing) {
        let best = null, bd = 380 * 380;
        const test = (t) => { const dx = t.x - p.x, dy = t.y - p.y, d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = t; } };
        for (const e of this.enemies) test(e);
        for (const f of this.fighters.values()) if (f.alive && f.id !== p.o && !(f.invT > 0)) test(f);
        if (best) {
          const sp = Math.hypot(p.vx, p.vy), cur = Math.atan2(p.vy, p.vx);
          const want = Math.atan2(best.y - p.y, best.x - p.x);
          const turn = FBR.clamp(FBR.angDiff(want, cur), -4.5 * dt, 4.5 * dt);
          p.vx = Math.cos(cur + turn) * sp; p.vy = Math.sin(cur + turn) * sp;
        }
      }
      const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;
      let gone = false;
      for (const o of this.obs) if (FBR.segHitsCircle(p.x, p.y, nx, ny, o.x, o.y, o.r + p.r * 0.4)) { gone = true; this.ev(['x', 'puff', r1(nx), r1(ny), 14], nx, ny); this.hitObs(o, p.dmg * (p.ot === 0 ? 1 : 0.6)); break; }
      if (!gone && Math.hypot(nx, ny) > C.ARENA_R + 40) gone = true;
      if (!gone && live) {
        if (p.ot === 0) {
          for (const e of this.enemies) {
            if (e.dead || (p.hit && p.hit.has(e.id)) || !FBR.segHitsCircle(p.x, p.y, nx, ny, e.x, e.y, e.r + p.r)) continue;
            this.hurt(e, p.dmg, p.o, 'pencil'); this.knock(e, p.vx, p.vy, 90);
            if (p.burn) { e.burnT = 3; e.burnBy = p.o; }
            if (p.pen > 0) { p.pen--; (p.hit || (p.hit = new Set())).add(e.id); continue; }   // shots punch through one enemy
            gone = true; break;
          }
        }
        if (!gone) {
          for (const f of this.fighters.values()) {
            if (!f.alive || f.id === p.o || !FBR.segHitsCircle(p.x, p.y, nx, ny, f.x, f.y, f.r + p.r)) continue;
            this.hurt(f, p.dmg, p.ot === 0 ? p.o : 0, p.ot === 0 ? 'pencil' : 'e:spit');
            this.knock(f, p.vx, p.vy, p.ot === 0 ? 110 : 160);
            if (p.burn) { f.burnT = 3; f.burnBy = p.o; }
            gone = true; break;
          }
        }
      }
      if (gone) P.splice(i, 1); else { p.x = nx; p.y = ny; }
    }
  }

  updateBombs(dt) {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.t += dt;
      if (b.t >= b.T) {
        this.bombs.splice(i, 1);
        const owner = this.fighters.get(b.o) || null;
        this.explode(b.x1, b.y1, 125, 28, 520, owner, 'bomb');
        this.addCloud(owner, 'goo', b.x1, b.y1, 120, 5, 8, true);
      }
    }
  }

  addCloud(owner, kind, x, y, r, life, dps, slow) {
    if (this.clouds.length > 140) this.clouds.shift();
    this.clouds.push({ id: this.nid++, o: owner ? owner.id : 0, kind, x, y, r, life, maxLife: life, dps, slow: !!slow });
  }

  updateClouds(dt, live) {
    const C2 = this.clouds;
    for (let i = C2.length - 1; i >= 0; i--) {
      const c = C2[i];
      c.life -= dt;
      if (c.life <= 0) { C2.splice(i, 1); continue; }
      if (!live) continue;
      for (const f of this.fighters.values()) {
        if (!f.alive || f.id === c.o) continue;
        const dx = f.x - c.x, dy = f.y - c.y, rr2 = c.r + f.r * 0.5;
        if (dx * dx + dy * dy > rr2 * rr2) continue;
        if (f.dotMark[c.kind] !== this.simN) { f.dotMark[c.kind] = this.simN; this.hurt(f, c.dps * dt, c.o, c.kind, true); }
        if (c.slow) f.slowT = Math.max(f.slowT, 0.35);
      }
      for (const e of this.enemies) {
        const dx = e.x - c.x, dy = e.y - c.y, rr2 = c.r + e.r * 0.5;
        if (dx * dx + dy * dy > rr2 * rr2) continue;
        if (e.dotMark[c.kind] !== this.simN) { e.dotMark[c.kind] = this.simN; this.hurt(e, c.dps * dt, c.o, c.kind, true); }
        if (c.slow) e.slowT = Math.max(e.slowT, 0.35);
      }
    }
  }

  zoneDamage(dt) {
    const z = this.zoneNow;
    if (z.dps <= 0) return;
    for (const f of this.fighters.values()) if (f.alive && Math.hypot(f.x - z.x, f.y - z.y) > z.r) this.hurt(f, z.dps * dt, 0, 'zone', true);
    for (const e of this.enemies) if (Math.hypot(e.x - z.x, e.y - z.y) > z.r) this.hurt(e, z.dps * 2 * dt, 0, 'zone', true);
  }

  updatePickups(dt) {
    const z = this.zoneNow;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.life -= dt;
      if (pk.life <= 0 || Math.hypot(pk.x - z.x, pk.y - z.y) > z.r + 30) { this.pickups.splice(i, 1); continue; }
      for (const f of this.fighters.values()) {
        if (!f.alive) continue;
        const dx = f.x - pk.x, dy = f.y - pk.y, rr2 = f.r + 22;
        if (dx * dx + dy * dy < rr2 * rr2) { this.applyPickup(f, pk.t); this.pickups.splice(i, 1); break; }
      }
    }
  }

  spawns(dt) {
    const z = this.zoneNow;
    this.spawnT -= dt;
    const target = Math.min(FBR.clamp(Math.round(z.r / 55), 8, 46), 5 + Math.floor(this.time / 3.5));
    if (this.spawnT <= 0 && this.enemies.length < target) {
      this.spawnT = 0.55;
      const p = this.spawnPoint(Math.max(420, 720 - this.time * 6));
      if (p) {
        const s = z.stage, roll = Math.random();
        let type = 'fly';
        if (s <= 1) type = roll < 0.7 ? 'fly' : 'spit';
        else if (s <= 3) type = roll < 0.5 ? 'fly' : roll < 0.85 ? 'spit' : 'chonk';
        else type = roll < 0.4 ? 'fly' : roll < 0.72 ? 'spit' : 'chonk';
        if (type === 'fly') { const n = 4 + ((Math.random() * 4) | 0); for (let i = 0; i < n; i++) spawnEnemy(this, 'fly', p.x + rr(-50, 50), p.y + rr(-50, 50)); }
        else spawnEnemy(this, type, p.x, p.y);
      }
    }
    this.chaos(dt);
    this.puT -= dt;
    if (this.puT <= 0 && this.pickups.length < 26) {
      const g = Math.min(1, this.time / 150);
      this.puT = rr(3.4, 5.6) - 1.2 * g;
      const p = this.spawnPoint(0, 30);
      if (p) this.dropPickup(p.x, p.y);
    }
  }

  /* ------------------------------------------------------------ chaos events */
  chaos(dt) {
    this.evT -= dt;
    if (this.evT <= 0 && this.aliveCount() > 2) {
      const kinds = ['rain', 'swarm', 'party'].filter(k => k !== this.lastEv);
      this.startEvent(kinds[(Math.random() * kinds.length) | 0]);
      this.evT = rr(22, 32);
    }
    const E = this.eventNow;
    if (E) {
      E.t -= dt;
      if (E.kind === 'rain') { E.spawnT -= dt; if (E.spawnT <= 0) { E.spawnT = 0.26; this.dropMeteor(); } }
      if (E.t <= 0) this.eventNow = null;
    }
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.t -= dt;
      if (h.t > 0) continue;
      this.hazards.splice(i, 1);
      this.explode(h.x, h.y, h.r, 28, 760, null, 'meteor');
    }
  }

  startEvent(kind) {
    this.lastEv = kind;
    this.ev(['w', kind], 0, 0, true);
    const alive = this.aliveList();
    if (kind === 'rain') this.eventNow = { kind, t: 9, spawnT: 1.4 };
    else if (kind === 'swarm') {
      const picks = shuffle(alive.slice()).slice(0, 3);
      for (const f of picks) {
        const a0 = rr(0, TAU);
        for (let k = 0; k < 2; k++) {
          const a = a0 + k * 2.1, d = rr(430, 540), cx = f.x + Math.cos(a) * d, cy = f.y + Math.sin(a) * d;
          if (Math.hypot(cx, cy) > C.ARENA_R - 90 || this.blocked(cx, cy, 40)) continue;
          for (let i = 0; i < 7; i++) spawnEnemy(this, 'fly', cx + rr(-60, 60), cy + rr(-60, 60));
          if (k === 0) spawnEnemy(this, Math.random() < 0.5 ? 'chonk' : 'spit', cx, cy);
        }
      }
    } else if (kind === 'party') {
      for (let i = 0; i < 18; i++) { const p = this.spawnPoint(0, 30); if (p) this.dropPickup(p.x, p.y); }
      for (const f of alive) for (let i = 0; i < 2; i++) this.dropPickup(f.x + rr(-160, 160), f.y + rr(-160, 160));
    }
  }

  dropMeteor() {
    const alive = this.aliveList(), z = this.zoneNow;
    let x, y;
    if (alive.length && Math.random() < 0.65) {
      const f = alive[(Math.random() * alive.length) | 0];
      x = f.x + (f.vx || 0) * 0.6 + rr(-150, 150); y = f.y + (f.vy || 0) * 0.6 + rr(-150, 150);
    } else { const a = rr(0, TAU), d = Math.sqrt(Math.random()) * z.r; x = z.x + Math.cos(a) * d; y = z.y + Math.sin(a) * d; }
    if (Math.hypot(x, y) > C.ARENA_R - 40) return;
    if (this.hazards.length < 40) this.hazards.push({ id: this.nid++, x, y, r: 105, t: 1.05, T: 1.05 });
  }

  spawnPoint(minDist, pad) {
    const z = this.zoneNow;
    for (let i = 0; i < 25; i++) {
      const a = rr(0, TAU), d = Math.sqrt(Math.random()) * (z.r - 70);
      const x = z.x + Math.cos(a) * d, y = z.y + Math.sin(a) * d;
      if (Math.hypot(x, y) > C.ARENA_R - 70 || this.blocked(x, y, pad || 44)) continue;
      let ok = true;
      for (const f of this.fighters.values()) if (f.alive && Math.hypot(f.x - x, f.y - y) < minDist) { ok = false; break; }
      if (ok) return { x, y };
    }
    return null;
  }

  /* ------------------------------------------------------------ levels: kills make you stronger, everyone sees it */
  levelCheck(f) {
    if (!f.alive) return;
    const want = Math.min(C.LVL_MAX, 1 + f.kills + Math.floor(f.pve / C.LVL_PVE));
    while (f.lvl < want) {
      f.lvl++;
      const add = C.LVL_HP; f.maxHp += add; f.hp = Math.min(f.maxHp, f.hp + add + 15);
      this.ev(['lv', f.id, f.lvl, r1(f.x), r1(f.y)], f.x, f.y, true);
    }
  }

  /* ------------------------------------------------------------ damage + death */
  hurt(t, amt, ownerId, kind, isDot) {
    if (this.phase !== 'live' || t.dead || amt <= 0) return 0;
    if (ownerId) { const ow = this.fighters.get(ownerId); if (ow && ow.lvl > 1) amt *= 1 + C.LVL_DMG * (ow.lvl - 1); }
    if (!t.isE && t.protT > 0) return 0;
    let abs = 0;
    if (!t.isE && t.shield > 0) { abs = Math.min(t.shield, amt); t.shield -= abs; amt -= abs; }
    t.hp -= amt;
    if (ownerId) { t.lastHitBy = ownerId; t.lastHitAt = this.time; const o = this.fighters.get(ownerId); if (o) o.dmg += amt + abs; }
    t.lastHitKind = kind;
    const total = amt + abs;
    if (isDot) {
      t.dotAcc = (t.dotAcc || 0) + total;
      if (t.dotAcc >= 5) { this.ev(['h', t.id, Math.round(t.dotAcc), r1(t.x), r1(t.y), 4 | (t.isE ? 2 : 0)], t.x, t.y); t.dotAcc = 0; }
    } else this.ev(['h', t.id, Math.round(total), r1(t.x), r1(t.y), (abs > 0 ? 1 : 0) | (t.isE ? 2 : 0)], t.x, t.y);
    if (t.hp <= 0) { t.dead = true; this.dying.push(t); }
    return amt;
  }

  knock(t, dx, dy, force) {
    const l = Math.hypot(dx, dy) || 1;
    t.kx += dx / l * force; t.ky += dy / l * force;
    const m = Math.hypot(t.kx, t.ky);
    if (m > 1100) { t.kx *= 1100 / m; t.ky *= 1100 / m; }
  }

  explode(x, y, R, dmg, force, owner, kind, clearProj) {
    this.ev(['x', kind, r1(x), r1(y), R], x, y);
    const oid = owner ? owner.id : 0;
    for (const f of this.fighters.values()) {
      if (!f.alive) continue;
      const d = Math.hypot(f.x - x, f.y - y);
      if (d > R + f.r) continue;
      const fall = 0.55 + 0.45 * (1 - Math.min(1, d / R));
      if (f !== owner) this.hurt(f, dmg * fall, oid, kind);
      this.knock(f, f.x - x, f.y - y, force * fall);
    }
    if (kind !== 'puff') for (const o of this.obs.slice()) { const d = Math.hypot(o.x - x, o.y - y); if (d <= R + o.r) this.hitObs(o, dmg * 2.2 * (0.55 + 0.45 * (1 - Math.min(1, d / R)))); }
    for (const e of this.enemies) {
      const d = Math.hypot(e.x - x, e.y - y);
      if (d > R + e.r) continue;
      const fall = 0.55 + 0.45 * (1 - Math.min(1, d / R));
      this.hurt(e, dmg * fall, oid, kind);
      this.knock(e, e.x - x, e.y - y, force * fall);
    }
    if (clearProj) {
      for (let i = this.projs.length - 1; i >= 0; i--) {
        const p = this.projs[i];
        if (p.o !== oid && Math.hypot(p.x - x, p.y - y) < R) this.projs.splice(i, 1);
      }
    }
  }

  ignite(owner, cloud) {
    const queue = [cloud];
    let n = 0;
    while (queue.length && n++ < 12) {
      const c = queue.shift();
      if (c.life <= 0) continue;
      c.life = 0;
      const R = c.r * 1.2;
      this.explode(c.x, c.y, R, 26, 460, owner, 'ignite');
      for (const o of this.clouds) if (o.life > 0 && Math.hypot(o.x - c.x, o.y - c.y) < R + o.r * 0.5) queue.push(o);
    }
  }

  processDeaths() {
    if (!this.dying.length) return;
    const list = this.dying; this.dying = [];
    const aliveBefore = this.aliveCount();
    for (const t of list) {
      if (t.isE) this.killEnemy(t); else this.killFighter(t, aliveBefore);
    }
  }

  killEnemy(e) {
    const i = this.enemies.indexOf(e);
    if (i >= 0) this.enemies.splice(i, 1);
    if (e.lastHitKind !== 'zone' && e.lastHitBy) { const k = this.fighters.get(e.lastHitBy); if (k) { k.pve++; this.levelCheck(k); } }
    this.ev(['d', 'e', ENEMY_IDS.indexOf(e.type), r1(e.x), r1(e.y)], e.x, e.y);
    if (Math.random() < ENEMIES[e.type].drop) this.dropPickup(e.x, e.y);
  }

  killFighter(f, aliveBefore) {
    f.alive = false; f.dead = false; f.diedAt = this.time; f.place = aliveBefore;
    let killer = f.lastHitBy ? (this.fighters.get(f.lastHitBy) || null) : null;
    const cause = f.lastHitKind || 'zone';
    if (cause === 'zone' && this.time - f.lastHitAt > 6) killer = null;
    if (cause.startsWith('e:')) killer = null;
    if (killer === f) killer = null;
    if (killer) { killer.kills++; f.killerId = killer.id; this.levelCheck(killer); }
    this.ev(['k', killer ? killer.name : '', f.name, cause, f.id, killer ? killer.id : 0, r1(f.x), r1(f.y), f.bot ? 1 : 0], f.x, f.y, true);
    this.ev(['d', 'f', f.id, r1(f.x), r1(f.y), Math.round(f.kx), Math.round(f.ky), killer ? killer.id : 0], f.x, f.y);
    if (Math.random() < 0.75) this.dropPickup(f.x + rr(-45, 45), f.y + rr(-45, 45));
    if (f.client) {
      f.client.send({ t: 'dead', place: f.place, kills: f.kills, pve: f.pve, dmg: Math.round(f.dmg), by: killer ? killer.name : '', cause, time: Math.round(this.time) });
    }
  }

  /* ------------------------------------------------------------ pickups */
  puWeights() {
    const g = Math.min(1, this.time / 150);
    return [14, 5 + 6 * g, 12, 9, 10, 12, 9, this.time < 40 ? 0 : 1.5 + 4 * g]; // order = PU_IDS
  }

  dropPickup(x, y) {
    const w = this.puWeights();
    let sum = 0; for (const v of w) sum += v;
    let r = Math.random() * sum, t = 0;
    for (; t < w.length - 1; t++) { r -= w[t]; if (r <= 0) break; }
    this.pickups.push({ id: this.nid++, t, x, y, life: 70 });
  }

  applyPickup(f, type) {
    const id = PU_IDS[type], def = POWERUPS[id];
    switch (id) {
      case 'heart': f.hp = Math.min(f.maxHp, f.hp + 35); break;
      case 'sticky': f.shield = Math.max(f.shield, 35); f.shieldT = Math.max(f.shieldT, 12); break;
      case 'crayon': if (f.bf.crayon <= 0) { f.maxHp += 40; f.hp += 40; } f.bf.crayon = def.dur; break;
      default: f.bf[id] = def.dur;
    }
    this.ev(['p', f.id, type, r1(f.x), r1(f.y)], f.x, f.y);
  }

  /* ------------------------------------------------------------ snapshots */
  specTarget(c) {
    let t = c.specId ? this.fighters.get(c.specId) : null;
    if (!t || !t.alive) {
      const f = c.f;
      let cand = f && f.killerId ? this.fighters.get(f.killerId) : null;
      if (!cand || !cand.alive) {
        let any = null;
        for (const o of this.fighters.values()) if (o.alive) { if (!o.bot) { any = o; break; } if (!any) any = o; }
        cand = any;
      }
      t = cand; c.specId = t ? t.id : 0;
    }
    return t;
  }

  cycleSpec(c, dir) {
    const alive = this.aliveList();
    if (!alive.length) return;
    let i = alive.findIndex(f => f.id === c.specId);
    i = (i + (dir || 1) + alive.length) % alive.length;
    c.specId = alive[i].id;
  }

  sendSnapshots() {
    for (const c of this.clients) {
      if (c.ws.bufferedAmount > 400000) continue;
      c.send(this.snapshotFor(c));
    }
  }

  snapshotFor(c) {
    const f = c.f;
    const view = f.alive ? f : this.specTarget(c);
    const vx = view ? view.x : 0, vy = view ? view.y : 0;
    const R = C.VIEW_R;
    const near = (x, y, m) => { const dx = x - vx, dy = y - vy, rr2 = R + (m || 0); return dx * dx + dy * dy <= rr2 * rr2; };
    const s = { t: 's', st: Math.round(this.clock * 1000), ack: f.lastSeq, ph: PHASE[this.phase], al: this.aliveCount(), k: f.kills, pv: f.pve, lv: f.lvl };
    if (this.phase === 'lobby') s.lt = this.manual ? 0 : Math.max(0, Math.ceil(this.lobbyT));
    else if (this.phase === 'over') s.lt = Math.max(0, Math.ceil(this.overT));
    if (this.phase === 'live') { s.tm = Math.round(this.time); s.z = this.zoneArr; }
    if (f.alive) {
      s.me = [r1(f.x), r1(f.y), r1(f.vx), r1(f.vy), r1(f.kx), r1(f.ky), r2(f.dashT), r2(f.dashDx), r2(f.dashDy), r1(f.r), r2(f.spd), f.stun ? 1 : 0, Math.ceil(f.hp), f.maxHp, Math.ceil(f.shield), flagsOf(f)];
      s.cd = f.cd.map(r1);
      const bf = [];
      PU_IDS.forEach((k, i) => { if (f.bf[k] > 0) bf.push([i, r1(f.bf[k])]); });
      s.bf = bf;
    } else { s.sp = view ? view.id : 0; if (f.queued) s.q = 1; }

    const P = [];
    for (const o of this.fighters.values()) {
      if (!o.alive || o === f) continue;
      if (!near(o.x, o.y, 60)) continue;
      if (o.invT > 0 && o !== view && Math.hypot(o.x - vx, o.y - vy) > 230) continue;
      P.push([o.id, r1(o.x), r1(o.y), Math.round(o.aim * 100), Math.ceil(o.hp), o.maxHp, flagsOf(o), Math.ceil(o.shield), o.lvl]);
    }
    s.p = P;
    const E = [];
    for (const e of this.enemies) if (near(e.x, e.y, 60)) E.push([e.id, ENEMY_IDS.indexOf(e.type), r1(e.x), r1(e.y), Math.max(1, Math.ceil(e.hp / e.maxHp * 100)), e.flags, Math.round(e.ang * 100)]);
    s.e = E;
    const B = [];
    for (const p of this.projs) if (near(p.x, p.y, 120)) B.push([p.id, r1(p.x), r1(p.y), Math.round(p.vx), Math.round(p.vy), r1(p.r), p.kind, p.o]);
    s.b = B;
    const CL = [];
    for (const k of this.clouds) if (near(k.x, k.y, k.r)) CL.push([k.id, CLOUD_KINDS.indexOf(k.kind), r1(k.x), r1(k.y), k.r, Math.round(k.life / k.maxLife * 100)]);
    s.c = CL;
    const BO = [];
    for (const b of this.bombs) if (near(b.x1, b.y1, 300)) BO.push([b.id, r1(b.x0), r1(b.y0), r1(b.x1), r1(b.y1), r2(b.t), r2(b.T)]);
    if (BO.length) s.bo = BO;
    const K = [];
    for (const k of this.pickups) if (near(k.x, k.y, 40)) K.push([k.id, k.t, r1(k.x), r1(k.y)]);
    s.k2 = K;
    if (this.hazards.length) { const HZ = []; for (const h of this.hazards) if (near(h.x, h.y, h.r)) HZ.push([h.id, r1(h.x), r1(h.y), h.r, r2(h.t), h.T]); if (HZ.length) s.hz = HZ; }
    const ev = [];
    for (const e of this.events) if (e.g || near(e.x, e.y, 250)) ev.push(e.a);
    if (ev.length) s.ev = ev;
    return s;
  }
}

module.exports = { Room, rosterEntry };
