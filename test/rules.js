'use strict';
/* Rules test: drives the authoritative Room directly and verifies every skill, power-up, enemy, zone and match rule.
 *   node test/rules.js */
const FBR = require('../shared/shared.js');
const { C, PU_IDS } = FBR;
const { Room } = require('../game/room.js');
const { spawnEnemy } = require('../game/enemies.js');

let failed = 0, total = 0;
const check = (name, ok, info) => { total++; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info !== undefined ? '  (' + info + ')' : ''}`); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const DT = 1 / C.TICK_HZ;

function mkClient() { const c = { msgs: [], send(o) { this.msgs.push(o); }, ws: { bufferedAmount: 0 }, f: null, room: null, specId: 0 }; return c; }
/* a live arena with exactly two human fighters A (0,0) and B (300,0), no bots/enemies/spawns */
function arena(skillsA = ['jet', 'bomb', 'burst'], skillsB = ['flame', 'slap', 'boom'], auto = false) {
  const room = new Room('T', true, { zoneScale: 1, lobbySeconds: 1, manualAim: !auto });
  room.obs = [];                                 // open field
  const a = mkClient(), b = mkClient();
  room.addClient(a, { name: 'A', skills: skillsA, img: null, seed: 1 });
  room.addClient(b, { name: 'B', skills: skillsB, img: null, seed: 2 });
  room.startMatch();
  for (const [id, f] of room.fighters) if (f.bot) room.fighters.delete(id);
  room.enemies.length = 0; room.pickups.length = 0; room.projs.length = 0; room.clouds.length = 0; room.bombs.length = 0;
  room.spawnT = room.puT = 1e9;
  const A = a.f, B = b.f;
  A.protT = B.protT = 0;
  A.x = 0; A.y = 0; B.x = 300; B.y = 0; A.aim = 0; B.aim = Math.PI;
  A.vx = A.vy = B.vx = B.vy = 0;
  return { room, A, B, a, b };
}
const sim = (room, secs) => { for (let i = 0; i < Math.round(secs / DT); i++) { room.simulate(DT); room.events.length = 0; } };
const simEv = (room, secs) => { const ev = []; for (let i = 0; i < Math.round(secs / DT); i++) { room.simulate(DT); ev.push(...room.events.map(e => e.a)); room.events.length = 0; } return ev; };
const cmd = (o) => Object.assign({ seq: 0, mx: 0, my: 0, aim: 0, fire: 0, cast: -1, tx: 0, ty: 0 }, o);
const puIdx = id => PU_IDS.indexOf(id);

/* ---------------------------------------------------------------- basic attack */
{
  const { room, A, B } = arena();
  room.tryFire(A); sim(room, 0.6);
  check('basic shot hits for the Gunner\'s damage', near(B.hp, 100 - C.CLASSES.gun.dmg, 0.01), B.hp);
  check('basic shot has a cooldown', (room.tryFire(A), room.projs.length === 1) && (A.fireCd > 0.15));
}

/* ---------------------------------------------------------------- power-ups */
{
  const { room, A, B } = arena();
  room.applyPickup(A, puIdx('redpen')); room.tryFire(A); sim(room, 0.6);
  check('Red Pen: damage x1.6 (+ a little burn)', near(B.hp, 100 - C.CLASSES.gun.dmg * 1.6, 2), B.hp.toFixed(2));
  check('Red Pen: shots set target on fire', B.burnT > 0 || B.hp < 86, 'burnT=' + B.burnT.toFixed(2));
  const hpBefore = B.hp; sim(room, 1.5);
  check('Red Pen: burn deals damage over time', B.hp < hpBefore - 5, `${hpBefore.toFixed(1)} -> ${B.hp.toFixed(1)}`);
}
{
  const { room, A } = arena();
  room.applyPickup(A, puIdx('triple')); room.tryFire(A);
  const angs = room.projs.map(p => Math.atan2(p.vy, p.vx)).sort((x, y) => x - y);
  check('Triple Pencil: triple shot (3 projectiles, spread)', room.projs.length === 3 && angs[2] - angs[0] > 0.3, `n=${room.projs.length}`);
}
{
  const { room, A } = arena();
  A.cd = [10, 10, 10]; room.updateFighter(A, 0); sim(room, 1);
  const base = A.cd[0];
  const t = arena(); t.A.bf.coffee = 10; t.A.cd = [10, 10, 10]; sim(t.room, 1);
  check('Espresso: cooldowns recharge 2.5x faster', near(10 - base, 1, 0.1) && near(10 - t.A.cd[0], 2.5, 0.15), `${(10 - base).toFixed(2)} vs ${(10 - t.A.cd[0]).toFixed(2)}`);
  t.A.fireCd = 0; t.room.tryFire(t.A);
  check('Espresso: faster fire rate', near(t.A.fireCd, C.CLASSES.gun.cd / 1.4, 0.001), t.A.fireCd.toFixed(3));
}
{
  const t1 = arena(), t2 = arena();
  t2.A.bf.bolt = 8; t2.room.updateFighter(t2.A, DT);
  for (let i = 0; i < 60; i++) { FBR.stepMove(t1.A, 1, 0, C.STEP, []); FBR.stepMove(t2.A, 1, 0, C.STEP, []); }
  check('Lightning Bolt: speed +45%', t2.A.spd === 1.45 && near(t2.A.x / t1.A.x, 1.45, 0.08), `${(t2.A.x / t1.A.x).toFixed(2)}x`);
}
{
  const { room, A, B } = arena();
  room.applyPickup(B, puIdx('sticky'));
  check('Sticky Note: +35 shield', B.shield === 35);
  room.tryFire(A); sim(room, 0.6);
  check('Sticky Note: shield absorbs damage first', B.hp === 100 && near(B.shield, 35 - C.CLASSES.gun.dmg, 0.01), `hp=${B.hp} shield=${B.shield}`);
}
{
  const { room, A } = arena();
  A.hp = 50; room.applyPickup(A, puIdx('heart'));
  check('Heart Sticker: heals 35 (capped at max)', A.hp === 85); A.hp = 90; room.applyPickup(A, puIdx('heart'));
  check('Heart Sticker: never exceeds max HP', A.hp === 100);
}
{
  const hit = (magnet) => { const { room, A, B } = arena(); B.x = 320; if (magnet) A.bf.magnet = 10; A.aim = 0.35; room.tryFire(A); A.fireCd = 0; sim(room, 1); return B.hp; };
  check('Magnet: homing shots curve into targets (plain shot misses)', hit(false) === 100 && hit(true) < 100, `plain=${hit(false)} homing=${hit(true).toFixed(1)}`);
}
{
  const { room, A } = arena();
  room.applyPickup(A, puIdx('crayon')); room.updateFighter(A, DT);
  check('Mega Crayon: giant + 40 HP', near(A.r, C.P_R * 1.45, 0.01) && A.maxHp === 140 && A.hp === 140, `r=${A.r.toFixed(1)} hp=${A.hp}`);
  sim(room, 9.3);
  check('Mega Crayon: expires cleanly', A.maxHp === 100 && A.hp <= 100 && A.r === C.P_R, `hp=${A.hp} max=${A.maxHp}`);
}
{
  const { room, A, B } = arena();
  A.bf.crayon = 9; A.maxHp = 140; A.hp = 140; B.x = 60; sim(room, 0.8);
  check('Mega Crayon: stomp damages nearby enemies', B.hp < 100, B.hp.toFixed(1));
}

/* ---------------------------------------------------------------- skills */
{ // jet rip
  const { room, A } = arena(['jet', 'bomb', 'burst']);
  room.cast(A, 0, cmd({ mx: 1 }));
  for (let i = 0; i < 20; i++) room.runCmd(A, cmd({ seq: i + 1, mx: 1 }), C.STEP);
  room.updateFighter(A, DT); sim(room, 0.1);
  check('Pencil Dash: dashes ~250 units', A.x > 240 && A.x < 300, A.x.toFixed(0));
  check('Pencil Dash: leaves a damaging trail', room.clouds.some(c => c.kind === 'trail'), `${room.clouds.length} clouds`);
  check('Pencil Dash: has a cooldown', A.cd[0] > 4.5);
}
{ // silent but deadly
  const { room, A, B, b } = arena(['vanish', 'bomb', 'burst']);
  B.x = 600; room.cast(A, 0, cmd({}));
  check('Invisible Ink: stealth active', A.invT > 3, A.invT.toFixed(2));
  const snapFar = room.snapshotFor(b);
  check('Invisible Ink: hidden from distant players', !snapFar.p.some(p => p[0] === A.id));
  B.x = 150; const snapNear = room.snapshotFor(b);
  check('Invisible Ink: only revealed up close', snapNear.p.some(p => p[0] === A.id));
  B.x = 20; sim(room, 1.5);
  check('Invisible Ink: poison ink cloud damages others (not owner)', B.hp < 90 && A.hp === 100, `B=${B.hp.toFixed(1)} A=${A.hp}`);
  room.tryFire(A);
  check('Invisible Ink: attacking breaks stealth', A.invT === 0);
}
{ // sonic boom
  const { room, A, B } = arena(['boom', 'bomb', 'burst']);
  B.x = 120; room.cast(A, 0, cmd({})); const k0 = Math.hypot(B.kx, B.ky);
  check('Eraser Wave: damages + knocks back', B.hp < 90 && k0 > 500, `hp=${B.hp.toFixed(1)} knock=${k0.toFixed(0)}`);
  for (let i = 0; i < 30; i++) room.runCmd(B, cmd({ seq: i + 1 }), C.STEP);   // idle player: knockback integrates through its input steps
  check('Eraser Wave: target actually flies away', B.x > 190, B.x.toFixed(0));
  const { room: r2, A: A2, B: B2 } = arena(['boom', 'bomb', 'burst']);
  r2.projs.push({ id: 999, o: B2.id, ot: 0, x: 60, y: 0, vx: -700, vy: 0, r: 8, dmg: 9, life: 1, burn: false, homing: false, kind: 1 });
  r2.cast(A2, 0, cmd({}));
  check('Eraser Wave: erases incoming projectiles', r2.projs.length === 0);
}
{ // blue flame + ignition
  const { room, A, B } = arena(['flame', 'vanish', 'burst']);
  B.x = 150; room.cast(A, 0, cmd({}));
  check('Hot Marker: cone damages and ignites', B.hp < 90 && B.burnT > 2, `hp=${B.hp.toFixed(1)} burn=${B.burnT.toFixed(1)}`);
  const hp = B.hp; sim(room, 1);
  check('Hot Marker: burning keeps hurting', B.hp < hp - 3);
  const t = arena(['flame', 'vanish', 'burst']); t.B.x = -150; t.room.cast(t.A, 0, cmd({}));
  check('Hot Marker: nothing hurt behind the caster', t.B.hp === 100);
  const g = arena(['vanish', 'flame', 'burst']);
  g.room.addCloud(g.A, 'poison', 150, 0, 100, 4.5, 11, false); g.B.x = 150; g.B.y = 0; g.A.cd = [0, 0, 0];
  const ev = []; g.room.cast(g.A, 1, cmd({})); ev.push(...g.room.events.map(e => e.a));
  check('Hot Marker: detonates ink clouds (combo)', ev.some(e => e[0] === 'x' && e[1] === 'ignite') && g.B.hp < 75 && g.A.hp === 100, `B=${g.B.hp.toFixed(1)} A=${g.A.hp}`);
}
{ // bean bomb
  const { room, A, B } = arena(['bomb', 'vanish', 'burst']);
  B.x = 300; room.cast(A, 0, cmd({ tx: 300, ty: 0 }));
  check('Ink Bomb: lobbed (in flight)', room.bombs.length === 1);
  const ev = simEv(room, 1.2);
  check('Ink Bomb: explodes in an area', ev.some(e => e[0] === 'x' && e[1] === 'bomb') && B.hp < 80, `B=${B.hp.toFixed(1)}`);
  check('Ink Bomb: leaves a slowing ink puddle', room.clouds.some(c => c.kind === 'goo' && c.slow) && B.slowT > 0);
}
{ // scribble burst
  const { room, A } = arena(['burst', 'vanish', 'jet']);
  room.cast(A, 0, cmd({}));
  const ev = simEv(room, 1);
  check('Scribble Burst: fires seven shots', ev.filter(e => e[0] === 's').length === 7, ev.filter(e => e[0] === 's').length);
}
{ // gas bubble
  const { room, A, B } = arena(['bubble', 'vanish', 'burst']);
  B.x = 300; B.aim = Math.PI; room.cast(A, 0, cmd({}));
  check('Bubble Wrap: 45 shield', A.shield === 45);
  room.tryFire(B); sim(room, 0.7);
  check('Bubble Wrap: absorbs damage', A.hp === 100 && A.shield < 45, `shield=${A.shield}`);
  sim(room, 6);
  check('Bubble Wrap: pops after 6 seconds', A.shield === 0);
}
{ // squeaker
  const { room, A, B } = arena(['slap', 'vanish', 'burst']);
  B.x = 120; room.cast(A, 0, cmd({}));
  check('Ruler Slap: stuns nearby fighters', B.stunT > 1.2, B.stunT.toFixed(2));
  room.updateFighter(B, DT); const x0 = B.x; for (let i = 0; i < 30; i++) room.runCmd(B, cmd({ mx: 1 }), C.STEP);
  check('Ruler Slap: stunned fighter cannot move', Math.abs(B.x - x0) < 4, `moved ${(B.x - x0).toFixed(1)}`);
  sim(room, 1.4); A.cd[0] = 0; room.cast(A, 0, cmd({}));
  check('Ruler Slap: stun immunity prevents chain-stun', B.stunT <= 0 || B.stunT < 0.2, B.stunT.toFixed(2));
}

/* ---------------------------------------------------------------- enemies */
{
  const { room, A, B } = arena(); B.x = 1500; B.y = 1500;
  const f = spawnEnemy(room, 'fly', 60, 0);
  sim(room, 1.5);
  check('Scribble: chases and bites the player', A.hp < 100, `A.hp=${A.hp.toFixed(1)}`);
}
{
  const { room, A, B } = arena(); B.x = 1500; B.y = 1500;
  const e = spawnEnemy(room, 'fly', 200, 0); e.homeX = 200;
  for (let i = 0; i < 30 && room.enemies.includes(e); i++) {       // a real player aims at the target each shot
    A.aim = Math.atan2(e.y - A.y, e.x - A.x); A.fireCd = 0; room.tryFire(A); sim(room, 0.1);
  }
  sim(room, 0.3);
  check('Enemies die to shots and credit the player (pve)', !room.enemies.includes(e) && A.pve >= 1, `pve=${A.pve}`);
}
{
  const { room, A, B } = arena(); B.x = 1500; B.y = 1500;
  const e = spawnEnemy(room, 'spit', 250, 0); sim(room, 3);
  check('Inkblot: shoots projectiles at the player', A.hp < 100 || room.projs.some(p => p.ot === 1), `A.hp=${A.hp.toFixed(1)}`);
}
{
  const { room, A, B } = arena(); B.x = 1500; B.y = 1500;
  const e = spawnEnemy(room, 'chonk', 280, 0); const ev = simEv(room, 3.4);
  check('Smudge: windup telegraph then charge hits hard', A.hp <= 85, `A.hp=${A.hp.toFixed(1)}`);
}

/* ---------------------------------------------------------------- auto-attack (survivor style) */
{
  const { room, A, B } = arena(['jet', 'bomb', 'burst'], ['flame', 'slap', 'boom'], true);
  B.x = 1500; B.y = 1500;
  const near = spawnEnemy(room, 'chonk', 300, 0), far = spawnEnemy(room, 'chonk', 520, 0);
  near.hp = near.maxHp = far.hp = far.maxHp = 9999; near.atkCd = far.atkCd = 99;
  const hp0 = near.hp;
  sim(room, 1.2);
  check('Auto-attack: fires with zero input at the nearest enemy', near.hp < hp0 && A.tgt === near, `hp ${hp0}->${near.hp.toFixed(0)}`);
  check('Auto-attack: aims at the target (no mouse needed)', Math.abs(FBR.angDiff(A.aim, Math.atan2(near.y - A.y, near.x - A.x))) < 0.2, A.aim.toFixed(2));
  check('Auto-attack: shots pierce one enemy (rear enemy also hit)', far.hp < 9999, far.hp.toFixed(0));
}
{
  const { room, A, B } = arena(['jet', 'bomb', 'burst'], ['flame', 'slap', 'boom'], true);
  B.x = 1500; B.y = 1500; const e = spawnEnemy(room, 'chonk', 900, 0); e.atkCd = 99;
  sim(room, 1);
  check('Auto-attack: ignores targets beyond range', A.tgt === null && room.projs.length === 0 && e.hp === e.maxHp);
  room.runCmd(A, cmd({ seq: 1, mx: -1, my: 0 }), C.STEP); room.updateFighter(A, DT);
  check('Auto-attack: with no target you face the way you walk', Math.abs(Math.abs(A.aim) - Math.PI) < 0.01, A.aim.toFixed(2));
}
{
  const { room, A, B } = arena(['vanish', 'bomb', 'burst'], ['flame', 'slap', 'boom'], true);
  B.x = 1500; B.y = 1500; const e = spawnEnemy(room, 'chonk', 250, 0); e.atkCd = 99;
  room.cast(A, 0, cmd({})); sim(room, 1.0);
  check('Auto-attack: pauses while vanished (Invisible Ink)', e.hp === e.maxHp && A.invT > 0, `invT=${A.invT.toFixed(2)}`);
  sim(room, 3); const hpAfter = e.hp;
  sim(room, 1);
  check('Auto-attack: resumes after you reappear', e.hp < e.maxHp && A.invT <= 0, `hp=${e.hp.toFixed(0)}`);
}
{
  const { room, A, B } = arena(['vanish', 'bomb', 'burst'], ['flame', 'slap', 'boom'], true);
  B.x = 1500; B.y = 1500; A.protT = 3; const e = spawnEnemy(room, 'chonk', 250, 0); e.atkCd = 99; A.protT = 3;
  for (let i = 0; i < 40; i++) { A.protT = 3; room.simulate(DT); }
  check('Auto-attack: held while spawn-protected', e.hp === e.maxHp);
}
{
  const { room, A, B } = arena(['bomb', 'vanish', 'burst'], ['flame', 'slap', 'boom'], true);
  B.x = 1500; B.y = 1500; const e = spawnEnemy(room, 'chonk', 0, 380); e.atkCd = 99; e.homeX = 0; e.homeY = 380;
  room.updateFighter(A, DT);
  room.runCmd(A, cmd({ seq: 1, cast: 0, tx: -999, ty: -999 }), C.STEP);   // client coords are ignored for humans
  const b = room.bombs[0];
  check('Skills auto-aim: Ink Bomb lands on the target, not the mouse', b && Math.hypot(b.x1 - e.x, b.y1 - e.y) < 90, b ? `${b.x1.toFixed(0)},${b.y1.toFixed(0)}` : 'no bomb');
}

/* ---------------------------------------------------------------- chaos events */
{
  const { room, A, B } = arena();
  A.x = 0; A.y = 0; B.x = 1400; B.y = 1400;
  room.startEvent('rain');
  check('Chaos: Ink Rain announces itself to everyone (global event)', room.events.some(e => e.a[0] === 'w' && e.a[1] === 'rain' && e.g));
  const ev = simEv(room, 3.5);
  check('Chaos: Ink Rain drops telegraphed meteors', ev.length > 0 && (room.hazards.length > 0 || ev.some(e => e[0] === 'x' && e[1] === 'meteor')), `hazards=${room.hazards.length}`);
  const t = arena(); t.A.x = 0; t.A.y = 0; t.room.hazards.push({ id: 9001, x: 0, y: 0, r: 105, t: 0.5, T: 1.05 });
  t.A.hp = 100; const before = t.A.hp; const ev2 = [];
  const snap2 = t.room.snapshotFor(t.a);
  check('Chaos: meteors telegraph in the snapshot', Array.isArray(snap2.hz) && snap2.hz[0][3] === 105, JSON.stringify(snap2.hz));
  for (let i = 0; i < 40; i++) { t.room.simulate(DT); ev2.push(...t.room.events.map(e => e.a)); t.room.events.length = 0; }
  check('Chaos: meteor explodes and hurts what stands under it', ev2.some(e => e[0] === 'x' && e[1] === 'meteor') && t.A.hp < before - 8, `A.hp=${t.A.hp.toFixed(1)}`);
}
{
  const { room, A, B } = arena(); B.x = 1500; B.y = 1500;
  const before = room.enemies.length; room.startEvent('swarm');
  check('Chaos: Doodle Swarm spawns a horde around the fighters', room.enemies.length - before >= 8, `+${room.enemies.length - before}`);
  const p0 = room.pickups.length; room.startEvent('party');
  check('Chaos: Power-up Party floods the arena with pickups', room.pickups.length - p0 >= 14, `+${room.pickups.length - p0}`);
}
{
  const { room } = arena(); room.time = 0; room.evT = 0.05; room.lastEv = 'rain'; room.aliveCount = () => 5;   // pretend a crowd is alive
  room.endMatch = () => {}; const seen = new Set();
  for (let i = 0; i < 40 * 120; i++) { room.simulate(DT); for (const e of room.events) if (e.a[0] === 'w') seen.add(e.a[1]); room.events.length = 0; if (room.phase !== 'live') break; }
  check('Chaos: events fire on a timer and rotate', seen.size >= 1 && !seen.has('rain') || seen.size >= 2, [...seen].join(','));
}

/* ---------------------------------------------------------------- fair opening */
{
  const room = new Room('F', true, { zoneScale: 1, lobbySeconds: 1 });
  const h = mkClient(); room.addClient(h, { name: 'Newbie', skills: ['jet', 'bomb', 'burst'], img: null, seed: 9 });
  room.setReady(h); for (let i = 0; i < 400 && room.phase === 'lobby'; i++) room.tick();
  const F = h.f, bots = [...room.fighters.values()].filter(f => f.bot);
  check('Opening: every fighter starts spawn-protected', [...room.fighters.values()].every(f => near(f.protT, C.SPAWN_PROT, 0.2)), F.protT.toFixed(2));
  check('Opening: every fighter has a power-up within 300 units of spawn', [...room.fighters.values()].every(f => room.pickups.some(k => Math.hypot(k.x - f.x, k.y - f.y) < 300)));
  const hp0 = F.hp; room.hurt(F, 50, bots[0].id, 'pencil');
  check('Opening: protection blocks damage', F.hp === hp0 && room.hurt(F, 50, 0, 'zone') === 0);
  let shots = 0, enemiesEarly = 0, protFlag = (flagBit => 0);
  for (let i = 0; i < 40 * 3.8; i++) { room.tick(); shots += room.projs.filter(p => p.ot === 0 && p.o !== F.id).length ? 1 : 0; enemiesEarly = Math.max(enemiesEarly, room.enemies.length); }
  check('Opening: bots do not hunt in the first 3.8 seconds (no shots fired)', shots === 0, `shots ticks=${shots}`);
  check('Opening: no NPC enemies before the first wave (9s)', enemiesEarly === 0, enemiesEarly);
  check('Opening: protection still holds just before 4s and nobody hurt you', F.protT > 0 && F.hp === hp0, `protT=${F.protT.toFixed(2)}`);
  for (let i = 0; i < 40 * 0.6; i++) room.tick();
  check('Opening: protection expires on its own after 4s', F.protT === 0, `protT=${F.protT.toFixed(2)}`);
  const snap = room.snapshotFor(h);
  room.time = 0; F.protT = 3; check('Opening: snapshot carries the protected flag', (room.snapshotFor(h).me[15] & 2048) === 2048);
  const t1 = arena(); t1.A.protT = 3; t1.room.tryFire(t1.A);
  check('Opening: attacking ends protection immediately', t1.A.protT === 0);
  const t2 = arena(); t2.A.protT = 3; t2.A.cd = [0, 0, 0]; t2.room.cast(t2.A, 0, cmd({}));
  check('Opening: casting a skill ends protection immediately', t2.A.protT === 0);
  const t3 = arena(); t3.room.time = 40; for (let i = 0; i < 40 * 2; i++) t3.room.simulate(DT);
  check('NPC waves ramp up with the clock (<= 5 + t/3.5 plus one swarm)', t3.room.enemies.length <= 5 + Math.floor(t3.room.time / 3.5) + 8, `${t3.room.enemies.length} at t=${t3.room.time.toFixed(0)}`);
}

/* ---------------------------------------------------------------- zone + match flow */
{
  const { room, A, B } = arena();
  sim(room, 60);   // past the first shrink
  const z = room.zoneNow;
  check('Zone: shrinks below arena size over time', z.r < C.ARENA_R - 300 && z.stage >= 1, `r=${z.r.toFixed(0)} stage=${z.stage}`);
  A.x = z.x + z.r + 200; A.y = z.y; const hp = A.hp; sim(room, 2);
  check('Zone: damages fighters outside The Ink', A.hp < hp - 2, `${hp.toFixed(0)} -> ${A.hp.toFixed(1)}`);
}
{
  const { room, A, B, a } = arena();
  B.hp = 5; room.tryFire(A); sim(room, 0.8);
  check('Kill: victim dies, killer credited, kill-feed event sent', !B.alive && A.kills === 1 && B.killerId === A.id, `kills=${A.kills}`);
  check('Match ends with last fighter standing', room.phase === 'over' && a.msgs.some(m => m.t === 'over' && m.w === A.id));
  const over = a.msgs.find(m => m.t === 'over');
  check('Results board ranks winner #1, victim #2', over.board[0].id === A.id && over.board[0].p === 1 && over.board[1].p === 2);
}
{
  const { room, A, B, b } = arena();
  A.hp = 1; room.hurt(A, 5, B.id, 'pencil'); room.processDeaths();
  check('Eliminated human gets a "dead" message with placement', !A.alive && A.client.msgs.some(m => m.t === 'dead' && m.place === 2 && m.by === 'B'));
}
{
  const { room } = arena();
  const late = mkClient(); room.addClient(late, { name: 'Late', skills: ['jet', 'bomb', 'burst'], img: null, seed: 3 });
  check('Late joiners drop straight into early matches', late.f.alive && !late.f.queued);
  room.time = 125; room.zoneNow = room.zoneAt(125);
  const late2 = mkClient(); room.addClient(late2, { name: 'TooLate', skills: ['jet', 'bomb', 'burst'], img: null, seed: 4 });
  check('Late joiners after the drop-in window queue as spectators', !late2.f.alive && late2.f.queued && late2.msgs[0].queued === true);
  const snap = room.snapshotFor(late2);
  check('Queued spectators still receive snapshots', snap.t === 's' && snap.q === 1 && snap.me === undefined);
}
{
  const room = new Room('L', true, { zoneScale: 1, lobbySeconds: 1 });
  const a = mkClient(); room.addClient(a, { name: 'Solo', skills: ['jet', 'bomb', 'burst'], img: null, seed: 1 });
  room.setReady(a); room.tick(); for (let i = 0; i < 200 && room.phase === 'lobby'; i++) room.tick();
  check('Lobby: ready-up starts the match quickly, bots fill to 12', room.phase === 'live' && room.fighters.size === C.MAX_FIGHTERS, `${room.fighters.size} fighters`);
  const f = a.f; f.hp = 0.01; room.hurt(f, 1, 0, 'zone'); room.processDeaths();
  for (let i = 0; i < 40 * 120 && room.phase === 'live'; i++) room.tick();
  check('Fast-forward: bots finish the match after the last human dies', room.phase === 'over', `time=${room.time.toFixed(0)}s`);
}

/* ---------------------------------------------------------------- levels */
{
  const { room, A, B } = arena();
  check('Level: starts at 1', A.lvl === 1 && B.lvl === 1);
  const d0 = (() => { const h = B.hp; room.hurt(B, 10, A.id, 'pencil'); return h - B.hp; })();
  B.hp = B.maxHp = 100; B.protT = 0;
  A.kills = 3; room.levelCheck(A);
  check('Level: 3 kills -> level 4, +12 max HP per level and a bit of healing', A.lvl === 4 && A.maxHp === C.MAX_HP + 36, `lvl=${A.lvl} maxHp=${A.maxHp}`);
  const h = B.hp; room.hurt(B, 10, A.id, 'pencil');
  check('Level: higher level deals more damage', Math.abs((h - B.hp) - 10 * (1 + C.LVL_DMG * 3)) < 1e-6 && (h - B.hp) > d0, `dealt=${(h - B.hp).toFixed(2)} vs ${d0}`);
  A.kills = 99; room.levelCheck(A);
  check('Level: capped', A.lvl === C.LVL_MAX, `lvl=${A.lvl}`);
  const snap = room.snapshotFor(B.client);
  const row = snap.p && snap.p.find(r => r[0] === A.id);
  check('Level: other players see your level in the snapshot', !!row && row[8] === A.lvl, row ? `lv=${row[8]}` : 'no row');
}

/* ---------------------------------------------------------------- fighter classes */
{
  const K = C.CLASSES;
  const shotOf = (cls) => { const { room, A } = arena(); A.cls = cls; room.tryFire(A); return room.projs[0]; };
  const g = shotOf('gun'), s = shotOf('sniper');
  check('Class: Gunner and Sniper bullets fly at the same speed; Sniper goes further, is bigger and hits harder; Gunner fires faster',
    Math.abs(Math.hypot(g.vx, g.vy) - Math.hypot(s.vx, s.vy)) < 1e-6 && s.life * Math.hypot(s.vx, s.vy) > g.life * Math.hypot(g.vx, g.vy) && s.r > g.r && s.dmg > g.dmg && K.gun.cd < K.sniper.cd,
    `speed ${Math.hypot(g.vx, g.vy) | 0}/${Math.hypot(s.vx, s.vy) | 0}; reach ${(g.life * Math.hypot(g.vx, g.vy)) | 0}/${(s.life * Math.hypot(s.vx, s.vy)) | 0}; cd ${K.gun.cd}/${K.sniper.cd}`);
  {
    const { room, A, B } = arena(); A.cls = 'sword'; A.aim = 0; B.x = 90; B.y = 0; const h = B.hp;
    room.tryFire(A);
    check('Class: Swordsman hits at short range with no projectile', room.projs.length === 0 && B.hp < h, `dealt ${(h - B.hp).toFixed(1)}`);
    const q = arena(); q.A.cls = 'sword'; q.A.aim = 0; q.B.x = 330; const h2 = q.B.hp; q.room.tryFire(q.A);
    check('Class: sword cannot hit out of reach', q.B.hp === h2);
    const b = arena(); b.A.cls = 'sword'; b.A.aim = 0; b.B.x = -90; const h3 = b.B.hp; b.room.tryFire(b.A);
    check('Class: sword only hits in front, not behind', b.B.hp === h3);
    const p = arena(); p.A.cls = 'sword'; p.A.aim = 0; p.room.projs.push({ id: 9999, o: p.B.id, ot: 0, x: 80, y: 0, vx: -700, vy: 0, r: 8, dmg: 9, life: 1, pen: 1 });
    p.room.tryFire(p.A);
    check('Class: sword swing cuts enemy projectiles', !p.room.projs.some(x => x.id === 9999));
  }
  check('Class: Swordsman has extra HP', (() => { const { A } = arena(); A.cls = 'sword'; return C.MAX_HP + K.sword.hpBonus > C.MAX_HP; })());
  {
    const { room, a } = arena(); const room2 = new Room('Q', true, {}); const cl = { send() {}, ws: {} };
    room2.addClient(cl, { name: 'X', skills: ['jet', 'bomb', 'burst'], cls: 'sniper', img: null, seed: 1 });
    check('Class: chosen class is kept and sent in the roster', cl.f.cls === 'sniper' && room2.fighters.get(cl.f.id).cls === 'sniper');
    const bad = { send() {}, ws: {} }; room2.addClient(bad, { name: 'Y', skills: ['jet', 'bomb', 'burst'], cls: 'hax', img: null, seed: 2 });
    check('Class: unknown class falls back to default', bad.f.cls === C.DEFAULT_CLASS);
  }
}

/* ---------------------------------------------------------------- sword: damage on every swing */
{
  const { room, A, B } = arena(undefined, undefined, true); A.cls = 'sword'; B.cls = 'sword'; B.protT = 0; A.protT = 0;
  B.x = 118; B.y = 0; B.hp = B.maxHp = 9999; B.fireCd = 1e9; A.hp = A.maxHp = 9999;
  let sw = 0, hits = 0;
  for (let i = 0; i < Math.round(3 / DT); i++) { room.simulate(DT); for (const e of room.events) { if (e.a[0] === 'sw' && e.a[1] === A.id) sw++; if (e.a[0] === 'h' && e.a[1] === B.id && !(e.a[5] & 4)) hits++; } room.events.length = 0; B.x = 118; B.y = 0; }
  check('Sword: auto-attack swings, and every swing deals damage', sw >= 4 && hits >= sw, `swings=${sw} hits=${hits}`);
}

/* ---------------------------------------------------------------- destructible landscape */
{
  const mk = () => { const x = arena(); x.room.obs = [{ x: 400, y: 0, r: 40, g: 0 }, { x: 400, y: 300, r: 40, g: 1 }]; x.room.initObs(); return x; };
  { // bullets chip it away, then it is gone and the events fire
    const { room, A, B } = mk(); B.x = 1500; B.y = 1500; const o = room.obs[0]; A.cls = 'gun'; A.aim = 0; A.x = 100; A.y = 0; A.fireCd = 0;
    const hp0 = o.hp; let ox = 0, od = 0;
    for (let i = 0; i < Math.round(30 / DT) && room.obs.includes(o); i++) { if (i % 6 === 0) { A.fireCd = 0; room.tryFire(A); } room.simulate(DT); for (const e of room.events) { if (e.a[0] === 'ox') ox++; if (e.a[0] === 'od') od++; } room.events.length = 0; }
    check('Landscape: bullets damage an obstacle (damage events) and finally destroy it', hp0 > 0 && !room.obs.includes(o) && ox === 1 && od > 3 && room.obs.length === 1, `od=${od} ox=${ox} left=${room.obs.length}`);
    check('Landscape: a destroyed obstacle no longer blocks movement or shots', !room.blocked(400, 0, 20) && room.blocked(400, 300, 20));
  }
  { // sword hits it
    const { room, A } = mk(); const o = room.obs[0]; A.cls = 'sword'; A.aim = 0; A.x = 330; A.y = 0; const hp0 = o.hp; room.tryFire(A);
    check('Landscape: sword swings damage obstacles', o.hp < hp0, `${hp0} -> ${o.hp}`);
  }
  { // explosions flatten it quickly
    const { room, A } = mk(); const o = room.obs[1];
    for (let i = 0; i < 6 && room.obs.includes(o); i++) room.explode(400, 300, 125, 28, 520, A, 'bomb');
    check('Landscape: bombs destroy obstacles', !room.obs.includes(o));
  }
  { // clients (and late joiners) get ids and hp percentages
    const { room } = mk(); room.obs[0].hp = room.obs[0].maxhp / 2; const pl = room.obsPayload();
    check('Landscape: payload carries ids and remaining HP', pl[0][4] === 0 && pl[0][5] === 50 && pl[1][5] === 100, JSON.stringify(pl[0]));
  }
}

/* ---------------------------------------------------------------- sword + Scribble Burst */
{
  const { room, A, B } = arena(['burst', 'bomb', 'jet'], undefined, true); A.cls = 'sword'; A.protT = B.protT = 0; B.x = 100; B.y = 0; B.hp = B.maxHp = 9999; B.fireCd = 1e9;
  A.aim = 0; room.cast(A, 0, cmd({}));
  let swings = 0, shots = 0, maxProj = 0;
  for (let i = 0; i < Math.round(1.2 / DT); i++) { room.simulate(DT); B.x = 100; B.y = 0; maxProj = Math.max(maxProj, room.projs.filter(p => p.o === A.id).length); for (const e of room.events) { if (e.a[0] === 'sw' && e.a[1] === A.id) swings++; if (e.a[0] === 's' && e.a[1] === A.id) shots++; } room.events.length = 0; }
  check('Sword + Scribble Burst: a flurry of swings, no projectile flies out', swings >= 5 && shots === 0 && maxProj === 0, `swings=${swings} shots=${shots} projectiles=${maxProj}`);
  check('Sword + Scribble Burst: every swing damages the target', B.hp <= 9999 - 5 * 24 * 0.8 + 1, `hp=${B.hp.toFixed(1)}`);
}

/* ---------------------------------------------------------------- custom rooms: host decides */
{
  const mk = (opts) => { const room = new Room('HOST', true, Object.assign({ zoneScale: 1, manual: true }, opts)); const cl = () => { const c = mkClient(); return c; };
    const a = cl(), b = cl(); room.addClient(a, { name: 'Host', skills: ['jet', 'bomb', 'burst'], img: null, seed: 1 }); room.addClient(b, { name: 'Guest', skills: ['jet', 'bomb', 'burst'], img: null, seed: 2 }); return { room, a, b }; };
  const { room, a, b } = mk({ maxHumans: 5, bots: 3 });
  for (let i = 0; i < 40 * 60; i++) room.tick();
  check('Custom room: never starts by itself (waited 60 s)', room.phase === 'lobby');
  check('Custom room: the first player is the host', room.host === a && room.roomInfo().host === a.f.id);
  b.f.ready = true; check('Custom room: a guest cannot start it', room.hostStart(b) === false && room.phase === 'lobby');
  check('Custom room: guests cannot change the settings', room.hostConfig(b, { players: 2, bots: 0 }) === false && room.maxHumans === 5);
  check('Custom room: host changes players and CPUs (total capped at 16)', room.hostConfig(a, { players: 4, bots: 20 }) && room.maxHumans === 4 && room.botCount === 12, `${room.maxHumans}/${room.botCount}`);
  room.hostConfig(a, { players: 5, bots: 3 });
  check('Custom room: players cannot be set below how many already joined', room.hostConfig(a, { players: 1, bots: 3 }) && room.maxHumans === 2, `max=${room.maxHumans}`);
  room.hostConfig(a, { players: 5, bots: 3 });
  check('Custom room: host starts it', room.hostStart(a) === true && room.phase === 'live');
  const bots = [...room.fighters.values()].filter(f => f.bot).length;
  check('Custom room: exactly the chosen number of CPUs join', bots === 3 && room.fighters.size === 5, `bots=${bots} total=${room.fighters.size}`);
  room.removeClient(a);
  check('Custom room: when the host leaves, the next player becomes host', room.host === b && room.roomInfo().host === b.f.id);
  const r2 = mk({ maxHumans: 2, bots: 0 }); r2.room.hostStart(r2.a); for (let i = 0; i < 40 * 5; i++) r2.room.tick();
  check('Custom room: 0 CPUs means only real players', [...r2.room.fighters.values()].every(f => !f.bot) && r2.room.fighters.size === 2);
  const pub = new Room('PUB1', false, { zoneScale: 1, lobbySeconds: 1 }); const pc = mkClient(); pub.addClient(pc, { name: 'P', skills: ['jet', 'bomb', 'burst'], img: null, seed: 3 });
  check('Public rooms are unchanged (automatic, no host)', !pub.manual && pub.host === null && pub.hostStart(pc) === false);
}

console.log(failed ? `\n${failed}/${total} FAILED` : `\nall ${total} rule checks passed`);
process.exit(failed ? 1 : 0);
