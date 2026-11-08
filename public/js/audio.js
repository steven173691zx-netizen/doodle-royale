/* Procedural sound: every effect is synthesised (no audio files). The palette is "stationery":
 * pencil ticks, marker squeaks, eraser rubs, ink splats and paper cracks, built from short oscillator blips,
 * filtered noise and a few randomised glass-tinkle shards for the big moments. */
const Sfx = (() => {
  let ctx = null, master = null, muted = false, lx = 0, ly = 0, voices = 0;
  try { muted = (localStorage.getItem('dr.muted') ?? localStorage.getItem('fbr.muted')) === '1'; } catch (e) {}
  const lastAt = {};
  const noiseCache = new WeakMap();

  function getNoise(ac) {
    let b = noiseCache.get(ac);
    if (!b) {
      b = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      noiseCache.set(ac, b);
    }
    return b;
  }
  const noiseSrc = (ac) => { const s = ac.createBufferSource(); s.buffer = getNoise(ac); s.loop = true; return s; };

  /* ---------- primitives ---------- */
  function env(g, t0, dur, vol, attack, sustain) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t0 + attack);
    g.gain.setValueAtTime(Math.max(0.0002, vol), t0 + Math.max(attack, dur * sustain));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  function noiseBurst(ac, dest, o) {
    const t0 = ac.currentTime + (o.delay || 0), dur = o.dur;
    const n = noiseSrc(ac), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = o.type || 'bandpass'; f.Q.value = o.q == null ? 1 : o.q;
    f.frequency.setValueAtTime(o.f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(30, o.f1 || o.f0), t0 + dur);
    env(g, t0, dur, (o.vol || 0.2) * (o.v == null ? 1 : o.v), o.attack || 0.004, o.sustain == null ? 0.2 : o.sustain);
    n.connect(f); f.connect(g); g.connect(dest);
    n.start(t0, Math.random() * 0.5); n.stop(t0 + dur + 0.05);
  }

  function blip(ac, dest, o) {
    const t0 = ac.currentTime + (o.delay || 0), dur = o.dur;
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = o.wave || 'sine';
    osc.frequency.setValueAtTime(o.f0, t0); osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 || o.f0), t0 + dur);
    env(g, t0, dur, (o.vol || 0.2) * (o.v == null ? 1 : o.v), o.attack || 0.006, o.sustain == null ? 0.3 : o.sustain);
    osc.connect(g); g.connect(dest); osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  /* pencil scratch: band-passed noise chopped by a fast square LFO, so it sounds like quick strokes */
  function scratch(ac, dest, o) {
    const t0 = ac.currentTime + (o.delay || 0), dur = o.dur;
    const n = noiseSrc(ac), f = ac.createBiquadFilter(), am = ac.createGain(), out = ac.createGain();
    f.type = 'bandpass'; f.Q.value = 2.2;
    f.frequency.setValueAtTime(o.f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(200, o.f1 || o.f0), t0 + dur);
    am.gain.value = 0.55;
    const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.type = 'square'; lfo.frequency.setValueAtTime(o.rate || 24, t0); lg.gain.value = 0.45;
    lfo.connect(lg); lg.connect(am.gain);
    env(out, t0, dur, (o.vol || 0.15) * (o.v == null ? 1 : o.v), 0.01, 0.5);
    n.connect(f); f.connect(am); am.connect(out); out.connect(dest);
    n.start(t0, Math.random() * 0.5); lfo.start(t0); n.stop(t0 + dur + 0.05); lfo.stop(t0 + dur + 0.05);
  }

  /* a spray of tiny glass/paper shards, randomised on every call */
  function tinkle(ac, dest, o) {
    const n = o.n || 8;
    for (let i = 0; i < n; i++) blip(ac, dest, { v: o.v, delay: (o.delay || 0) + Math.random() * (o.span || 0.3), f0: 1800 + Math.random() * 2800, f1: 900 + Math.random() * 900, dur: 0.05 + Math.random() * 0.06, vol: o.vol || 0.07, wave: 'triangle' });
  }

  /* ---------- presets ---------- */
  const rp = (o) => (o.pitch || 1) * (0.94 + Math.random() * 0.12);
  const PRE = {
    shot: (a, d, o) => { const p = rp(o); blip(a, d, { v: o.v, f0: 920 * p, f1: 430 * p, dur: 0.07, vol: 0.12, wave: 'triangle' }); noiseBurst(a, d, { v: o.v, dur: 0.03, f0: 3600, f1: 2600, q: 1.5, vol: 0.05 }); },
    hot: (a, d, o) => { const p = rp(o); blip(a, d, { v: o.v, f0: 740 * p, f1: 300 * p, dur: 0.09, vol: 0.13, wave: 'sawtooth' }); scratch(a, d, { v: o.v, dur: 0.08, f0: 3200, f1: 1800, vol: 0.08 }); },
    jet: (a, d, o) => {
      noiseBurst(a, d, { v: o.v, dur: 0.34, f0: 500, f1: 3400, q: 0.8, vol: 0.26 });
      scratch(a, d, { v: o.v, dur: 0.3, f0: 1500, f1: 3600, rate: 44, vol: 0.16 });
      blip(a, d, { v: o.v, f0: 260, f1: 820, dur: 0.2, vol: 0.07, wave: 'square' });
    },
    vanish: (a, d, o) => {
      noiseBurst(a, d, { v: o.v, dur: 0.75, f0: 2400, f1: 500, q: 0.7, vol: 0.14, attack: 0.1, sustain: 0.5 });
      blip(a, d, { v: o.v, f0: 620, f1: 240, dur: 0.55, vol: 0.09, attack: 0.05 });
      blip(a, d, { v: o.v, delay: 0.12, f0: 930, f1: 360, dur: 0.5, vol: 0.05, attack: 0.05 });
    },
    boom: (a, d, o) => {
      blip(a, d, { v: o.v, f0: 125, f1: 32, dur: 0.5, vol: 0.55 });
      noiseBurst(a, d, { v: o.v, dur: 0.34, f0: 1500, f1: 160, type: 'lowpass', q: 0.7, vol: 0.32 });
      scratch(a, d, { v: o.v, delay: 0.02, dur: 0.28, f0: 2600, f1: 900, rate: 18, vol: 0.2 });
    },
    flame: (a, d, o) => {
      noiseBurst(a, d, { v: o.v, dur: 0.45, f0: 700, f1: 2600, q: 0.6, vol: 0.28 });
      blip(a, d, { v: o.v, f0: 240, f1: 120, dur: 0.4, vol: 0.12, wave: 'sawtooth' });
      scratch(a, d, { v: o.v, dur: 0.4, f0: 3000, f1: 1500, rate: 30, vol: 0.12 });
    },
    bomb: (a, d, o) => { blip(a, d, { v: o.v, f0: 300, f1: 760, dur: 0.14, vol: 0.2 }); blip(a, d, { v: o.v, delay: 0.1, f0: 520, f1: 900, dur: 0.1, vol: 0.1 }); },
    bombBoom: (a, d, o) => {
      blip(a, d, { v: o.v, f0: 160, f1: 42, dur: 0.38, vol: 0.5 });
      noiseBurst(a, d, { v: o.v, dur: 0.28, f0: 1100, f1: 160, type: 'lowpass', q: 0.7, vol: 0.28 });
      blip(a, d, { v: o.v, delay: 0.03, f0: 760, f1: 240, dur: 0.14, vol: 0.18 });
    },
    bubble: (a, d, o) => { for (let i = 0; i < 4; i++) blip(a, d, { v: o.v, delay: i * 0.045, f0: 1100 - i * 120, f1: 320, dur: 0.05, vol: 0.14 }); },
    slap: (a, d, o) => {
      noiseBurst(a, d, { v: o.v, dur: 0.09, f0: 3400, f1: 1400, q: 0.9, vol: 0.5, attack: 0.002 });
      blip(a, d, { v: o.v, f0: 1900, f1: 380, dur: 0.08, vol: 0.18, wave: 'square' });
      blip(a, d, { v: o.v, f0: 240, f1: 90, dur: 0.18, vol: 0.3 });
    },
    hit: (a, d, o) => { blip(a, d, { v: o.v, f0: 540, f1: 240, dur: 0.05, vol: 0.16, wave: 'triangle' }); noiseBurst(a, d, { v: o.v, dur: 0.045, f0: 1700, f1: 900, q: 1.2, vol: 0.12 }); },
    hitMe: (a, d, o) => { blip(a, d, { v: o.v, f0: 190, f1: 66, dur: 0.14, vol: 0.38 }); noiseBurst(a, d, { v: o.v, dur: 0.08, f0: 1400, f1: 600, vol: 0.2 }); },
    pickup: (a, d, o) => {
      [523, 659, 784, 1047].forEach((f, i) => blip(a, d, { v: o.v, delay: i * 0.055, f0: f * (o.pitch || 1), f1: f * (o.pitch || 1), dur: 0.1, vol: 0.14, wave: 'triangle' }));
      tinkle(a, d, { v: o.v, n: 3, delay: 0.1, span: 0.15, vol: 0.05 });
    },
    /* the big one: impact thud, falling howl, crash and a shower of paper-glass shards */
    death: (a, d, o) => {
      blip(a, d, { v: o.v, f0: 95, f1: 28, dur: 0.7, vol: 0.65 });
      blip(a, d, { v: o.v, f0: 760, f1: 52, dur: 1.0, vol: 0.2, wave: 'sawtooth', attack: 0.02, sustain: 0.4 });
      noiseBurst(a, d, { v: o.v, dur: 0.85, f0: 3600, f1: 180, type: 'lowpass', q: 0.8, vol: 0.4, sustain: 0.35 });
      scratch(a, d, { v: o.v, delay: 0.04, dur: 0.5, f0: 3800, f1: 800, rate: 40, vol: 0.18 });
      tinkle(a, d, { v: o.v, n: 12, delay: 0.06, span: 0.45, vol: 0.08 });
      blip(a, d, { v: o.v, delay: 0.55, f0: 420, f1: 140, dur: 0.4, vol: 0.12, wave: 'triangle' });
    },
    ko: (a, d, o) => {
      noiseBurst(a, d, { v: o.v, dur: 0.12, f0: 2600, f1: 700, q: 0.8, vol: 0.34, attack: 0.002 });
      blip(a, d, { v: o.v, f0: 220, f1: 880, dur: 0.09, vol: 0.2, wave: 'square' });
      blip(a, d, { v: o.v, delay: 0.08, f0: 1318 * (o.pitch || 1), f1: 1318 * (o.pitch || 1), dur: 0.26, vol: 0.17, wave: 'triangle' });
      blip(a, d, { v: o.v, delay: 0.16, f0: 1760 * (o.pitch || 1), f1: 1760 * (o.pitch || 1), dur: 0.3, vol: 0.12, wave: 'triangle' });
    },
    streak: (a, d, o) => { const p = o.pitch || 1; [659, 784, 988, 1319].forEach((f, i) => blip(a, d, { v: o.v, delay: i * 0.06, f0: f * p, f1: f * p, dur: 0.12, vol: 0.14, wave: 'square', sustain: 0.5 })); },
    swing: (a, d, o) => { noiseBurst(a, d, { v: o.v, dur: 0.14, vol: 0.2, f0: 3200, f1: 900 }); blip(a, d, { v: o.v, f0: 700, f1: 240, dur: 0.1, vol: 0.12, wave: 'sawtooth' }); },
    chip: (a, d, o) => { noiseBurst(a, d, { v: o.v, dur: 0.06, vol: 0.14, f0: 1800, f1: 700 }); blip(a, d, { v: o.v, f0: 260, f1: 150, dur: 0.05, vol: 0.08 }); },
    crumble: (a, d, o) => { noiseBurst(a, d, { v: o.v, dur: 0.42, vol: 0.28, f0: 900, f1: 120, q: 0.7 }); blip(a, d, { v: o.v, f0: 140, f1: 48, dur: 0.3, vol: 0.2 }); },
    levelup: (a, d, o) => { [523, 659, 784].forEach((f, i) => blip(a, d, { v: o.v, delay: i * 0.07, f0: f, f1: f * 1.02, dur: 0.14, vol: 0.15, wave: 'triangle', sustain: 0.6 })); },
    enemyDeath: (a, d, o) => { blip(a, d, { v: o.v, f0: 520, f1: 120, dur: 0.1, vol: 0.22 }); noiseBurst(a, d, { v: o.v, dur: 0.09, f0: 2600, f1: 900, q: 0.9, vol: 0.14 }); },
    spit: (a, d, o) => { blip(a, d, { v: o.v, f0: 380, f1: 170, dur: 0.12, vol: 0.2 }); noiseBurst(a, d, { v: o.v, dur: 0.07, f0: 1800, f1: 900, vol: 0.09 }); },
    meteorWarn: (a, d, o) => { blip(a, d, { v: o.v, f0: 1500, f1: 420, dur: 0.95, vol: 0.07, attack: 0.05, sustain: 0.6 }); },
    meteor: (a, d, o) => {
      blip(a, d, { v: o.v, f0: 110, f1: 30, dur: 0.5, vol: 0.5 });
      noiseBurst(a, d, { v: o.v, dur: 0.4, f0: 1600, f1: 110, type: 'lowpass', q: 0.7, vol: 0.36 });
      blip(a, d, { v: o.v, delay: 0.02, f0: 820, f1: 260, dur: 0.14, vol: 0.14 });
    },
    event: (a, d, o) => {
      for (let i = 0; i < 4; i++) blip(a, d, { v: o.v, delay: i * 0.13, f0: i % 2 ? 880 : 660, f1: i % 2 ? 880 : 660, dur: 0.11, vol: 0.14, wave: 'triangle' });
      blip(a, d, { v: o.v, f0: 140, f1: 60, dur: 0.6, vol: 0.18 });
    },
    tick: (a, d, o) => { blip(a, d, { v: o.v, f0: 880, f1: 880, dur: 0.05, vol: 0.12 }); },
    go: (a, d, o) => { blip(a, d, { v: o.v, f0: 660, f1: 660, dur: 0.12, vol: 0.2, wave: 'triangle' }); blip(a, d, { v: o.v, delay: 0.11, f0: 990, f1: 990, dur: 0.22, vol: 0.2, wave: 'triangle' }); },
    win: (a, d, o) => {
      [523, 659, 784, 1047, 1319].forEach((f, i) => blip(a, d, { v: o.v, delay: i * 0.1, f0: f, f1: f, dur: 0.2, vol: 0.18, wave: 'triangle' }));
      [523, 659, 784].forEach((f) => blip(a, d, { v: o.v, delay: 0.55, f0: f, f1: f, dur: 0.9, vol: 0.1, wave: 'square', sustain: 0.6 }));
      tinkle(a, d, { v: o.v, n: 10, delay: 0.5, span: 0.7, vol: 0.06 });
    },
    lose: (a, d, o) => { blip(a, d, { v: o.v, f0: 392, f1: 311, dur: 0.4, vol: 0.18, wave: 'triangle' }); blip(a, d, { v: o.v, delay: 0.3, f0: 262, f1: 196, dur: 0.6, vol: 0.14, wave: 'triangle' }); },
    ui: (a, d, o) => { blip(a, d, { v: o.v, f0: 660, f1: 880, dur: 0.045, vol: 0.07 }); },
    zone: (a, d, o) => { noiseBurst(a, d, { v: o.v, dur: 0.9, f0: 500, f1: 180, type: 'lowpass', q: 0.7, vol: 0.2, attack: 0.1, sustain: 0.5 }); blip(a, d, { v: o.v, f0: 90, f1: 62, dur: 0.9, vol: 0.14, attack: 0.1, sustain: 0.5 }); },
  };
  const GAP = { shot: 45, hot: 45, hit: 35, spit: 80, hitMe: 80, enemyDeath: 40, meteorWarn: 120, meteor: 70, bubble: 60 };

  /* ---------- runtime ---------- */
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.6;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
  }

  function play(name, o = {}) {
    if (!ctx || muted || !PRE[name]) return;
    const now = performance.now();
    if (GAP[name] && now - (lastAt[name] || 0) < GAP[name]) return;
    lastAt[name] = now;
    if (voices > 30 && !o.prio) return;
    let v = o.v == null ? 1 : o.v, pan = 0;
    if (o.x != null) {
      const dx = o.x - lx, dy = o.y - ly, d = Math.hypot(dx, dy);
      v *= Math.pow(Math.max(0.12, 1 - d / 1150), 1.3);
      pan = Math.max(-0.85, Math.min(0.85, dx / 650));
    }
    if (v < 0.03) return;
    const g = ctx.createGain();
    if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(master); } else g.connect(master);
    voices++; setTimeout(() => { voices--; }, 1600);
    PRE[name](ctx, g, { v, pitch: o.pitch });
  }

  function setMuted(m) {
    muted = !!m;
    try { localStorage.setItem('dr.muted', muted ? '1' : '0'); } catch (e) {}
    if (master) master.gain.value = muted ? 0 : 0.6;
  }

  /* offline render for tests: returns peak / rms / non-silent flag */
  async function renderTest(name, seconds = 1.8) {
    const off = new OfflineAudioContext(1, Math.ceil(44100 * seconds), 44100);
    PRE[name](off, off.destination, { v: 1 });
    const buf = await off.startRendering(), d = buf.getChannelData(0);
    let peak = 0, sum = 0, nan = false;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a !== a) nan = true; if (a > peak) peak = a; sum += d[i] * d[i]; }
    return { name, peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(4), nan };
  }

  return {
    init, play, setMuted, get muted() { return muted; }, setListener(x, y) { lx = x; ly = y; },
    get ready() { return !!ctx; }, names: Object.keys(PRE), renderTest,
  };
})();
