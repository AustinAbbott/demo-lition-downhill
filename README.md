# Demo-lition Downhill ⛷️

A multiplayer ski game that picks who demos first each week.

Everyone joins a room from their own browser and skis down the same mountain. After a short head start, **the Scope Creep** shows up. It's a lumpy snow monster covered in sticky notes, and it always hunts whoever is furthest back. **The order it eats people is the demo order.** The last skier standing demos last.

The gameplay is an homage to the classic Windows ski game. All the art, the monster and the code are original.

## How a round works

1. One person clicks **Create a room** and shares the link (`…/?room=KXBT`).
2. Everyone joins. The lobby is a warm-up run, so people can ski around while waiting. Press <kbd>R</kbd> to go back to the top.
3. The host can **add bots**. Type the name of someone who's out, and a bot skis in their place and gets a fair slot.
4. The host clicks **Start the round**. After a 3-2-1 countdown, everyone is off.
5. The Scope Creep arrives 14 seconds in. It starts out sluggish, so it only catches people who keep crashing. It gets faster every second it's loose and with every skier it eats, and it grows as it eats. Every third meal, the game announces that it just got faster. Expect about 2 minutes with 12 people: a slow first catch, then a frantic last 30 seconds.
6. When the round ends, the results window shows the full order. **Copy demo order** puts it on your clipboard, ready to paste into Slack.

Anyone who joins mid-round "missed the lift" and **demos first**.

### Controls

| Key | Does |
|---|---|
| <kbd>←</kbd> / <kbd>→</kbd> (or A/D) | Turn. Hold to keep turning. Turning all the way sideways stops you. |
| <kbd>↓</kbd> (or S) | Point straight downhill. This is the fastest heading. |
| <kbd>Space</kbd> (or ↑/W) | Hop over rocks, stumps, moguls and other skiers. A hop won't clear a tree. |
| <kbd>R</kbd> | Lobby only: go back to the top. |
| <kbd>M</kbd> | Music on/off. It's remembered per browser, and there's also a **Music** button in the corner. Sound effects have their own **SFX** button. |

Phones get on-screen buttons.

The soundtrack is three original chiptune loops synthesized in the browser, so there are no audio files. The music builds as the round goes:

- **Lobby:** an easygoing loop.
- **Race:** a faster, driving track that kicks in at the countdown.
- **Chase:** a minor-key loop that starts the moment the Scope Creep shows up. It gets a little faster with every skier eaten.

What's on the mountain:
- Trees, rocks and stumps knock you down for about a second.
- Moguls halve your speed.
- Ramps launch you over everything.
- Running into another skier knocks *you* down.

## Run it locally

You need Node 18+. There are no dependencies to install.

```bash
npm run dev          # → http://localhost:8787
```

Open it in two or three browser windows to play against yourself, or click **Practice solo vs. bots**. Practice mode runs the whole room in the page, with no server.

```bash
npm test             # headless: simulates full 12-skier rounds and checks the order
npm run test:e2e     # 4 real browsers play a round (needs Playwright + the dev server running)
```

`npx wrangler dev` also works and is closer to production. It runs the actual Worker and Durable Object.

## Deploy to Cloudflare (ski.austinabbott.dev)

The whole thing is one Worker:

- **Static assets.** The game itself is served straight from `public/`.
- **A Durable Object per room.** Each room code maps to one instance. It holds the room in memory and runs the 20 Hz game loop over WebSockets.

This all fits within the **Workers Free plan**, which supports SQLite-backed Durable Objects.

### Option A: from your terminal

```bash
npx wrangler login
npx wrangler deploy
```

`wrangler.toml` contains a custom domain route for `ski.austinabbott.dev`. Your domain's DNS is already on Cloudflare, so the deploy creates the DNS record and certificate for you. To use a different hostname, edit `routes` in `wrangler.toml`.

### Option B: deploy on every push to GitHub

1. In the Cloudflare dashboard, go to **Workers & Pages → Create → Import a repository** and pick this repo.
2. Leave the build command empty. Set the deploy command to `npx wrangler deploy`.
3. Every push to `main` now deploys.

## Tuning

All the knobs are at the top of `public/js/sim.js`:

- `MONSTER.grace`: seconds before the monster appears.
- `MONSTER.base`: how fast it starts. A skier pointed straight down does 380.
- `MONSTER.ramp`: how much faster it gets every second.
- `MONSTER.perMeal`: how much faster it gets with every skier it eats.
- `MONSTER.cap`: its top speed.
- `MONSTER.catchup*`: how hard it sprints when it's far behind, which also grows with each meal.
- `MONSTER.eatTime` / `MONSTER.eatTimeMin` / `MONSTER.eatTimeStep`: how long it chews before hunting the next person. Chewing gets quicker with each meal.
- `MAX_SPEED`, `RAMP_SPEED`: how fast skiers go.
- `Terrain.chunk()`: how many obstacles there are, and how quickly the mountain gets denser.

To flip the late-joiner rule so late people demo last instead, change the order of the `this.final = [...]` line in `RoomLogic.finish()` (`public/js/room.js`).

## How it's built

```
public/
  index.html, css/style.css   UI (early-90s desktop chrome)
  js/sim.js                   shared rules: terrain generator, skier physics, bot AI, monster tuning
  js/room.js                  RoomLogic: lobby, phases, bots, the monster, eat order (platform-agnostic)
  js/sprites.js               all pixel art + a 5×7 pixel font, drawn in code
  js/audio.js                 synthesized sound effects
  js/music.js                 chiptune soundtrack (three loops that escalate, sequenced live)
  js/main.js                  input, netcode, rendering, HUD
src/worker.js                 Cloudflare Worker + Durable Object wrapper around RoomLogic
dev/server.mjs                zero-dependency local server (same RoomLogic)
test/                         headless round test + Playwright end-to-end test
```

Who decides what:

- **Your own skier is simulated in your browser,** so steering feels instant. It reports its position 20 times a second.
- **The room decides the rest:** the phase, the bots, the monster and who got eaten. It also sanity-checks each position report, so nobody can teleport away or ski uphill to escape. Coworkers with devtools: we see you.
- **Terrain comes from a seed.** Every client generates the same mountain from it, so trees never cross the network.

Rooms live only in memory. When everyone leaves, the room resets.
