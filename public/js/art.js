/* Doodle art: skill/UI icons (inline SVG), hand-drawn enemies and power-ups (canvas). Solid fills + one dark outline. */
const Art = (() => {
  const INK = '#0F0E12';
  const TAU = Math.PI * 2;

  /* ---------------------------------------------------------------- icons (24x24, stroke) */
  const ICONS = {
    jet: '<path d="M7.5 19.5L8.7 15.3 18.5 5.5a2.1 2.1 0 0 1 3 3L11.7 18.3z"/><path d="M16.2 7.8l3 3"/><path d="M2.5 9.5h4.5M1.5 13h3.5"/>',
    vanish: '<path d="M12 3.5c3.2 4 6 6.7 6 10.2a6 6 0 0 1-12 0C6 10.2 8.8 7.5 12 3.5z" stroke-dasharray="2.4 2.6"/><path d="M10 14.2a2.2 2.2 0 0 0 2 2" stroke-dasharray="none"/>',
    boom: '<path d="M8.5 19.5H5L3.2 17.7a1.4 1.4 0 0 1 0-2l6.6-6.6a1.4 1.4 0 0 1 2 0l3 3a1.4 1.4 0 0 1 0 2l-6.3 6.4"/><path d="M7.8 11.2l5 5"/><path d="M18.4 8.8a4.8 4.8 0 0 1 0 6.4M21 6.2a8.4 8.4 0 0 1 0 11.6"/>',
    flame: '<path d="M12 3c.6 3.6 4.6 5 4.6 10a4.6 4.6 0 0 1-9.2 0c0-1.8.8-3 1.8-4 .2 1.6 1 2.4 2 2.5C11 9 10.4 6 12 3z"/>',
    bomb: '<path d="M9.5 3h5v3h-5z"/><path d="M7 8.5h10l1.5 3.2V19a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-7.3z"/><path d="M12 12.8c1.4 1.7 2.4 2.8 2.4 4a2.4 2.4 0 0 1-4.8 0c0-1.2 1-2.3 2.4-4z"/>',
    burst: '<path d="M3 14c1.6-6 3.2-6 5 0s3.4 6 5 0 3.2-6 5 0c.8 2.4 1.8 3 3.2 1.4"/>',
    bubble: '<circle cx="7.5" cy="7.5" r="3.5"/><circle cx="16.5" cy="7.5" r="3.5"/><circle cx="7.5" cy="16.5" r="3.5"/><circle cx="16.5" cy="16.5" r="3.5"/>',
    slap: '<g transform="rotate(-38 12 12)"><rect x="1.8" y="8.4" width="20.4" height="7.2" rx="1.6"/><path d="M6 8.4v2.6M9.5 8.4v3.6M13 8.4v2.6M16.5 8.4v3.6M20 8.4v2.6"/></g>',
    right: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
    left: '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M9 9h.01M15 9h.01M12 12h.01M9 15h.01M15 15h.01" stroke-width="2.6"/>',
    brush: '<path d="M4 20l1-4L16 5a2.1 2.1 0 0 1 3 3L8 19z"/><path d="M14 7l3 3"/>',
    fill: '<path d="M12 3l8 8-7 7a2 2 0 0 1-2.8 0L4 11.8a2 2 0 0 1 0-2.8z"/><path d="M21 16.5c0 1.1-.9 2-2 2s-2-.9-2-2c0-1.2 2-3.4 2-3.4s2 2.2 2 3.4z"/>',
    eraser: '<path d="M19.5 19.5H9L4.4 14.9a1.5 1.5 0 0 1 0-2.1l8-8a1.5 1.5 0 0 1 2.1 0l5 5a1.5 1.5 0 0 1 0 2.1l-6.5 6.6"/><path d="M8 9.5l6.5 6.5"/>',
    soundOn: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.6 6.5a8 8 0 0 1 0 11"/>',
    soundOff: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9.5l4.5 5M21.5 9.5l-4.5 5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    out: '<path d="M10 4H5v16h5"/><path d="M15 8l4 4-4 4"/><path d="M19 12H9"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    users: '<path d="M16 20v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1"/><circle cx="10" cy="8" r="3.5"/><path d="M20 20v-1a4 4 0 0 0-3-3.9"/><path d="M16 4.3a3.5 3.5 0 0 1 0 6.7"/>',
    target: '<circle cx="12" cy="12" r="5"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    keys: '<rect x="3" y="6" width="18" height="12" rx="3"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
    zone: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/>',
  };
  const icon = (name, size = 24, cls = '') =>
    `<svg class="ico ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;

  /* ---------------------------------------------------------------- canvas helpers */
  function ell(ctx, x, y, rx, ry, rot, fill, stroke, lw) {
    ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  const circ = (ctx, x, y, r, fill, stroke, lw) => ell(ctx, x, y, r, r, 0, fill, stroke, lw);

  /* ---------------------------------------------------------------- enemies (hand-drawn doodle monsters) */
  const ENEMY_COL = { fly: '#EDEAE0', spit: '#4A55D6', chonk: '#B4849A' };

  /* closed wobbly blob path, centred on 0,0 */
  function blobPath(ctx, r, n, amp, t, ph) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i % n) / n * TAU, k = 1 + amp * Math.sin(t * 3 + i * 2.1 + ph) + amp * 0.6 * Math.sin(t * 5.3 - i * 1.3 + ph);
      const x = Math.cos(a) * r * k, y = Math.sin(a) * r * k;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  function smoothBlob(ctx, r, n, amp, t, ph) {
    const pts = [];
    for (let i = 0; i < n; i++) { const a = i / n * TAU, k = 1 + amp * Math.sin(t * 3 + i * 2.1 + ph) + amp * 0.6 * Math.sin(t * 5.3 - i * 1.3 + ph); pts.push([Math.cos(a) * r * k, Math.sin(a) * r * k]); }
    ctx.beginPath();
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    let m0 = mid(pts[n - 1], pts[0]); ctx.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) { const p = pts[i], m = mid(p, pts[(i + 1) % n]); ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]); }
    ctx.closePath();
  }
  function eye(ctx, x, y, r, ca, sa, pupil) {
    circ(ctx, x, y, r, '#F6F4EE', INK, Math.max(1.6, r * 0.22));
    circ(ctx, x + ca * r * 0.35, y + sa * r * 0.35, r * (pupil || 0.42), INK);
  }

  function drawEnemy(ctx, type, e, now) {
    // e: {x,y,r,flags,ang,id}
    const r = e.r, t = now * 0.001, ph = e.id * 1.713;
    ctx.save(); ctx.translate(e.x, e.y);
    const fl = e.flags | 0, ang = e.ang || 0, ca = Math.cos(ang), sa = Math.sin(ang);
    if (fl & 1) ctx.globalAlpha = 0.85;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (type === 'fly') {                               /* Scribble: a jittery ball of pencil loops */
      const sq = Math.sin(t * 15 + ph) * 0.08;
      ctx.scale(1 + sq, 1 - sq);
      ctx.strokeStyle = INK; ctx.lineWidth = 3;
      for (const s of [-1, 1]) { const k = Math.sin(t * 20 + ph + s * 1.6); ctx.beginPath(); ctx.moveTo(s * r * 0.42, r * 0.78); ctx.lineTo(s * r * (0.6 + k * 0.18), r * 1.28 + k * 2); ctx.stroke(); }
      smoothBlob(ctx, r, 9, 0.04, t * 2, ph); ctx.fillStyle = ENEMY_COL.fly; ctx.fill(); ctx.lineWidth = 3; ctx.stroke();
      ctx.save(); smoothBlob(ctx, r - 1.5, 9, 0.04, t * 2, ph); ctx.clip();
      ctx.strokeStyle = 'rgba(15,14,18,.5)'; ctx.lineWidth = 1.7; ctx.beginPath();
      for (let k = 0; k < 3; k++) { const a0 = t * (1.4 + k * 0.5) + k * 2.1 + ph; ctx.moveTo(Math.cos(a0) * r, Math.sin(a0) * r); for (let j = 1; j <= 4; j++) { const a1 = a0 + j * 1.9; ctx.lineTo(Math.cos(a1) * r * (j % 2 ? 0.25 : 1), Math.sin(a1) * r * (j % 2 ? 0.25 : 1)); } }
      ctx.stroke(); ctx.restore();
      eye(ctx, -r * 0.33, -r * 0.12, r * 0.3, ca, sa); eye(ctx, r * 0.33, -r * 0.12, r * 0.3, ca, sa);
      ctx.strokeStyle = INK; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 0.52); ctx.lineTo(-r * 0.12, -r * 0.36); ctx.moveTo(r * 0.6, -r * 0.52); ctx.lineTo(r * 0.12, -r * 0.36); ctx.stroke();
    } else if (type === 'spit') {                       /* Inkblot: a spitting blob of blue ink */
      const cue = (fl & 16) ? 1 : 0, pul = 1 + cue * 0.14;
      ctx.scale(pul, pul * (1 - cue * 0.06));
      const drip = 0.5 + 0.5 * Math.sin(t * 2.4 + ph);
      ctx.fillStyle = ENEMY_COL.spit; ctx.strokeStyle = INK; ctx.lineWidth = 3;
      for (const s of [-1, 1]) { const dl = r * (0.28 + 0.22 * (s > 0 ? drip : 1 - drip)); ctx.beginPath(); ctx.ellipse(s * r * 0.5, r * 0.88 + dl * 0.4, r * 0.14, r * 0.14 + dl, 0, 0, TAU); ctx.fill(); ctx.stroke(); }
      smoothBlob(ctx, r, 10, 0.06, t * 1.3, ph); ctx.fillStyle = ENEMY_COL.spit; ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(190,200,255,.5)'; ctx.beginPath(); ctx.ellipse(-r * 0.4, -r * 0.5, r * 0.22, r * 0.12, -0.6, 0, TAU); ctx.fill();
      eye(ctx, -r * 0.34, -r * 0.2, r * 0.24, ca, sa, 0.46); eye(ctx, r * 0.34, -r * 0.2, r * 0.24, ca, sa, 0.46);
      ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(ca * r * 0.22, r * 0.34 + sa * r * 0.18, r * 0.36, r * (cue ? 0.34 : 0.14), ang * 0.15, 0, TAU); ctx.fill();
      if (cue) circ(ctx, ca * r * 0.46, r * 0.34 + sa * r * 0.4, r * 0.2, '#A8B2FF');
    } else {                                            /* Smudge: a big angry graphite smear */
      const wind = (fl & 4) ? 1 : 0;
      if (wind) ctx.translate(Math.sin(t * 90) * 2.2, 0);
      const sq = Math.sin(t * 4 + ph) * 0.03;
      ctx.scale(1 + sq, 1 - sq);
      ctx.fillStyle = INK; for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * r * 0.46, r * 0.95, r * 0.3, r * 0.2, 0, 0, TAU); ctx.fill(); }
      smoothBlob(ctx, r, 11, 0.035, t * 0.9, ph); ctx.fillStyle = wind ? '#E08AA0' : ENEMY_COL.chonk; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 4.5; ctx.stroke();
      ctx.save(); smoothBlob(ctx, r - 2, 11, 0.035, t * 0.9, ph); ctx.clip();
      ctx.strokeStyle = 'rgba(15,14,18,.22)'; ctx.lineWidth = 3; ctx.beginPath();
      for (let k = 1; k <= 4; k++) ctx.arc(r * 0.15, r * 0.35, r * 0.22 * k, Math.PI * 1.05, Math.PI * 2.0);
      ctx.stroke(); ctx.restore();
      ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(-r * 0.62, -r * 0.5); ctx.lineTo(-r * 0.1, -r * 0.24); ctx.moveTo(r * 0.62, -r * 0.5); ctx.lineTo(r * 0.1, -r * 0.24); ctx.stroke();
      circ(ctx, -r * 0.34, -r * 0.08, r * 0.1, INK); circ(ctx, r * 0.34, -r * 0.08, r * 0.1, INK);
      ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(-r * 0.5, r * 0.46); for (let i = 1; i <= 6; i++) ctx.lineTo(-r * 0.5 + i * r / 6, r * (i % 2 ? 0.66 : 0.42)); ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------- power-ups (index = FBR.PU_IDS) */
  function drawPickupShape(ctx, id, s) {
    const lw = Math.max(2, s * 0.14);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const stroke = () => { ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.stroke(); };
    switch (id) {
      case 'bolt':
        ctx.beginPath(); ctx.moveTo(s * 0.18, -s * 1.0); ctx.lineTo(-s * 0.62, s * 0.12); ctx.lineTo(-s * 0.06, s * 0.12); ctx.lineTo(-s * 0.3, s * 1.0); ctx.lineTo(s * 0.64, -s * 0.2); ctx.lineTo(s * 0.06, -s * 0.2); ctx.closePath();
        ctx.fillStyle = '#FFD65C'; ctx.fill(); stroke();
        break;
      case 'redpen':
        ctx.save(); ctx.rotate(-0.78);
        ctx.fillStyle = '#FF6F61'; ctx.beginPath(); ctx.roundRect(-s * 0.9, -s * 0.24, s * 1.5, s * 0.48, s * 0.12); ctx.fill(); stroke();
        ctx.fillStyle = '#F2F0EA'; ctx.beginPath(); ctx.roundRect(-s * 0.9, -s * 0.24, s * 0.4, s * 0.48, s * 0.1); ctx.fill(); stroke();
        ctx.beginPath(); ctx.moveTo(s * 0.6, -s * 0.24); ctx.lineTo(s * 1.0, 0); ctx.lineTo(s * 0.6, s * 0.24); ctx.closePath(); ctx.fillStyle = '#FFB3A8'; ctx.fill(); stroke();
        circ(ctx, s * 0.94, 0, s * 0.09, INK);
        ctx.restore();
        break;
      case 'triple':
        for (const [rot, col] of [[-0.5, '#8FD36B'], [0, '#FFD65C'], [0.5, '#6CC8FF']]) {
          ctx.save(); ctx.translate(0, s * 0.5); ctx.rotate(rot);
          ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(-s * 0.2, -s * 1.5, s * 0.4, s * 1.5, s * 0.06); ctx.fill(); stroke();
          ctx.beginPath(); ctx.moveTo(-s * 0.2, -s * 1.5); ctx.lineTo(0, -s * 1.9); ctx.lineTo(s * 0.2, -s * 1.5); ctx.closePath(); ctx.fillStyle = '#F2D2A8'; ctx.fill(); stroke();
          ctx.restore();
        }
        break;
      case 'coffee':
        ctx.beginPath(); ctx.arc(s * 0.62, s * 0.1, s * 0.3, -1.3, 1.3); ctx.strokeStyle = INK; ctx.lineWidth = lw * 2.6; ctx.stroke(); ctx.strokeStyle = '#F2F0EA'; ctx.lineWidth = lw * 1.1; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-s * 0.62, -s * 0.35); ctx.lineTo(s * 0.62, -s * 0.35); ctx.lineTo(s * 0.46, s * 0.7); ctx.quadraticCurveTo(0, s * 0.95, -s * 0.46, s * 0.7); ctx.closePath();
        ctx.fillStyle = '#F2F0EA'; ctx.fill(); stroke();
        ctx.beginPath(); ctx.ellipse(0, -s * 0.35, s * 0.62, s * 0.16, 0, 0, TAU); ctx.fillStyle = '#7A4A2B'; ctx.fill(); stroke();
        ctx.strokeStyle = 'rgba(242,240,234,.8)'; ctx.lineWidth = lw * 0.8; ctx.beginPath(); ctx.moveTo(-s * 0.2, -s * 0.62); ctx.quadraticCurveTo(-s * 0.4, -s * 0.9, -s * 0.2, -s * 1.15); ctx.moveTo(s * 0.2, -s * 0.62); ctx.quadraticCurveTo(0, -s * 0.9, s * 0.2, -s * 1.15); ctx.stroke();
        break;
      case 'sticky':
        ctx.beginPath(); ctx.moveTo(-s * 0.8, -s * 0.8); ctx.lineTo(s * 0.8, -s * 0.8); ctx.lineTo(s * 0.8, s * 0.35); ctx.lineTo(s * 0.35, s * 0.8); ctx.lineTo(-s * 0.8, s * 0.8); ctx.closePath();
        ctx.fillStyle = '#FFE680'; ctx.fill(); stroke();
        ctx.beginPath(); ctx.moveTo(s * 0.8, s * 0.35); ctx.lineTo(s * 0.35, s * 0.35); ctx.lineTo(s * 0.35, s * 0.8); ctx.fillStyle = '#E8C84A'; ctx.fill(); stroke();
        ctx.strokeStyle = 'rgba(15,14,18,.55)'; ctx.lineWidth = lw * 0.7; ctx.beginPath(); ctx.moveTo(-s * 0.5, -s * 0.4); ctx.lineTo(s * 0.5, -s * 0.4); ctx.moveTo(-s * 0.5, -s * 0.05); ctx.lineTo(s * 0.35, -s * 0.05); ctx.moveTo(-s * 0.5, s * 0.3); ctx.lineTo(0, s * 0.3); ctx.stroke();
        break;
      case 'heart':
        ctx.beginPath(); ctx.moveTo(0, s * 0.85); ctx.bezierCurveTo(-s * 1.25, -s * 0.05, -s * 0.8, -s * 0.95, 0, -s * 0.4); ctx.bezierCurveTo(s * 0.8, -s * 0.95, s * 1.25, -s * 0.05, 0, s * 0.85); ctx.closePath();
        ctx.fillStyle = '#FF7B9C'; ctx.fill(); stroke();
        ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.beginPath(); ctx.ellipse(-s * 0.46, -s * 0.34, s * 0.16, s * 0.1, -0.7, 0, TAU); ctx.fill();
        break;
      case 'magnet':
        ctx.beginPath(); ctx.arc(0, -s * 0.1, s * 0.62, Math.PI, 0); ctx.lineTo(s * 0.62, s * 0.7); ctx.lineTo(s * 0.22, s * 0.7); ctx.lineTo(s * 0.22, -s * 0.1); ctx.arc(0, -s * 0.1, s * 0.22, 0, Math.PI, true); ctx.lineTo(-s * 0.22, s * 0.7); ctx.lineTo(-s * 0.62, s * 0.7); ctx.closePath();
        ctx.fillStyle = '#FF6F61'; ctx.fill(); stroke();
        ctx.fillStyle = '#F2F0EA'; for (const sx of [-1, 1]) { ctx.beginPath(); ctx.rect(sx > 0 ? s * 0.22 : -s * 0.62, s * 0.34, s * 0.4, s * 0.36); ctx.fill(); ctx.stroke(); }
        break;
      case 'crayon':
        ctx.save(); ctx.rotate(-0.6);
        ctx.fillStyle = '#B78CFF'; ctx.beginPath(); ctx.roundRect(-s * 1.0, -s * 0.34, s * 1.5, s * 0.68, s * 0.12); ctx.fill(); stroke();
        ctx.fillStyle = '#F2F0EA'; ctx.fillRect(-s * 0.55, -s * 0.34 + lw / 2, s * 0.6, s * 0.68 - lw); ctx.strokeStyle = INK; ctx.lineWidth = lw * 0.7; ctx.beginPath(); ctx.moveTo(-s * 0.55, -s * 0.34); ctx.lineTo(-s * 0.55, s * 0.34); ctx.moveTo(s * 0.05, -s * 0.34); ctx.lineTo(s * 0.05, s * 0.34); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s * 0.5, -s * 0.34); ctx.lineTo(s * 1.05, 0); ctx.lineTo(s * 0.5, s * 0.34); ctx.closePath(); ctx.fillStyle = '#B78CFF'; ctx.fill(); stroke();
        ctx.restore();
        break;
    }
  }

  const _imgCache = {};
  function pickupImg(id, px) {
    const key = id + px;
    if (_imgCache[key]) return _imgCache[key];
    const c = document.createElement('canvas'); c.width = c.height = px * 2; // 2x for crispness
    const x = c.getContext('2d'); x.translate(px, px);
    drawPickupShape(x, id, px * 0.55);
    return (_imgCache[key] = c.toDataURL());
  }

  return { INK, ICONS, icon, ell, circ, blobPath, smoothBlob, drawEnemy, drawPickupShape, pickupImg, ENEMY_COL };
})();
