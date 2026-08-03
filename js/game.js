import { BOT_COUNT, WORLD_RADIUS, dist, randomInCircle } from "./utils.js";
import { BOT_NAMES, defaultPlayerSkin, randomSkin } from "./skins.js";
import { FoodField } from "./food.js";
import { Snake } from "./snake.js";
import { updateBotAI } from "./ai.js";
import { Renderer } from "./render.js";

/** Min distance from existing snakes when a new one spawns */
const SPAWN_CLEARANCE = 560;

export class Game {
  constructor({ canvas, minimap, onDeath, onHud }) {
    this.renderer = new Renderer(canvas, minimap);
    this.food = new FoodField();
    this.snakes = [];
    this.player = null;
    this.running = false;
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.mouseWorld = { x: 0, y: 0 };
    this.boostHeld = false;
    this.onDeath = onDeath;
    this.onHud = onHud;
    this._hudAcc = 0;
    this._raf = null;
    this._last = 0;
    this._acc = 0;
    this._namesUsed = new Set();
    /** Fixed sim rate so speed is independent of display refresh (60/120/144Hz). */
    this._stepMs = 1000 / 60;

    window.addEventListener("resize", () => this.renderer.resize());
  }

  start(nickname, opts = {}) {
    const { skin = null, mode = "ai" } = opts;
    this.snakes = [];
    this.food = new FoodField();
    this._namesUsed.clear();
    this.mode = mode;
    this.spectateTarget = null;

    if (mode !== "spectate") {
      this.player = new Snake({
        name: nickname || "Player",
        isPlayer: true,
        skin: skin || defaultPlayerSkin(),
      });
      this.snakes.push(this.player);
      this._namesUsed.add(this.player.name.toLowerCase());
    } else {
      this.player = null;
    }

    for (let i = 0; i < BOT_COUNT; i++) {
      this.snakes.push(this._spawnBot());
    }

    const follow = this.player || this.snakes.find((s) => s.alive);
    if (follow) {
      this.renderer.cam.x = follow.head.x;
      this.renderer.cam.y = follow.head.y;
      if (mode === "spectate") this.spectateTarget = follow;
    }
    this._syncMouseWorld();
    this.running = true;
    this._last = performance.now();
    this._acc = 0;
    this._loop(this._last);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _spawnBot() {
    let name;
    do {
      name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
      if (Math.random() < 0.35) name += Math.floor(Math.random() * 90);
    } while (this._namesUsed.has(name.toLowerCase()));
    this._namesUsed.add(name.toLowerCase());

    const pos = this._findSafeSpawn();
    const bot = new Snake({
      name,
      skin: randomSkin(),
      isPlayer: false,
      x: pos.x,
      y: pos.y,
    });
    // Vary starting size
    const bonus = Math.floor(Math.random() * 40);
    if (bonus > 0) bot.grow(bonus);
    return bot;
  }

  /**
   * Pick a spawn point far from every living snake (head + sampled body).
   * Prefers the candidate with the largest nearest-neighbor gap if none clear fully.
   */
  _findSafeSpawn() {
    const alive = this.snakes.filter((s) => s.alive);
    let best = null;
    let bestMin = -1;

    for (let attempt = 0; attempt < 48; attempt++) {
      const pos = randomInCircle(WORLD_RADIUS * 0.78, 120);
      let minD = Infinity;

      for (const s of alive) {
        const headClear = SPAWN_CLEARANCE + s.radius * 10;
        const dHead = dist(pos.x, pos.y, s.head.x, s.head.y);
        if (dHead < minD) minD = dHead;
        if (dHead < headClear) {
          minD = -1;
          break;
        }

        const segs = s.segments;
        const step = Math.max(1, Math.floor(segs.length / 14));
        const bodyClear = SPAWN_CLEARANCE * 0.7 + s.radius * 5;
        for (let i = 0; i < segs.length; i += step) {
          const d = dist(pos.x, pos.y, segs[i].x, segs[i].y);
          if (d < minD) minD = d;
          if (d < bodyClear) {
            minD = -1;
            break;
          }
        }
        if (minD < 0) break;
      }

      if (minD === Infinity) return pos; // empty arena
      if (minD >= 0) return pos; // fully clear
      // Track least-bad fallback (minD was -1; recompute nearest for ranking)
      let nearest = Infinity;
      for (const s of alive) {
        nearest = Math.min(nearest, dist(pos.x, pos.y, s.head.x, s.head.y));
      }
      if (nearest > bestMin) {
        bestMin = nearest;
        best = pos;
      }
    }

    return best || randomInCircle(WORLD_RADIUS * 0.78, 120);
  }

  setMouse(sx, sy) {
    this.mouse.x = sx;
    this.mouse.y = sy;
  }

  /** Convert current screen cursor → world using the latest camera (must run every frame). */
  _syncMouseWorld() {
    this.mouseWorld = this.renderer.screenToWorld(this.mouse.x, this.mouse.y);
  }

  setBoost(on) {
    this.boostHeld = on;
  }

  _loop = (now) => {
    if (!this.running) return;
    // Cap spike so tab-resume doesn't fast-forward
    const dt = Math.min(100, now - this._last);
    this._last = now;
    this._acc += dt;

    let steps = 0;
    while (this._acc >= this._stepMs && steps < 5) {
      this._syncMouseWorld();
      this._update(1);
      this.renderer.follow(this._cameraTarget());
      this._acc -= this._stepMs;
      steps++;
    }
    if (steps >= 5) this._acc = 0;

    if (steps === 0) this.renderer.follow(this._cameraTarget());
    this._syncMouseWorld();
    this.renderer.render(this);
    this._hudAcc += dt;
    if (this._hudAcc > 200) {
      this._hudAcc = 0;
      this._emitHud();
    }
    this._raf = requestAnimationFrame(this._loop);
  };

  _cameraTarget() {
    if (this.player && this.player.alive) return this.player;
    if (this.mode === "spectate") {
      if (!this.spectateTarget || !this.spectateTarget.alive) {
        const alive = this.snakes.filter((s) => s.alive).sort((a, b) => b.mass - a.mass);
        this.spectateTarget = alive[0] || null;
      }
      return this.spectateTarget;
    }
    return this.player;
  }

  _update(dtFrames) {
    if (this.player && this.player.alive) {
      this.player.setTarget(this.mouseWorld.x, this.mouseWorld.y);
      this.player.boosting = this.boostHeld && this.player.mass > 14;
    }

    for (const s of this.snakes) {
      if (!s.alive) continue;
      if (!s.isPlayer) updateBotAI(s, this.snakes, this.food);
      const { droppedFood } = s.update(dtFrames);
      if (droppedFood) this.food.dropBoostTrail(s);

      // Vacuum nearby pellets into the head, then pick them up
      s.attractFood(this.food.items);
      const eaten = s.collectFood(this.food.items);
      if (eaten.length) {
        eaten.sort((a, b) => b - a);
        for (const idx of eaten) this.food.items.splice(idx, 1);
      }
    }

    // Collisions — head vs other bodies (Slither rules)
    const alive = this.snakes.filter((s) => s.alive);
    for (const s of alive) {
      if (!s.alive) continue;
      for (const other of alive) {
        if (!other.alive || other === s) continue;
        if (s.hitsSnake(other)) {
          this._kill(s);
          break;
        }
      }
      if (s.alive) {
        const d = Math.hypot(s.head.x, s.head.y);
        // Die when the head touches the arena rim
        if (d + s.radius >= WORLD_RADIUS) this._kill(s);
      }
    }

    this._respawnBots();
    this.food.maintain();
  }

  _respawnBots() {
    this.snakes = this.snakes.filter((s) => s.alive || s.isPlayer);
    const liveBots = this.snakes.filter((s) => s.alive && !s.isPlayer).length;
    const need = BOT_COUNT - liveBots;
    if (need <= 0) return;
    // Gradual respawn so the map doesn't refill instantly
    if (Math.random() < 0.04 * need) {
      this.snakes.push(this._spawnBot());
    }
  }

  _kill(snake) {
    if (!snake.alive) return;
    snake.die();
    this.food.spillFromSnake(snake);
    if (snake.isPlayer) {
      this.running = false;
      this._emitHud();
      // One last paint
      this.renderer.render(this);
      this.onDeath?.(snake.length);
    }
  }

  _emitHud() {
    const alive = this.snakes.filter((s) => s.alive).sort((a, b) => b.mass - a.mass);
    const top = alive.slice(0, 10).map((s) => ({
      name: s.name,
      score: s.length,
      you: s.isPlayer,
      color: s.skin.colors[0],
    }));
    const focus = this.player?.alive ? this.player : this._cameraTarget();
    let rank = "—";
    if (this.player && this.player.alive) {
      rank = String(alive.findIndex((s) => s === this.player) + 1);
    } else if (this.mode === "spectate" && focus) {
      rank = String(alive.findIndex((s) => s === focus) + 1);
    }
    this.onHud?.({
      length: focus ? focus.length : 0,
      rank: `${rank} of ${alive.length}`,
      leaderboard: top,
    });
  }
}
