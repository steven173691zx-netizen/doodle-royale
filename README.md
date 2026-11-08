# Doodle Royale

Draw your fighter. Pick three skills. Outlast the chaos.
A top-down online battle royale for the browser: up to 12 fighters per arena (humans first, bots fill the rest), a rising ink zone, ink-rain meteors, swarming doodle monsters and power-ups.

## Run it

```bash
npm install
npm start            # http://localhost:3000
```

On macOS, double-click **Doodle Royale.app** on the Desktop: it starts the server if needed and opens the game.
The server prints a `network` URL too, so anyone on the same Wi-Fi can join. For the internet, deploy it or tunnel the port (`cloudflared tunnel --url http://localhost:3000`).

* **Quick play** drops you into the next open public arena. **Create** makes a private room code (`/?room=ABCD`). Up to 16 humans per room.

## Phone / touch

Pick **Controls: Phone / Touch** on the main menu (it is chosen automatically on touch devices). Drag anywhere to move, your doodle attacks on its own, tap the three skill buttons. Landscape gives the most room.

## Deploy

* **Docker:** `docker build -t doodle-royale . && docker run -p 3000:3000 doodle-royale`
* **Render (free, one click):** https://render.com/deploy?repo=https://github.com/steven173691zx-netizen/doodle-royale (uses `render.yaml`).
* Anything that runs Node 18+ works: `npm ci --omit=dev && node server.js` (reads `PORT`; WebSockets on `/ws`; health check `/healthz`; live metrics `/api/stats`).
* One process holds all rooms in memory, so run a single instance.

## How it plays

* **Fighter type** (chosen on the Draw screen): **Swordsman** (short range; every swing hits what is in front, cuts enemy shots, +20 HP), **Gunner** (mid range; rapid small bullets) or **Sniper** (long range; heavy bullets, slower fire). Gunner and Sniper bullets fly at the same speed.
* **Destructible landscape**: rocks have HP. Bullets, sword swings and explosions crack and finally shatter them, opening new lines of fire (and sometimes dropping a power-up).
* **Move** with `WASD` / arrows (touch: drag anywhere).
* **Attacking is automatic**: your doodle shoots the nearest enemy or fighter in range, Vampire-Survivors style.
* **Skills are manual**: three skills bound to `J K L` by default, in the order you pick them. Click the keys on the Play screen to rebind (saved in the browser).
* **Levels**: every kill (or 8 monster kills) is +1 level, up to 10: +12 max HP, +7% damage, a slightly bigger doodle. Everyone sees `LV n` next to your name.
* Power-ups are scarcer now (a handful per minute across the arena).
* Last doodle standing wins. 4 s of spawn protection; it ends when the timer runs out or you attack.
* **Chaos**: enemy swarms get denser every few seconds, and timed events hit the arena (Ink Rain meteors, Doodle Swarm, Power-up Party).
* **Eliminations** shatter the fighter into shards, with a slow-mo hold, kill banners and streaks (KO, Double, Triple, Mega, Unstoppable) and ink splats that stay on the page.

| Skill | What it does |
|---|---|
| Pencil Dash | Dash forward, leaving a damaging graphite trail |
| Invisible Ink | Vanish for 3 s (auto-fire pauses) and leave a poison ink cloud |
| Eraser Wave | Shockwave that damages, knocks back and erases projectiles |
| Hot Marker | Cone of fire; ignites targets |
| Ink Bomb | Lobbed bomb: area damage plus a slowing goo cloud |
| Scribble Burst | Rapid volley of shots in a tight spread |
| Bubble Wrap | Bubble that soaks 45 damage |
| Ruler Slap | Close-range smack |

Power-ups: Lightning Bolt, Red Pen, Triple Pencil, Espresso, Sticky Note, Heart Sticker, Magnet, Mega Crayon.
Enemies: Scribble (swarm), Inkblot (ranged), Smudge (charger).

## Layout

```
server.js            HTTP static + WebSocket
game/room.js         authoritative simulation (40 Hz tick, 20 Hz snapshots, auto-attack, chaos events)
game/bots.js         bot AI           game/enemies.js   monster AI
shared/shared.js     constants, skills, deterministic movement (server + client prediction)
public/js/           client: art, doodle pad, audio (synthesized), game, render, hud, ui
test/                rules.js, smoke.js, ui-shot.js, ui-scene.js (staged scenes), ui-pages.js (every screen)
public/css/          style.css (layout) + doodle-theme.css (sketchbook skin)
```

## Tests

```bash
npm test             # 84 rule checks + 33 real-WebSocket smoke checks
npm run test:ui      # headless Chrome playthrough (needs the server running)
npm run test:load    # ~100 simulated players + churn + hostile clients; reports tick time, lag, memory, CPU
node test/ui-scene.js --out /tmp/scenes   # staged scene screenshots
```

Env: `PORT`, `ZONE_SCALE`, `LOBBY_SECONDS`, `OVER_SECONDS`.
