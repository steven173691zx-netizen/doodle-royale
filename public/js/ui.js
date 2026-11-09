/* Menu flow + app boot: landing hero, draw step, skill step, play step, persistence, main loop. */
const UI = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const G = Game.G, { SKILLS, SKILL_IDS, C } = FBR;
  const TAU = Math.PI * 2;
  const STORE = 'dr.v1', OLD_STORE = 'fbr.v1';
  const MIGRATE = { sbd: 'vanish', squeak: 'slap' };
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ORDER = ['jet', 'burst', 'flame', 'bomb', 'boom', 'slap', 'vanish', 'bubble'];
  const S = { step: 'landing', create: { players: 8, bots: 4 }, cls: 'gun', skills: [], name: '', sprite: null, sticker: null, pad: null, invite: '', busy: false, dirty: true };
  let last = 0;

  /* ------------------------------------------------------------------ persistence */
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify({ name: S.name, cls: S.cls, skills: S.skills, img: S.sprite ? Doodle.spriteURL(S.sprite) : null })); } catch (e) {}
  }
  async function load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE) || localStorage.getItem(OLD_STORE) || 'null');
      if (!d) return;
      if (C.CLASSES[d.cls]) S.cls = d.cls;
      S.name = d.name || ''; S.skills = (d.skills || []).map(s => MIGRATE[s] || s).filter(s => SKILLS[s]).slice(0, 3);
      if (d.img) { const c = await Doodle.fromDataURL(d.img); if (c) { S.sprite = c; S.pad.loadCanvas(c); refreshSticker(); } }
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ steps */
  const STEPS = ['landing', 'draw', 'skills', 'play'];
  const hasDrawing = () => !!S.sprite;
  /* ------------------------------------------------------------------ fighter type picker: just the names */
  function renderClasses() {
    const box = $('#class-pick'); if (!box) return;
    box.innerHTML = ['sword', 'gun', 'sniper'].map(id => `<button type="button" class="seg-btn" role="radio" data-id="${id}" aria-checked="false">${C.CLASSES[id].name}</button>`).join('');
    box.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => { S.cls = b.dataset.id; syncClasses(); save(); Sfx.play('ui'); }));
    syncClasses();
  }
  function syncClasses() {
    document.querySelectorAll('#class-pick .seg-btn').forEach(b => { const on = b.dataset.id === S.cls; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on); });
  }
  function canGo(step) { return step === 'landing' || step === 'draw' || (step === 'skills' && hasDrawing()) || (step === 'play' && hasDrawing() && S.skills.length === 3); }
  function go(step) {
    if (!canGo(step)) return;
    S.step = step; document.body.dataset.step = step;
    $$('.screen').forEach(s => s.classList.toggle('is-active', s.id === 's-' + step));
    const idx = STEPS.indexOf(step);
    $$('.step').forEach(b => { const i = STEPS.indexOf(b.dataset.step); b.classList.toggle('is-on', i === idx); b.classList.toggle('is-done', i < idx && i > 0); b.disabled = !canGo(b.dataset.step); b.setAttribute('aria-current', i === idx ? 'step' : 'false'); });
    window.scrollTo(0, 0);
    if (step === 'play') renderPlay();
    if (step === 'skills') renderSkills();
    Sfx.play('ui');
  }

  /* ------------------------------------------------------------------ sprite / preview */
  function refreshSticker() { S.sticker = S.sprite ? Doodle.sticker(S.sprite, Game.SELF_COLOR) : null; $('#to-skills').disabled = !S.sprite; $$('.step').forEach(b => { b.disabled = !canGo(b.dataset.step); }); }
  function onPadChange() {
    S.sprite = S.pad.isEmpty() ? null : S.pad.toSprite();
    refreshSticker(); save();
  }

  const puffs = [];
  function drawScene(canvas, now, name) {
    const dpr = Math.min(2, devicePixelRatio || 1), cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw) return;
    if (canvas.width !== Math.round(cw * dpr)) { canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr); }
    const x = canvas.getContext('2d'), m = Math.min(cw, ch); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.fillStyle = '#1B1A20'; x.fillRect(0, 0, cw, ch);
    x.fillStyle = 'rgba(255,255,255,.08)'; x.beginPath();
    for (let gx = 20; gx < cw; gx += 40) for (let gy = 20; gy < ch; gy += 40) { x.moveTo(gx + 2, gy); x.arc(gx, gy, 2, 0, TAU); }
    x.fill();
    x.strokeStyle = 'rgba(255,255,255,.04)'; x.lineWidth = 2; x.beginPath(); x.arc(cw / 2, ch / 2, m * 0.4, 0, TAU); x.stroke();
    const t = now * 0.001, cx = cw / 2, cy = ch / 2 + 8 + Math.sin(t * 2) * 3, size = m * 0.56;
    // pencil dust drifting off the back
    if (false) puffs.push({ x: cx - size * 0.28, y: cy + size * 0.25, vx: -30 - Math.random() * 25, vy: 6 - Math.random() * 14, r: 8 + Math.random() * 8, t: 0 });
    for (let i = puffs.length - 1; i >= 0; i--) { const p = puffs[i]; p.t += 0.016; p.x += p.vx * 0.016; p.y += p.vy * 0.016; p.r += 0.22; if (p.t > 1.1) { puffs.splice(i, 1); continue; } x.globalAlpha = 0.5 * (1 - p.t / 1.1); x.fillStyle = '#FFA45C'; x.beginPath(); x.arc(p.x, p.y, p.r, 0, TAU); x.fill(); }
    x.globalAlpha = 1;
    x.fillStyle = 'rgba(15,14,18,.4)'; x.beginPath(); x.ellipse(cx, cy + size * 0.42, size * 0.3, size * 0.07, 0, 0, TAU); x.fill();
    if (S.sticker) { const sz = size * (S.sticker.width / 128); x.drawImage(S.sticker, cx - sz / 2, cy - sz / 2 - size * 0.04, sz, sz); }
    else { x.fillStyle = 'rgba(255,255,255,.3)'; x.font = '600 13px Archivo, sans-serif'; x.textAlign = 'center'; x.fillText('Start drawing…', cx, cy); }
    // hp + name
    const bw = size * 0.55, by = cy - size * 0.62;
    x.fillStyle = 'rgba(15,14,18,.8)'; x.beginPath(); x.roundRect(cx - bw / 2 - 2, by - 2, bw + 4, 10, 5); x.fill();
    x.fillStyle = '#8FD36B'; x.beginPath(); x.roundRect(cx - bw / 2, by, bw, 6, 3); x.fill();
    x.font = '700 14px Archivo, sans-serif'; x.textAlign = 'center'; x.lineJoin = 'round'; x.lineWidth = 4; x.strokeStyle = '#0F0E12'; x.strokeText(name || 'You', cx, by - 8); x.fillStyle = Game.SELF_COLOR; x.fillText(name || 'You', cx, by - 8);
  }

  /* ------------------------------------------------------------------ draw step */
  function initDraw() {
    S.pad = Doodle.createPad($('#pad'), onPadChange);
    const sw = $('#swatches');
    Doodle.PALETTE.forEach((c, i) => {
      const b = document.createElement('button'); b.className = 'swatch' + (i === 3 ? ' is-on' : ''); b.style.setProperty('--c', c); b.setAttribute('role', 'radio'); b.setAttribute('aria-label', 'Colour ' + c); b.setAttribute('aria-checked', i === 3);
      b.addEventListener('click', () => { S.pad.setColor(c); $$('.swatch', sw).forEach(o => { o.classList.toggle('is-on', o === b); o.setAttribute('aria-checked', o === b); }); if (S.pad.tool === 'brush') setTool('brush'); Sfx.play('ui'); });
      sw.appendChild(b);
    });
    const icons = { brush: 'brush', fill: 'fill', eraser: 'eraser' };
    $$('[data-tool]').forEach(b => { b.innerHTML = Art.icon(icons[b.dataset.tool], 20); b.addEventListener('click', () => setTool(b.dataset.tool)); });
    $$('.size').forEach(b => b.addEventListener('click', () => { S.pad.setSize(+b.dataset.size); $$('.size').forEach(o => o.classList.toggle('is-on', o === b)); }));
    $('#t-undo').innerHTML = Art.icon('undo', 20); $('#t-clear').innerHTML = Art.icon('trash', 20);
    $('#t-undo').addEventListener('click', () => S.pad.undo());
    $('#t-clear').addEventListener('click', () => S.pad.clear());
    $('#t-rand').addEventListener('click', () => { S.pad.randomize(); Sfx.play('pickup'); });
    document.addEventListener('keydown', (e) => { if (S.step === 'draw' && (e.metaKey || e.ctrlKey) && e.code === 'KeyZ') { e.preventDefault(); S.pad.undo(); } });
    $('#to-skills').addEventListener('click', () => go('skills'));
    $('#to-skills').disabled = true;
  }
  function setTool(t) { S.pad.setTool(t); $$('[data-tool]').forEach(b => b.classList.toggle('is-on', b.dataset.tool === t)); $('#pad').style.cursor = t === 'fill' ? 'cell' : 'crosshair'; }

  /* ------------------------------------------------------------------ skills step */
  function initSkills() {
    const grid = $('#skill-grid');
    ORDER.forEach(id => {
      const d = SKILLS[id], b = document.createElement('button');
      b.className = 'skill-card'; b.dataset.id = id; b.style.setProperty('--c', d.color); b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `<span class="skill-badge"></span><span class="skill-ico">${Art.icon(id, 26)}</span><span class="skill-name">${d.name}</span><span class="skill-desc">${d.desc}</span><span class="skill-meta mono"><span>${d.tag}</span><span>${d.cd}s</span></span>`;
      b.addEventListener('click', () => toggleSkill(id));
      grid.appendChild(b);
    });
    $('#to-play').addEventListener('click', () => go('play'));
    $('#sk-random').addEventListener('click', () => { const a = SKILL_IDS.slice().sort(() => Math.random() - 0.5); S.skills = a.slice(0, 3); renderSkills(); save(); Sfx.play('pickup'); });
  }
  function toggleSkill(id) {
    const i = S.skills.indexOf(id);
    if (i >= 0) S.skills.splice(i, 1);
    else if (S.skills.length < 3) S.skills.push(id);
    else { const d = $('#slots'); d.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 220 }); return; }
    renderSkills(); save(); Sfx.play('ui');
  }
  function renderSkills() {
    $$('.skill-card').forEach(c => { const i = S.skills.indexOf(c.dataset.id); c.classList.toggle('is-on', i >= 0); c.setAttribute('aria-pressed', i >= 0); c.querySelector('.skill-badge').textContent = i >= 0 ? i + 1 : ''; });
    const slots = $('#slots'); slots.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const id = S.skills[i], d = id && SKILLS[id], s = document.createElement('div');
      s.className = 'slot' + (d ? ' is-full' : ''); if (d) s.style.setProperty('--c', d.color);
      s.innerHTML = `<em>${i + 1}</em>${d ? Art.icon(id, 26) : ''}`; if (d) s.title = d.name;
      slots.appendChild(s);
    }
    $('#to-play').disabled = S.skills.length !== 3;
    $$('.step').forEach(b => { b.disabled = !canGo(b.dataset.step); });
  }

  /* ------------------------------------------------------------------ play step */
  function renderPlay() {
    $('#in-name').value = S.name;
    const K = C.CLASSES[S.cls]; $('#pf-class').innerHTML = `<span class="skill-chip" style="--c:${K.color}">${K.name}</span>`;
    $('#pf-skills').innerHTML = S.skills.map(id => `<span class="skill-chip" style="--c:${SKILLS[id].color}">${Art.icon(id, 17)}${SKILLS[id].name}</span>`).join('');
    const q = $('#btn-quickplay span'); q.textContent = S.invite ? `Join room ${S.invite}` : 'Quick play';
    if (S.invite) $('#in-room').value = S.invite;
  }
  function showError(msg) { const e = $('#play-error'); e.textContent = msg; e.hidden = !msg; }
  async function start(room, create) {
    if (S.busy) return; showError('');
    S.name = $('#in-name').value.trim().slice(0, 14) || S.name || 'Anonymous'; save();
    Sfx.init(); S.busy = true;
    $$('#s-play .btn, #btn-quick').forEach(b => { b.disabled = true; });
    try {
      await Game.join({ name: S.name, img: Doodle.spriteURL(S.sprite), skills: S.skills.slice(), cls: S.cls, room, create, sprite: S.sprite });
      enterGame(create ? G.code : room);
    } catch (e) { if (S.step === 'landing') go('play'); showError(e.message || 'Could not connect.'); }
    finally { S.busy = false; $$('#s-play .btn, #btn-quick').forEach(b => { b.disabled = false; }); }
  }
  function enterGame(room) {
    document.body.classList.remove('in-menu'); document.body.classList.add('in-game'); window.scrollTo(0, 0);
    HUD.enter(); Render.resize();
    if (room && history.replaceState) history.replaceState(null, '', '/?room=' + encodeURIComponent(room));
  }
  function leaveToMenu() {
    Game.leave(); HUD.exit();
    document.body.classList.remove('in-game'); document.body.classList.add('in-menu');
    if (history.replaceState) history.replaceState(null, '', '/');
    S.invite = ''; go('play'); renderPlay();
  }

  /* ------------------------------------------------------------------ landing hero (background canvas) */
  const hero = { ctx: null, W: 0, H: 0, dpr: 1, chars: [], blobs: [], puffs: [], ready: false };
  const HERO_SEEDS = [3, 17, 29, 41, 58, 77];
  function initHero() {
    const cv = $('#bg-cv'); hero.cv = cv; hero.ctx = cv.getContext('2d');
    const cols = ['#6CC8FF', '#FF92D0', '#B78CFF', '#63E6D2', '#FFD65C', '#8FD36B'];
    const layout = [[0.77, 0.42, 230], [0.92, 0.64, 165], [0.665, 0.72, 175], [0.93, 0.2, 125], [0.72, 0.14, 105], [0.82, 0.88, 120]];
    hero.chars = HERO_SEEDS.map((seed, i) => ({ spr: Doodle.sticker(Doodle.sprite(Doodle.creature(seed)), cols[i]), fx: layout[i][0], fy: layout[i][1], size: layout[i][2], ph: i * 1.3, puffT: Math.random() * 3 }));
    for (let i = 0; i < 7; i++) hero.blobs.push({ x: Math.random(), y: Math.random(), r: 90 + Math.random() * 170, vx: (Math.random() - 0.5) * 0.004, vy: (Math.random() - 0.5) * 0.004 });
    resizeHero(); addEventListener('resize', resizeHero);
  }
  function resizeHero() { const c = hero.cv; hero.dpr = Math.min(2, devicePixelRatio || 1); hero.W = innerWidth; hero.H = innerHeight; c.width = Math.round(hero.W * hero.dpr); c.height = Math.round(hero.H * hero.dpr); }
  function drawHero(now, dt) {
    const x = hero.ctx, W = hero.W, H = hero.H; x.setTransform(hero.dpr, 0, 0, hero.dpr, 0, 0); x.clearRect(0, 0, W, H);
    const landing = S.step === 'landing';
    x.fillStyle = '#6C7BFF';
    for (const b of hero.blobs) { if (!reduceMotion) { b.x += b.vx * dt; b.y += b.vy * dt; if (b.x < -0.1) b.x = 1.1; if (b.x > 1.1) b.x = -0.1; if (b.y < -0.1) b.y = 1.1; if (b.y > 1.1) b.y = -0.1; } x.globalAlpha = landing ? 0.04 : 0.025; x.beginPath(); x.arc(b.x * W, b.y * H, b.r, 0, TAU); x.fill(); }
    x.globalAlpha = 1;
    if (!landing) return;
    const t = now * 0.001, phone = W < 900;
    if (phone && H < 700) return;
    // dot field
    if (!phone) { x.fillStyle = 'rgba(255,255,255,.07)'; x.beginPath();
      for (let gx = W * 0.5; gx < W; gx += 44) for (let gy = 90; gy < H - 60; gy += 44) { x.moveTo(gx + 2, gy); x.arc(gx, gy, 2, 0, TAU); }
      x.fill(); }
    const rowM = [[0.2, 104], [0.5, 140], [0.8, 104]];
    for (let i = 0; i < hero.chars.length; i++) {
      if (phone && i > 2) break;
      const c = hero.chars[i], bob = reduceMotion ? 0 : Math.sin(t * 1.4 + c.ph) * (phone ? 6 : 9);
      const px = phone ? rowM[i][0] * W : c.fx * W, py = phone ? H - 96 + bob : c.fy * H + bob;
      const sz = (phone ? Math.min(rowM[i][1], W * 0.34) : c.size) * (c.spr.width / 128), spr = i === 0 && S.sticker ? S.sticker : c.spr;
      if (false) { c.puffT -= dt; if (c.puffT <= 0) { c.puffT = 1.4 + Math.random() * 2.4; hero.puffs.push({ x: px - sz * 0.3, y: py + sz * 0.3, vx: -50 - Math.random() * 40, vy: 10 - Math.random() * 20, r: 10 + Math.random() * 10, t: 0 }); } }
      x.fillStyle = 'rgba(15,14,18,.35)'; x.beginPath(); x.ellipse(px, py + sz * 0.42, sz * 0.3, sz * 0.07, 0, 0, TAU); x.fill();
      x.save(); x.translate(px, py); x.rotate(Math.sin(t * 1.1 + c.ph) * 0.05); x.drawImage(spr, -sz / 2, -sz / 2, sz, sz); x.restore();
    }
    for (let i = hero.puffs.length - 1; i >= 0; i--) { const p = hero.puffs[i]; p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.r += 14 * dt; if (p.t > 1.6) { hero.puffs.splice(i, 1); continue; } x.globalAlpha = 0.34 * (1 - p.t / 1.6); x.fillStyle = '#FFA45C'; x.beginPath(); x.arc(p.x, p.y, p.r, 0, TAU); x.fill(); }
    x.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ online counter */
  async function pollStats() {
    if (!document.body.classList.contains('in-menu')) return;
    try {
      const r = await fetch('/api/stats', { cache: 'no-store' }); const d = await r.json();
      $('#online').hidden = !(d.online > 0); $('#online-n').textContent = d.online;
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ boot */
  let errShown = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - last) / 1000); last = ts;
    try {
      if (document.body.classList.contains('in-game')) {
        if (G.running) { const v = Render.viewInfo(); Game.update(dt, ts, v.W, v.H, v.scale); Render.draw(ts); HUD.update(ts); }
      } else {
        drawHero(ts, dt);
        if (S.step === 'draw') drawScene($('#preview'), ts, S.name);
        else if (S.step === 'play') drawScene($('#fighter-prev'), ts, S.name);
      }
    } catch (e) { if (errShown++ < 5) console.error('frame error', e); (window.__errs = window.__errs || []).push('frame: ' + (e && e.stack || e)); }
  }

  /* ------------------------------------------------------------------ controls: keyboard or phone */
  function applyControls(mode, persist) {
    S.ctl = mode === 'touch' ? 'touch' : 'kb';
    document.body.classList.toggle('touch', S.ctl === 'touch');
    $$('#ctl-pick .seg-btn').forEach(b => { const on = b.dataset.ctl === S.ctl; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on); });
    $$('.controls-touch').forEach(e => { e.hidden = S.ctl !== 'touch'; });
    $$('.controls-kb').forEach(e => { e.hidden = S.ctl === 'touch'; });
    if (persist) { try { localStorage.setItem('dr.ctl', S.ctl); } catch (e) {} }
  }
  function initControls() {
    let saved = null; try { saved = localStorage.getItem('dr.ctl'); } catch (e) {}
    applyControls(saved || (matchMedia('(pointer: coarse)').matches ? 'touch' : 'kb'), false);
    $$('#ctl-pick .seg-btn').forEach(b => b.addEventListener('click', () => { applyControls(b.dataset.ctl, true); Sfx.play('ui'); }));
  }

  /* ------------------------------------------------------------------ create-room panel */
  function syncCreate() {
    const c = S.create, ok = (k, d) => k === 'players' ? c.players + d >= 1 && c.players + d <= 12 && c.players + d + c.bots <= 16 : c.bots + d >= 0 && c.players + c.bots + d <= 16;
    $('#cr-players').textContent = c.players; $('#cr-bots').textContent = c.bots;
    $('#cr-sum').textContent = `Up to ${c.players + c.bots} fighters (${c.players} players + ${c.bots} CPU). You start the match when everyone is in.`;
    $$('#create-panel .stepper').forEach(s => s.querySelectorAll('button').forEach(b => { b.disabled = !ok(s.dataset.k, +b.dataset.d); }));
  }
  function initCreate() {
    try { const d = JSON.parse(localStorage.getItem('dr.create') || 'null'); if (d && d.players >= 1 && d.players <= 12 && d.bots >= 0 && d.players + d.bots <= 16) S.create = { players: d.players | 0, bots: d.bots | 0 }; } catch (e) {}
    $$('#create-panel .stepper button').forEach(b => b.addEventListener('click', () => { const k = b.closest('.stepper').dataset.k; S.create[k] += +b.dataset.d; syncCreate(); Sfx.play('ui'); }));
    $('#btn-create-go').addEventListener('click', () => { try { localStorage.setItem('dr.create', JSON.stringify(S.create)); } catch (e) {} start('', { players: S.create.players, bots: S.create.bots }); });
    syncCreate();
  }

  async function boot() {
    HUD.init(); HUD.onLeave = leaveToMenu;
    $$('.ico-slot[data-icon]').forEach(s => { s.innerHTML = Art.icon(s.dataset.icon, 20); });
    $('#btn-sound').addEventListener('click', HUD.toggleMute);
    initDraw(); initSkills(); initHero();
    Render.init($('#cv'), $('#mm')); Game.bindInput($('#cv'));
    Game.bindTouch($('#touch'));
    initControls(); initCreate();
    $$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
    $$('.step').forEach(b => b.addEventListener('click', () => go(b.dataset.step)));
    $('#btn-start').addEventListener('click', () => { Sfx.init(); go('draw'); });
    $('#btn-quickplay').addEventListener('click', () => start(S.invite || ''));
    $('#btn-join-room').addEventListener('click', () => { const c = $('#in-room').value.trim(); if (c.length < 3) return showError('Room codes are 3–10 letters or numbers.'); start(c); });
    $('#btn-new-room').addEventListener('click', () => { const p = $('#create-panel'); p.hidden = !p.hidden; $('#btn-new-room').setAttribute('aria-expanded', !p.hidden); syncCreate(); });
    $('#in-name').addEventListener('input', (e) => { S.name = e.target.value.slice(0, 14); });
    $('#in-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') start(S.invite || ''); });
    $('#in-room').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-join-room').click(); });
    $('#btn-quick').addEventListener('click', () => start(S.invite || ''));

    const q = new URLSearchParams(location.search).get('room');
    if (q) S.invite = q.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    await load();
    renderClasses();
    if (S.sprite && S.skills.length === 3 && S.name) {
      $('#btn-quick').hidden = false; $('#quick-name').textContent = S.invite ? 'room ' + S.invite : S.name;
      $('#btn-quick span').firstChild.textContent = S.invite ? 'Join ' : 'Quick play as ';
    }
    renderSkills(); go('landing');
    pollStats(); setInterval(pollStats, 8000);
    ['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, () => Sfx.init(), { once: true, capture: true }));
    addEventListener('visibilitychange', () => { last = performance.now(); });
    requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
    window.__dr = { S, G, Game, UI: { go, start, leaveToMenu, toggleSkill }, HUD, Render, Doodle, Sfx };
  }
  return { boot };
})();

window.addEventListener('error', (e) => { (window.__errs = window.__errs || []).push(String(e.message) + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno); });
window.addEventListener('unhandledrejection', (e) => { (window.__errs = window.__errs || []).push('promise: ' + String(e.reason && e.reason.message || e.reason)); });
document.fonts && document.fonts.ready.then(() => UI.boot()); if (!document.fonts) UI.boot();
