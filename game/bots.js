'use strict';
/* Bot fighters: fill empty slots so there is always a battle. They use the same commands as humans. */
const FBR = require('../shared/shared.js');
const { SKILL_IDS } = FBR;

const BOT_NAMES = [
  'Sketchy Sam', 'Penny Pencil', 'Doodle Dan', 'Inky', 'Capt. Crayon', 'Madam Marker',
  'Scribbles', 'Mr. Eraser', 'Dot Matrix', 'Lady Lead', 'Squiggle', 'Blot',
  'Duke of Doodle', 'Col. Chalk', 'Sir Sharpie', 'Aunt Ink', 'Zigzag Zed', 'Pixel Pete',
  'Doctor Draw', 'Wobbly Walt',
];

function pickSkills() {
  const a = SKILL_IDS.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, 3);
}

function makeBotAI(skills) {
  const close = skills.filter(s => s === 'flame' || s === 'boom' || s === 'slap').length;
  return {
    tgt: null, retarget: Math.random() * 0.4, since: 0, strafe: 1, strafeT: 0,
    skillT: 2 + Math.random() * 3, px: 0, py: 0, stuckT: 0, unstick: 0, ux: 0, uy: 0,
    wx: 0, wy: 0, wT: 0, pr: close >= 2 ? 170 : close === 1 ? 230 : 310,
    aimErr: 0.08 + Math.random() * 0.12, react: 0.5 + Math.random() * 0.45,
  };
}

function pickTarget(room, b) {
  // calm opening: loot first; fight back only if someone hit us recently
  if (room.time < (b.ai.calmUntil || 0) && !(b.lastHitAt && room.time - b.lastHitAt < 3)) return null;
  let best = null, bd = 400 * 400;
  for (const e of room.enemies) {
    const dx = e.x - b.x, dy = e.y - b.y, d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = e; }
  }
  for (const f of room.fighters.values()) {
    if (f === b || !f.alive) continue;
    const dx = f.x - b.x, dy = f.y - b.y, d2 = dx * dx + dy * dy;
    if (f.invT > 0 && d2 > 160 * 160) continue;
    if (d2 / 0.8 < bd) { bd = d2 / 0.8; best = f; }
  }
  return best;
}

function botThink(room, b, dt) {
  const ai = b.ai, z = room.zoneNow;
  ai.retarget -= dt; ai.skillT -= dt; ai.strafeT -= dt; ai.wT -= dt; ai.unstick -= dt; ai.stuckT += dt;

  if (ai.retarget <= 0) {
    ai.retarget = 0.3 + Math.random() * 0.3;
    const t = pickTarget(room, b);
    if (t !== ai.tgt) ai.since = room.time;
    ai.tgt = t;
  }
  let tgt = ai.tgt;
  if (tgt && (tgt.hp <= 0 || tgt.alive === false)) { tgt = ai.tgt = null; }
  if (ai.strafeT <= 0) { ai.strafeT = 0.8 + Math.random() * 1.4; ai.strafe = Math.random() < 0.5 ? -1 : 1; }

  // --- movement goal ---
  const dc = Math.hypot(b.x - z.x, b.y - z.y);
  const dn = Math.hypot(b.x - z.nx, b.y - z.ny);
  const endangered = dc > z.r - 80 || (z.mode === 1 && dn > z.nr - 50) || (z.mode === 0 && z.left < 7 && dn > z.nr - 90);
  let mvx = 0, mvy = 0;
  let d = 1e9, ux = 0, uy = 0;
  if (tgt) {
    const dx = tgt.x - b.x, dy = tgt.y - b.y;
    d = Math.hypot(dx, dy) || 1; ux = dx / d; uy = dy / d;
  }

  if (endangered || (dn > z.nr * 0.75 && !tgt)) {
    const gx = z.nx - b.x, gy = z.ny - b.y, gl = Math.hypot(gx, gy) || 1;
    mvx = gx / gl; mvy = gy / gl;
  } else if (tgt) {
    const radial = d > ai.pr + 70 ? 1 : d < ai.pr - 70 ? -1 : 0;
    mvx = ux * radial - uy * ai.strafe * 0.8;
    mvy = uy * radial + ux * ai.strafe * 0.8;
  } else {
    // loot or roam
    let best = null, bd = 380 * 380;
    for (const pk of room.pickups) {
      const dx = pk.x - b.x, dy = pk.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = pk; }
    }
    if (best) { const gx = best.x - b.x, gy = best.y - b.y, gl = Math.hypot(gx, gy) || 1; mvx = gx / gl; mvy = gy / gl; }
    else {
      if (ai.wT <= 0 || Math.hypot(ai.wx - b.x, ai.wy - b.y) < 60) {
        ai.wT = 4 + Math.random() * 4;
        const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * z.nr * 0.7;
        ai.wx = z.nx + Math.cos(a) * rr; ai.wy = z.ny + Math.sin(a) * rr;
      }
      const gx = ai.wx - b.x, gy = ai.wy - b.y, gl = Math.hypot(gx, gy) || 1;
      mvx = gx / gl * 0.8; mvy = gy / gl * 0.8;
    }
  }

  // --- stuck handling ---
  if (ai.stuckT >= 0.6) {
    const moved = Math.hypot(b.x - ai.px, b.y - ai.py);
    if (moved < 25 && (mvx || mvy)) {
      ai.unstick = 0.7;
      const a = Math.atan2(mvy, mvx) + (Math.random() < 0.5 ? 1 : -1) * (1.2 + Math.random() * 0.6);
      ai.ux = Math.cos(a); ai.uy = Math.sin(a);
    }
    ai.px = b.x; ai.py = b.y; ai.stuckT = 0;
  }
  if (ai.unstick > 0) { mvx = ai.ux; mvy = ai.uy; }

  // --- aim + fire ---
  let aim = b.aim, fire = false;
  if (tgt) {
    const K = FBR.C.CLASSES[b.cls] || FBR.C.CLASSES.gun, lead = Math.min(1, d / K.speed);
    const tx = tgt.x + (tgt.vx || 0) * lead, ty = tgt.y + (tgt.vy || 0) * lead;
    aim = Math.atan2(ty - b.y, tx - b.x) + (Math.random() - 0.5) * 2 * ai.aimErr;
    fire = d < (K.kind === 'melee' ? K.reach + 24 : K.reachAcquire - 40) && (room.time - ai.since) > ai.react && Math.random() < 0.62;
  } else if (mvx || mvy) aim = Math.atan2(mvy, mvx);

  // --- skills ---
  let cast = -1, tx = b.x, ty = b.y;
  if (ai.skillT <= 0 && room.phase === 'live') {
    const hpf = b.hp / b.maxHp;
    for (let i = 0; i < 3; i++) {
      if (b.cd[i] > 0 || b.stun) continue;
      const id = b.skills[i];
      let use = false;
      switch (id) {
        case 'jet':
          if (hpf < 0.4 && tgt && d < 320) { use = true; mvx = -ux; mvy = -uy; }
          else if (tgt && d > 400 && d < 520 && Math.random() < 0.3) { use = true; mvx = ux; mvy = uy; }
          else if (endangered && dc > z.r) { use = true; }
          break;
        case 'vanish': use = !!tgt && hpf < 0.5 && d < 380; break;
        case 'boom': use = !!tgt && d < 175; break;
        case 'flame': use = !!tgt && d < 215; break;
        case 'bomb': if (tgt && d > 160 && d < 500) { use = true; tx = tgt.x + (tgt.vx || 0) * 0.7; ty = tgt.y + (tgt.vy || 0) * 0.7; } break;
        case 'burst': use = !!tgt && d < 470; break;
        case 'bubble': use = !!tgt && b.shield <= 0 && hpf < 0.8 && d < 400; break;
        case 'slap': use = !!tgt && d < 185; break;
      }
      if (use && Math.random() < 0.45) { cast = i; ai.skillT = 0.5 + Math.random() * 0.8; break; }
    }
    if (cast < 0) ai.skillT = 0.25;
  }

  return { seq: 0, mx: mvx, my: mvy, aim, fire: fire ? 1 : 0, cast, tx, ty };
}

module.exports = { BOT_NAMES, pickSkills, makeBotAI, botThink };
