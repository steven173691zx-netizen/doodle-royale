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

  const shotN = async (n) => { await sleep(450); await shot(n); };
  await shotN('P1-landing');
  await ev(`document.getElementById('btn-start').click()`); await sleep(300);
  await ev(`document.getElementById('t-rand').click()`); await shotN('P2-draw');
  await ev(`document.getElementById('to-skills').click()`); await sleep(300);
  await ev(`(() => { const w = ['jet','flame','bubble']; const on = [...document.querySelectorAll('.skill-card.is-on')].map(e => e.dataset.id); for (const s of on) if (!w.includes(s)) document.querySelector('.skill-card[data-id="'+s+'"]').click(); for (const s of w) if (!on.includes(s)) document.querySelector('.skill-card[data-id="'+s+'"]').click(); })()`);
  await shotN('P3-skills');
  await ev(`document.getElementById('to-play').click()`); await shotN('P4-play');
  await ev(`(() => { const i = document.getElementById('in-name'); i.value = 'Nave'; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('btn-new-room').click(); })()`);
  await shotN('P4b-create-panel');
  // host sets 3 players + 5 CPU, creates the room
  await ev(`(() => { const click = (s, n) => { for (let i = 0; i < n; i++) document.querySelector(s).click(); }; click('#create-panel .stepper[data-k="players"] button[data-d="-1"]', 5); click('#create-panel .stepper[data-k="bots"] button[data-d="1"]', 1); })()`);
  const sum = await ev(`document.getElementById('cr-sum').textContent`); console.log('create summary:', sum);
  await ev(`document.getElementById('btn-create-go').click()`);
  for (let i = 0; i < 40 && !(await ev('window.__dr && __dr.G.running')); i++) await sleep(200);
  await shotN('P5-lobby');
  const lob = JSON.parse(await ev(`JSON.stringify({ code: __dr.G.code, room: __dr.G.room, start: !document.getElementById('btn-start-match').hidden, ready: !document.getElementById('btn-ready').hidden, cfg: !document.getElementById('host-cfg').hidden, who: document.getElementById('room-who').textContent })`));
  console.log('lobby', JSON.stringify(lob));
  if (!/^[A-Z]{4}$/.test(lob.code) || !lob.start || lob.ready || !lob.cfg || lob.room.max !== 3 || lob.room.bots !== 5) { console.error('HOST LOBBY WRONG'); errors.push('host lobby wrong'); }
  await sleep(4000);                                   // a custom room must NOT start by itself
  if ((await ev('__dr.G.phase')) !== 0) { console.error('ROOM AUTO-STARTED'); errors.push('room auto-started'); }
  await ev(`document.getElementById('btn-start-match').click()`);
  let t0 = Date.now(); while (Date.now() - t0 < 15000 && (await ev('__dr.G.phase')) !== 1) await sleep(100);
  console.log('after host start: phase', await ev('__dr.G.phase'), 'fighters', await ev('__dr.G.roster.size'));
  if ((await ev('__dr.G.phase')) !== 1) { console.error('HOST START FAILED'); errors.push('host start failed'); }
  await sleep(3000); await shot('P6-hud');
  if (MOBILE) {                                    // real touch: drag the stick, then tap a skill button
    const x0 = await ev('__dr.G.me.x'), y0 = await ev('__dr.G.me.y');
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 90, y: 560, id: 1 }] });
    for (let k = 1; k <= 12; k++) { await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 90 + k * 6, y: 560 - k * 4, id: 1 }] }); await sleep(60); }
    await sleep(500); await shot('P6b-touch-stick');
    const lv = JSON.parse(await ev('JSON.stringify(__dr.G.input.touch.lv)')), moved = Math.hypot((await ev('__dr.G.me.x')) - x0, (await ev('__dr.G.me.y')) - y0);
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const r = JSON.parse(await ev(`(() => { const b = document.querySelector('#skill-bar .skill'), q = b.getBoundingClientRect(); return JSON.stringify([q.x + q.width / 2, q.y + q.height / 2]); })()`));
    const cd0 = await ev('__dr.G.cd[0]');
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r[0], y: r[1], id: 2 }] }); await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(400);
    const cd1 = await ev('__dr.G.cd[0]');
    console.log(`touch stick vec=${lv.map(v => v.toFixed(2))} moved=${moved.toFixed(0)}px; skill cd ${cd0.toFixed ? cd0.toFixed(1) : cd0} -> ${cd1.toFixed ? cd1.toFixed(1) : cd1}`);
    if (moved < 30 || Math.hypot(lv[0], lv[1]) < 0.3) { console.error('TOUCH MOVE FAILED'); errors.push('touch move failed'); }
    if (!(cd1 > cd0 + 1)) { console.error('TOUCH SKILL FAILED'); errors.push('touch skill failed'); }
  }
  await sleep(300); await shot('P6-hud');
  await ev(`(() => { const G = __dr.G; G.hooks.dead({ place: 3, kills: 2, pve: 11, dmg: 420, by: 'Inky', cause: 'pencil', time: 84 }); })()`); await sleep(500); await shot('P7-dead');
  await ev(`(() => { const G = __dr.G; G.hooks.over({ w: G.id, board: [{ id: G.id, n: 'Nave', k: 5, pv: 20, p: 1, b: 0, d: 800 }, { id: 99, n: 'Inky', k: 3, pv: 4, p: 2, b: 1, d: 500 }], time: 120 }); })()`); await sleep(2200); await shot('P8-over');
  console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'no page errors');
  ws.close(); cleanup(); process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error('ui-pages crashed:', e); process.exit(2); });
