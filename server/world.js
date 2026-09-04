/**
 * Authoritative persistent arena — runs on Node with no DOM/canvas.
 * Clients send input only; this module owns snakes, food, collisions, cash-out.
 */

import {
  AI_STAGGER_FRAMES,
  WORLD_RADIUS,
  dist,
  randomInCircle,
} from "../js/utils.js";
import { BOT_NAMES, defaultPlayerSkin, randomSkin, skinByName } from "../js/skins.js";
import { FoodField } from "../js/food.js";
import { Snake } from "../js/snake.js";
import { updateBotAI } from "../js/ai.js";
import { SpatialHash } from "../js/spatial.js";
import {
  BOT_CASHOUT_MULT,
  CASHOUT_DWELL_MS,
  computeCashOutZones,
  computeRoundEconomy,
  pointInCashOutZone,
} from "../js/economy.js";

/** Online world sizing (shared persistent room). */
export const ONLINE_CAPACITY = 40;
export const ONLINE_BOT_TARGET = 22;
export const ONLINE_FOOD_COUNT = 2800;
export const ONLINE_BUY_IN = 1;
export const SIM_HZ = 60;
export const SNAPSHOT_HZ = 20;
export const FOOD_AOI = 1400;
export const SEG_SAMPLE = 3;
export const SEG_MAX = 48;

function spawnSlot(index, total) {
  const rings = Math.max(3, Math.ceil(Math.sqrt(total / 2)));
  const ring = index % rings;
  const onRing = Math.floor(index / rings);
  const perRing = Math.ceil(total / rings);
  const t = (onRing + ring * 0.37) / Math.max(1, perRing);
  const angle = t * Math.PI * 2;
  const radius = WORLD_RADIUS * (0.22 + (ring / Math.max(1, rings - 1)) * 0.55);
  const jitter = 18;
  return {
    x: Math.cos(angle) * radius + (Math.random() - 0.5) * jitter,
    y: Math.sin(angle) * radius + (Math.random() - 0.5) * jitter,
  };
}

export class AuthoritativeWorld {
  /**
   * @param {{ regionId?: string }} [opts]
   */
  constructor(opts = {}) {
    this.regionId = opts.regionId || "NA";
    this.tick = 0;
    this.running = false;
    this._stepMs = 1000 / SIM_HZ;
    this._acc = 0;
    this._last = Date.now();
    this._timer = null;
    this._namesUsed = new Set();

    this.capacity = ONLINE_CAPACITY;
    this.economy = computeRoundEconomy(ONLINE_BUY_IN, this.capacity);
    this.economy.foodCount = ONLINE_FOOD_COUNT;
    this.cashOutZones = computeCashOutZones(WORLD_RADIUS);
    this.food = new FoodField(this.economy);
    this.snakes = [];
    this.snakeGrid = new SpatialHash();
    this.foodGrid = new SpatialHash();
    this.totalCashedOut = 0;
    this.flags = {
      spatial: true,
      staggerAi: true,
      trailCap: true,
    };

    /** @type {Map<string, { snake: import("../js/snake.js").Snake, input: { angle: number, boost: boolean }, name: string }>} */
    this.clients = new Map();

    /** @type {((evt: { type: string, clientId?: string, snake?: any, amount?: number }) => void) | null} */
    this.onEvent = null;

    this._seedBots(ONLINE_BOT_TARGET);
    this._rebuildSpatial();
  }

  humanCount() {
    let n = 0;
    for (const s of this.snakes) if (s.alive && s.isPlayer) n++;
    return n;
  }

  botCount() {
    let n = 0;
    for (const s of this.snakes) if (s.alive && !s.isPlayer) n++;
    return n;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = Date.now();
    this._acc = 0;
    this._timer = setInterval(() => this._frame(), this._stepMs);
    console.info(
      `[world:${this.regionId}] started — bots=${this.botCount()} food=${this.food.items.length} capacity=${this.capacity}`
    );
  }

  stop() {
    this.running = false;
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  _seedBots(count) {
    const birth = this.economy.perSnakeBirth;
    for (let i = 0; i < count; i++) {
      const bot = this._spawnBot(birth, i, count);
      bot.aiPhase = i % AI_STAGGER_FRAMES;
      this.snakes.push(bot);
    }
  }

  _spawnBot(carriedValue, index, total) {
    let name;
    do {
      name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
      if (Math.random() < 0.35) name += Math.floor(Math.random() * 90);
    } while (this._namesUsed.has(name.toLowerCase()));
    this._namesUsed.add(name.toLowerCase());

    const pos = spawnSlot(index, Math.max(1, total));
    const bot = new Snake({
      name,
      skin: randomSkin(),
      isPlayer: false,
      x: pos.x,
      y: pos.y,
      carriedValue,
    });
    const bonus = Math.floor(Math.random() * 40);
    if (bonus > 0) bot.grow(bonus);
    return bot;
  }

  _findSafeSpawn() {
    const alive = this.snakes.filter((s) => s.alive);
    let best = null;
    let bestMin = -1;
    for (let attempt = 0; attempt < 40; attempt++) {
      const pos = randomInCircle(WORLD_RADIUS * 0.78, 120);
      let minD = Infinity;
      for (const s of alive) {
        const dHead = dist(pos.x, pos.y, s.head.x, s.head.y);
        if (dHead < minD) minD = dHead;
        if (dHead < 480 + s.radius * 8) {
          minD = -1;
          break;
        }
      }
      if (minD === Infinity || minD >= 0) return pos;
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

  /**
   * @param {string} clientId
   * @param {{ name?: string, skin?: any }} meta
   */
  addPlayer(clientId, meta = {}) {
    if (this.clients.has(clientId)) return this.clients.get(clientId).snake;
    if (this.humanCount() >= this.capacity) {
      const err = new Error("server_full");
      err.code = "server_full";
      throw err;
    }

    let name = String(meta.name || "scuta").slice(0, 16);
    const base = name.toLowerCase();
    if (this._namesUsed.has(base)) name = `${name}${Math.floor(Math.random() * 90)}`;
    this._namesUsed.add(name.toLowerCase());

    const skin =
      (meta.skin && typeof meta.skin === "object" && meta.skin.name
        ? skinByName(meta.skin.name)
        : null) ||
      (typeof meta.skin === "string" ? skinByName(meta.skin) : null) ||
      defaultPlayerSkin();

    const pos = this._findSafeSpawn();
    const snake = new Snake({
      name,
      skin,
      isPlayer: true,
      x: pos.x,
      y: pos.y,
      carriedValue: this.economy.perSnakeBirth,
    });
    snake.clientId = clientId;
    this.snakes.push(snake);
    this.clients.set(clientId, {
      snake,
      input: { angle: snake.angle, boost: false },
      name,
    });
    this._rebuildSpatial();
    return snake;
  }

  removePlayer(clientId) {
    const entry = this.clients.get(clientId);
    if (!entry) return;
    this.clients.delete(clientId);
    const snake = entry.snake;
    if (snake.alive) {
      snake.die();
      this.food.spillFromSnake(snake);
    }
    this.snakes = this.snakes.filter((s) => s !== snake);
    this._namesUsed.delete(entry.name.toLowerCase());
    this._topUpBots();
  }

  /**
   * @param {string} clientId
   * @param {{ angle?: number, boost?: boolean }} input
   */
  setInput(clientId, input) {
    const entry = this.clients.get(clientId);
    if (!entry || !entry.snake.alive) return;
    if (Number.isFinite(input.angle)) entry.input.angle = input.angle;
    entry.input.boost = Boolean(input.boost);
  }

  _topUpBots() {
    const need = ONLINE_BOT_TARGET - this.botCount();
    if (need <= 0) return;
    const birth = this.economy.perSnakeBirth;
    for (let i = 0; i < need; i++) {
      const bot = this._spawnBot(birth, this.snakes.length + i, ONLINE_BOT_TARGET);
      bot.aiPhase = (this.tick + i) % AI_STAGGER_FRAMES;
      const pos = this._findSafeSpawn();
      bot.segments[0].x = pos.x;
      bot.segments[0].y = pos.y;
      this.snakes.push(bot);
    }
  }

  _frame() {
    if (!this.running) return;
    const now = Date.now();
    const dt = Math.min(100, now - this._last);
    this._last = now;
    this._acc += dt;
    let steps = 0;
    while (this._acc >= this._stepMs && steps < 3) {
      this._update(1);
      this._acc -= this._stepMs;
      steps++;
    }
    if (steps >= 3) this._acc = 0;
  }

  _update(dtFrames) {
    this.tick++;
    const dtMs = this._stepMs * dtFrames;
    const cashThreshold = this.economy.perSnakeBirth * BOT_CASHOUT_MULT;
    const stagger = AI_STAGGER_FRAMES;
    const phase = this.tick % stagger;

    // Apply human inputs
    for (const [, entry] of this.clients) {
      const s = entry.snake;
      if (!s.alive) continue;
      s.targetAngle = entry.input.angle;
      s.boosting = entry.input.boost && s.mass > 14;
    }

    for (const s of this.snakes) {
      if (!s.alive) continue;
      if (!s.isPlayer) {
        const shouldThink = !this.flags.staggerAi || (s.aiPhase ?? 0) === phase;
        if (shouldThink) {
          updateBotAI(s, this.snakes, this.food, {
            zones: this.cashOutZones,
            cashThreshold,
          });
        } else if (s.aiTimer > 0) {
          s.aiTimer--;
        }
      }
      const { droppedFood, burnedValue, burnedMass } = s.update(dtFrames);
      if (droppedFood) {
        this.food._trailCapEnabled = this.flags.trailCap;
        this.food.dropBoostTrail(s, burnedValue, burnedMass);
      }
    }

    this._rebuildSpatial();

    const eatenSet = new Set();
    for (const s of this.snakes) {
      if (!s.alive) continue;
      s.attractFood(this.foodGrid);
      const eaten = s.collectFood(this.foodGrid, eatenSet);
      for (let i = 0; i < eaten.length; i++) eatenSet.add(eaten[i]);
    }
    if (eatenSet.size) {
      const items = this.food.items;
      for (let i = items.length - 1; i >= 0; i--) {
        if (eatenSet.has(items[i])) items.splice(i, 1);
      }
      this.foodGrid.clear();
      for (let i = 0; i < items.length; i++) {
        const f = items[i];
        this.foodGrid.insert(f.x, f.y, f);
      }
    }

    this._updateCashOuts(dtMs);

    const alive = this.snakes.filter((s) => s.alive);
    for (const s of alive) {
      if (!s.alive) continue;
      const result = s.hitsAny(this.snakeGrid);
      if (result.hit) this._kill(s);
      if (s.alive) {
        const d = Math.hypot(s.head.x, s.head.y);
        if (d + s.radius >= WORLD_RADIUS) this._kill(s);
      }
    }

    // Drop dead snakes that aren't waiting for client ack
    this.snakes = this.snakes.filter((s) => s.alive);
    this.food.maintain();

    if (this.tick % 120 === 0) this._topUpBots();
  }

  _rebuildSpatial() {
    this.snakeGrid.clear();
    this.foodGrid.clear();
    for (const s of this.snakes) {
      if (!s.alive) continue;
      s._updateBounds();
      const segs = s.segments;
      const sid = s.id;
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        this.snakeGrid.insert(seg.x, seg.y, {
          snake: s,
          snakeId: sid,
          index: i,
          seg,
        });
      }
    }
    const items = this.food.items;
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      this.foodGrid.insert(f.x, f.y, f);
    }
  }

  _updateCashOuts(dtMs) {
    for (const s of this.snakes) {
      if (!s.alive) continue;
      const zone = pointInCashOutZone(s.head.x, s.head.y, this.cashOutZones);
      if (zone) {
        s.cashOutMs += dtMs;
        if (s.cashOutMs >= CASHOUT_DWELL_MS) {
          s.cashOutProgress = 1;
          this._completeCashOut(s);
          continue;
        }
      } else {
        s.cashOutMs = 0;
      }
      s.cashOutProgress = Math.min(1, s.cashOutMs / CASHOUT_DWELL_MS);
    }
  }

  _completeCashOut(snake) {
    if (!snake.alive) return;
    const amount = snake.carriedValue || 0;
    const clientId = snake.clientId;
    snake.carriedValue = 0;
    snake.alive = false;
    snake.cashOutMs = 0;
    snake.cashOutProgress = 0;
    this.totalCashedOut += amount;
    this.onEvent?.({ type: "cashed", clientId, amount, length: snake.length });
    if (clientId) {
      const entry = this.clients.get(clientId);
      if (entry) this._namesUsed.delete(entry.name.toLowerCase());
      this.clients.delete(clientId);
    }
  }

  _kill(snake) {
    if (!snake.alive) return;
    const clientId = snake.clientId;
    snake.die();
    this.food.spillFromSnake(snake);
    this.onEvent?.({ type: "died", clientId, length: snake.length });
    if (clientId) {
      const entry = this.clients.get(clientId);
      if (entry) this._namesUsed.delete(entry.name.toLowerCase());
      this.clients.delete(clientId);
    }
  }

  /**
   * Build a network snapshot for one viewer (AOI food).
   * @param {string | null} viewerId
   */
  buildSnapshot(viewerId) {
    const viewer = viewerId ? this.clients.get(viewerId)?.snake : null;
    const ox = viewer?.alive ? viewer.head.x : 0;
    const oy = viewer?.alive ? viewer.head.y : 0;
    const aoi2 = FOOD_AOI * FOOD_AOI;

    const snakes = [];
    for (const s of this.snakes) {
      if (!s.alive) continue;
      const segs = s.segments;
      const sampled = [];
      const step = Math.max(1, SEG_SAMPLE);
      for (let i = 0; i < segs.length && sampled.length < SEG_MAX; i += step) {
        sampled.push([+segs[i].x.toFixed(1), +segs[i].y.toFixed(1)]);
      }
      const last = segs[segs.length - 1];
      if (last && sampled.length) {
        const tip = sampled[sampled.length - 1];
        if (tip[0] !== +last.x.toFixed(1) || tip[1] !== +last.y.toFixed(1)) {
          sampled.push([+last.x.toFixed(1), +last.y.toFixed(1)]);
        }
      }
      snakes.push({
        id: s.id,
        name: s.name,
        you: Boolean(viewer && s.id === viewer.id),
        angle: +s.angle.toFixed(3),
        boost: Boolean(s.boosting),
        mass: +s.mass.toFixed(1),
        r: +s.radius.toFixed(2),
        cv: +s.carriedValue.toFixed(2),
        cop: +s.cashOutProgress.toFixed(3),
        skin: {
          name: s.skin.name,
          style: s.skin.style || "coin",
          colors: s.skin.colors,
          coins: s.skin.coins,
        },
        segs: sampled,
      });
    }

    const food = [];
    const items = this.food.items;
    if (viewer?.alive) {
      const near = this.foodGrid.queryRect(
        ox - FOOD_AOI,
        oy - FOOD_AOI,
        ox + FOOD_AOI,
        oy + FOOD_AOI
      );
      const seen = new Set();
      for (let i = 0; i < near.length; i++) {
        const f = near[i];
        if (seen.has(f)) continue;
        seen.add(f);
        const dx = f.x - ox;
        const dy = f.y - oy;
        if (dx * dx + dy * dy > aoi2) continue;
        food.push([
          +f.x.toFixed(1),
          +f.y.toFixed(1),
          +f.radius.toFixed(2),
          +(f.value || 0).toFixed(3),
          f.kind === "death" ? 2 : f.kind === "trail" ? 1 : 0,
          f.sprite | 0,
        ]);
      }
    } else {
      for (let i = 0; i < items.length && food.length < 200; i += Math.max(1, Math.floor(items.length / 200))) {
        const f = items[i];
        food.push([
          +f.x.toFixed(1),
          +f.y.toFixed(1),
          +f.radius.toFixed(2),
          +(f.value || 0).toFixed(3),
          f.kind === "death" ? 2 : f.kind === "trail" ? 1 : 0,
          f.sprite | 0,
        ]);
      }
    }

    return {
      type: "state",
      t: this.tick,
      wr: WORLD_RADIUS,
      you: viewer?.alive ? viewer.id : null,
      humans: this.humanCount(),
      snakes,
      food,
      zones: this.cashOutZones.map((z) => [
        +z.x.toFixed(1),
        +z.y.toFixed(1),
        +z.radius.toFixed(1),
      ]),
    };
  }
}
