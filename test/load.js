#!/usr/bin/env node
'use strict';
/* Load / stability simulation. Starts its own server (fast-cycling matches), then runs many headless players:
 *   - steady players  : bot-client processes spread over many rooms, playing whole matches (join, ready, move, shoot, cast)
 *   - churn clients   : connect, join, leave after 1-7 s, over and over (tests join/leave + cleanup)
 *   - hostile clients : garbage frames, oversized frames, invalid joins, message floods, abrupt socket kills
 * and samples /api/stats + process CPU/RSS every 2 s. Prints a report and exits non-zero if a threshold is broken.
 *   node test/load.js [--rooms 8] [--per 10] [--secs 120] [--churn 20] [--hostile 6] [--port 3100] */
const { spawn, execSync } = require('child_process');
const http = require('http'), path = require('path'), WebSocket = require('ws');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : +process.argv[i + 1]; };
const ROOMS = arg('rooms', 8), PER = arg('per', 10), SECS = arg('secs', 120), CHURN = arg('churn', 20), HOSTILE = arg('hostile', 6), PORT = arg('port', 3100);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const get = (p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res(b); } }); }).on('error', rej));
const root = path.join(__dirname, '..');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

(async () => {
  const server = spawn('node', ['server.js'], { cwd: root, env: Object.assign({}, process.env, { PORT, LOBBY_SECONDS: 6, OVER_SECONDS: 5, ZONE_SCALE: 0.4 }), stdio: ['ignore', 'pipe', 'pipe'] });
  let serverLog = ''; server.stdout.on('data', d => serverLog += d); server.stderr.on('data', d => serverLog += d);
  for (let i = 0; i < 50; i++) { try { await get('/healthz'); break; } catch (e) { await sleep(100); } }
  const kids = [], counters = { joined: 0, over: 0, steadyErrors: 0 };
  for (let r = 0; r < ROOMS; r++) {
    const k = spawn('node', ['test/bot-client.js', 'LOAD' + String.fromCharCode(65 + r), String(PER), String(SECS + 5), String(PORT)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    k.stdout.on('data', d => { const s = String(d); counters.joined += (s.match(/ joined /g) || []).length; counters.over += (s.match(/match over/g) || []).length; });
    k.stderr.on('data', () => counters.steadyErrors++);
    kids.push(k);
  }
  // churn: join / leave quickly, forever
  let churnJoins = 0, churnFails = 0, stop = false;
  const churn = async (n) => {
    while (!stop) {
      await new Promise((res) => {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); let done = false;
        const end = () => { if (!done) { done = true; try { ws.terminate(); } catch (e) {} res(); } };
        ws.on('open', () => { ws.send(JSON.stringify({ t: 'join', name: 'Churn' + n, skills: ['jet', 'bomb', 'burst'], cls: ['sword', 'gun', 'sniper'][n % 3], room: n % 3 ? '' : 'LOADA', img: PNG })); churnJoins++; setTimeout(end, 1000 + Math.random() * 6000); });
        ws.on('error', () => { churnFails++; end(); }); ws.on('close', end);
      });
      await sleep(Math.random() * 400);
    }
  };
  for (let i = 0; i < CHURN; i++) churn(i);
  // hostile
  let hostileSent = 0;
  const hostile = async (n) => {
    while (!stop) {
      await new Promise((res) => {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); let iv;
        const end = () => { clearInterval(iv); try { ws.terminate(); } catch (e) {} res(); };
        ws.on('open', () => {
          const mode = n % 5; hostileSent++;
          if (mode === 0) { ws.send('not json at all'); ws.send('{"t":'); ws.send(JSON.stringify({ t: 'join', name: 'x'.repeat(5000), skills: 'nope' })); }
          if (mode === 1) { ws.send(JSON.stringify({ t: 'join', name: 'Big', skills: ['jet', 'bomb', 'burst'], img: 'data:image/png;base64,' + 'A'.repeat(300000) })); }
          if (mode === 2) { ws.send(JSON.stringify({ t: 'join', name: '<script>alert(1)</script>', skills: ['jet', 'jet', 'jet'] })); ws.send(JSON.stringify({ t: 'in', c: [[1, 'NaN', null, {}, 1, 99, 0, 0]] })); }
          if (mode === 3) { ws.send(JSON.stringify({ t: 'join', name: 'Flood', skills: ['jet', 'bomb', 'burst'], room: 'LOADB', img: PNG })); iv = setInterval(() => { for (let i = 0; i < 60; i++) ws.send(JSON.stringify({ t: 'in', c: Array.from({ length: 20 }, (_, j) => [j, 1, 1, 0, 1, j % 4 - 1, 0, 0]) })); }, 20); }
          if (mode === 4) { ws.send(JSON.stringify({ t: 'join', name: 'Ghost', skills: ['jet', 'bomb', 'burst'], cls: 'hax', room: 'LOADC', img: PNG })); ws.send(JSON.stringify({ t: 'spec', d: 1e9 })); ws.send(JSON.stringify({ t: 'ready' })); ws.send(JSON.stringify({ t: 'unknown' })); }
          setTimeout(end, 800 + Math.random() * 2500);
        });
        ws.on('error', end); ws.on('close', end);
      });
      await sleep(100 + Math.random() * 300);
    }
  };
  for (let i = 0; i < HOSTILE; i++) hostile(i);

  // sample
  const samples = [], t0 = Date.now(); let maxOnline = 0;
  const cpu = () => { try { return execSync(`ps -o %cpu=,rss= -p ${server.pid}`).toString().trim().split(/\s+/).map(Number); } catch (e) { return [0, 0]; } };
  console.log(`load: ${ROOMS} rooms x ${PER} steady players + ${CHURN} churn + ${HOSTILE} hostile clients for ${SECS}s on :${PORT}`);
  while ((Date.now() - t0) / 1000 < SECS) {
    await sleep(2000);
    try { const s = await get('/api/stats'), [c, rss] = cpu(); s.cpu = c; s.rssKB = rss; samples.push(s); maxOnline = Math.max(maxOnline, s.online);
      if (samples.length % 5 === 0) console.log(`  t=${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s online=${String(s.online).padStart(3)} rooms=${s.rooms} fighters=${s.fighters} enemies=${s.enemies} tick p99=${s.tickMs.p99}ms max=${s.tickMs.max}ms lag p99=${s.loopLagMs.p99}ms cpu=${c}% rss=${s.memMB.rss}MB out=${s.outKBps}KB/s`);
    } catch (e) { samples.push(null); console.log('  stats request failed', e.message); }
  }
  stop = true; await sleep(1200);
  const last = samples.filter(Boolean).slice(-1)[0] || {}, ok = samples.filter(Boolean);
  const early = ok.slice(2, 8), late = ok.slice(-6), avg = (a, f) => a.reduce((x, s) => x + f(s), 0) / (a.length || 1);
  const peakCpu = Math.max(...ok.map(s => s.cpu)), avgCpu = avg(ok, s => s.cpu);
  const growth = ok.length > 10 ? avg(late, s => s.memMB.rss) - avg(early, s => s.memMB.rss) : 0;
  const healthy = await get('/healthz').then(() => true, () => false);
  const rep = {
    peakOnline: last.peakOnline, rooms: last.rooms, tickMs: last.tickMs, slowTicks: last.slowTicks, loopLagMs: last.loopLagMs, roomErrors: last.roomErrors,
    cpuAvg: +avgCpu.toFixed(1), cpuPeak: peakCpu, rssMB: last.memMB && last.memMB.rss, rssGrowthMB: +growth.toFixed(1), outKBps: last.outKBps, msgsPerSec: last.msgsPerSec,
    steadyJoined: counters.joined, matchesFinished: Math.round(counters.over / Math.max(1, PER)), churnJoins, churnFails, hostileSessions: hostileSent, serverAlive: healthy,
    serverErrors: (serverLog.match(/error|Error|TypeError|crash/g) || []).length,
  };
  console.log('\nreport', JSON.stringify(rep, null, 2));
  const checks = [
    ['server still answering', healthy], ['reached the target concurrency', (last.peakOnline || 0) >= ROOMS * Math.min(PER, 12) * 0.8, `peak ${last.peakOnline}`],
    ['no room crashed', rep.roomErrors === 0], ['no uncaught server errors in log', rep.serverErrors === 0],
    ['tick p99 under half the 25 ms budget', last.tickMs && last.tickMs.p99 < 12.5, last.tickMs && last.tickMs.p99 + ' ms'],
    ['no tick overran its budget', rep.slowTicks === 0, rep.slowTicks + ' slow'],
    ['event-loop lag p99 < 60 ms', last.loopLagMs && last.loopLagMs.p99 < 60, last.loopLagMs && last.loopLagMs.p99 + ' ms'],
    ['memory growth < 60 MB over the run', growth < 60, growth.toFixed(1) + ' MB'],
    ['matches completed repeatedly', counters.over > 0, counters.over + ' over msgs'],
  ];
  let bad = 0; for (const [n, v, d] of checks) { console.log(`${v ? 'PASS' : 'FAIL'}  ${n}${d ? '  (' + d + ')' : ''}`); if (!v) bad++; }
  for (const k of kids) { try { k.kill('SIGKILL'); } catch (e) {} }
  server.kill('SIGTERM'); await sleep(300);
  if (bad) console.log('\nserver log tail:\n' + serverLog.split('\n').slice(-15).join('\n'));
  console.log(bad ? `\n${bad} load checks FAILED` : '\nall load checks passed'); process.exit(bad ? 1 : 0);
})().catch(e => { console.error('load crashed', e); process.exit(2); });
