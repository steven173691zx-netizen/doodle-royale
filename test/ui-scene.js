#!/usr/bin/env node
'use strict';
/* Deterministic visual QA: joins a real match in headless Chrome, freezes the render loop, then stages scenes
 * (art sheet, kill, elimination, meteors, victory) by injecting snapshots/events and stepping the client frame by frame,
 * saving a screenshot for every beat. Needs a running server (npm start) and Google Chrome.
 *   node test/ui-scene.js [--w 1440] [--h 900] [--mobile] [--out DIR] [--only death,ko] */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const WebSocket = require('ws');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const W = +arg('w', 1440), H = +arg('h', 900), MOBILE = !!arg('mobile', false), URL = arg('url', 'http://localhost:3000');
const ONLY = (arg('only', '') || '').split(',').filter(Boolean);
const OUT = path.resolve(arg('out', path.join(os.tmpdir(), 'dr-scenes'))), PORT = 9400 + ((Math.random() * 400) | 0);
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
if (!CHROME) { console.error('No Chrome found'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = (u) => new Promise((res, rej) => http.get(u, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej));

(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dr-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, '--no-first-run', '--hide-scrollbars', '--mute-audio', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (e) {} try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {} };
  process.on('exit', cleanup);
  let targets = null; for (let i = 0; i < 60 && !targets; i++) { try { targets = await getJSON(`http://127.0.0.1:${PORT}/json`); } catch (e) { await sleep(250); } }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 1 << 28 });
  await new Promise(r => ws.on('open', r));
  let id = 0; const pend = new Map(), errors = [];
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return; } if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text); });
  const cdp = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, aw) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!aw }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text); return r.result.value; };
  const shot = async (name) => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); const f = path.join(OUT, name + '.png'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('shot', f); };

  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: MOBILE ? 2 : 1, mobile: MOBILE });
  if (MOBILE) await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Page.navigate', { url: URL }); await sleep(1600);

  // draw screen: pick the Swordsman and capture the picker
  await ev(`(async () => { const sl = ms => new Promise(r => setTimeout(r, ms)); document.getElementById('btn-start').click(); await sl(300); document.getElementById('t-rand').click(); await sl(200); document.querySelector('.seg-btn[data-id="sniper"]').click(); await sl(100); document.querySelector('.seg-btn[data-id="sword"]').click(); await sl(300); })()`, true);
  await shot('F-draw-class');
  const clsSel = await ev(`document.querySelector('.seg-btn.is-on').dataset.id`); if (clsSel !== 'sword') { console.error('class pick failed', clsSel); }
  // join a real room via the menu funnel
  const joined = await ev(`(async () => {
    const $ = s => document.querySelector(s), sl = ms => new Promise(r => setTimeout(r, ms)), click = s => { const e = $(s); if (!e || e.disabled) throw new Error('cannot click ' + s); e.click(); };
    click('#to-skills'); await sl(300);
    const want = ['jet', 'flame', 'bubble'], on = [...document.querySelectorAll('.skill-card.is-on')].map(e => e.dataset.id);
    for (const s of on) if (!want.includes(s)) click('.skill-card[data-id="' + s + '"]'); for (const s of want) if (!on.includes(s)) click('.skill-card[data-id="' + s + '"]');
    click('#to-play'); await sl(300);
    // rebind UI: defaults are J K L; click the first key, press U, then put J back
    const def = [...document.querySelectorAll('.kbind')].map(e => e.textContent).join('');
    document.querySelector('.kbind[data-i="0"]').click(); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyU', key: 'u', bubbles: true }));
    const after = [...document.querySelectorAll('.kbind')].map(e => e.textContent).join('');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
    window.__bindTest = { def, after, saved: localStorage.getItem('dr.keys') };
    document.getElementById('bind-reset').click();
    const i = $('#in-name'); i.value = 'Nave'; i.dispatchEvent(new Event('input', { bubbles: true }));
    click('#btn-quickplay');
    for (let t = 0; t < 40 && !(window.__dr && __dr.G.running); t++) await sl(200);
    return !!(window.__dr && __dr.G.running);
  })()`, true);
  if (!joined) { console.error('could not join'); cleanup(); process.exit(1); }
  const bt = await ev('JSON.stringify(window.__bindTest)'); console.log('bind test', bt);
  const bo = JSON.parse(bt); if (bo.def !== 'JKL' || bo.after !== 'UKL') { console.error('REBIND FAILED'); errors.push('rebind failed'); }
  await ev(`document.getElementById('btn-ready').click()`);
  let t0 = Date.now(); while (Date.now() - t0 < 25000 && (await ev('__dr.G.phase')) !== 1) await sleep(100);
  await sleep(1200);

  // freeze the live loop; from here we drive Game.update + Render.draw by hand
  await ev(`(() => { window.__raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; const D = __dr; D.V = D.Render.viewInfo(); D.T = performance.now() + 5000;
    D.step = (secs) => { const n = Math.max(1, Math.round(secs * 60)); for (let i = 0; i < n; i++) { D.T += 1000 / 60; D.Game.update(1 / 60, D.T, D.V.W, D.V.H, D.V.scale); } D.Render.draw(D.T); };
    D.hud = () => { D.HUD.update(D.T); }; })()`);
  await sleep(300);
  const me = JSON.parse(await ev(`JSON.stringify({ x: __dr.G.me.x, y: __dr.G.me.y, id: __dr.G.id, others: [...__dr.G.roster.values()].filter(r => r.id !== __dr.G.id).map(r => r.id) })`));
  const want = (n) => !ONLY.length || ONLY.includes(n);
  const clearFx = () => ev(`(() => { const G = __dr.G; G.fx.length = 0; G.texts.length = 0; G.decals.length = 0; G.projD.clear(); G.deathHold = null; G.slow = 0; G.cam.zoom = 0; G.cam.white = 0; G.cam.shake = 0; G.cam.flash = 0; document.getElementById('slam').innerHTML = ''; })()`);
  /* stage fake entities in the newest snapshot so collect() renders them */
  const stage = (spec) => ev(`(() => { const G = __dr.G, L = G.last, me = G.me; const e = L.raw.e = [], p = L.raw.p = [], k = L.raw.k2 = [], b = L.raw.b = [], c = L.raw.c = [];
    L.e.clear(); L.p.clear(); const S = ${JSON.stringify(spec)};
    for (const t of S.enemies || []) { const row = [900 + t.i, t.t, me.x + t.dx, me.y + t.dy, t.hp == null ? 100 : t.hp, t.fl || 0, Math.round((t.ang || 0) * 100)]; L.e.set(row[0], row); e.push(row); }
    for (const t of S.players || []) { const row = [t.id, me.x + t.dx, me.y + t.dy, Math.round((t.aim || 0) * 100), t.hp, 100, t.fl || 0, t.sh || 0, t.lv || 1]; L.p.set(t.id, row); p.push(row); }
    for (const t of S.pickups || []) k.push([800 + t.i, t.t, me.x + t.dx, me.y + t.dy]);
    for (const t of S.projs || []) b.push([700 + t.i, me.x + t.dx, me.y + t.dy, t.vx, t.vy, t.r || 8, t.kind || 1, t.o || __dr.G.id]);
    for (const t of S.clouds || []) c.push([600 + t.i, t.kind, me.x + t.dx, me.y + t.dy, t.r, 100]);
    L.raw.hz = (S.hz || []).map((h, i) => [500 + i, me.x + h.dx, me.y + h.dy, 105, h.t, 1.05]); L.at = __dr.T; })()`);

  if (want('sheet')) {
    await clearFx();
    await stage({
      enemies: [{ i: 1, t: 0, dx: -300, dy: -150 }, { i: 2, t: 0, dx: -250, dy: -120 }, { i: 3, t: 0, dx: -340, dy: -100, hp: 45 }, { i: 4, t: 1, dx: 260, dy: -140 }, { i: 5, t: 1, dx: 330, dy: -60, fl: 16 }, { i: 6, t: 2, dx: 0, dy: -230, hp: 70 }, { i: 7, t: 2, dx: -120, dy: 200, fl: 4, ang: 0.4 }],
      players: [{ id: me.others[0], dx: 290, dy: 130, aim: 3.1, hp: 80, lv: 6 }, { id: me.others[1], dx: -270, dy: 150, aim: 0, hp: 40, fl: 32, lv: 3 }],
      pickups: [0, 1, 2, 3, 4, 5, 6, 7].map((t, i) => ({ i, t, dx: -280 + i * 80, dy: 300 })),
      projs: [{ i: 1, dx: 80, dy: -30, vx: 700, vy: 0 }, { i: 2, dx: 150, dy: -60, vx: 700, vy: 100, kind: 2 }, { i: 3, dx: 200, dy: 30, vx: 300, vy: 100, kind: 3, r: 10 }],
      clouds: [{ i: 1, kind: 0, dx: 130, dy: 90, r: 90 }, { i: 2, kind: 1, dx: -140, dy: 80, r: 100 }, { i: 3, kind: 2, dx: 60, dy: 150, r: 38 }],
    });
    await ev(`__dr.step(0.5)`); await ev(`__dr.step(0.05)`); await shot('A-sheet');
  }

  if (want('meteors')) {
    await clearFx();
    await stage({ enemies: [{ i: 1, t: 0, dx: 160, dy: -20 }], hz: [{ dx: 170, dy: -10, t: 0.9 }, { dx: -190, dy: 110, t: 0.45 }, { dx: 30, dy: -190, t: 0.15 }] });
    await ev(`(() => { const G = __dr.G; G.hz = []; })()`);
    await ev(`__dr.step(0.05)`); await shot('B-meteors');
    await ev(`__dr.Game.onEvent(['x', 'meteor', __dr.G.me.x + 30, __dr.G.me.y - 190, 105])`);
    for (const [i, s] of [[1, 0.06], [2, 0.18], [3, 0.5]]) { await ev(`__dr.step(${s})`); await shot('B-meteor-impact-' + i); }
  }

  if (want('sword')) {
    await clearFx();
    await stage({ enemies: [{ i: 1, t: 0, dx: 70, dy: -30 }, { i: 2, t: 0, dx: 95, dy: 25 }], players: [{ id: me.others[0], dx: 330, dy: 0, aim: 3.1, hp: 100 }] });
    await ev(`(() => { const D = __dr; D.G.roster.get(D.G.id).c = 'sword'; D.G.roster.get(${me.others[0]}).c = 'sniper'; D.G.input.aim = 0; })()`);
    await ev(`__dr.step(0.05)`); await shot('G-sword-0');
    await ev(`__dr.Game.onEvent(['sw', __dr.G.id, __dr.G.me.x, __dr.G.me.y, 0, 118, 2.0])`);
    for (const [i, s] of [[1, 0.06], [2, 0.08]]) { await ev(`__dr.step(${s})`); await shot('G-sword-' + i); }
  }

  if (want('rocks')) {
    await clearFx();
    await stage({});
    await ev(`(() => { const D = __dr, m = D.G.me; D.G.obs.push({ x: m.x + 170, y: m.y - 40, r: 60, g: 90, i: 9001, hp: 1, hit: 0 }, { x: m.x - 160, y: m.y + 20, r: 55, g: 91, i: 9002, hp: 0.55, hit: 0 }, { x: m.x + 20, y: m.y + 190, r: 50, g: 92, i: 9003, hp: 0.2, hit: 0 }); })()`);
    await ev(`__dr.step(0.05)`); await shot('H-rocks-0');
    await ev(`(() => { const D = __dr, m = D.G.me; D.Game.onEvent(['od', 9001, 70, m.x + 170, m.y - 40]); D.Game.onEvent(['ox', 9003, m.x + 20, m.y + 190, 50]); })()`);
    for (const [i, s] of [[1, 0.05], [2, 0.2], [3, 0.5]]) { await ev(`__dr.step(${s})`); await shot('H-rocks-' + i); }
  }

  if (want('ko')) {
    await clearFx();
    const v = me.others[0];
    await stage({ players: [{ id: v, dx: 230, dy: -40, aim: 3.1, hp: 5 }], enemies: [{ i: 1, t: 0, dx: -200, dy: 90 }] });
    await ev(`__dr.step(0.1)`);
    await ev(`(() => { const G = __dr.G; G.hooks.kill && null; __dr.Game.onEvent(['k', 'Nave', __dr.Game.nameOf(${v}), 'pencil', ${v}, __dr.G.id, __dr.G.me.x + 230, __dr.G.me.y - 40, 1]); __dr.Game.onEvent(['d', 'f', ${v}, __dr.G.me.x + 230, __dr.G.me.y - 40, 260, -80, __dr.G.id]); })()`);
    for (const [i, s] of [[1, 0.05], [2, 0.2], [3, 0.35], [4, 0.6]]) { await ev(`__dr.step(${s})`); await shot('C-ko-' + i); }
  }

  if (want('death')) {
    await clearFx();
    const killer = me.others[1];
    await stage({ players: [{ id: killer, dx: -210, dy: 60, aim: 0, hp: 90 }], enemies: [{ i: 1, t: 0, dx: 140, dy: -90 }, { i: 2, t: 1, dx: 220, dy: 70 }] });
    await ev(`__dr.step(0.1)`);
    // the server removes you from the player list and sends 'd' + 'dead'
    await ev(`(() => { const G = __dr.G, x = G.me.x, y = G.me.y; G.alive = false; G.specId = ${killer}; __dr.Game.onEvent(['k', __dr.Game.nameOf(${killer}), 'Nave', 'pencil', G.id, ${killer}, x, y, 0]); __dr.Game.onEvent(['d', 'f', G.id, x, y, -300, 60, ${killer}]); G.hooks.dead({ place: 3, kills: 2, pve: 11, dmg: 420, by: __dr.Game.nameOf(${killer}), cause: 'pencil', time: 84 }); })()`);
    for (const [i, s] of [[1, 0.03], [2, 0.12], [3, 0.2], [4, 0.3], [5, 0.5], [6, 0.7]]) { await ev(`__dr.step(${s})`); await shot('D-death-' + i); }
  }

  if (want('win')) {
    await clearFx();
    await ev(`(() => { const G = __dr.G; G.alive = true; __dr.Game.celebrate(); G.hooks.over({ w: G.id, board: [{ id: G.id, n: 'Nave', k: 5, pv: 20, p: 1, b: 0, d: 800 }], time: 120 }); })()`);
    await ev(`__dr.step(0.9)`); await shot('E-win-1'); await ev(`__dr.step(1.2)`); await shot('E-win-2');
  }

  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  ws.close(); cleanup(); process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('ui-scene crashed:', e); process.exit(2); });
