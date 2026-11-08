'use strict';
/* NPC enemies: Scribble (swarm), Inkblot (ranged), Smudge (charger). */
const FBR = require('../shared/shared.js');
const { ENEMIES } = FBR;
const TAU = Math.PI * 2;
const r1 = v => Math.round(v * 10) / 10;

function nearest(room, x, y, range) {
  let best = null, bd = range * range;
  for (const f of room.fighters.values()) {
    if (!f.alive) continue;
    const dx = f.x - x, dy = f.y - y, d2 = dx * dx + dy * dy;
    if (f.invT > 0 && d2 > 170 * 170) continue; // stealthed players are ignored unless very close
    if (d2 < bd) { bd = d2; best = f; }
  }
  return best;
}

function spawnEnemy(room, type, x, y) {
  const def = ENEMIES[type];
  const stage = room.zoneNow ? room.zoneNow.stage : 0;
  const scale = 1 + Math.min(0.9, stage * 0.12);
  const e = {
    id: room.nid++, isE: true, type, x, y, vx: 0, vy: 0, kx: 0, ky: 0,
    r: def.r, hp: def.hp * scale, maxHp: def.hp * scale,
    tgt: null, retarget: Math.random() * 0.3, atkCd: 0.6 + Math.random(), hitCd: 0, cue: 0,
    st: 0, stT: 0, cdx: 0, cdy: 0, age: Math.random() * 10, ph: Math.random() * TAU,
    strafe: Math.random() < 0.5 ? -1 : 1, strafeT: 0,
    stunT: 0, burnT: 0, burnBy: 0, slowT: 0,
    lastHitBy: 0, lastHitKind: '', lastHitAt: 0, dotAcc: 0, dotMark: {},
    ang: 0, flags: 0, wx: x, wy: y, wT: 0, homeX: x, homeY: y,
  };
  room.enemies.push(e);
  return e;
}

function chonkState(e, ux, uy, spd, dt, live, hasTarget, d) {
  switch (e.st) {
    case 0:
      if (hasTarget && e.atkCd <= 0 && d < 340 && live) { e.st = 1; e.stT = 0.75; }
      return [ux * spd, uy * spd, 6];
    case 1:
      e.flags |= 4;
      e.stT -= dt;
      if (hasTarget) { e.cdx = ux; e.cdy = uy; }
      if (e.stT <= 0) { e.st = 2; e.stT = 0.55; }
      return [0, 0, 10];
    case 2:
      e.flags |= 4 | 8;
      e.stT -= dt;
      if (e.stT <= 0) { e.st = 3; e.stT = 0.9; }
      return [e.cdx * 470, e.cdy * 470, 30];
    default:
      e.stT -= dt;
      if (e.stT <= 0) { e.st = 0; e.atkCd = 1.6 + Math.random(); }
      return [0, 0, 8];
  }
}

function updateEnemy(room, e, dt) {
  const def = ENEMIES[e.type];
  const live = room.phase === 'live';
  e.age += dt;
  e.flags = 0;
  e.atkCd = Math.max(0, e.atkCd - dt);
  e.hitCd = Math.max(0, e.hitCd - dt);
  if (e.burnT > 0) { e.burnT -= dt; e.flags |= 2; room.hurt(e, 5 * dt, e.burnBy, 'burn', true); }
  if (e.slowT > 0) e.slowT -= dt;
  const spd = def.speed * (e.slowT > 0 ? 0.6 : 1);
  let mvx = 0, mvy = 0, ease = 8;

  if (e.stunT > 0) {
    e.stunT -= dt; e.flags |= 1; e.st = e.type === 'chonk' ? 0 : e.st; e.cue = 0;
  } else {
    e.retarget -= dt;
    if (e.retarget <= 0 || (e.tgt && !e.tgt.alive)) {
      e.retarget = 0.35 + Math.random() * 0.3;
      e.tgt = live ? nearest(room, e.x, e.y, def.aggro) : null;
    }
    const t = e.tgt;
    let dx = 0, dy = 0, d = 1e9, ux = 0, uy = 0;
    if (t) {
      dx = t.x - e.x; dy = t.y - e.y; d = Math.hypot(dx, dy) || 1; ux = dx / d; uy = dy / d;
      e.ang = Math.atan2(dy, dx);
    }
    if (e.type === 'chonk' && (t || e.st !== 0)) {
      const r = chonkState(e, ux, uy, spd, dt, live, !!t, d);
      mvx = r[0]; mvy = r[1]; ease = r[2];
    } else if (t && e.type === 'fly') {
      const w = Math.sin(e.age * 7 + e.ph);
      mvx = (ux - uy * w * 0.7) * spd; mvy = (uy + ux * w * 0.7) * spd;
    } else if (t && e.type === 'spit') {
      e.strafeT -= dt;
      if (e.strafeT <= 0) { e.strafeT = 1 + Math.random() * 1.5; e.strafe = Math.random() < 0.5 ? -1 : 1; }
      const radial = d > 360 ? 1 : d < 230 ? -1 : 0;
      mvx = (ux * radial - uy * e.strafe * 0.6) * spd;
      mvy = (uy * radial + ux * e.strafe * 0.6) * spd;
      if (e.cue > 0) {
        e.cue -= dt; e.flags |= 16; mvx *= 0.2; mvy *= 0.2;
        if (e.cue <= 0) {
          const lead = d / 320 * 0.8;
          const a = Math.atan2(t.y + (t.vy + t.ky) * lead - e.y, t.x + (t.vx + t.kx) * lead - e.x);
          room.projs.push({
            id: room.nid++, o: e.id, ot: 1, x: e.x + Math.cos(a) * e.r, y: e.y + Math.sin(a) * e.r,
            vx: Math.cos(a) * 320, vy: Math.sin(a) * 320, r: 9, dmg: def.dmg, life: 2.2, kind: 3, burn: false, homing: false,
          });
          room.ev(['es', r1(e.x), r1(e.y), Math.round(a * 100) / 100], e.x, e.y);
          e.atkCd = 1.7 + Math.random() * 0.6;
        }
      } else if (e.atkCd <= 0 && d < 580 && live) e.cue = 0.34;
    } else if (!t) {
      e.wT -= dt;
      if (e.wT <= 0) {
        e.wT = 2 + Math.random() * 3;
        const a = Math.random() * TAU, rr = Math.random() * 220;
        e.wx = e.homeX + Math.cos(a) * rr; e.wy = e.homeY + Math.sin(a) * rr;
      }
      const wx = e.wx - e.x, wy = e.wy - e.y, wd = Math.hypot(wx, wy);
      if (wd > 20) { mvx = wx / wd * spd * 0.35; mvy = wy / wd * spd * 0.35; e.ang = Math.atan2(wy, wx); }
    }
  }

  // contact damage
  if (live && e.stunT <= 0 && e.hitCd <= 0) {
    for (const f of room.fighters.values()) {
      if (!f.alive) continue;
      const dx = f.x - e.x, dy = f.y - e.y, rr = e.r + f.r;
      if (dx * dx + dy * dy < rr * rr) {
        const charging = e.type === 'chonk' && e.st === 2;
        room.hurt(f, e.type === 'chonk' && !charging ? def.dmg * 0.5 : def.dmg, 0, 'e:' + e.type);
        room.knock(f, dx, dy, e.type === 'chonk' ? (charging ? 820 : 420) : 240);
        e.hitCd = e.type === 'fly' ? 0.7 : 0.9;
        break;
      }
    }
  }

  const k = Math.min(1, ease * dt);
  e.vx += (mvx - e.vx) * k; e.vy += (mvy - e.vy) * k;
  e.x += (e.vx + e.kx) * dt; e.y += (e.vy + e.ky) * dt;
  const kd = Math.exp(-6 * dt); e.kx *= kd; e.ky *= kd;
  FBR.collide(e, room.obs);
}

function separateEnemies(room) {
  const a = room.enemies;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const p = a[i], q = a[j];
      const dx = q.x - p.x, dy = q.y - p.y, min = (p.r + q.r) * 0.9;
      const d2 = dx * dx + dy * dy;
      if (d2 < min * min && d2 > 0.0001) {
        const d = Math.sqrt(d2), push = (min - d) / 2;
        const nx = dx / d, ny = dy / d;
        p.x -= nx * push; p.y -= ny * push; q.x += nx * push; q.y += ny * push;
      }
    }
  }
}

module.exports = { spawnEnemy, updateEnemy, separateEnemies };
