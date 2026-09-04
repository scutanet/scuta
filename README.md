# SCUTA.IO

A browser-based multiplayer arena game in the .io genre, themed around crypto liquidity pools.

Steer a snake through a circular arena, eat coin pellets to grow, and bank what you are carrying before someone else takes it. Online play is not wired up yet; the current build is a local demo with AI bots.

## Play

Open `index.html` in a modern browser, or serve locally:

```bash
python3 -m http.server 8080
```

Then visit [http://localhost:8080](http://localhost:8080).

Run the economy tests with `npm test`.

## Demo wallet

Every session uses a **demo wallet** stored in `localStorage` (starts at **$500**). Buy-ins come out of this balance; cashed-out value goes back in.

- Open **Liquidity Pools** to pick a tier and enter.
- **Top up** adds $100.
- Settings can reset the wallet to $500.
- If the balance is too low for a tier, top up before entering.

This is play money only. Nothing is on-chain.

## Pool tiers

Ten arenas, each with its own buy-in, capacity, and net liquidity (90% of `buy-in × capacity` after a 10% platform cut):

| Code | Tier        | Buy-in | Capacity | Pool class |
|------|-------------|--------|----------|------------|
| S1   | Micro       | $1     | 500      | Low-cap    |
| S2   | Starter     | $2.50  | 450      | Entry      |
| S3   | Bronze      | $5     | 400      | Low-cap    |
| S4   | Silver      | $10    | 350      | Mid-cap    |
| S5   | Gold        | $20    | 300      | Mid-cap    |
| S6   | Platinum    | $35    | 250      | High-cap   |
| S7   | Diamond     | $50    | 200      | High-cap   |
| S8   | Master      | $65    | 150      | Elite      |
| S9   | Grandmaster | $80    | 120      | Elite      |
| S10  | Apex VIP    | $100   | 100      | VIP        |

Entering a pool deducts the buy-in. Switching tiers refunds the previous buy-in, then charges the new one.

## Carried-value economy

Round money is closed. After the platform cut, remaining liquidity is split:

- **30% birth pool** — starting value on every snake.
- **70% map budget** — coin pellets on the floor, weighted toward the center (outer 20% / middle 30% / center 50%).

Eating a pellet adds its value to **carried value** (shown on the HUD as *Carrying*). Boosting burns length *and* carried value into trail pellets. If you die, your full carried value spills as pellets for everyone else. The round never mints extra money.

## Cash-out zones

Four teal discs sit on the cardinal axes, near the rim of the arena. Dwell inside a zone for **5 seconds** to bank your carried value back to the demo wallet and leave the round.

Leave the zone and the timer resets. Dying inside a zone is a normal death — the spill happens, nothing is banked.

## Controls

| Input | Action |
|--------|--------|
| Mouse / touch | Steer |
| Hold left click / Space / touch | Boost (burns length and carried value into pellets) |

## Also in the build

- Skins, nickname (saved in `localStorage`), leaderboard, minimap
- AI bots that hunt food, dodge larger snakes, and cash out when they are far enough ahead
- Play Online (primary) connects to the selected regional server; Play Offline stays available below
- **Region selector** (lobby top-left): pings NA / EU / ASIA and auto-picks lowest latency

## Regional servers

Three arena processes, one per continent:

| Region | Host | Port | Flag |
|--------|------|------|------|
| NA | na.scuta.io | 3001 | `--region NA` |
| EU | eu.scuta.io | 3002 | `--region EU` |
| ASIA | asia.scuta.io | 3003 | `--region ASIA` |

```bash
node server/index.js --region NA
# GET /health → { region, players, uptime, ping }
```

Deploy to a VPS (git pull + PM2) with `./deploy/deploy-na.sh` (also `deploy-eu.sh`, `deploy-asia.sh`). Copy keys into `deploy/` (`scuta-key.pem`, `scuta-key-eu.pem`, `scuta-key-asia.pem`) and keep IPs in `deploy/config.env`.

Local ping against a running process:

```js
window.__SCUTA_REGION_ORIGIN__ = "http://127.0.0.1";
```