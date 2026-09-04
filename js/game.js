import { WORLD_RADIUS, dist, randomInCircle, AI_STAGGER_FRAMES } from "./utils.js";
import { BOT_NAMES, defaultPlayerSkin, randomSkin } from "./skins.js";
import { FoodField } from "./food.js";
import { Snake } from "./snake.js";
import { updateBotAI } from "./ai.js";
import { Renderer } from "./render.js";
import { SpatialHash } from "./spatial.js";
import { getServerById } from "./servers.js";
import {
  BOT_CASHOUT_MULT,
  CASHOUT_DWELL_MS,
  INVARIANT_TOLERANCE,
  computeCashOutZones,
  computeRoundEconomy,
  pointInCashOutZone,
  toCents,
} from "./economy.js";

/** Min distance from existing snakes when a new one spawns */
const SPAWN_CLEARANCE = 560;
/** Frame-time threshold (ms) above which we warn the round is unplayable. */
const UNPLAYABLE_FRAME_MS = 33;

/** Spread bots across concentric rings without a spatial index. */
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

export class Game {
  constructor({ canvas, minimap, onDeath, onCashOut, onHud }) {
    this.renderer = new Renderer(canvas, minimap);
    this.food = new FoodField();
    this.snakes = [];
    this.player = null;
    this.running = false;
    this.mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    this.mouseWorld = { x: 0, y: 0 };
    this.boostHeld = false;
    this.onDeath = onDeath;
    this.onCashOut = onCashOut;
    this.onHud = onHud;
    this._hudAcc = 0;
    this._raf = null;
    this._last = 0;
    this._acc = 0;
    this._namesUsed = new Set();
    /** Fixed sim rate so speed is independent of display refresh (60/120/144Hz). */
    this._stepMs = 1000 / 60;
    this._frameIndex = 0;

    this.serverSession = null;
    this.server = null;
    this.economy = null;
    this.cashOutZones = [];
    this.totalCashedOut = 0;
    this.capacity = 0;
    this.cashedOutIds = new Set();
    this.lastFrameMs = 0;
    this._probing = false;

    /** Separate spatial hashes for snake segments and pellets. */
    this.snakeGrid = new SpatialHash();
    this.foodGrid = new SpatialHash();

    /** Perf counters (reset each sim step). */
    this.perf = {
      frameMs: 0,
      simMs: 0,
      renderMs: 0,
      collisionChecks: 0,
      snakeCount: 0,
    };
    this._perfLogAcc = 0;
    this._perfSamples = [];

    /**
     * Perf feature flags (all on by default). Bench can disable to isolate gains.
     * spatial / staggerAi / trailCap affect sim; cull / lod affect render.
     */
    this.flags = {
      spatial: true,
      cull: true,
      lod: true,
      staggerAi: true,
      trailCap: true,
    };

    window.addEventListener("resize", () => this.renderer.resize());
  }

  start(nickname, opts = {}) {
    const {
      skin = null,
      mode = "ai",
      serverSession = null,
      capacityOverride = null,
      flags = null,
      onlineSocket = null,
    } = opts;
    if (flags) Object.assign(this.flags, flags);
    this.snakes = [];
    this._namesUsed.clear();
    this.mode = mode;
    this.onlineSocket = onlineSocket;
    this.netPlayerId = null;
    this.spectateTarget = null;
    this.totalCashedOut = 0;
    this.cashedOutIds = new Set();
    this._frameIndex = 0;
    this._perfSamples = [];
    this._perfLogAcc = 0;
    /** @type {{ serverId: string, buyIn: number, startingValue: number, joinedAt: number } | null} */
    this.serverSession = serverSession;

    this.server = serverSession ? getServerById(serverSession.serverId) : null;
    const buyIn = this.server?.buyIn ?? serverSession?.buyIn ?? 1;
    this.capacity = capacityOverride ?? this.server?.maxCapacity ?? 28;
    this.economy = computeRoundEconomy(buyIn, this.capacity);
    this.cashOutZones = computeCashOutZones(WORLD_RADIUS);

    if (mode === "online") {
      // Authoritative server owns the world — local food/snakes are render mirrors only.
      this.food = new FoodField({ foodCount: 0 });
      this.player = null;
      this.running = true;
      this._last = performance.now();
      this._acc = 0;
      this._loop(this._last);
      return;
    }

    this.food = new FoodField(this.economy);

    const birth = this.economy.perSnakeBirth;
    const botTarget = Math.max(0, this.capacity - (mode !== "spectate" ? 1 : 0));

    if (mode !== "spectate") {
      this.player = new Snake({
        name: nickname || "Player",
        isPlayer: true,
        skin: skin || defaultPlayerSkin(),
        carriedValue: birth,
        x: 0,
        y: 0,
      });
      this.snakes.push(this.player);
      this._namesUsed.add(this.player.name.toLowerCase());
    } else {
      this.player = null;
    }

    // Bulk-spawn bots on staggered rings (avoids instant pile-up deaths).
    for (let i = 0; i < botTarget; i++) {
      const bot = this._spawnBot(birth, i, botTarget);
      bot.aiPhase = i % AI_STAGGER_FRAMES;
      this.snakes.push(bot);
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

    this._rebuildSpatial();
    this._measureStartFrame();
    this._loop(this._last);
  }

  /** One sim+render sample at round start; warn if frame time is unplayable. */
  _measureStartFrame() {
    this._probing = true;
    const t0 = performance.now();
    this._update(1);
    this.renderer.follow(this._cameraTarget());
    this.renderer.render(this);
    const ms = performance.now() - t0;
    this._probing = false;
    this.lastFrameMs = ms;
    this.perf.frameMs = ms;

    const n = this.snakes.filter((s) => s.alive).length;
    const tier = this.server?.id ?? "?";
    console.info(
      `[scuta] round start: ${ms.toFixed(1)}ms/frame with ${n} living / ${this.snakes.length} spawned snakes (tier ${tier}, capacity ${this.capacity}) | collisionChecks=${this.perf.collisionChecks}`
    );
    if (ms > UNPLAYABLE_FRAME_MS) {
      console.warn(
        `[scuta] UNPLAYABLE: ${ms.toFixed(1)}ms/frame at ${this.snakes.length} snakes — expect heavy lag on this tier`
      );
    }
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _spawnBot(carriedValue = 0, index = 0, total = 1) {
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
    // Vary starting size (mass only — does not invent money)
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

  /** Rebuild snake-segment + pellet spatial hashes after movement. */
  _rebuildSpatial() {
    const snakeGrid = this.snakeGrid;
    const foodGrid = this.foodGrid;
    snakeGrid.clear();
    foodGrid.clear();

    for (const s of this.snakes) {
      if (!s.alive) continue;
      s._updateBounds();
      const segs = s.segments;
      const sid = s.id;
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        snakeGrid.insert(seg.x, seg.y, {
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
      foodGrid.insert(f.x, f.y, f);
    }
  }

  _loop = (now) => {
    if (!this.running) return;
    // Cap spike so tab-resume doesn't fast-forward
    const dt = Math.min(100, now - this._last);
    this._last = now;
    this._acc += dt;

    const frameT0 = performance.now();
    let steps = 0;
    let simMs = 0;

    if (this.mode === "online") {
      this._syncMouseWorld();
      this._sendOnlineInput();
      this.renderer.follow(this._cameraTarget());
    } else {
      while (this._acc >= this._stepMs && steps < 5) {
        this._syncMouseWorld();
        const tSim = performance.now();
        this._update(1);
        simMs += performance.now() - tSim;
        this.renderer.follow(this._cameraTarget());
        this._acc -= this._stepMs;
        steps++;
      }
      if (steps >= 5) this._acc = 0;
      if (steps === 0) this.renderer.follow(this._cameraTarget());
      this._syncMouseWorld();
    }

    const tRen = performance.now();
    this.renderer.render(this);
    const renderMs = performance.now() - tRen;
    const frameMs = performance.now() - frameT0;

    this.lastFrameMs = frameMs;
    this.perf.frameMs = frameMs;
    this.perf.simMs = simMs;
    this.perf.renderMs = renderMs;
    this.perf.snakeCount = this.snakes.filter((s) => s.alive).length;

    this._perfLogAcc += dt;
    this._perfSamples.push(frameMs);
    if (this._perfSamples.length > 120) this._perfSamples.shift();
    if (this._perfLogAcc > 2000) {
      this._perfLogAcc = 0;
      this._logPerf();
    }

    this._hudAcc += dt;
    if (this._hudAcc > 200) {
      this._hudAcc = 0;
      this._emitHud();
    }
    this._raf = requestAnimationFrame(this._loop);
  };

  /** Send heading + boost only — server owns the sim. */
  _sendOnlineInput() {
    const sock = this.onlineSocket;
    if (!sock || sock.readyState !== 1) return;
    const angle = Math.atan2(
      this.mouseWorld.y - (this.player?.head.y ?? this.renderer.cam.y),
      this.mouseWorld.x - (this.player?.head.x ?? this.renderer.cam.x)
    );
    try {
      sock.send(
        JSON.stringify({
          type: "input",
          angle,
          boost: Boolean(this.boostHeld),
        })
      );
    } catch {
      /* ignore */
    }
  }

  _logPerf() {
    const samples = this._perfSamples;
    if (!samples.length) return;
    let sum = 0;
    let max = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i];
      if (samples[i] > max) max = samples[i];
    }
    const avg = sum / samples.length;
    console.info(
      `[scuta:perf] snakes=${this.perf.snakeCount} avgFrame=${avg.toFixed(1)}ms max=${max.toFixed(1)}ms ` +
        `sim=${this.perf.simMs.toFixed(1)}ms render=${this.perf.renderMs.toFixed(1)}ms ` +
        `collisionChecks=${this.perf.collisionChecks}`
    );
  }

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
    this._frameIndex++;
    const dtMs = this._stepMs * dtFrames;
    const cashThreshold = (this.economy?.perSnakeBirth || 0) * BOT_CASHOUT_MULT;
    const stagger = AI_STAGGER_FRAMES;
    const phase = this._frameIndex % stagger;

    if (this.player && this.player.alive) {
      this.player.setTarget(this.mouseWorld.x, this.mouseWorld.y);
      this.player.boosting = this.boostHeld && this.player.mass > 14;
    }

    // Movement first (all snakes every frame)
    for (const s of this.snakes) {
      if (!s.alive) continue;
      if (!s.isPlayer) {
        // Decision staggered; movement always runs below
        const shouldThink =
          !this.flags.staggerAi || (s.aiPhase ?? 0) === phase;
        if (shouldThink) {
          updateBotAI(s, this.snakes, this.food, {
            zones: this.cashOutZones,
            cashThreshold,
          });
        } else if (s.aiTimer > 0) {
          // Keep seek timers on wall-clock frames so stagger doesn't stretch AI cadence
          s.aiTimer--;
        }
      }
      const { droppedFood, burnedValue, burnedMass } = s.update(dtFrames);
      if (droppedFood) {
        this.food._trailCapEnabled = this.flags.trailCap;
        this.food.dropBoostTrail(s, burnedValue, burnedMass);
      }
    }

    // Rebuild grids after movement / trail drops, before magnet + collision
    if (this.flags.spatial) this._rebuildSpatial();
    else {
      // Still need bounds for cull even without spatial queries
      for (const s of this.snakes) {
        if (s.alive) s._updateBounds();
      }
    }

    // Vacuum + eat
    const eatenSet = new Set();
    if (this.flags.spatial) {
      for (const s of this.snakes) {
        if (!s.alive) continue;
        s.attractFood(this.foodGrid);
        const eaten = s.collectFood(this.foodGrid, eatenSet);
        for (let i = 0; i < eaten.length; i++) eatenSet.add(eaten[i]);
      }
    } else {
      for (const s of this.snakes) {
        if (!s.alive) continue;
      s.attractFoodLegacy(this.food.items);
      const idxs = s.collectFoodLegacy(this.food.items, eatenSet);
      for (const idx of idxs) eatenSet.add(this.food.items[idx]);
      }
    }
    if (eatenSet.size) {
      const items = this.food.items;
      for (let i = items.length - 1; i >= 0; i--) {
        if (eatenSet.has(items[i])) items.splice(i, 1);
      }
      if (this.flags.spatial) {
        this.foodGrid.clear();
        for (let i = 0; i < items.length; i++) {
          const f = items[i];
          this.foodGrid.insert(f.x, f.y, f);
        }
      }
    }

    // Cash-out dwell (head must stay inside; leave resets to zero)
    if (!this._probing) this._updateCashOuts(dtMs);

    // Collisions
    let collisionChecks = 0;
    const alive = this.snakes.filter((s) => s.alive);
    if (this.flags.spatial) {
      for (const s of alive) {
        if (!s.alive) continue;
        const result = s.hitsAny(this.snakeGrid);
        collisionChecks += result.checks;
        if (result.hit) {
          if (!this._probing) this._kill(s);
        }
        if (s.alive && !this._probing) {
          const d = Math.hypot(s.head.x, s.head.y);
          if (d + s.radius >= WORLD_RADIUS) this._kill(s);
        }
      }
    } else {
      for (const s of alive) {
        if (!s.alive) continue;
        for (const other of alive) {
          if (!other.alive || other === s) continue;
          collisionChecks += Math.max(1, Math.floor(other.segments.length / 5));
          if (s.hitsSnake(other)) {
            if (!this._probing) this._kill(s);
            break;
          }
        }
        if (s.alive && !this._probing) {
          const d = Math.hypot(s.head.x, s.head.y);
          if (d + s.radius >= WORLD_RADIUS) this._kill(s);
        }
      }
    }
    this.perf.collisionChecks = collisionChecks;

    // No mid-round funded respawns — that would invent money.
    this.snakes = this.snakes.filter((s) => s.alive || s.isPlayer);
    this.food.maintain();

    if (this._frameIndex % 60 === 0) this._checkInvariant();
  }

  _updateCashOuts(dtMs) {
    const zones = this.cashOutZones;
    if (!zones.length) return;

    for (const s of this.snakes) {
      if (!s.alive) continue;
      const h = s.head;
      const zone = pointInCashOutZone(h.x, h.y, zones);
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
    snake.carriedValue = 0;
    snake.alive = false;
    snake.cashOutMs = 0;
    snake.cashOutProgress = 0;
    this.totalCashedOut += amount;
    this.cashedOutIds.add(snake.id);

    if (snake.isPlayer) {
      this.running = false;
      this._emitHud();
      this.renderer.render(this);
      this.onCashOut?.({ amount, length: snake.length });
    }
  }

  _kill(snake) {
    if (!snake.alive) return;
    // Dying inside a zone is a normal death — full spill, nothing banked
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

  _checkInvariant() {
    if (!this.economy) return;
    let pelletSum = 0;
    for (const p of this.food.items) pelletSum += p.value || 0;
    let snakeSum = 0;
    for (const s of this.snakes) {
      if (s.alive) snakeSum += s.carriedValue || 0;
    }
    const total = pelletSum + snakeSum + this.totalCashedOut;
    const expected = this.economy.roundLiquidity;
    const drift = Math.abs(total - expected);
    if (drift > INVARIANT_TOLERANCE) {
      console.error(
        `[scuta] money invariant broken: pellets=${pelletSum.toFixed(4)} snakes=${snakeSum.toFixed(4)} cashed=${this.totalCashedOut.toFixed(4)} sum=${total.toFixed(4)} expected=${expected.toFixed(4)} drift=$${drift.toFixed(4)} (tier ${this.server?.id ?? "?"})`
      );
    }
  }

  /** Snapshot used by tests / debug. */
  moneySnapshot() {
    let pelletSum = 0;
    for (const p of this.food.items) pelletSum += p.value || 0;
    let snakeSum = 0;
    for (const s of this.snakes) {
      if (s.alive) snakeSum += s.carriedValue || 0;
    }
    return {
      pellets: pelletSum,
      snakes: snakeSum,
      cashedOut: this.totalCashedOut,
      total: pelletSum + snakeSum + this.totalCashedOut,
      expected: this.economy?.roundLiquidity ?? 0,
      driftCents: Math.abs(
        toCents(pelletSum + snakeSum + this.totalCashedOut) - toCents(this.economy?.roundLiquidity ?? 0)
      ),
    };
  }

  _emitHud() {
    const alive = this.snakes.filter((s) => s.alive).sort((a, b) => b.mass - a.mass);
    const top = alive.slice(0, 10).map((s) => ({
      name: s.name,
      score: s.length,
      value: s.carriedValue,
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
      carriedValue: this.player?.alive ? this.player.carriedValue : focus?.carriedValue ?? 0,
      cashOutProgress: this.player?.alive ? this.player.cashOutProgress : 0,
      leaderboard: top,
      frameMs: this.lastFrameMs,
      snakeCount: this.snakes.filter((s) => s.alive).length,
      collisionChecks: this.perf.collisionChecks,
    });
  }
}
