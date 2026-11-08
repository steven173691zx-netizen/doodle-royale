/* Drawing pad, procedural creature generator, sprite normalisation + sticker outline. */
const Doodle = (() => {
  const TAU = Math.PI * 2;
  const INK = '#1B1A1F';
  const PAD = 384;       // pad resolution
  const OUT = 128;       // sprite resolution
  const BODY = ['#8FD36B', '#FFA45C', '#FF92D0', '#6CC8FF', '#B78CFF', '#FFD65C', '#63E6D2', '#FF7B6E', '#E3A857'];
  const PALETTE = ['#1B1A1F', '#FFFFFF', '#FF7B6E', '#FFA45C', '#FFD65C', '#8FD36B', '#63E6D2', '#6CC8FF', '#9DB4FF', '#B78CFF', '#FF92D0', '#9A6B4B'];
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; };

  /* ------------------------------------------------------------ procedural creature */
  function blob(ctx, cx, cy, rx, ry, rnd, wob) {
    const n = 12, pts = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, k = 1 + (rnd() - 0.5) * wob;
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const m0 = mid(pts[n - 1], pts[0]);
    ctx.beginPath(); ctx.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) { const p = pts[i], m = mid(p, pts[(i + 1) % n]); ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]); }
    ctx.closePath();
  }

  function creature(seed, S = PAD) {
    const rnd = FBR.mulberry32(seed | 0);
    const R = (a, b) => a + rnd() * (b - a);
    const pick = a => a[(rnd() * a.length) | 0];
    const c = mk(S), ctx = c.getContext('2d');
    const body = pick(BODY);
    const cx = S / 2, cy = S * 0.52, rx = R(S * 0.2, S * 0.27), ry = R(S * 0.2, S * 0.28);
    const lw = S * 0.022;
    ctx.lineJoin = ctx.lineCap = 'round'; ctx.strokeStyle = INK; ctx.lineWidth = lw;
    const dot = (x, y, r, f) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = f; ctx.fill(); };
    const ring = (x, y, r, f) => { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = f; ctx.fill(); ctx.stroke(); };

    // back extras
    const extra = pick(['ears', 'horns', 'antenna', 'tuft', 'none', 'ears', 'antenna']);
    if (extra === 'ears') {
      for (const sx of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(cx + sx * rx * 0.35, cy - ry * 0.75); ctx.lineTo(cx + sx * rx * 0.85, cy - ry * 1.5); ctx.lineTo(cx + sx * rx * 0.95, cy - ry * 0.45); ctx.closePath();
        ctx.fillStyle = body; ctx.fill(); ctx.stroke();
      }
    } else if (extra === 'horns') {
      for (const sx of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(cx + sx * rx * 0.3, cy - ry * 0.85); ctx.quadraticCurveTo(cx + sx * rx * 0.9, cy - ry * 1.1, cx + sx * rx * 0.75, cy - ry * 1.6); ctx.quadraticCurveTo(cx + sx * rx * 0.45, cy - ry * 1.25, cx + sx * rx * 0.05, cy - ry * 0.8); ctx.closePath();
        ctx.fillStyle = '#F2EFE6'; ctx.fill(); ctx.stroke();
      }
    } else if (extra === 'antenna') {
      ctx.beginPath(); ctx.moveTo(cx, cy - ry * 0.9); ctx.quadraticCurveTo(cx + rx * 0.2, cy - ry * 1.4, cx + rx * 0.1, cy - ry * 1.65); ctx.stroke();
      ring(cx + rx * 0.1, cy - ry * 1.72, S * 0.035, pick(BODY));
    }
    // feet
    const feet = rnd() < 0.8;
    if (feet) for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + sx * rx * 0.45, cy + ry * 0.98, rx * 0.28, ry * 0.15, 0, 0, TAU); ctx.fillStyle = INK; ctx.fill(); }
    // arms
    if (rnd() < 0.7) for (const sx of [-1, 1]) { ctx.beginPath(); ctx.moveTo(cx + sx * rx * 0.95, cy + ry * 0.1); ctx.quadraticCurveTo(cx + sx * rx * 1.4, cy + ry * R(-0.3, 0.3), cx + sx * rx * 1.35, cy + ry * R(0.35, 0.6)); ctx.stroke(); }
    // body
    blob(ctx, cx, cy, rx, ry, rnd, 0.1);
    ctx.fillStyle = body; ctx.fill(); ctx.stroke();
    if (extra === 'tuft') {
      ctx.beginPath(); for (let i = -1; i <= 1; i++) { ctx.moveTo(cx + i * rx * 0.2, cy - ry * 0.95); ctx.lineTo(cx + i * rx * 0.3, cy - ry * 1.35); } ctx.stroke();
    }
    // belly patch
    if (rnd() < 0.4) { ctx.beginPath(); ctx.ellipse(cx, cy + ry * 0.4, rx * 0.5, ry * 0.4, 0, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fill(); }

    // eyes
    const eyeStyle = pick(['dots', 'big', 'big', 'cyclops', 'angry', 'sleepy', 'wide']);
    const ey = cy - ry * R(0.08, 0.3), ex = rx * R(0.32, 0.46), er = S * R(0.035, 0.06);
    if (eyeStyle === 'dots') { dot(cx - ex, ey, er * 0.7, INK); dot(cx + ex, ey, er * 0.7, INK); }
    else if (eyeStyle === 'big' || eyeStyle === 'wide') {
      const k = eyeStyle === 'wide' ? 1.35 : 1;
      ring(cx - ex * k, ey, er * 1.5, '#fff'); ring(cx + ex * k, ey, er * 1.5, '#fff');
      dot(cx - ex * k + er * 0.3, ey + er * 0.2, er * 0.6, INK); dot(cx + ex * k + er * 0.3, ey + er * 0.2, er * 0.6, INK);
    } else if (eyeStyle === 'cyclops') { ring(cx, ey, er * 2.2, '#fff'); dot(cx + er * 0.4, ey + er * 0.2, er * 0.95, INK); }
    else if (eyeStyle === 'angry') {
      dot(cx - ex, ey, er * 0.75, INK); dot(cx + ex, ey, er * 0.75, INK);
      ctx.beginPath(); ctx.moveTo(cx - ex - er * 1.2, ey - er * 1.7); ctx.lineTo(cx - ex + er * 1.3, ey - er * 0.8); ctx.moveTo(cx + ex + er * 1.2, ey - er * 1.7); ctx.lineTo(cx + ex - er * 1.3, ey - er * 0.8); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(cx - ex, ey, er * 1.1, 0.1 * Math.PI, 0.9 * Math.PI); ctx.moveTo(cx + ex + er * 1.1, ey); ctx.arc(cx + ex, ey, er * 1.1, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
    }
    // cheeks
    if (rnd() < 0.5) { ctx.fillStyle = 'rgba(255,90,120,.35)'; for (const sx of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + sx * rx * 0.62, ey + er * 2.3, er * 1.3, er * 0.8, 0, 0, TAU); ctx.fill(); } }
    // mouth
    const my = cy + ry * R(0.25, 0.5), mouth = pick(['smile', 'smile', 'open', 'teeth', 'o', 'flat', 'cat']);
    ctx.fillStyle = INK;
    if (mouth === 'smile') { ctx.beginPath(); ctx.arc(cx, my - er, er * 2, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
    else if (mouth === 'open') { ctx.beginPath(); ctx.ellipse(cx, my, er * 1.7, er * 1.3, 0, 0, Math.PI); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.ellipse(cx, my + er * 0.55, er * 0.9, er * 0.5, 0, 0, Math.PI); ctx.fillStyle = '#FF6F7A'; ctx.fill(); }
    else if (mouth === 'teeth') {
      ctx.beginPath(); ctx.moveTo(cx - er * 2.2, my); for (let i = 0; i < 5; i++) ctx.lineTo(cx - er * 2.2 + (i + 0.5) * er * 0.88, my + (i % 2 ? -er * 0.7 : er * 0.7)); ctx.lineTo(cx + er * 2.2, my); ctx.stroke();
    } else if (mouth === 'o') { ctx.beginPath(); ctx.ellipse(cx, my, er * 0.9, er * 1.2, 0, 0, TAU); ctx.fill(); }
    else if (mouth === 'flat') { ctx.beginPath(); ctx.moveTo(cx - er * 1.6, my); ctx.lineTo(cx + er * 1.6, my); ctx.stroke(); }
    else { ctx.beginPath(); ctx.moveTo(cx - er * 2, my - er * 0.4); ctx.quadraticCurveTo(cx - er, my + er, cx, my - er * 0.2); ctx.quadraticCurveTo(cx + er, my + er, cx + er * 2, my - er * 0.4); ctx.stroke(); }
    // doodle sparkle on the shoulder
    if (rnd() < 0.4) {
      ctx.fillStyle = '#FFD65C'; ctx.strokeStyle = INK; ctx.lineJoin = 'round';
      const px = cx + rx * 1.15, py = cy - ry * 0.7, rr = S * 0.055; ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + i * Math.PI / 4, k = i % 2 ? 0.45 : 1; const x = px + Math.cos(a) * rr * k, y = py + Math.sin(a) * rr * k; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    return c;
  }

  /* ------------------------------------------------------------ sprite normalisation */
  function sprite(src, out = OUT, fill = 0.8) {
    const w = src.width, h = src.height;
    const d = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    const c = mk(out);
    if (x1 < 0) return c;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const s = Math.min(out * fill / bw, out * fill / bh, 0.7);
    // two-step downscale keeps lines crisp
    let cur = src, sx = x0, sy = y0, sw = bw, sh = bh, curS = 1;
    while (s / curS < 0.5) {
      const nw = Math.max(1, Math.round(sw / 2)), nh = Math.max(1, Math.round(sh / 2));
      const t = mk(nw, nh), tx = t.getContext('2d'); tx.imageSmoothingQuality = 'high';
      tx.drawImage(cur, sx, sy, sw, sh, 0, 0, nw, nh);
      cur = t; sx = 0; sy = 0; sw = nw; sh = nh; curS *= 0.5;
    }
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    const dw = bw * s, dh = bh * s;
    ctx.drawImage(cur, sx, sy, sw, sh, (out - dw) / 2, (out - dh) / 2, dw, dh);
    return c;
  }

  /* die-cut sticker outline in the owner's colour so any drawing reads on the dark arena */
  function sticker(spr, color, pad = 7, thick = 4.5) {
    const W = spr.width + pad * 2, c = mk(W), x = c.getContext('2d');
    for (const [rad, n] of [[thick, 20], [thick * 0.6, 14]]) for (let i = 0; i < n; i++) { const a = i / n * TAU; x.drawImage(spr, pad + Math.cos(a) * rad, pad + Math.sin(a) * rad); }
    x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, W, W);
    x.globalCompositeOperation = 'source-over'; x.drawImage(spr, pad, pad);
    return c;
  }

  function fromDataURL(url) {
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => { const c = mk(OUT); c.getContext('2d').drawImage(im, 0, 0, OUT, OUT); res(c); };
      im.onerror = () => res(null);
      im.src = url;
    });
  }

  /* ------------------------------------------------------------ the pad */
  function createPad(canvas, onChange) {
    canvas.width = canvas.height = PAD;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.lineJoin = ctx.lineCap = 'round';
    const st = { color: PALETTE[3], size: 14, tool: 'brush', undo: [], drawing: false, last: null, strokes: 0 };
    const push = () => { st.undo.push(ctx.getImageData(0, 0, PAD, PAD)); if (st.undo.length > 30) st.undo.shift(); };
    const changed = () => { st.strokes++; onChange && onChange(); };
    const pos = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * PAD / r.width, (e.clientY - r.top) * PAD / r.height]; };

    function seg(a, b, p) {
      ctx.globalCompositeOperation = st.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = ctx.fillStyle = st.color;
      ctx.lineWidth = st.size * (st.tool === 'eraser' ? 1.8 : 1) * (p || 1);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    function dotAt(a, p) {
      ctx.globalCompositeOperation = st.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.fillStyle = st.color; ctx.beginPath(); ctx.arc(a[0], a[1], st.size * (st.tool === 'eraser' ? 1.8 : 1) * (p || 1) / 2, 0, TAU); ctx.fill();
    }

    function floodFill(x, y) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= PAD || y >= PAD) return;
      push();
      const img = ctx.getImageData(0, 0, PAD, PAD), d = img.data;
      const idx = (x + y * PAD) * 4, tr = d[idx], tg = d[idx + 1], tb = d[idx + 2], ta = d[idx + 3];
      const empty = ta < 40;
      const match = (i) => empty ? d[i + 3] < 40 : (Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) + Math.abs(d[i + 3] - ta) < 70);
      const mask = new Uint8Array(PAD * PAD), stack = [x, y];
      while (stack.length) {
        let py = stack.pop(), px = stack.pop();
        let xl = px; while (xl >= 0 && !mask[xl + py * PAD] && match((xl + py * PAD) * 4)) xl--; xl++;
        let up = false, dn = false;
        for (let xx = xl; xx < PAD && !mask[xx + py * PAD] && match((xx + py * PAD) * 4); xx++) {
          mask[xx + py * PAD] = 1;
          if (py > 0) { const m = !mask[xx + (py - 1) * PAD] && match((xx + (py - 1) * PAD) * 4); if (m && !up) { stack.push(xx, py - 1); up = true; } else if (!m) up = false; }
          if (py < PAD - 1) { const m = !mask[xx + (py + 1) * PAD] && match((xx + (py + 1) * PAD) * 4); if (m && !dn) { stack.push(xx, py + 1); dn = true; } else if (!m) dn = false; }
        }
      }
      let cnt = 0; for (let i = 0; i < mask.length; i++) cnt += mask[i];
      if (cnt > PAD * PAD * 0.9 && empty) { /* whole canvas empty: still fill background-less region as a disc-free no-op */ st.undo.pop(); return; }
      // grow by 2px so the colour sits under anti-aliased outlines
      let m2 = mask;
      if (empty) { for (let pass = 0; pass < 2; pass++) { const n = new Uint8Array(m2); for (let yy = 1; yy < PAD - 1; yy++) for (let xx = 1; xx < PAD - 1; xx++) { const i = xx + yy * PAD; if (!m2[i] && (m2[i - 1] || m2[i + 1] || m2[i - PAD] || m2[i + PAD])) n[i] = 1; } m2 = n; } }
      const layer = ctx.createImageData(PAD, PAD), L = layer.data;
      const hex = st.color, rr = parseInt(hex.slice(1, 3), 16), gg = parseInt(hex.slice(3, 5), 16), bb = parseInt(hex.slice(5, 7), 16);
      for (let i = 0; i < m2.length; i++) if (m2[i]) { L[i * 4] = rr; L[i * 4 + 1] = gg; L[i * 4 + 2] = bb; L[i * 4 + 3] = 255; }
      const tmp = mk(PAD); tmp.getContext('2d').putImageData(layer, 0, 0);
      ctx.globalCompositeOperation = empty ? 'destination-over' : 'source-over';
      ctx.drawImage(tmp, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      changed();
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      const p = pos(e);
      if (st.tool === 'fill') { floodFill(p[0], p[1]); return; }
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      push(); st.drawing = true; st.last = p;
      const pr = e.pointerType === 'pen' ? 0.4 + e.pressure * 0.9 : 1;
      dotAt(p, pr);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!st.drawing) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of (evs.length ? evs : [e])) {
        const p = pos(ev), pr = e.pointerType === 'pen' ? 0.4 + ev.pressure * 0.9 : 1;
        // light smoothing
        const q = [st.last[0] + (p[0] - st.last[0]) * 0.75, st.last[1] + (p[1] - st.last[1]) * 0.75];
        seg(st.last, q, pr); st.last = q;
      }
    });
    const end = () => { if (!st.drawing) return; st.drawing = false; ctx.globalCompositeOperation = 'source-over'; changed(); };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);

    return {
      canvas,
      setColor(c) { st.color = c; if (st.tool === 'eraser') st.tool = 'brush'; },
      setSize(s) { st.size = s; },
      setTool(t) { st.tool = t; },
      get tool() { return st.tool; },
      isEmpty() {
        const d = ctx.getImageData(0, 0, PAD, PAD).data; let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 40) { if (++n > 400) return false; }
        return true;
      },
      undo() { const s = st.undo.pop(); if (s) { ctx.putImageData(s, 0, 0); changed(); } },
      clear() { push(); ctx.clearRect(0, 0, PAD, PAD); changed(); },
      randomize(seed) { push(); ctx.clearRect(0, 0, PAD, PAD); ctx.drawImage(creature(seed == null ? (Math.random() * 1e9) | 0 : seed), 0, 0); changed(); },
      loadCanvas(src) { push(); ctx.clearRect(0, 0, PAD, PAD); ctx.drawImage(src, 0, 0, PAD, PAD); changed(); },
      toSprite() { return sprite(canvas); },
    };
  }

  const spriteURL = (spr) => spr.toDataURL('image/png');

  return { PAD, OUT, PALETTE, creature, sprite, sticker, fromDataURL, createPad, spriteURL };
})();
