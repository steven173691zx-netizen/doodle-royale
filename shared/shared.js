/* DOODLE ROYALE — shared definitions + deterministic movement.
 * Loaded by the Node server (require) and the browser (<script>, exposes window.FBR).
 * Movement code here is used for client-side prediction, so keep it deterministic. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FBR = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const C = {
    TICK_HZ: 40,          // server simulation rate
    SNAP_EVERY: 2,        // snapshot every N ticks (=20 Hz)
    STEP: 1 / 60,         // fixed input step used by client + server
    ARENA_R: 1900,
    VIEW_R: 1050,         // interest radius for snapshots
    P_R: 22,
    P_SPEED: 265,
    P_ACCEL: 2600,
    KNOCK_DECAY: 6.5,
    DASH_TIME: 0.2,
    DASH_SPEED: 1250,
    MAX_HP: 100,
    LVL_MAX: 10, LVL_HP: 12, LVL_DMG: 0.07, LVL_PVE: 8,   // each level: +12 max HP, +7% damage; a level per kill (or per 8 monster kills)
    MAX_FIGHTERS: 12,
    SPAWN_PROT: 4,
    MAX_HUMANS: 16,
    ROOM_MAX_TOTAL: 16,        // custom rooms: players + CPUs
    ROOM_MAX_PLAYERS: 12,
    LOBBY_SECONDS: 15,
    OVER_SECONDS: 10,
    NAME_MAX: 14,
    BASIC: { cd: 0.34, speed: 700, life: 0.8, dmg: 9, r: 8 },
    AUTO_RANGE: 540,
    DEFAULT_CLASS: 'gun',
    /* fighter classes, chosen on the draw screen. kind 'melee' swings a sword in an arc; 'shot' fires bullets.
     * reach = how far the attack lands (target acquisition range). */
    CLASSES: {
      sword: { id: 'sword', name: 'Swordsman', range: 'Short', color: '#FF7B6E', kind: 'melee', cd: 0.5, dmg: 24, reach: 118, arc: 2.0, reachAcquire: 126, speed: 700, hpBonus: 20 },
      gun:   { id: 'gun',   name: 'Gunner',    range: 'Mid',   color: '#FFA45C', kind: 'shot',  cd: 0.2,  dmg: 6,  speed: 760, life: 0.8, r: 7,  reachAcquire: 560 },
      sniper: { id: 'sniper', name: 'Sniper',   range: 'Long',  color: '#6CC8FF', kind: 'shot',  cd: 0.66, dmg: 17, speed: 760, life: 1.2, r: 11, reachAcquire: 820 },
    },      // auto-attack acquires targets inside this radius
  };

  /* ---------- Skills (the three the player picks, cast manually with 1 2 3) ---------- */
  const SKILLS = {
    jet:    { id: 'jet',    name: 'Pencil Dash',    tag: 'Mobility', cd: 5,  color: '#FFA45C', desc: 'Dash forward in a flash. Leaves a damaging graphite trail.' },
    vanish: { id: 'vanish', name: 'Invisible Ink',  tag: 'Stealth',  cd: 10, color: '#9B7BFF', desc: 'Vanish for 3 seconds (auto-fire pauses) and leave a poison ink cloud.' },
    boom:   { id: 'boom',   name: 'Eraser Wave',    tag: 'Control',  cd: 8,  color: '#FF92D0', desc: 'Shockwave that damages, blasts foes away and erases incoming shots.' },
    flame:  { id: 'flame',  name: 'Hot Marker',     tag: 'Damage',   cd: 6,  color: '#FF7A59', desc: 'Scorch a cone ahead. Burns targets and detonates ink clouds.' },
    bomb:   { id: 'bomb',   name: 'Ink Bomb',       tag: 'Area',     cd: 9,  color: '#6C7BFF', desc: 'Lob a bomb that bursts into a slowing puddle of ink.' },
    burst:  { id: 'burst',  name: 'Scribble Burst', tag: 'Damage',   cd: 6,  color: '#C9F26A', desc: 'Scribble seven quick shots in a tight spread.' },
    bubble: { id: 'bubble', name: 'Bubble Wrap',    tag: 'Defense',  cd: 13, color: '#63E6D2', desc: 'Wrap yourself in a bubble that soaks 45 damage.' },
    slap:   { id: 'slap',   name: 'Ruler Slap',     tag: 'Control',  cd: 11, color: '#FFD65C', desc: 'A loud whack that stuns everything nearby.' },
  };
  const SKILL_IDS = Object.keys(SKILLS);

  /* ---------- Power-ups (dropped / scattered, different effects) ---------- */
  const POWERUPS = {
    bolt:   { id: 'bolt',   name: 'Lightning Bolt', effect: 'Speed +45%',                 dur: 8,  color: '#FFD65C' },
    redpen: { id: 'redpen', name: 'Red Pen',        effect: 'Damage x1.6, shots burn',    dur: 10, color: '#FF6F61' },
    triple: { id: 'triple', name: 'Triple Pencil',  effect: 'Triple shot',                dur: 10, color: '#8FD36B' },
    coffee: { id: 'coffee', name: 'Espresso',       effect: 'Rapid fire, fast cooldowns', dur: 10, color: '#C9956B' },
    sticky: { id: 'sticky', name: 'Sticky Note',    effect: '+35 shield',                 dur: 0,  color: '#FFE680' },
    heart:  { id: 'heart',  name: 'Heart Sticker',  effect: 'Heal 35 HP',                 dur: 0,  color: '#FF7B9C' },
    magnet: { id: 'magnet', name: 'Magnet',         effect: 'Homing shots',               dur: 10, color: '#6CC8FF' },
    crayon: { id: 'crayon', name: 'Mega Crayon',    effect: 'Giant, +40 HP, stomp',       dur: 9,  color: '#B78CFF' },
  };
  const PU_IDS = Object.keys(POWERUPS); // index = wire id

  /* ---------- Enemies ---------- */
  const ENEMIES = {
    fly:   { id: 'fly',   name: 'Scribble', hp: 20,  r: 14, speed: 178, dmg: 7,  drop: 0.15, aggro: 700 },
    spit:  { id: 'spit',  name: 'Inkblot',  hp: 46,  r: 21, speed: 108, dmg: 10, drop: 0.38, aggro: 720 },
    chonk: { id: 'chonk', name: 'Smudge',   hp: 170, r: 36, speed: 84,  dmg: 24, drop: 1.00, aggro: 660 },
  };
  const ENEMY_IDS = Object.keys(ENEMIES);

  /* hold s, shrink s, new radius, damage/s outside The Ink */
  const ZONE_PLAN = [
    [30, 20, 1450, 2],
    [20, 18, 1050, 5],
    [18, 16, 720, 7],
    [14, 14, 450, 10],
    [10, 13, 260, 14],
    [7, 12, 110, 20],
    [5, 12, 30, 28],
  ];

  /* ---------- math helpers ---------- */
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function angDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function segHitsCircle(x0, y0, x1, y1, cx, cy, r) {
    const dx = x1 - x0, dy = y1 - y0;
    const fx = x0 - cx, fy = y0 - cy;
    const a = dx * dx + dy * dy;
    let t = a > 0 ? -(fx * dx + fy * dy) / a : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = fx + dx * t, py = fy + dy * t;
    return px * px + py * py <= r * r;
  }

  /* ---------- arena obstacles (blobs of 1-3 circles) ---------- */
  function genObstacles(seed) {
    const rnd = mulberry32(seed);
    const out = [], groups = [];
    let g = 0, tries = 0;
    while (groups.length < 30 && tries++ < 900) {
      const ang = rnd() * Math.PI * 2;
      const dist = 400 + Math.sqrt(rnd()) * (C.ARENA_R - 680);
      const x = Math.cos(ang) * dist, y = Math.sin(ang) * dist;
      const n = rnd() < 0.55 ? 1 : (rnd() < 0.6 ? 2 : 3);
      const base = 34 + rnd() * 40;
      const circles = [{ x, y, r: base }];
      for (let i = 1; i < n; i++) {
        const a2 = rnd() * Math.PI * 2, r2 = base * (0.6 + rnd() * 0.5);
        const prev = circles[i - 1], d = prev.r + r2 - 14;
        circles.push({ x: prev.x + Math.cos(a2) * d, y: prev.y + Math.sin(a2) * d, r: r2 });
      }
      let cx = 0, cy = 0;
      circles.forEach(c => { cx += c.x; cy += c.y; });
      cx /= n; cy /= n;
      let bound = 0;
      circles.forEach(c => { bound = Math.max(bound, Math.hypot(c.x - cx, c.y - cy) + c.r); });
      if (Math.hypot(cx, cy) + bound > C.ARENA_R - 90) continue;
      if (groups.some(o => Math.hypot(o.x - cx, o.y - cy) < o.r + bound + 150)) continue;
      groups.push({ x: cx, y: cy, r: bound });
      circles.forEach(c => out.push({ x: Math.round(c.x), y: Math.round(c.y), r: Math.round(c.r), g }));
      g++;
    }
    return out;
  }

  /* ---------- movement (deterministic, shared with client prediction) ---------- */
  function collide(p, obs) {
    const r = p.r || C.P_R;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const dx = p.x - o.x, dy = p.y - o.y, min = r + o.r;
      const d2 = dx * dx + dy * dy;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 0.001;
        const nx = dx / d, ny = dy / d;
        p.x = o.x + nx * min; p.y = o.y + ny * min;
        const vn = p.vx * nx + p.vy * ny;
        if (vn < 0) { p.vx -= vn * nx; p.vy -= vn * ny; }
        const kn = p.kx * nx + p.ky * ny;
        if (kn < 0) { p.kx -= kn * nx; p.ky -= kn * ny; }
      }
    }
    const dd = Math.hypot(p.x, p.y), lim = C.ARENA_R - r;
    if (dd > lim) { p.x *= lim / dd; p.y *= lim / dd; }
  }

  function startDash(p, mx, my, aim) {
    let dx = mx, dy = my, l = Math.hypot(dx, dy);
    if (l < 0.15) { dx = Math.cos(aim); dy = Math.sin(aim); l = 1; }
    p.dashDx = dx / l; p.dashDy = dy / l; p.dashT = C.DASH_TIME;
  }

  function stepMove(p, mx, my, dt, obs) {
    const l = Math.hypot(mx, my);
    if (l > 1) { mx /= l; my /= l; }
    const sp = C.P_SPEED * (p.spd || 1);
    if (p.dashT > 0) {
      p.vx = p.dashDx * C.DASH_SPEED; p.vy = p.dashDy * C.DASH_SPEED;
      p.dashT -= dt;
      if (p.dashT <= 0) { p.dashT = 0; p.vx = p.dashDx * sp; p.vy = p.dashDy * sp; }
    } else if (p.stun) {
      const k = Math.exp(-9 * dt); p.vx *= k; p.vy *= k;
    } else {
      const tx = mx * sp, ty = my * sp;
      const dx = tx - p.vx, dy = ty - p.vy, d = Math.hypot(dx, dy), m = C.P_ACCEL * dt;
      if (d <= m) { p.vx = tx; p.vy = ty; } else { p.vx += dx / d * m; p.vy += dy / d * m; }
    }
    p.x += (p.vx + p.kx) * dt;
    p.y += (p.vy + p.ky) * dt;
    const kd = Math.exp(-C.KNOCK_DECAY * dt);
    p.kx *= kd; p.ky *= kd;
    collide(p, obs);
  }

  return {
    C, SKILLS, SKILL_IDS, POWERUPS, PU_IDS, ENEMIES, ENEMY_IDS, ZONE_PLAN,
    clamp, lerp, mulberry32, angDiff, segHitsCircle, genObstacles, collide, startDash, stepMove,
  };
});
