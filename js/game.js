import { BOT_COUNT, WORLD_RADIUS } from "./utils.js";
import { BOT_NAMES, randomSkin } from "./skins.js";
import { FoodField } from "./food.js";
import { Snake } from "./snake.js";
import { updateBotAI } from "./ai.js";
import { Renderer } from "./render.js";

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

  start(nickname) {
    this.snakes = [];
    this.food = new FoodField();
    this._namesUsed.clear();

    this.player = new Snake({
      name: nickname || "Player",
      isPlayer: true,
      skin: randomSkin(),
    });
    this.snakes.push(this.player);
    this._namesUsed.add(this.player.name.toLowerCase());

    for (let i = 0; i < BOT_COUNT; i++) {
      this.snakes.push(this._spawnBot());
    }

    this.renderer.cam.x = this.player.head.x;
    this.renderer.cam.y = this.player.head.y;
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

    const bot = new Snake({
      name,
      skin: randomSkin(),
      isPlayer: false,
    });
    // Vary starting size
    const bonus = Math.floor(Math.random() * 40);
    if (bonus > 0) bot.grow(bonus);
    return bot;
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
      // Aim at whatever is under the cursor with the current camera
      this._syncMouseWorld();
      this._update(1);
      this.renderer.follow(this.player);
      this._acc -= this._stepMs;
      steps++;
    }
    // Drop leftover time if we hit the catch-up cap (avoid spiral of death)
    if (steps >= 5) this._acc = 0;

    // Keep reticle glued to the OS cursor after the camera settles
    if (steps === 0) this.renderer.follow(this.player);
    this._syncMouseWorld();
    this.renderer.render(this);
    this._hudAcc += dt;
    if (this._hudAcc > 200) {
      this._hudAcc = 0;
      this._emitHud();
    }
    this._raf = requestAnimationFrame(this._loop);
  };

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

      // Food pickup (remove descending)
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
        if (d > WORLD_RADIUS + 10) this._kill(s);
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
    }));
    let rank = "—";
    if (this.player && this.player.alive) {
      rank = String(alive.findIndex((s) => s === this.player) + 1);
    }
    this.onHud?.({
      length: this.player ? this.player.length : 0,
      rank: `${rank} / ${alive.length}`,
      leaderboard: top,
    });
  }
}
