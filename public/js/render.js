/* World renderer. House style: flat solid fills, one dark outline, no gradients / glows / shadowBlur.
 * Theme: a dark sketchbook. Graph-paper floor with faint doodles, hand-wobbled obstacles, ink-flood zone,
 * squash-and-stretch characters, ink splats that stay on the page, shard-shatter eliminations. */
const Render = (() => {
  const C = FBR.C, G = Game.G, TAU = Math.PI * 2, INK = '#0F0E12', PAPER = '#1B1A20';
  const UNIT = 76 / 128;            // world units per sprite pixel
  let cv, ctx, W = 0, H = 0, dpr = 1, scale = 1, mm = null, lastNow = 0, hatch = null;
  const vel = new Map(), pkSeen = new Map(), obsPath = new Map();
  const clamp = FBR.clamp;

  function init(canvas, minimap) {
    cv = canvas; ctx = cv.getContext('2d', { alpha: false });
    if (minimap) { mm = { cv: minimap, ctx: minimap.getContext('2d'), size: 0 }; }
    resize(); window.addEventListener('resize', resize);
  }
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    scale = Math.max(0.62, Math.min(W / 1100, H / 760));
    if (mm) { const css = mm.cv.clientWidth || 148; mm.size = Math.round(css * dpr); mm.cv.width = mm.cv.height = mm.size; }
  }
  const viewInfo = () => ({ W, H, scale });

  function hash2(x, y) { let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  const ease = (k) => 1 - Math.pow(1 - clamp(k, 0, 1), 3);

  /* ------------------------------------------------------------------ main draw */
  function draw(now) {
    const cam = G.cam, zoom = 1 + cam.zoom, s = scale * dpr * zoom;
    const dtf = Math.min(0.1, Math.max(0.001, (now - (lastNow || now)) / 1000)); lastNow = now;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = INK; ctx.fillRect(0, 0, cv.width, cv.height);
    if (!G.running) return;
    const sh = cam.shake;
    const sx = sh ? Math.sin(now * 0.11) * sh * 0.8 + (Math.random() - 0.5) * sh * 0.6 : 0, sy = sh ? Math.cos(now * 0.093) * sh * 0.8 + (Math.random() - 0.5) * sh * 0.6 : 0;
    const camx = cam.x + sx, camy = cam.y + sy;
    ctx.setTransform(s, 0, 0, s, cv.width / 2 - camx * s, cv.height / 2 - camy * s);
    const vw = W / (scale * zoom), vh = H / (scale * zoom);
    const vis = { x0: camx - vw / 2 - 160, x1: camx + vw / 2 + 160, y0: camy - vh / 2 - 160, y1: camy + vh / 2 + 160 };
    const E = Game.collect(now);

    drawFloor(vis);
    drawDecals(now);
    drawObstacles(vis, now);
    drawClouds(E.c, now, vis);
    drawHazardRings(E.hz, now);
    drawPickups(E.k, now);
    drawBombs(E.bo, now);
    drawTelegraphs(E.e, now);
    drawTargetMarker(now);
    drawEnemies(E.e, now, dtf);
    drawFighters(E.f, now, dtf);
    drawProjectiles(E.b, now);
    drawMeteors(E.hz, now);
    drawFx(now);
    drawZone(vis, now);
    drawTexts();

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScreenFx(now);
    if (mm) drawMinimap(E);
    if (vel.size > 300) vel.clear();
    if (swordSt.size > 300) swordSt.clear();
    if (G.hpd.size > 400) G.hpd.clear();
    if (pkSeen.size > 200) { const live = new Set(E.k.map(p => p.id)); for (const id of pkSeen.keys()) if (!live.has(id)) pkSeen.delete(id); }
    return E;
  }

  /* ------------------------------------------------------------------ floor: graph paper + faint doodles */
  function doodle(type, r) {
    ctx.beginPath();
    switch (type) {
      case 0: for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + i * TAU * 2 / 5; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } break;   // star
      case 1: for (let i = 0; i <= 44; i++) { const a = i * 0.34, rr = r * i / 44; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } break;                    // spiral
      case 2: ctx.moveTo(-r, r * 0.3); for (let i = 1; i <= 4; i++) ctx.lineTo(-r + i * r * 0.4, i % 2 ? -r * 0.3 : r * 0.3); ctx.moveTo(r * 0.5, -r * 0.35); ctx.lineTo(r * 0.78, -r * 0.05); ctx.lineTo(r * 0.38, r * 0.1); break;  // zigzag arrow
      case 3: ctx.arc(0, 0, r * 0.22, 0, TAU); for (let i = 0; i < 5; i++) { const a = i * TAU / 5; ctx.moveTo(Math.cos(a) * r * 0.62 + r * 0.32, Math.sin(a) * r * 0.62); ctx.arc(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.32, 0, TAU); } break;  // flower
      case 4: ctx.arc(-r * 0.4, 0, r * 0.4, Math.PI * 0.55, Math.PI * 1.5); ctx.arc(0, -r * 0.25, r * 0.5, Math.PI, 0); ctx.arc(r * 0.45, 0, r * 0.38, -Math.PI * 0.5, Math.PI * 0.45); ctx.lineTo(-r * 0.4, r * 0.38); break;  // cloud
      case 5: ctx.moveTo(-r * 0.6, -r * 0.6); ctx.lineTo(r * 0.6, r * 0.6); ctx.moveTo(r * 0.6, -r * 0.6); ctx.lineTo(-r * 0.6, r * 0.6); break;   // x
      case 6: ctx.moveTo(0, r * 0.7); ctx.bezierCurveTo(-r * 1.2, -r * 0.1, -r * 0.7, -r * 0.9, 0, -r * 0.35); ctx.bezierCurveTo(r * 0.7, -r * 0.9, r * 1.2, -r * 0.1, 0, r * 0.7); break;  // heart
      default: ctx.arc(0, 0, r * 0.36, 0, TAU); for (let i = 0; i < 8; i++) { const a = i * TAU / 8; ctx.moveTo(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55); ctx.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9); }   // sun
    }
    ctx.stroke();
  }

  function drawFloor(vis) {
    ctx.fillStyle = PAPER; ctx.beginPath(); ctx.arc(0, 0, C.ARENA_R, 0, TAU); ctx.fill();
    ctx.save(); ctx.beginPath(); ctx.arc(0, 0, C.ARENA_R, 0, TAU); ctx.clip();
    // graph-paper grid
    const g = 70, g2 = 350;
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.03)'; ctx.beginPath();
    for (let x = Math.floor(vis.x0 / g) * g; x <= vis.x1; x += g) { ctx.moveTo(x, vis.y0); ctx.lineTo(x, vis.y1); }
    for (let y = Math.floor(vis.y0 / g) * g; y <= vis.y1; y += g) { ctx.moveTo(vis.x0, y); ctx.lineTo(vis.x1, y); }
    ctx.stroke();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.055)'; ctx.beginPath();
    for (let x = Math.floor(vis.x0 / g2) * g2; x <= vis.x1; x += g2) { ctx.moveTo(x, vis.y0); ctx.lineTo(x, vis.y1); }
    for (let y = Math.floor(vis.y0 / g2) * g2; y <= vis.y1; y += g2) { ctx.moveTo(vis.x0, y); ctx.lineTo(vis.x1, y); }
    ctx.stroke();
    // margin line, like a notebook
    ctx.strokeStyle = 'rgba(255,123,110,0.10)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-1400, vis.y0); ctx.lineTo(-1400, vis.y1); ctx.stroke();
    // doodles in the margins of the world (deterministic per cell)
    const cs = 380; ctx.strokeStyle = 'rgba(255,255,255,0.085)'; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let cx = Math.floor(vis.x0 / cs); cx <= Math.floor(vis.x1 / cs); cx++) {
      for (let cy = Math.floor(vis.y0 / cs); cy <= Math.floor(vis.y1 / cs); cy++) {
        const n = hash2(cx, cy), count = n < 0.3 ? 0 : n < 0.78 ? 1 : 2;
        for (let i = 0; i < count; i++) {
          const x = (cx + 0.15 + hash2(cx * 7 + i, cy * 13 + 1) * 0.7) * cs, y = (cy + 0.15 + hash2(cx * 11 + i, cy * 5 + 2) * 0.7) * cs;
          if (Math.hypot(x, y) > C.ARENA_R - 60) continue;
          ctx.save(); ctx.translate(x, y); ctx.rotate((hash2(cx + i, cy * 3) - 0.5) * 1.2);
          doodle(Math.floor(hash2(cx * 3 + i, cy * 17) * 8), 26 + hash2(cx, cy + i * 9) * 26);
          ctx.restore();
        }
      }
    }
    ctx.restore();
    // torn-paper edge
    ctx.strokeStyle = INK; ctx.lineWidth = 20; ctx.beginPath(); ctx.arc(0, 0, C.ARENA_R + 10, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 4; ctx.setLineDash([28, 18]); ctx.beginPath(); ctx.arc(0, 0, C.ARENA_R - 8, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  }

  /* ink splats left behind by kills / bombs / meteors */
  function drawDecals(now) {
    for (const d of G.decals) {
      const age = now - d.born, pop = ease(age / 220), fade = age > 17000 ? Math.max(0, 1 - (age - 17000) / 7000) : 1;
      ctx.globalAlpha = d.a * fade; ctx.fillStyle = d.color; ctx.beginPath();
      for (const b of d.blobs) { ctx.moveTo(d.x + b.dx * pop + b.r * pop, d.y + b.dy * pop); ctx.arc(d.x + b.dx * pop, d.y + b.dy * pop, b.r * pop, 0, TAU); }
      for (const b of d.drops) { ctx.moveTo(d.x + b.dx * pop + b.r, d.y + b.dy * pop); ctx.arc(d.x + b.dx * pop, d.y + b.dy * pop, b.r * pop, 0, TAU); }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ obstacles: wobbly ink-outlined stones */
  function obsShape(o) {
    const key = o.x + ',' + o.y + ',' + o.r;
    let p = obsPath.get(key);
    if (!p) {
      p = new Path2D(); const n = 24, seed = hash2(o.x | 0, o.y | 0) * 50;
      for (let i = 0; i < n; i++) { const a = i / n * TAU, k = 1 + 0.05 * Math.sin(i * 2.3 + seed) + 0.04 * Math.sin(i * 4.1 + seed * 1.7), x = Math.cos(a) * o.r * k, y = Math.sin(a) * o.r * k; if (i) p.lineTo(x, y); else p.moveTo(x, y); }
      p.closePath(); obsPath.set(key, p); if (obsPath.size > 200) obsPath.clear();
    }
    return p;
  }
  function drawObstacles(vis, now) {
    for (const o of G.obs) {
      if (o.x + o.r < vis.x0 || o.x - o.r > vis.x1 || o.y + o.r < vis.y0 || o.y - o.r > vis.y1) continue;
      const p = obsShape(o), hk = o.hit ? clamp(1 - (now - o.hit) / 160, 0, 1) : 0, dmg = 1 - (o.hp == null ? 1 : o.hp);
      const jx = hk ? Math.sin(now * 0.12) * 3.2 * hk : 0, jy = hk ? Math.cos(now * 0.14) * 2.4 * hk : 0, sc = 1 - hk * 0.04;
      ctx.save(); ctx.translate(o.x + jx, o.y + jy); ctx.scale(sc, sc);
      ctx.fillStyle = 'rgba(15,14,18,.45)'; ctx.save(); ctx.translate(0, o.r * 0.14); ctx.fill(p); ctx.restore();
      ctx.lineJoin = 'round'; ctx.lineWidth = 8; ctx.strokeStyle = INK; ctx.stroke(p);
      ctx.fillStyle = '#2B2A32'; ctx.fill(p);
      ctx.save(); ctx.clip(p);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 2.5; ctx.beginPath();
      for (let k = -o.r * 2; k < o.r * 2; k += 20) { ctx.moveTo(k - o.r, o.r); ctx.lineTo(k + o.r, -o.r); }
      ctx.stroke();
      ctx.restore();
      ctx.save(); ctx.translate(0, -o.r * 0.1); ctx.scale(0.78, 0.78); ctx.fillStyle = '#3B3A44'; ctx.fill(p); ctx.restore();
      if (dmg > 0.05) {                      // cracks grow as it takes damage
        ctx.save(); ctx.clip(p); ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const n = 2 + Math.floor(dmg * 5), seed = (o.i || 0) * 13.7;
        for (let c = 0; c < n; c++) {
          const a0 = hash2((o.i || 0) * 7 + c, 3) * TAU, len = o.r * (0.45 + 0.6 * Math.min(1, dmg * 1.2));
          ctx.beginPath(); let x = Math.cos(a0) * o.r * 0.12, y = Math.sin(a0) * o.r * 0.12; ctx.moveTo(x, y);
          for (let s2 = 1; s2 <= 4; s2++) { const aa = a0 + (hash2(c * 5 + s2, seed | 0) - 0.5) * 1.1; x += Math.cos(aa) * len / 4; y += Math.sin(aa) * len / 4; ctx.lineTo(x, y); }
          ctx.stroke();
        }
        ctx.restore();
      }
      if (hk) { ctx.globalAlpha = hk * 0.5; ctx.fillStyle = '#fff'; ctx.fill(p); ctx.globalAlpha = 1; }
      ctx.restore();
    }
  }

  function drawClouds(list, now, vis) {
    for (const c of list) {
      if (c.x + c.r < vis.x0 || c.x - c.r > vis.x1 || c.y + c.r < vis.y0 || c.y - c.r > vis.y1) continue;
      const col = Game.CLOUD_COL[c.kind] || '#9B7BFF', fade = Math.min(1, c.life * 4);
      ctx.fillStyle = col; ctx.globalAlpha = (c.kind === 2 ? 0.34 : 0.3) * fade;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r * 0.9, 0, TAU);
      const n = c.kind === 2 ? 3 : 7;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + now * 0.0004 * (i % 2 ? 1 : -1) + c.id, rr = c.r * (0.62 + 0.08 * Math.sin(now * 0.002 + i + c.id)), pr = c.r * 0.4;
        const px = c.x + Math.cos(a) * rr, py = c.y + Math.sin(a) * rr; ctx.moveTo(px + pr, py); ctx.arc(px, py, pr, 0, TAU);
      }
      ctx.fill();
      ctx.globalAlpha = 0.55 * fade; ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash([7, 9]); ctx.lineDashOffset = -now * 0.01;
      ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------------------------ ink-rain meteors */
  function drawHazardRings(list, now) {
    for (const h of list) {
      const p = 1 - h.t / h.T;
      ctx.fillStyle = '#6C7BFF'; ctx.globalAlpha = 0.08 + 0.14 * p; ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.9; ctx.strokeStyle = '#9AA6FF'; ctx.lineWidth = 3; ctx.setLineDash([12, 10]); ctx.lineDashOffset = -now * 0.04;
      ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 0.5 + 0.5 * p; ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(h.x, h.y, Math.max(4, h.r * (1 - p)), 0, TAU); ctx.stroke();
      ctx.globalAlpha = 0.7; ctx.strokeStyle = '#9AA6FF'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(h.x - 12, h.y - 12); ctx.lineTo(h.x + 12, h.y + 12); ctx.moveTo(h.x + 12, h.y - 12); ctx.lineTo(h.x - 12, h.y + 12); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  function drawMeteors(list, now) {
    for (const h of list) {
      const k = clamp(h.t / h.T, 0, 1), y = h.y - k * k * 980, s = 22 + (1 - k) * 8;
      ctx.fillStyle = 'rgba(15,14,18,.4)'; ctx.beginPath(); ctx.ellipse(h.x, h.y + 4, s * (0.5 + (1 - k) * 0.6), s * 0.22, 0, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(h.x, y);
      ctx.fillStyle = '#4A55D6'; ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(0, -s * 2.0); ctx.bezierCurveTo(s * 0.2, -s * 1.2, s * 0.95, -s * 0.5, s * 0.95, s * 0.1); ctx.arc(0, s * 0.1, s * 0.95, 0, Math.PI); ctx.bezierCurveTo(-s * 0.95, -s * 0.5, -s * 0.2, -s * 1.2, 0, -s * 2.0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(200,208,255,.55)'; ctx.beginPath(); ctx.ellipse(-s * 0.35, -s * 0.15, s * 0.18, s * 0.3, 0.3, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  function drawPickups(list, now) {
    for (const p of list) {
      let born = pkSeen.get(p.id); if (!born) { born = now; pkSeen.set(p.id, born); }
      const id = FBR.PU_IDS[p.t], def = FBR.POWERUPS[id], rare = id === 'crayon';
      const pop = now - born < 380 ? ease((now - born) / 380) * (1 + Math.sin((now - born) / 380 * Math.PI) * 0.18) : 1;
      const bob = Math.sin(now * 0.004 + p.id) * 3.5, R = (rare ? 34 : 28) * pop;
      ctx.fillStyle = def.color; ctx.globalAlpha = 0.14 + 0.06 * Math.sin(now * 0.005 + p.id);
      ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.6; ctx.strokeStyle = def.color; ctx.lineWidth = 2; ctx.setLineDash([6, 8]); ctx.lineDashOffset = now * 0.012; ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(15,14,18,.35)'; ctx.beginPath(); ctx.ellipse(p.x, p.y + 20, 13 * pop, 4.5 * pop, 0, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(p.x, p.y + bob - 3); ctx.rotate(Math.sin(now * 0.003 + p.id) * 0.08); ctx.scale(pop, pop); Art.drawPickupShape(ctx, id, rare ? 19 : 15); ctx.restore();
    }
  }

  function drawBombs(list, now) {
    for (const b of list) {
      const x = b.x0 + (b.x1 - b.x0) * b.k, y = b.y0 + (b.y1 - b.y0) * b.k, h = 4 * b.k * (1 - b.k) * 150;
      ctx.fillStyle = '#6C7BFF'; ctx.globalAlpha = 0.1; ctx.beginPath(); ctx.arc(b.x1, b.y1, 125, 0, TAU); ctx.fill();
      ctx.globalAlpha = 0.6; ctx.strokeStyle = '#8D99FF'; ctx.lineWidth = 3; ctx.setLineDash([10, 10]); ctx.beginPath(); ctx.arc(b.x1, b.y1, 125 * (0.55 + 0.45 * b.k), 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(15,14,18,.4)'; ctx.beginPath(); ctx.ellipse(x, y + 4, 11, 5, 0, 0, TAU); ctx.fill();
      ctx.save(); ctx.translate(x, y - h); ctx.rotate(b.k * 9);
      ctx.fillStyle = '#2A2F6B'; ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.roundRect(-10, -8, 20, 20, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#F2F0EA'; ctx.beginPath(); ctx.roundRect(-5, -13, 10, 6, 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#8D99FF'; ctx.beginPath(); ctx.arc(-3.5, -1, 3, 0, TAU); ctx.fill();
      ctx.restore();
    }
  }

  function drawTelegraphs(list, now) {
    for (const e of list) {
      if (e.type !== 'chonk' || !(e.flags & 4)) continue;
      const charging = e.flags & 8;
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.ang);
      ctx.fillStyle = '#FF6F61'; ctx.globalAlpha = charging ? 0.3 : 0.14 + 0.1 * Math.sin(now * 0.03);
      ctx.fillRect(0, -e.r, 330, e.r * 2);
      ctx.globalAlpha = charging ? 0.8 : 0.5; ctx.strokeStyle = '#FF6F61'; ctx.lineWidth = 3; ctx.setLineDash([14, 10]); ctx.lineDashOffset = -now * 0.05; ctx.strokeRect(0, -e.r, 330, e.r * 2); ctx.setLineDash([]);
      ctx.restore(); ctx.globalAlpha = 1;
    }
  }

  /* where your auto-attack is aimed: a faint pencil line and corner brackets */
  function drawTargetMarker(now) {
    const t = G.autoTgt; if (!t || !G.alive) return;
    const px = G.me.x + G.off.x, py = G.me.y + G.off.y, a = Math.atan2(t.y - py, t.x - px), r = t.enemy ? 26 : 32, pulse = 1 + Math.sin(now * 0.012) * 0.07;
    ctx.save(); ctx.strokeStyle = Game.SELF_COLOR; ctx.lineCap = 'round';
    ctx.globalAlpha = 0.2; ctx.lineWidth = 2; ctx.setLineDash([6, 10]); ctx.lineDashOffset = -now * 0.03;
    ctx.beginPath(); ctx.moveTo(px + Math.cos(a) * 36, py + Math.sin(a) * 36); ctx.lineTo(t.x - Math.cos(a) * r, t.y - Math.sin(a) * r); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = 0.85; ctx.lineWidth = 3; ctx.translate(t.x, t.y); ctx.rotate(now * 0.0012);
    for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(r * pulse, -r * 0.45 * pulse); ctx.lineTo(r * pulse, -r * pulse); ctx.lineTo(r * 0.45 * pulse, -r * pulse); ctx.stroke(); }
    ctx.restore();
  }

  function bar(x, y, w, frac, col) {
    ctx.fillStyle = 'rgba(15,14,18,.8)'; ctx.beginPath(); ctx.roundRect(x - w / 2 - 2, y - 2, w + 4, 9, 4.5); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x - w / 2, y, Math.max(2, w * Math.min(1, Math.max(0, frac))), 5, 2.5); ctx.fill();
  }
  function smooth(id, target, dtf) {
    let v = G.hpd.get(id); if (v == null) v = target;
    v += (target - v) * (1 - Math.exp(-11 * dtf)); G.hpd.set(id, v); return v;
  }

  function drawEnemies(list, now, dtf) {
    list.sort((a, b) => a.y - b.y);
    for (const e of list) {
      ctx.fillStyle = 'rgba(15,14,18,.36)'; ctx.beginPath(); ctx.ellipse(e.x, e.y + e.r * 0.98, e.r * 0.9, e.r * 0.28, 0, 0, TAU); ctx.fill();
      Art.drawEnemy(ctx, e.type, e, now);
      if (e.flags & 2) flames(e.x, e.y, e.r, now);
      if (e.flags & 1) stars(e.x, e.y - e.r - 6, now);
      if (e.hp < 100) { const hp = smooth('e' + e.id, e.hp, dtf); bar(e.x, e.y - e.r - 14, Math.max(26, e.r * 1.6), hp / 100, '#FF7B6E'); }
      const hf = G.hitFlash.get(e.id);
      if (hf && now - hf < 90) { ctx.globalAlpha = 0.55 * (1 - (now - hf) / 90); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }
    }
  }

  function flames(x, y, r, now) {
    for (let i = 0; i < 3; i++) {
      const fx = x + (i - 1) * r * 0.55, fy = y - r * 0.5 - (Math.sin(now * 0.02 + i * 2) * 0.5 + 0.5) * r * 0.55, h = r * (0.6 + 0.25 * Math.sin(now * 0.03 + i));
      ctx.fillStyle = i === 1 ? '#FFD65C' : '#FF8A3C'; ctx.beginPath(); ctx.moveTo(fx - r * 0.2, fy + h * 0.3); ctx.quadraticCurveTo(fx - r * 0.1, fy - h * 0.2, fx, fy - h); ctx.quadraticCurveTo(fx + r * 0.12, fy - h * 0.1, fx + r * 0.2, fy + h * 0.3); ctx.closePath(); ctx.fill();
    }
  }
  function stars(x, y, now) {
    for (let i = 0; i < 3; i++) { const a = now * 0.008 + i * TAU / 3; Art.circ(ctx, x + Math.cos(a) * 14, y + Math.sin(a) * 4, 3.5, '#FFD65C', INK, 1.5); }
  }

  /* ------------------------------------------------------------------ fighters */
  function drawFighters(list, now, dtf) {
    list.sort((a, b) => a.y - b.y);
    for (const f of list) drawFighter(f, now, dtf);
  }

  function drawFighter(f, now, dtf) {
    const ent = G.roster.get(f.id), spr = ent && ent.spr;
    const lvs = 1 + 0.035 * ((f.lv || 1) - 1), lp = G.lvPop.get(f.id), lpk = lp && now - lp < 500 ? Math.sin((now - lp) / 500 * Math.PI) * 0.18 : 0;
    const giant = ((f.fl & 16) ? 1.45 : 1) * lvs * (1 + lpk), r = C.P_R * giant;
    const stealth = f.fl & 1;
    const alpha = stealth ? (f.self ? 0.4 : 0.2) : 1;
    let face = G.face.get(f.id) || 1;
    const ca = Math.cos(f.aim); if (ca > 0.3) face = 1; else if (ca < -0.3) face = -1; G.face.set(f.id, face);
    const born = G.spawnAt.get(f.id); let pop = 1;
    if (born && now - born < 420) { const k = (now - born) / 420; pop = 0.35 + 0.65 * ease(k) + Math.sin(k * Math.PI) * 0.14; }
    // motion feel: estimate velocity per frame, derive lean / stretch / hop
    let v = vel.get(f.id); if (!v) { v = { x: f.x, y: f.y, vx: 0, vy: 0 }; vel.set(f.id, v); }
    const ivx = (f.x - v.x) / dtf, ivy = (f.y - v.y) / dtf, kv = 1 - Math.exp(-12 * dtf);
    if (Math.hypot(f.x - v.x, f.y - v.y) > 200) { v.vx = v.vy = 0; } else { v.vx += (ivx - v.vx) * kv; v.vy += (ivy - v.vy) * kv; }
    v.x = f.x; v.y = f.y;
    // walk feel: smoothed speed drives a soft sway, never a hard hop
    v.mv = (v.mv || 0) + (clamp(Math.hypot(v.vx, v.vy) / 265, 0, 1.4) - (v.mv || 0)) * (1 - Math.exp(-8 * dtf));
    const mv = v.mv, lean = clamp(v.vx * 0.0004, -0.1, 0.1), sway = Math.sin(now * 0.009 + f.id) * 0.035 * mv, hop = 0;
    const breathe = Math.sin(now * 0.0036 + f.id * 1.7) * 0.016 * (1 - Math.min(1, mv));
    const rc = G.recoil.get(f.id), rk = rc ? Math.max(0, 1 - (now - rc) / 130) : 0;
    const color = ent ? ent.color : '#F2F0E8';
    const hp = f.self ? f.hp : smooth('f' + f.id, f.hp, dtf);

    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(f.x, f.y);
    // ground shadow shrinks when the fighter hops
    ctx.fillStyle = 'rgba(15,14,18,.4)'; ctx.beginPath(); ctx.ellipse(0, r * 0.95, r * 0.95, r * 0.32, 0, 0, TAU); ctx.fill();
    if (f.self) { ctx.strokeStyle = Game.SELF_COLOR; ctx.lineWidth = 3; ctx.globalAlpha = alpha * 0.7; ctx.beginPath(); ctx.ellipse(0, r * 0.95, r * 1.25, r * 0.45, 0, 0, TAU); ctx.stroke(); ctx.globalAlpha = alpha; }
    if (f.fl & 2048) { ctx.save(); ctx.setLineDash([7, 9]); ctx.lineDashOffset = -now * 0.03; ctx.strokeStyle = 'rgba(242,240,232,.8)'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, r + 11, 0, TAU); ctx.stroke(); ctx.restore(); }
    if (f.fl & 32) { ctx.fillStyle = 'rgba(99,230,210,.14)'; ctx.beginPath(); ctx.arc(0, 0, r + 12, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(99,230,210,.8)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r + 12 + Math.sin(now * 0.008) * 1.5, 0, TAU); ctx.stroke(); }
    if (f.fl & 8) { ctx.strokeStyle = color; ctx.globalAlpha = alpha * 0.5; ctx.lineWidth = 4; ctx.lineCap = 'round'; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(-Math.cos(f.aim) * (r + 6) - Math.sin(f.aim) * i * 10, -Math.sin(f.aim) * (r + 6) + Math.cos(f.aim) * i * 10); ctx.lineTo(-Math.cos(f.aim) * (r + 48) - Math.sin(f.aim) * i * 10, -Math.sin(f.aim) * (r + 48) + Math.cos(f.aim) * i * 10); ctx.stroke(); } ctx.globalAlpha = alpha; }
    if (spr) {
      const size = spr.width * UNIT * giant * pop;
      ctx.save();
      ctx.translate(-Math.cos(f.aim) * 3 * rk, -Math.sin(f.aim) * 3 * rk);
      ctx.rotate(lean + sway);
      ctx.scale(face * (1 - breathe * 0.6 + rk * 0.07), 1 + breathe + Math.abs(sway) * 0.5 - rk * 0.05);
      ctx.drawImage(spr, -size / 2, -size / 2 - r * 0.12, size, size);
      const hf = G.hitFlash.get(f.id);
      if (hf && now - hf < 110) { const w = Game.whiteOf(ent); if (w) { ctx.globalAlpha = alpha * 0.7 * (1 - (now - hf) / 110); ctx.drawImage(w, -size / 2, -size / 2 - r * 0.12, size, size); } }
      ctx.restore();
    } else { Art.circ(ctx, 0, 0, r, color, INK, 3); }
    ctx.globalAlpha = alpha;
    drawWeapon(f, ent, now, r, rk, dtf);
    if (f.fl & 2) flames(0, 0, r, now);
    if (f.fl & 4) stars(0, -r - 8, now);
    if (f.fl & 64) { ctx.strokeStyle = '#FFD65C'; ctx.lineWidth = 3; ctx.lineCap = 'round'; for (let i = 0; i < 3; i++) { const o = ((now * 0.12 + i * 14) % 36); ctx.globalAlpha = alpha * (1 - o / 36) * 0.8; ctx.beginPath(); ctx.moveTo(-face * (r + 6 + o), -8 + i * 8); ctx.lineTo(-face * (r + 18 + o), -8 + i * 8); ctx.stroke(); } ctx.globalAlpha = alpha; }
    ctx.restore();

    // name + hp (screen-aligned)
    {
      ctx.save(); ctx.globalAlpha = stealth ? (f.self ? 0.55 : 0.3) : 1;
      if (!f.self || f.hp < f.maxHp) bar(f.x, f.y - r - (f.self ? 12 : 24), 44 * giant, hp / f.maxHp, hp / f.maxHp > 0.5 ? '#8FD36B' : hp / f.maxHp > 0.25 ? '#FFD65C' : '#FF7B6E');
      if (f.sh > 0 && !f.self) { ctx.fillStyle = '#63E6D2'; ctx.fillRect(f.x - 22 * giant, f.y - r - 28, Math.min(44 * giant, f.sh / 45 * 44 * giant), 2.5); }
      const nm = ent ? ent.n : '';
      {
        ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
        const lv = f.lv || 1, ty = f.y - r - (f.self ? 20 : 32), hot = lv >= 5 ? '#FFD65C' : '#FFA45C';
        ctx.font = '800 15px Archivo, system-ui, sans-serif';
        const nw = ctx.measureText(nm).width;
        ctx.font = '700 11px JetBrains Mono, monospace';
        const lt = 'LV ' + lv, lw = ctx.measureText(lt).width + 10, bw = ent && ent.b ? 0 : 0;
        const total = lw + 5 + nw, x0 = f.x - total / 2;
        ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(x0 - 1, ty - 13, lw + 2, 17, 6); ctx.fill();
        ctx.fillStyle = hot; ctx.beginPath(); ctx.roundRect(x0, ty - 12, lw, 15, 5); ctx.fill();
        ctx.fillStyle = INK; ctx.fillText(lt, x0 + 5, ty - 0.5);
        ctx.font = '800 15px Archivo, system-ui, sans-serif';
        ctx.lineWidth = 5; ctx.strokeStyle = INK; ctx.strokeText(nm, x0 + lw + 5, ty);
        ctx.fillStyle = f.self ? Game.SELF_COLOR : '#F7F4EC'; ctx.fillText(nm, x0 + lw + 5, ty);
      }
      ctx.restore();
    }
  }

  /* class weapon in hand: the sword follows a smoothed angle (wind-up, swing, relax) instead of snapping between poses */
  const swordSt = new Map();
  const angDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
  function drawWeapon(f, ent, now, r, rk, dtf) {
    const cls = ent && ent.c || 'gun'; ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    let a = f.aim;
    if (cls === 'sword') {
      const rc = G.recoil.get(f.id), k = rc ? clamp((now - rc) / 260, 0, 1) : 1, half = C.CLASSES.sword.arc / 2;
      let st = swordSt.get(f.id); if (!st) { st = { a: f.aim - 0.55 }; swordSt.set(f.id, st); }
      const swinging = k < 1;
      const target = swinging ? f.aim - half - 0.25 + (2 * half + 0.5) * ease(k) : f.aim - 0.55 + Math.sin(now * 0.004 + f.id) * 0.07;
      st.a += angDelta(st.a, target) * (1 - Math.exp(-(swinging ? 38 : 9) * dtf));
      a = st.a;
      ctx.translate(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55); ctx.rotate(a);
      const L = r * 2.0;
      ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(r * 0.1 - 2, -r * 0.2 - 2, L + 4, r * 0.4 + 4, 3); ctx.fill();
      ctx.fillStyle = '#E9ECF2'; ctx.beginPath(); ctx.roundRect(r * 0.1, -r * 0.2, L, r * 0.4, 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(r * 0.2, -r * 0.1, L * 0.8, r * 0.1);
      ctx.fillStyle = INK; ctx.fillRect(-r * 0.05 - 2, -r * 0.55 - 2, r * 0.22 + 4, r * 1.1 + 4);
      ctx.fillStyle = '#FFA45C'; ctx.fillRect(-r * 0.05, -r * 0.55, r * 0.22, r * 1.1);
    } else {
      const long = cls === 'sniper', L = r * (long ? 1.9 : 1.25), W = r * (long ? 0.26 : 0.34), rr = rk * r * 0.2;
      let st = swordSt.get(f.id); if (!st) { st = { a: f.aim }; swordSt.set(f.id, st); }
      st.a += angDelta(st.a, f.aim) * (1 - Math.exp(-26 * dtf)); a = st.a;           // barrel turns smoothly toward the target
      ctx.translate(Math.cos(a) * (r * 0.5 - rr), Math.sin(a) * (r * 0.5 - rr)); ctx.rotate(a);
      ctx.fillStyle = INK; ctx.beginPath(); ctx.roundRect(-2, -W / 2 - 2, L + 4, W + 4, 3); ctx.fill();
      ctx.fillStyle = long ? '#6CC8FF' : '#FFA45C'; ctx.beginPath(); ctx.roundRect(0, -W / 2, L, W, 2); ctx.fill();
      ctx.fillStyle = INK; ctx.fillRect(L - r * 0.18, -W / 2 - 1, r * 0.18, W + 2);
    }
    ctx.restore();
  }

  /* bullets: smooth tapered ribbon trail + inked head */
  function drawProjectiles(list, now) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const p of list) {
      let col;
      if (p.kind === 3) col = '#8D99FF';
      else if (p.kind === 2) col = '#FF8A5C';
      else { const ent = G.roster.get(p.o); col = ent ? ent.color : '#C9F26A'; }
      const sp = Math.hypot(p.vx, p.vy) || 1, ux = p.vx / sp, uy = p.vy / sp, tr = p.trail;
      // ribbon from the recorded positions, extended backwards along the velocity so it is never short at spawn
      const pts = [];
      if (tr) for (let i = tr.length - 1; i >= 0; i--) pts.push(tr[i]);
      const tailLen = p.r * (p.kind === 3 ? 3 : 7);
      const last = pts.length ? pts[pts.length - 1] : { x: p.x, y: p.y };
      pts.push({ x: last.x - ux * tailLen * 0.6, y: last.y - uy * tailLen * 0.6 }, { x: last.x - ux * tailLen, y: last.y - uy * tailLen });
      if (pts.length >= 2) {
        const n = pts.length, L = [], R = [];
        for (let i = 0; i < n; i++) {
          const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
          let dx = b.x - a.x, dy = b.y - a.y; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
          const w = p.r * 1.7 * Math.pow(1 - i / (n - 1), 1.15);
          L.push([pts[i].x - dy * w, pts[i].y + dx * w]); R.push([pts[i].x + dy * w, pts[i].y - dx * w]);
        }
        ctx.beginPath(); ctx.moveTo(L[0][0], L[0][1]);
        for (let i = 1; i < n; i++) ctx.lineTo(L[i][0], L[i][1]);
        for (let i = n - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
        ctx.closePath(); ctx.globalAlpha = 0.5; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 2.5, 0, TAU); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.beginPath(); ctx.arc(p.x - p.r * 0.28, p.y - p.r * 0.3, p.r * 0.3, 0, TAU); ctx.fill();
    }
  }

  /* ------------------------------------------------------------------ fx */
  function drawFx(now) {
    for (const f of G.fx) {
      if (f.delay > 0) continue;
      const k = f.t / f.dur;
      if (f.k === 'puff') { ctx.globalAlpha = f.a * (1 - k) * (1 - k * 0.3); ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(f.x, f.y, Math.max(0.5, f.r), 0, TAU); ctx.fill(); }
      else if (f.k === 'ring') {
        const e = 1 - Math.pow(1 - k, 3), r = f.r0 + (f.r1 - f.r0) * e;
        if (f.fill) { ctx.globalAlpha = f.fill * (1 - k); ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.fill(); }
        ctx.globalAlpha = 1 - k; ctx.strokeStyle = f.color; ctx.lineWidth = f.lw * (1 - k * 0.5); ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.stroke();
      } else if (f.k === 'cone') {
        const e = 1 - Math.pow(1 - k, 2);
        ctx.globalAlpha = 0.4 * (1 - k); ctx.fillStyle = f.color; ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.arc(f.x, f.y, f.range * (0.35 + 0.65 * e), f.ang - f.half, f.ang + f.half); ctx.closePath(); ctx.fill();
      } else if (f.k === 'slash') {
        const e = 1 - Math.pow(1 - k, 3), a0 = f.ang - f.arc / 2, head = a0 + f.arc * e, tail = Math.max(a0, head - f.arc * 0.85), N = 16, fade = 1 - k * k;
        ctx.save(); ctx.translate(f.x, f.y); ctx.lineCap = 'round';
        ctx.globalAlpha = 0.16 * fade; ctx.fillStyle = f.color; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, f.reach * 0.95, a0, head); ctx.closePath(); ctx.fill();
        for (let j = 0; j < N; j++) {                                   // tapered, fading comet tail
          const t0 = j / N, t1 = (j + 1) / N, s0 = tail + (head - tail) * t0, s1 = tail + (head - tail) * t1, w = Math.pow(t1, 1.4);
          ctx.globalAlpha = fade * (0.15 + 0.85 * t1); ctx.strokeStyle = INK; ctx.lineWidth = 30 * w * (1 - k * 0.5) + 2; ctx.beginPath(); ctx.arc(0, 0, f.reach * 0.88, s0, s1 + 0.02); ctx.stroke();
        }
        for (let j = 0; j < N; j++) {
          const t0 = j / N, t1 = (j + 1) / N, s0 = tail + (head - tail) * t0, s1 = tail + (head - tail) * t1, w = Math.pow(t1, 1.4);
          ctx.globalAlpha = fade * (0.2 + 0.8 * t1); ctx.strokeStyle = t1 > 0.8 ? '#FFFFFF' : '#F2F0E8'; ctx.lineWidth = 22 * w * (1 - k * 0.5); ctx.beginPath(); ctx.arc(0, 0, f.reach * 0.88, s0, s1 + 0.02); ctx.stroke();
        }
        ctx.restore();
      } else if (f.k === 'bit') {
        ctx.globalAlpha = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1; ctx.fillStyle = f.color;
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot);
        if (f.shape === 1) { ctx.beginPath(); ctx.arc(0, 0, f.w * 0.5 * (1 - k * 0.5), 0, TAU); ctx.fill(); }
        else ctx.fillRect(-f.w / 2, -f.h / 2, f.w, f.h);
        ctx.restore();
      } else if (f.k === 'shard') {
        const ent = G.roster.get(f.id), spr = ent && ent.spr;
        const fade = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
        ctx.save(); ctx.globalAlpha = fade; ctx.translate(f.x, f.y); ctx.rotate(f.a); ctx.scale(1 - k * 0.25, 1 - k * 0.25); ctx.translate(-f.cx, -f.cy);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(f.a0) * f.R * 1.7, Math.sin(f.a0) * f.R * 1.7); ctx.lineTo(Math.cos(f.a1) * f.R * 1.7, Math.sin(f.a1) * f.R * 1.7); ctx.closePath();
        if (spr) { ctx.save(); ctx.clip(); ctx.scale(f.face, 1); ctx.drawImage(spr, -f.size / 2, -f.size / 2 - 4, f.size, f.size); ctx.restore(); }
        else { ctx.fillStyle = f.col; ctx.fill(); }
        ctx.strokeStyle = INK; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
        ctx.restore();
      } else if (f.k === 'ghostx') {
        const ent = G.roster.get(f.id), w = ent && Game.whiteOf(ent);
        const e = ease(k), y = f.y - e * 130, x = f.x + Math.sin(k * 9) * 12 * (1 - k * 0.4), a = (k < 0.15 ? k / 0.15 : 1) * (1 - Math.pow(k, 1.6)) * 0.62, sz = f.size * (1 - 0.18 * e);
        if (w) { ctx.globalAlpha = a; ctx.drawImage(w, x - sz / 2, y - sz / 2, sz, sz); }
        ctx.globalAlpha = Math.min(1, a * 1.6); ctx.strokeStyle = INK; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
        for (const ex of [-0.17, 0.17]) { const cx = x + ex * sz * f.face, cy = y - sz * 0.06; ctx.beginPath(); ctx.moveTo(cx - 5, cy - 5); ctx.lineTo(cx + 5, cy + 5); ctx.moveTo(cx + 5, cy - 5); ctx.lineTo(cx - 5, cy + 5); ctx.stroke(); }
        ctx.strokeStyle = '#FFD65C'; ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(x, y - sz * 0.62, sz * 0.22, sz * 0.07, 0, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* ------------------------------------------------------------------ The Ink (shrinking zone) */
  function hatchPattern() {
    if (hatch) return hatch;
    const c = document.createElement('canvas'); c.width = c.height = 44; const x = c.getContext('2d');
    x.strokeStyle = 'rgba(150,165,255,0.2)'; x.lineWidth = 3.5; x.lineCap = 'round'; x.beginPath();
    x.moveTo(-4, 48); x.lineTo(48, -4); x.moveTo(-26, 26); x.lineTo(26, -26); x.moveTo(18, 70); x.lineTo(70, 18); x.stroke();
    return (hatch = ctx.createPattern(c, 'repeat'));
  }
  function drawZone(vis, now) {
    const z = G.zoneD;
    if (!z || G.phase !== 1) return;
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, C.ARENA_R + 6, 0, TAU); ctx.clip();
    ctx.beginPath(); ctx.rect(vis.x0 - 3000, vis.y0 - 3000, vis.x1 - vis.x0 + 6000, vis.y1 - vis.y0 + 6000); ctx.arc(z.x, z.y, z.r, 0, TAU, true);
    ctx.fillStyle = 'rgba(38,44,128,0.52)'; ctx.fill('evenodd');
    ctx.fillStyle = hatchPattern(); ctx.fill('evenodd');
    // billowing ink edge
    const n = Math.max(24, Math.min(110, Math.round(z.r * TAU / 64)));
    ctx.fillStyle = 'rgba(70,82,220,0.42)'; ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, rr = z.r + Math.sin(now * 0.0012 + i * 1.7) * 14 + 8, px = z.x + Math.cos(a) * rr, py = z.y + Math.sin(a) * rr;
      if (px < vis.x0 - 60 || px > vis.x1 + 60 || py < vis.y0 - 60 || py > vis.y1 + 60) continue;
      const pr = 30 + Math.sin(now * 0.0017 + i * 2.3) * 8; ctx.moveTo(px + pr, py); ctx.arc(px, py, pr, 0, TAU);
    }
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = INK; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#8D99FF'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
    if (z.nr < z.r - 4 || Math.hypot(z.nx - z.x, z.ny - z.y) > 4) {
      ctx.strokeStyle = 'rgba(255,255,255,.65)'; ctx.lineWidth = 3; ctx.setLineDash([16, 14]); ctx.lineDashOffset = -now * 0.02; ctx.beginPath(); ctx.arc(z.nx, z.ny, z.nr, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  function drawTexts() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (const t of G.texts) {
      const k = t.t / t.dur, pop = k < 0.12 ? 0.5 + k / 0.12 * 0.75 : 1.25 - Math.min(0.25, (k - 0.12) * 0.4);
      ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      ctx.font = `900 ${Math.round(t.size * pop)}px Archivo, system-ui, sans-serif`;
      ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.strokeText(t.s, t.x, t.y);
      ctx.fillStyle = t.color; ctx.fillText(t.s, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  /* screen-space: impact flash, death dim + letterbox */
  function drawScreenFx(now) {
    const cam = G.cam;
    if (cam.white > 0.01) { ctx.fillStyle = `rgba(255,255,255,${(cam.white * 0.42).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
    const dh = G.deathHold; let dk = 0;
    if (dh) { const t0 = dh.until - 1550; dk = clamp((now - t0) / 240, 0, 1) * clamp((dh.until + 450 - now) / 450, 0, 1); }
    if (dk > 0.01) {
      ctx.fillStyle = `rgba(15,14,18,${(dk * 0.34).toFixed(3)})`; ctx.fillRect(0, 0, W, H);
      const bh = H * 0.075 * dk; ctx.fillStyle = INK; ctx.fillRect(0, 0, W, bh); ctx.fillRect(0, H - bh, W, bh);
    }
  }

  /* ------------------------------------------------------------------ minimap */
  function drawMinimap(E) {
    const m = mm.ctx, S = mm.size; if (!S) return;
    m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, S, S);
    const R = S / 2 - 4, k = R / C.ARENA_R;
    m.save(); m.translate(S / 2, S / 2);
    m.fillStyle = PAPER; m.beginPath(); m.arc(0, 0, R, 0, TAU); m.fill();
    const z = G.zoneD;
    if (z && G.phase === 1) {
      m.save(); m.beginPath(); m.arc(0, 0, R, 0, TAU); m.clip();
      m.beginPath(); m.rect(-S, -S, S * 2, S * 2); m.arc(z.x * k, z.y * k, z.r * k, 0, TAU, true); m.fillStyle = 'rgba(70,82,220,.55)'; m.fill('evenodd');
      m.strokeStyle = 'rgba(255,255,255,.75)'; m.lineWidth = dpr; m.setLineDash([4 * dpr, 4 * dpr]); m.beginPath(); m.arc(z.nx * k, z.ny * k, z.nr * k, 0, TAU); m.stroke(); m.setLineDash([]);
      m.restore();
    }
    m.fillStyle = 'rgba(255,255,255,.12)'; for (const o of G.obs) { m.beginPath(); m.arc(o.x * k, o.y * k, Math.max(1, o.r * k), 0, TAU); m.fill(); }
    for (const f of E.f) { if (f.self) continue; const ent = G.roster.get(f.id); m.fillStyle = ent ? ent.color : '#fff'; m.beginPath(); m.arc(f.x * k, f.y * k, 2.6 * dpr, 0, TAU); m.fill(); }
    m.fillStyle = '#FF7B6E'; for (const e of E.e) { m.beginPath(); m.arc(e.x * k, e.y * k, 1.6 * dpr, 0, TAU); m.fill(); }
    m.fillStyle = '#9AA6FF'; for (const h of E.hz) { m.beginPath(); m.arc(h.x * k, h.y * k, 2.2 * dpr, 0, TAU); m.fill(); }
    const me = G.alive ? { x: G.me.x, y: G.me.y } : { x: G.cam.x, y: G.cam.y };
    m.fillStyle = Game.SELF_COLOR; m.strokeStyle = INK; m.lineWidth = 1.5 * dpr; m.beginPath(); m.arc(me.x * k, me.y * k, 4 * dpr, 0, TAU); m.fill(); m.stroke();
    m.restore();
    m.strokeStyle = 'rgba(255,255,255,.18)'; m.lineWidth = 2 * dpr; m.beginPath(); m.arc(S / 2, S / 2, R, 0, TAU); m.stroke();
  }

  return { init, resize, draw, viewInfo };
})();
