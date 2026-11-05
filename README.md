# Demo-lition Downhill ⛷️

A multiplayer ski game that picks who demos first each week.

Everyone joins a room from their own browser and skis down the same mountain. After a short head start, **the Scope Creep** shows up. It's a big, shaggy yeti covered in sticky notes (feature requests, obviously), and it always hunts whoever is furthest back. **The order it eats people is the demo order.** The last skier standing demos last.

The gameplay is an homage to the classic Windows ski game. All the art, the code and the yeti (its own design) are original.

## How a round works

1. One person clicks **Create a new room** and shares the link (`…/?room=KXBT`). Opening that link puts the start screen in "You're joining room KXBT" mode. You get one big Join button and a live check of the room ("Austin's lobby · 5 skiers warming up"), and the create buttons are hidden, so nobody accidentally starts a second game. Without a link, "Join your team's game" comes first and checks codes as you type, and pressing Enter never creates a room. Joining only works with the code of a room that already exists. A typo gets a "no room with that code" message instead of putting you in an empty room. An empty room stays joinable for 30 minutes, so the host can refresh without losing it.
2. Everyone joins. The lobby is a warm-up run, so people can ski around while waiting. Press <kbd>R</kbd> to go back to the top.

   **Big-screen view:** whoever created the room is usually the one sharing their screen on the call. Their camera zooms out to show the whole pack whenever they aren't skiing: in the lobby, after they're eaten, and on the results screen. In the lobby it also shows the join address and room code in large text. When the field gets too spread out to fit, it follows the yeti and whoever is closest to it. They still ski normally once the round starts.
3. The host can **add bots**. Type the name of someone who's out, and a bot skis in their place and gets a fair slot.
4. The host clicks **Start the round**. After a 3-2-1 countdown, everyone is off.
5. The Scope Creep arrives 14 seconds in. It's erratic: it weaves as it chases, and every few seconds it switches to a different mood. A speech bubble shows which mood it's in:
   - **Lunge (!):** a sudden burst of speed when it's close.
   - **Sniff (?):** gets distracted and wanders sideways. This happens less as it eats more.
   - **Zigzag:** big swerves from side to side.
   - **Roar (ROAAAR!):** it stops to roar, and everyone's screen shakes.
   - **Fickle (ACTUALLY…):** changes scope and goes after the second-to-last skier for a few seconds.

   Under all of that, it starts out sluggish, so it only catches people who keep crashing. It gets faster every second it's loose and with every skier it eats, and it grows as it eats. Every third meal, the game announces that it just got faster. Expect a little over 2 minutes with 12 people: a slow first catch, then a frantic last 30 seconds.
   During the round, the **Distance down the hill** panel ranks everyone by how far they've gone. Eaten skiers stay on the list, crossed out, with where they were caught. Your own distance is shown big in the corner.
6. When the round ends, the results window shows the full order with everyone's distance. **Copy demo order** puts it on your clipboard, ready to paste into Slack.

Anyone who joins mid-round "missed the lift" and **demos first**.

### Controls

| Key | Does |
|---|---|
| <kbd>←</kbd> / <kbd>→</kbd> (or A/D) | Turn. Hold to keep turning. Turning all the way sideways stops you. |
| <kbd>↓</kbd> (or S) | Point straight downhill. This is the fastest heading. |
| <kbd>Space</kbd> (or ↑/W) | Hop over rocks, stumps, moguls and other skiers. A hop won't clear a tree. |
| <kbd>R</kbd> | Lobby only: go back to the top. |
| <kbd>E</kbd> | Drop a meeting invite behind you, if you're holding one. |
| <kbd>1</kbd>–<kbd>4</kbd> | Emotes. |
| <kbd>M</kbd> | Music on/off. It's remembered per browser, and there's also a **Music** button in the corner. Sound effects have their own **SFX** button. |

Phones get on-screen buttons.

The soundtrack is three original chiptune loops synthesized in the browser, so there are no audio files. The music builds as the round goes:

- **Lobby:** an easygoing loop.
- **Race:** a faster, driving track that kicks in at the countdown.
- **Chase:** starts the moment the Scope Creep shows up. It's a frantic minor-key riff with a kick drum, a gritty doubled lead and snare rolls. It speeds up and adds layers as the monster eats more people:
  - after 3 eaten, faster hi-hats;
  - after 5, a busier kick;
  - after 7, the lead doubled an octave up.

**Pickups** float on the slope. They're the same for everyone, and the first person to ski through one gets it:
- ☕ **Coffee:** a 3-second speed burst, about 35% faster.
- 🏝️ **PTO:** the next time the Scope Creep catches you, you're out of office. It's baffled for a moment and you slip away. It works once.
- 📅 **Meeting invite:** hold up to two, then press <kbd>E</kbd> to drop one behind you. Whoever skis into it is stuck "in a meeting" for 1.6 seconds, and it says whose invite it was. A hop clears it, and you can't trip on your own.

**Emotes:** <kbd>1</kbd> SORRY!, <kbd>2</kbd> GG, <kbd>3</kbd> HI!, <kbd>4</kbd> YIKES! show in a speech bubble over your head. On phones, the 💬 button cycles through them.

**Cosmetics:** on the start screen, next to your jacket colour, pick a hat (cowboy, top hat, crown, party hat, viking, propeller cap, chef or the classic beanie) and a scarf. The skier in the logo shows your look as you choose. Your choice is remembered, and bots dress themselves. Hats fly off when you crash.

Bots grab pickups, drop invites on people right behind them, and say GG when they're eaten.

What's on the mountain (it gets more crowded the further down you go):
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
npm test             # headless: full 12-skier rounds, then a 24-skier stress + reconnect/fuzz run
npm run test:e2e     # 4 real browsers play a round (needs Playwright + the dev server running)
                     # ...then edge cases: reconnect, two tabs, kick, room reset, phone controls
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
- `MOOD`: how often each erratic mood is picked, how long it lasts, how fast it moves during it, and the gap between moods.
- `MAX_SPEED`, `RAMP_SPEED`: how fast skiers go.
- `TERRAIN`: how crowded the mountain is. It starts at 16 obstacles per 32 m and climbs to about 54, plus bigger and more frequent tree groves, by about 1,500 m. So the longer a round goes, the harder the slope gets.

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
