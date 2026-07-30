# SCUTA.IO

A browser game inspired by [Slither.io](http://slither.io) — steer your snake, eat pellets, boost to chase, and don't hit another snake's body.

## Play

Open `index.html` in a modern browser, or serve locally:

```bash
python3 -m http.server 8080
```

Then visit [http://localhost:8080](http://localhost:8080).

## Controls

| Input | Action |
|--------|--------|
| Mouse / touch | Steer |
| Hold left click / Space / touch | Boost (burns length into pellets) |

## Features

- Circular arena with Slither-style dots, skins, eyes, and gloss
- Food pellets, boost trails, and death spills
- AI bots, leaderboard, minimap, score / rank HUD
- Nickname saved in `localStorage`
