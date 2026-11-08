/* DOM HUD: vitals, skills, minimap host, kill feed, toasts, lobby / death / results overlays, touch sticks. */
const HUD = (() => {
  const G = Game.G, { SKILLS, POWERUPS, PU_IDS } = FBR;
  const el = new Proxy({}, { get: (t, k) => t[k] || (t[k] = document.getElementById(k)) });
  const buffEls = new Map();
  let slotEls = [], lastCd = [-1, -1, -1], wasReady = [true, true, true], deadTimer = 0, confirmOpen = false, sticks = null, hpCol = '';
  const api = { onLeave: null };

  const fmt = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function initIcons() {
    document.querySelectorAll('.ico-slot[data-icon]').forEach(s => { s.innerHTML = Art.icon(s.dataset.icon, 20); });
    el['btn-leave'].innerHTML = Art.icon('out', 20);
    setMuteIcon();
  }
  function setMuteIcon() {
    const h = Art.icon(Sfx.muted ? 'soundOff' : 'soundOn', 20);
    el['btn-mute'].innerHTML = h; const b = document.getElementById('btn-sound'); if (b) b.innerHTML = h;
  }
  /* rebind UI (Play screen): click a key, press the new one */
  function syncBinds() {
    const b = Game.getBinds(), def = ['KeyJ', 'KeyK', 'KeyL'];
    document.querySelectorAll('.kbind').forEach((k) => { k.textContent = Game.keyLabel(b[+k.dataset.i]); k.classList.remove('listening'); });
    document.querySelectorAll('kbd.bind-0').forEach(k => k.textContent = Game.keyLabel(b[0]));
    document.querySelectorAll('kbd.bind-1').forEach(k => k.textContent = Game.keyLabel(b[1]));
    document.querySelectorAll('kbd.bind-2').forEach(k => k.textContent = Game.keyLabel(b[2]));
    const rs = document.getElementById('bind-reset'); if (rs) rs.hidden = b.every((x, i) => x === def[i]);
    const h = document.getElementById('bind-hint'); if (h) h.textContent = 'click a key to change';
  }
  function initBindUI() {
    let listening = -1;
    const stop = () => { listening = -1; syncBinds(); };
    document.querySelectorAll('.kbind').forEach((k) => k.addEventListener('click', () => {
      stop(); listening = +k.dataset.i; k.classList.add('listening'); k.textContent = '…'; document.getElementById('bind-hint').textContent = 'press a key (Esc cancels)';
    }));
    window.addEventListener('keydown', (e) => {
      if (listening < 0) return;
      e.preventDefault(); e.stopPropagation();
      if (e.code === 'Escape') return stop();
      if (!Game.setBind(listening, e.code)) { document.getElementById('bind-hint').textContent = 'that key is taken (move / mute); try another'; return; }
      stop();
    }, true);
    document.getElementById('bind-reset').addEventListener('click', () => { Game.resetBinds(); });
    syncBinds();
  }
  function toggleMute() { Sfx.init(); Sfx.setMuted(!Sfx.muted); setMuteIcon(); }

  function buildSkillBar(skills) {
    const bar = el['skill-bar']; bar.innerHTML = ''; slotEls = [];
    skills.forEach((id, i) => {
      const def = SKILLS[id], b = document.createElement('button');
      b.className = 'skill ready'; b.style.setProperty('--c', def.color); b.setAttribute('aria-label', `${def.name} (key ${Game.keyLabel(Game.getBinds()[i])})`);
      b.innerHTML = `<span class="key">${Game.keyLabel(Game.getBinds()[i])}</span>${Art.icon(id, 30)}<div class="cd"></div><div class="cdn"></div>`;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); Sfx.init(); Game.queueCast(i); });
      bar.appendChild(b);
      slotEls.push({ b, cd: b.querySelector('.cd'), n: b.querySelector('.cdn') });
    });
    lastCd = [-1, -1, -1]; wasReady = [true, true, true];
  }

  function toast(text, opts = {}) {
    if (!el['ov-dead'].hidden || !el['ov-over'].hidden) return;
    const t = document.createElement('div');
    t.className = 'toast ' + (opts.cls || ''); t.textContent = text;
    if (opts.sub) { const s = document.createElement('small'); s.textContent = opts.sub; t.appendChild(s); }
    const box = el['toasts']; box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.remove(), 2300);
  }

  const CAUSE = {
    pencil: ['burst', '#C9F26A'], flame: ['flame', '#FF7A59'], boom: ['boom', '#FF92D0'], bomb: ['bomb', '#6C7BFF'], poison: ['vanish', '#9B7BFF'],
    goo: ['bomb', '#6C7BFF'], trail: ['jet', '#FFA45C'], burn: ['flame', '#FF8A3C'], ignite: ['flame', '#FFB45C'], stomp: ['target', '#B78CFF'], slap: ['slap', '#FFD65C'], meteor: ['bomb', '#9AA6FF'],
  };
  const ENEMY_NAME = { 'e:fly': 'Scribble', 'e:spit': 'Inkblot', 'e:chonk': 'Smudge' };

  function addKill(k) {
    const item = document.createElement('div'); item.className = 'feed-item';
    const nm = (id, n) => `<b class="${id === G.id ? 'me' : ''}">${esc(n)}</b>`;
    let html;
    if (k.cause === 'left') html = `${nm(k.vid, k.vn)}<span>left</span>`;
    else if (k.kn) { const c = CAUSE[k.cause] || ['target', '#fff']; html = `${nm(k.kid, k.kn)}<span style="--c:${c[1]}">${Art.icon(c[0], 15)}</span>${nm(k.vid, k.vn)}`; }
    else if (k.cause === 'zone') html = `${nm(k.vid, k.vn)}<span style="--c:#8D99FF">${Art.icon('zone', 15)}</span><span>drowned in ink</span>`;
    else if (k.cause === 'meteor') html = `${nm(k.vid, k.vn)}<span>was flattened by an ink drop</span>`;
    else html = `${nm(k.vid, k.vn)}<span>was scribbled out by ${ENEMY_NAME[k.cause] ? 'a ' + ENEMY_NAME[k.cause] : 'a monster'}</span>`;
    item.innerHTML = html;
    const f = el['feed']; f.appendChild(item);
    while (f.children.length > 6) f.firstChild.remove();
    setTimeout(() => item.classList.add('out'), 6000); setTimeout(() => item.remove(), 6500);
  }

  /* ------------------------------------------------------------------ overlays */
  function hideOverlays() { ['ov-dead', 'ov-over', 'ov-conn'].forEach(id => { el[id].hidden = true; }); }

  function showLobby() {
    el['ov-lobby'].hidden = false; el['btn-ready'].disabled = false;
    el['btn-ready'].lastElementChild.textContent = 'Ready';
    const priv = G.code && !G.code.startsWith('PUB');
    el['btn-invite'].hidden = !priv;
  }

  function showDead(m) {
    const total = G.roster.size || 12;
    el['dead-place'].textContent = '#' + m.place;
    let by = 'Swallowed by The Ink';
    if (m.by) by = 'Eliminated by ' + m.by;
    else if (m.cause === 'meteor') by = 'Flattened by an ink drop';
    else if (ENEMY_NAME[m.cause]) by = 'Scribbled out by a ' + ENEMY_NAME[m.cause];
    el['dead-by'].textContent = by + ` · ${m.place} of ${total}`;
    el['st-kills'].textContent = m.kills; el['st-dmg'].textContent = m.dmg; el['st-time'].textContent = fmt(m.time);
    el['ov-dead'].hidden = false;
  }

  function showOver(m) {
    el['ov-dead'].hidden = true;
    const win = m.board.find(r => r.id === m.w), mine = m.w === G.id;
    el['over-kicker'].textContent = mine ? 'Last one standing' : 'Match over';
    el['over-title'].textContent = mine ? 'Victory Royale' : (win ? win.n + ' wins' : 'No winner');
    el['over-title'].classList.toggle('small', !mine && win && win.n.length > 6);
    el['over-sub'].textContent = mine ? 'You outlasted everyone.' : (win && win.b ? 'A bot took the crown. Revenge awaits.' : '');
    const rows = m.board.slice(0, 6);
    const me = m.board.find(r => r.id === G.id);
    if (me && !rows.includes(me)) rows.push(me);
    el['over-board'].innerHTML = rows.map(r => `<li class="${r.id === G.id ? 'me' : ''}"><span class="pl">#${r.p}</span><span class="nm">${esc(r.n)}${r.b ? '<span class="bot">BOT</span>' : ''}</span><span class="k"><b>${r.k}</b> elims</span><span class="k">${r.d} dmg</span></li>`).join('');
    el['ov-over'].hidden = false;
    Sfx.play(mine ? 'win' : 'lose', { prio: 1 });
  }

  function showConn(title, sub, resume) {
    el['conn-title'].textContent = title; el['conn-sub'].textContent = sub;
    el['conn-resume'].hidden = !resume; el['conn-menu'].querySelector('span').textContent = resume ? 'Leave match' : 'Back to menu';
    el['ov-conn'].hidden = false;
  }

  /* ------------------------------------------------------------------ touch stick + banners */
  function drawSticks(T) {
    if (!sticks) {
      sticks = { l: document.createElement('div') };
      sticks.l.className = 'stick'; sticks.l.hidden = true; sticks.l.innerHTML = '<i></i>'; el['game'].appendChild(sticks.l);
    }
    const s = T.l; sticks.l.hidden = !s;
    if (s) { sticks.l.style.left = s.x0 + 'px'; sticks.l.style.top = s.y0 + 'px'; sticks.l.firstChild.style.transform = `translate(${T.lv[0] * T.R}px, ${T.lv[1] * T.R}px)`; }
  }

  /* big centre-screen slam text: eliminations, kill streaks, chaos events */
  function slam(text, sub, cls, color) {
    const box = el['slam']; box.innerHTML = '';
    const d = document.createElement('div'); d.className = 'slam-item ' + (cls || ''); if (color) d.style.setProperty('--c', color);
    d.innerHTML = `<div class="s">${esc(text)}</div>${sub ? `<div class="u">${esc(sub)}</div>` : ''}`;
    box.appendChild(d); setTimeout(() => d.remove(), cls && cls.includes('dead') ? 2100 : 1700);
  }
  const STREAK = ['', 'KO', 'DOUBLE KILL', 'TRIPLE KILL', 'MEGA KILL', 'UNSTOPPABLE'];
  const CHAOS = { rain: ['INK RAIN', 'Watch the sky. Keep moving.', '#9AA6FF'], swarm: ['DOODLE SWARM', 'They are coming from everywhere.', '#FF7B6E'], party: ['POWER-UP PARTY', 'Grab everything you can.', '#FFD65C'] };

  /* ------------------------------------------------------------------ per-frame */
  function update(now) {
    if (!G.running) return;
    // counters
    el['n-alive'].textContent = G.aliveN; el['n-kills'].textContent = G.kills;
    if (el['n-lv'].textContent != G.lvl) { if (+el['n-lv'].textContent < G.lvl) { el['pill-lv'].classList.remove('bump'); void el['pill-lv'].offsetWidth; el['pill-lv'].classList.add('bump'); } el['n-lv'].textContent = G.lvl; }
    // vitals
    const frac = G.alive ? Math.max(0, G.hp / G.maxHp) : 0;
    el['hp-fill'].style.width = (frac * 100) + '%';
    const col = frac > 0.5 ? 'var(--ok)' : frac > 0.25 ? '#FFD65C' : 'var(--danger)';
    if (col !== hpCol) { el['hp-fill'].style.background = col; hpCol = col; }
    el['hp-n'].textContent = G.alive ? G.hp : 0;
    el['hp-shield'].style.width = (G.alive ? Math.min(1, G.shield / G.maxHp) * 100 : 0) + '%';
    el['edge'].style.opacity = G.cam.flash * 0.85;

    // cooldowns
    const skills = G.skills;
    for (let i = 0; i < slotEls.length; i++) {
      const cd = G.alive ? G.cd[i] : 99, total = SKILLS[skills[i]].cd, s = slotEls[i];
      const key = cd <= 0 ? 0 : Math.ceil(cd * 10);
      if (key !== lastCd[i]) {
        lastCd[i] = key;
        const ready = cd <= 0;
        s.cd.style.transform = `scaleY(${ready ? 0 : Math.min(1, cd / total)})`;
        s.n.textContent = ready || cd > 90 ? '' : (cd >= 10 ? Math.ceil(cd) : cd.toFixed(1));
        s.b.classList.toggle('ready', ready);
        if (ready && !wasReady[i] && G.alive) { s.b.classList.remove('pop'); void s.b.offsetWidth; s.b.classList.add('pop'); }
        wasReady[i] = ready;
      } else if (cd > 0) { s.cd.style.transform = `scaleY(${Math.min(1, cd / total)})`; }
    }

    // zone pill
    const pz = el['pill-zone'];
    if (G.phase === 1 && G.zone) {
      const z = G.zone, left = Math.max(0, z[7] - (G.last ? (now - G.last.at) / 1000 : 0)), closing = z[6] === 1, final = z[8] > 7 && !closing;
      el['zone-label'].textContent = closing ? 'Closing' : final ? 'Final' : 'Ink in';
      el['zone-time'].textContent = final ? '' : fmt(left);
      pz.classList.toggle('closing', closing);
    } else { el['zone-label'].textContent = G.phase === 2 ? 'Match over' : 'Warm-up'; el['zone-time'].textContent = ''; pz.classList.remove('closing'); }

    // buffs
    const seen = new Set();
    for (const [idx, rem0] of G.bf) {
      const rem = Math.max(0, rem0 - (G.last ? (now - G.last.at) / 1000 : 0)); seen.add(idx);
      let b = buffEls.get(idx);
      if (!b) {
        const id = PU_IDS[idx]; b = document.createElement('div'); b.className = 'buff'; b.title = `${POWERUPS[id].name}: ${POWERUPS[id].effect}`;
        b.innerHTML = `<img alt="" src="${Art.pickupImg(id, 22)}"><span></span>`; el['buffs'].appendChild(b); buffEls.set(idx, b);
      }
      b.lastChild.textContent = Math.ceil(rem) + 's';
    }
    for (const [idx, b] of buffEls) if (!seen.has(idx)) { b.remove(); buffEls.delete(idx); }

    // lobby / spectate / over timers
    if (!el['ov-lobby'].hidden) {
      const warm = G.phase === 0;
      el['lobby-n'].textContent = Math.max(0, G.lobbyT);
      el['lobby-kicker'].textContent = warm ? 'Warm-up' : '';
    }
    const spec = !G.alive && G.phase !== 0 && el['ov-dead'].hidden && el['ov-over'].hidden && !deadTimer;
    el['spec-bar'].hidden = !(spec && (G.dead && G.dead.spectating || G.queued));
    if (!el['spec-bar'].hidden) { const r = G.roster.get(G.specId); el['spec-name'].textContent = r ? r.n : '—'; }
    if (!el['ov-over'].hidden) el['over-next'].textContent = 'Next round in ' + Math.max(0, G.lobbyT) + 's';
    document.getElementById('game').classList.toggle('is-spec', !G.alive);
  }

  /* ------------------------------------------------------------------ wiring */
  function bind() {
    el['btn-mute'].addEventListener('click', toggleMute);
    el['btn-leave'].addEventListener('click', () => { confirmOpen = true; showConn('Leave match?', 'You will give up your spot in this round.', true); });
    el['conn-resume'].addEventListener('click', () => { confirmOpen = false; el['ov-conn'].hidden = true; });
    el['conn-menu'].addEventListener('click', () => { confirmOpen = false; el['ov-conn'].hidden = true; api.onLeave && api.onLeave(); });
    el['btn-ready'].addEventListener('click', () => { Sfx.init(); Game.ready(); el['btn-ready'].disabled = true; el['btn-ready'].lastElementChild.textContent = 'Waiting…'; Sfx.play('ui'); });
    el['btn-invite'].addEventListener('click', async () => {
      const url = `${location.origin}/?room=${encodeURIComponent(G.code)}`;
      try { await navigator.clipboard.writeText(url); el['invite-label'].textContent = 'Copied'; } catch (e) { el['invite-label'].textContent = G.code; }
      setTimeout(() => { el['invite-label'].textContent = 'Copy invite'; }, 1800);
    });
    el['dead-spectate'].addEventListener('click', () => { el['ov-dead'].hidden = true; if (G.dead) G.dead.spectating = true; });
    el['dead-leave'].addEventListener('click', () => api.onLeave && api.onLeave());
    el['over-again'].addEventListener('click', () => { el['ov-over'].hidden = true; });
    el['over-menu'].addEventListener('click', () => api.onLeave && api.onLeave());

    const H = G.hooks;
    H.mute = toggleMute;
    H.escape = () => { if (confirmOpen) { confirmOpen = false; el['ov-conn'].hidden = true; } else { confirmOpen = true; showConn('Leave match?', 'You will give up your spot in this round.', true); } };
    H.kill = (k) => {
      addKill(k);
      if (k.kid === G.id && k.vid !== G.id) { const n = Math.max(1, k.streak || 1); slam(STREAK[Math.min(5, n)], k.vn + (n > 1 ? '  ·  x' + n : ''), 'ko' + (n > 1 ? ' streak' : '')); }
    };
    H.binds = () => { syncBinds(); document.querySelectorAll('#skill-bar .skill .key').forEach((k, i) => { k.textContent = Game.keyLabel(Game.getBinds()[i]); }); };
    H.chaos = (kind) => { const c = CHAOS[kind]; if (c) slam(c[0], c[1], 'event', c[2]); };
    H.phase = (ph) => {
      clearTimeout(deadTimer); deadTimer = 0;
      el['ov-dead'].hidden = true; el['ov-over'].hidden = true;
      if (ph === 1) { el['ov-lobby'].hidden = true; toast('Go', { cls: 'accent', sub: 'You shoot on your own. Cast skills with ' + Game.getBinds().map(Game.keyLabel).join(' ') + '.' }); }
      else { showLobby(); }
    };
    H.dead = (m) => { slam('ELIMINATED', m.by ? 'by ' + m.by : '', 'dead'); deadTimer = setTimeout(() => { deadTimer = 0; if (G.phase !== 2) showDead(m); }, 1900); };
    H.over = (m) => { clearTimeout(deadTimer); deadTimer = 0; if (m.w === G.id) { Game.celebrate(); slam('VICTORY', 'Last doodle standing', 'win'); } setTimeout(() => showOver(m), m.w === G.id ? 1500 : 600); };
    H.zoneMode = (mode, stage) => {
      if (mode === 1) { toast('The Ink is rising', { cls: 'gas', sub: stage > 6 ? 'Final circle' : 'Move to the safe zone' }); Sfx.play('zone', { prio: 1 }); }
      else if (stage > 0) toast('Zone holding', { sub: 'Loot up. Next closing soon.' });
    };
    H.disconnect = () => { showConn('Connection lost', 'The server stopped responding.', false); };
    H.error = (msg) => toast(msg || 'Error');
    H.stick = drawSticks;
    H.snap = (s) => {
      if (s.q && G.phase === 1 && !G._queuedToast) { G._queuedToast = true; toast('Match in progress', { sub: 'You join the next round' }); }
    };
  }

  /* called after a successful join */
  function enter() {
    el['game'].hidden = false; hideOverlays(); el['spec-bar'].hidden = true; el['feed'].innerHTML = ''; el['toasts'].innerHTML = ''; el['slam'].innerHTML = '';
    buffEls.forEach(b => b.remove()); buffEls.clear(); G._queuedToast = false;
    buildSkillBar(G.skills);
    if (G.phase === 0) showLobby(); else el['ov-lobby'].hidden = true;
    if (G.queued) toast('Match in progress', { sub: 'You join the next round' });
    else if (G.phase === 1) toast('Dropped in', { cls: 'accent' });
  }
  function exit() { el['game'].hidden = true; clearTimeout(deadTimer); deadTimer = 0; confirmOpen = false; if (sticks) sticks.l.hidden = true; }

  function init() { initIcons(); bind(); initBindUI(); }
  return Object.assign(api, { init, enter, exit, update, toast, setMuteIcon, toggleMute });
})();
