'use strict';
/* Headless-Chrome UI check: runs the real client end to end against a running server and saves screenshots.
 *   node server.js &            (default config)
 *   node test/ui-shot.js [--w 1440] [--h 900] [--mobile] [--out DIR] [--url http://localhost:3000] [--secs 40]
 * Exits non-zero if the page throws, the match never starts, or the HUD/canvas misbehave. */
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const WebSocket = require('ws');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const IDLE = !!arg('idle', false), W = +arg('w', 1440), H = +arg('h', 900), MOBILE = !!arg('mobile', false), URL = arg('url', 'http://localhost:3000'), SECS = +arg('secs', 40);
const OUT = path.resolve(arg('out', path.join(os.tmpdir(), 'fbr-shots'))), PORT = 9333 + ((Math.random() * 500) | 0);
const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(p => fs.existsSync(p));
if (!CHROME) { console.error('No Chrome/Chromium found'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJSON = (u) => new Promise((res, rej) => http.get(u, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } }); }).on('error', rej));

const AUTOPILOT = (idle) => `(() => { clearInterval(window.__ap); const IDLE = ${idle ? 'true' : 'false'}; window.__ap = setInterval(() => {
  const F = window.__dr, G = F.G; if (!G.running) return; const v = F.Render.viewInfo();
  const K = G.input.keys; K.up = K.down = K.left = K.right = false;
  if (!G.alive) return;
  const L = G.last && G.last.raw; if (!L) return; const me = G.me; let best = null, bd = 1e12;
  for (const e of L.e) { const d = Math.hypot(e[2]-me.x, e[3]-me.y); if (d < bd) { bd = d; best = {x:e[2], y:e[3]}; } }
  for (const p of L.p) { const d = Math.hypot(p[1]-me.x, p[2]-me.y); if (d < bd) { bd = d; best = {x:p[1], y:p[2]}; } }
  let pk = null, pd = 1e12; for (const k of L.k2) { const d = Math.hypot(k[2]-me.x, k[3]-me.y); if (d < pd) { pd = d; pk = {x:k[2], y:k[3]}; } }
  const z = L.z || [0,0,1900,0,0,1900]; const dc = Math.hypot(z[3]-me.x, z[4]-me.y); let mvx = 0, mvy = 0;
  if (pk && pd < 450 && (G.matchT < 15 || !best || bd > 300)) { mvx = (pk.x-me.x)/pd; mvy = (pk.y-me.y)/pd; }   // grab the nearby power-up first, like a human would
  else if (G.phase === 1 && (dc > z[5]*0.6)) { mvx = (z[3]-me.x)/dc; mvy = (z[4]-me.y)/dc; }
  else if (pk && pd < 900 && (!best || bd > 300)) { mvx = (pk.x-me.x)/pd; mvy = (pk.y-me.y)/pd; }
  else if (best) { const dx = best.x-me.x, dy = best.y-me.y, rad = bd > 280 ? 1 : bd < 170 ? -1 : 0; mvx = dx/bd*rad - dy/bd*0.7; mvy = dy/bd*rad + dx/bd*0.7; }
  if (!IDLE) { K.right = mvx > 0.3; K.left = mvx < -0.3; K.down = mvy > 0.3; K.up = mvy < -0.3; }
  if (!IDLE && best && bd < 430 && Math.random() < 0.08) G.input.castQ.push(Math.floor(Math.random()*3));   // attacks are automatic; skills are manual
}, 60); })()`;

const FUNNEL = `(async (room, name, skills) => {
  const $ = s => document.querySelector(s), sleep = ms => new Promise(r => setTimeout(r, ms));
  const click = s => { const e = $(s); if (!e || e.disabled) throw new Error('cannot click ' + s); e.click(); };
  click('#btn-start'); await sleep(400); click('#t-rand'); await sleep(200); click('#to-skills'); await sleep(400);
  const on = [...document.querySelectorAll('.skill-card.is-on')].map(e => e.dataset.id);
  for (const s of on) if (!skills.includes(s)) click('.skill-card[data-id="' + s + '"]');
  for (const s of skills) if (!on.includes(s)) click('.skill-card[data-id="' + s + '"]');
  click('#to-play'); await sleep(400);
  const i = $('#in-name'); i.value = name; i.dispatchEvent(new Event('input', { bubbles: true }));
  if (room) { $('#in-room').value = room; click('#btn-join-room'); } else click('#btn-quickplay');
  for (let t = 0; t < 40 && !(window.__dr && __dr.G.running); t++) await sleep(200);
  return !!(window.__dr && __dr.G.running);
})`;

(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fbr-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill('SIGKILL'); } catch (e) {} try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {} };
  process.on('exit', cleanup);
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) { try { targets = await getJSON(`http://127.0.0.1:${PORT}/json`); } catch (e) { await sleep(250); } }
  if (!targets) { console.error('Chrome did not start'); process.exit(2); }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 1 << 28 });
  await new Promise(r => ws.on('open', r));
  let id = 0; const pend = new Map(), errors = [], logs = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') errors.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') logs.push(m.params.args.map(a => a.value || a.description).join(' '));
  });
  const cdp = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr, aw) => { const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!aw }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text); return r.result.value; };
  const shot = async (name) => { const r = await cdp('Page.captureScreenshot', { format: 'png' }); const f = path.join(OUT, name + '.png'); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); console.log('shot', f); return f; };

  await cdp('Page.enable'); await cdp('Runtime.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: MOBILE ? 2 : 1, mobile: MOBILE });
  if (MOBILE) await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp('Page.navigate', { url: URL }); await sleep(1800);
  const results = []; const check = (n, ok, info) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info !== undefined ? '  (' + info + ')' : ''}`); };

  await shot('01-landing');
  const joined = await ev(`(${FUNNEL})(${JSON.stringify('')}, 'Nave', ['jet', 'flame', 'bubble'])`, true);
  check('menu funnel (draw -> skills -> play -> join) reaches the arena', joined === true);
  if (!joined) { await shot('99-fail'); cleanup(); process.exit(1); }
  await shot('02-warmup');
  await ev(`document.getElementById('btn-ready').click()`);
  let t0 = Date.now(); while (Date.now() - t0 < 25000 && (await ev('__dr.G.phase')) !== 1) await sleep(100);
  check('match goes live after Ready', (await ev('__dr.G.phase')) === 1);
  await sleep(900);
  const prot = await ev(`(__dr.G.flags & 2048) > 0`);
  check('spawn-protection flag reaches the client', prot === true);
  await shot('03-opening');
  await ev(`(() => { const H = __dr.G.hooks, o = H.pickup; window.__pk = 0; H.pickup = function () { window.__pk++; return o && o.apply(this, arguments); }; })()`);
  await ev(AUTOPILOT(IDLE));

  let gotHz = false, gotBuff = false, gotFight = false, gotKo = false, last = null, prevK = 0, died = false; t0 = Date.now();
  while (Date.now() - t0 < SECS * 1000) {
    await sleep(IDLE ? 150 : 300);
    last = JSON.parse(await ev(`JSON.stringify({alive: __dr.G.alive, ph: __dr.G.phase, bf: __dr.G.bf.length, pk: window.__pk, hp: __dr.G.hp, en: __dr.G.last ? __dr.G.last.raw.e.length : 0, pl: __dr.G.last ? __dr.G.last.raw.p.length : 0, fx: __dr.G.fx.length, k: __dr.G.kills, pv: __dr.G.pve, mt: __dr.G.matchT, hz: __dr.G.last && __dr.G.last.raw.hz ? __dr.G.last.raw.hz.length : 0})`));
    if ((last.bf || last.pk) && !gotBuff && last.alive) { gotBuff = true; await sleep(250); await shot('04-pickup'); }
    if ((last.en >= 2 || last.pl >= 2) && last.fx >= 3 && last.mt >= 6 && !gotFight && last.alive) { gotFight = true; await shot('05-fight'); }
    if (last.k > prevK && last.alive && !gotKo) { gotKo = true; await sleep(140); await shot('07-ko'); }
    prevK = last.k;
    if (last.hz && !gotHz && last.alive) { gotHz = true; await shot('08-meteors'); }
    if (!last.alive && last.ph === 1) {      // eliminated: capture the death animation frame by frame
      died = true;
      for (const [i, ms] of [[1, 60], [2, 260], [3, 420], [4, 520], [5, 600]]) { await sleep(ms); await shot('10-death-' + i); }
      break;
    }
    if (last.ph !== 1) break;
  }
  await sleep(IDLE ? 400 : 1400);
  const end = JSON.parse(await ev(`JSON.stringify({alive: __dr.G.alive, ph: __dr.G.phase, dead: !document.getElementById('ov-dead').hidden, over: !document.getElementById('ov-over').hidden, k: __dr.G.kills, pv: __dr.G.pve})`));
  await shot('06-end');
  const frame = await ev(`(() => { const c = document.getElementById('cv'); const x = c.getContext('2d'); const d = x.getImageData(0, 0, c.width, c.height).data; let nonbg = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] > 40 || d[i + 1] > 40 || d[i + 2] > 40) nonbg++; return nonbg; })()`);
  check('game canvas is drawing', frame > 50, `non-background samples=${frame}`);
  check('power-up pickup flow observed (hook fired, effect applied)', gotBuff, gotBuff ? `pickups=${last.pk}` : 'not within ' + SECS + 's');
  check('combat observed (enemies or players in view with effects)', gotFight);
  check('no uncaught page errors', errors.length === 0 && !((await ev('window.__errs || []')).length), errors.concat(logs).slice(0, 3).join(' | '));
  console.log('final state:', JSON.stringify(Object.assign({}, last, end)));
  ws.close(); cleanup();
  const failed = results.filter(r => !r).length;
  console.log(failed ? `\n${failed}/${results.length} FAILED` : `\nall ${results.length} UI checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('ui-shot crashed:', e); process.exit(2); });
