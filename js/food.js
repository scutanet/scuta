import {
  FOOD_COUNT,
  MAX_BOOST_TRAILS,
  MAX_FOOD,
  WORLD_RADIUS,
  randRange,
} from "./utils.js";
import { foodColor } from "./skins.js";
import { randomFoodSprite } from "./food-sprites.js";
import { RING_BOUNDS, splitCents, toCents } from "./economy.js";

const RING_ORDER = ["outer", "middle", "center"];

/** Visual scale / brightness bias per ring (center reads larger & brighter). */
const RING_VIS = {
  outer: { sizeMul: 0.85, brightness: 1 },
  middle: { sizeMul: 1.0, brightness: 1.08 },
  center: { sizeMul: 1.35, brightness: 1.28 },
};

export class FoodField {
  /**
   * @param {{ ringBudgets?: { outer: number, middle: number, center: number } } | null} economy
   */
  constructor(economy = null) {
    this.items = [];
    this._mapTarget = FOOD_COUNT;
    if (economy?.ringBudgets) {
      this._spawnRingSeeded(economy.ringBudgets);
    } else {
      this._spawnInitialUniform();
    }
  }

  _spawnInitialUniform() {
    for (let i = 0; i < FOOD_COUNT; i++) {
      this.spawn(undefined, undefined, 1, null, null, { kind: "map", massGain: 1, ring: "middle" });
    }
  }

  /**
   * Equal pellet counts per ring; value = ring budget ÷ count (exact cents).
   * Pellet value is never invented — only drawn from ringBudgets.
   */
  _spawnRingSeeded(ringBudgets) {
    const base = Math.floor(FOOD_COUNT / 3);
    const rem = FOOD_COUNT - base * 3;
    const counts = {
      outer: base,
      middle: base,
      center: base + rem,
    };
    this._mapTarget = counts.outer + counts.middle + counts.center;

    for (const ring of RING_ORDER) {
      const count = counts[ring];
      const budgetCents = toCents(ringBudgets[ring] || 0);
      const values = splitCents(budgetCents, count);
      const [r0, r1] = RING_BOUNDS[ring];
      const vis = RING_VIS[ring];

      for (let i = 0; i < count; i++) {
        const pos = randomInRing(WORLD_RADIUS * r0, WORLD_RADIUS * r1);
        const value = values[i] ?? 0;
        // Physical growth is separate from money; center pellets feed a bit more mass.
        const massGain = ring === "center" ? 1.35 : ring === "middle" ? 1.1 : 0.95;
        this.spawn(pos.x, pos.y, value, null, null, {
          kind: "map",
          ring,
          massGain,
          sizeMul: vis.sizeMul * (0.92 + Math.random() * 0.16),
          brightness: vis.brightness,
        });
      }
    }
  }

  spawn(x, y, value = 0, color = null, radius = null, opts = null) {
    let rescuedValue = 0;
    if (this.items.length >= MAX_FOOD) {
      // Prefer trail / death-spill pellets: free a map pellet if needed,
      // but fold its value into the new pellet so money is never destroyed.
      if ((opts?.immuneId != null || opts?.evictAmbient) && this.items.length > 0) {
        let idx = -1;
        const limit = Math.min(200, this.items.length);
        const start = Math.floor(Math.random() * limit);
        for (let k = 0; k < limit; k++) {
          const j = (start + k) % this.items.length;
          const it = this.items[j];
          if (it.immuneId == null && it.kind === "map") {
            idx = j;
            break;
          }
        }
        if (idx < 0) return null;
        rescuedValue = this.items[idx].value || 0;
        this.items.splice(idx, 1);
      } else {
        return null;
      }
    }
    const pos =
      x != null
        ? { x, y }
        : randomInRing(WORLD_RADIUS * RING_BOUNDS.middle[0], WORLD_RADIUS * RING_BOUNDS.middle[1]);
    const c = color || foodColor();
    const kind = opts?.kind ?? "map";
    const ring = opts?.ring ?? null;
    const money = (Number(value) || 0) + rescuedValue;
    const item = {
      x: pos.x,
      y: pos.y,
      /** Monetary value — always sourced from birth / ring / boost / death. */
      value: money,
      /** Physical mass granted on eat (not money). */
      massGain: opts?.massGain ?? 1,
      // Collision radius (visual size scales with the viewing snake's head)
      radius: radius ?? (2.6 + Math.random() * 1.8 + Math.min(2.5, money * 4)),
      h: c.h,
      s: c.s,
      l: c.l,
      sprite: opts?.sprite ?? randomFoodSprite(),
      /** map = neon circuit, death = fruit candy, trail = boost crumbs */
      kind,
      ring,
      brightness: opts?.brightness ?? 1,
      /** 0.85–1.15 variance so coins aren't perfectly uniform */
      sizeMul:
        opts?.sizeMul ??
        (kind === "death" ? 1.15 + Math.random() * 0.35 : 0.85 + Math.random() * 0.3),
      pulse: Math.random() * Math.PI * 2,
      immuneId: opts?.immuneId ?? null,
      immuneUntil: opts?.immuneMs != null ? performance.now() + opts.immuneMs : 0,
    };
    this.items.push(item);
    return item;
  }

  /**
   * Scatter death pellets equal to the snake's carriedValue (money)
   * and massGain shares of its physical mass. Clears carriedValue.
   */
  spillFromSnake(snake) {
    const totalValue = snake.carriedValue || 0;
    const totalMass = snake.mass || 0;
    snake.carriedValue = 0;
    const segs = snake.segments;
    if (!(totalValue > 0 || totalMass > 0) || !segs.length) return;

    const count = Math.max(1, Math.min(segs.length, 500, Math.round(Math.max(totalMass, 1) / 3)));
    const step = segs.length / count;
    const valueParts = splitCents(toCents(totalValue), count);
    let remainingMass = totalMass;
    let pendingValue = 0;

    for (let i = 0; i < count; i++) {
      const seg = segs[Math.min(segs.length - 1, Math.floor(i * step))];
      const left = count - i;
      const massGain = remainingMass / left;
      const value = (valueParts[i] ?? 0) + pendingValue;
      pendingValue = 0;
      const jitter = 14;
      const item = this.spawn(
        seg.x + randRange(-jitter, jitter),
        seg.y + randRange(-jitter, jitter),
        value,
        foodColor(),
        3.5 + Math.random() * 3,
        { kind: "death", massGain, evictAmbient: true }
      );
      if (item) remainingMass -= massGain;
      else pendingValue = value;
    }

    // Last-resort: if capacity blocked every spawn, fold leftover money into any pellet
    if (pendingValue > 0 && this.items.length) {
      this.items[this.items.length - 1].value += pendingValue;
    }
  }

  /**
   * Drop trail pellets carrying the exact burnedValue from the booster.
   * @param {import("./snake.js").Snake} snake
   * @param {number} burnedValue
   * @param {number} burnedMass
   */
  dropBoostTrail(snake, burnedValue = 0, burnedMass = 0.9) {
    const tail = snake.segments[snake.segments.length - 1];
    if (!tail) return;

    // Global trail cap — fold oldest trail value into the new drop so money holds.
    if (this._trailCapEnabled !== false) this._enforceTrailCap();

    // Push slightly past the tip so they sit behind the body
    let tx = 0;
    let ty = 0;
    if (snake.segments.length >= 2) {
      const before = snake.segments[snake.segments.length - 2];
      const dx = tail.x - before.x;
      const dy = tail.y - before.y;
      const d = Math.hypot(dx, dy) || 1;
      tx = (dx / d) * (snake.radius * 0.6 + 4);
      ty = (dy / d) * (snake.radius * 0.6 + 4);
    } else {
      tx = -Math.cos(snake.angle) * (snake.radius + 4);
      ty = -Math.sin(snake.angle) * (snake.radius + 4);
    }

    const count = 1 + (Math.random() < 0.45 ? 1 : 0);
    const valueParts = splitCents(toCents(burnedValue), count);
    const massEach = burnedMass / count;
    let pendingValue = 0;

    for (let i = 0; i < count; i++) {
      const value = (valueParts[i] ?? 0) + pendingValue;
      pendingValue = 0;
      const item = this.spawn(
        tail.x + tx + randRange(-5, 5),
        tail.y + ty + randRange(-5, 5),
        value,
        { h: hueFromHex(snake.skin.colors[i % snake.skin.colors.length]), s: 75, l: 58 },
        2.8 + Math.random() * 1.4,
        {
          kind: "trail",
          massGain: massEach,
          immuneId: snake.id,
          immuneMs: 900,
          sizeMul: 0.7 + Math.random() * 0.2,
        }
      );
      if (!item) pendingValue = value;
    }
    if (pendingValue > 0) {
      // Return unplaced burn to the snake so money is not destroyed
      snake.carriedValue += pendingValue;
    }
  }

  /**
   * Keep active boost trails under MAX_BOOST_TRAILS globally.
   * Evicted trail value is folded into the next surviving trail pellet.
   */
  _enforceTrailCap() {
    let trails = 0;
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].kind === "trail") trails++;
    }
    if (trails < MAX_BOOST_TRAILS) return;

    let overflow = trails - MAX_BOOST_TRAILS + 2; // room for the upcoming drop
    let rescued = 0;
    for (let i = 0; i < this.items.length && overflow > 0; ) {
      if (this.items[i].kind === "trail") {
        rescued += this.items[i].value || 0;
        this.items.splice(i, 1);
        overflow--;
      } else {
        i++;
      }
    }
    if (rescued > 0) {
      // Park rescued cents on the oldest remaining trail, else any pellet
      let host = null;
      for (let i = 0; i < this.items.length; i++) {
        if (this.items[i].kind === "trail") {
          host = this.items[i];
          break;
        }
      }
      if (!host && this.items.length) host = this.items[0];
      if (host) host.value = (host.value || 0) + rescued;
    }
  }

  /**
   * Do not refill map pellets with new value — that would invent money.
   * Trail / death pellets already come from snakes.
   */
  maintain() {
    // Intentionally empty under the conservation invariant.
  }

  totalValue() {
    let sum = 0;
    for (let i = 0; i < this.items.length; i++) sum += this.items[i].value || 0;
    return sum;
  }
}

/** Uniform sample in an annulus [innerR, outerR). */
function randomInRing(innerR, outerR) {
  const lo = Math.max(0, Math.min(innerR, outerR));
  const hi = Math.max(lo + 1e-6, Math.max(innerR, outerR));
  // Area-uniform: r = sqrt(u * (hi² - lo²) + lo²)
  const u = Math.random();
  const r = Math.sqrt(u * (hi * hi - lo * lo) + lo * lo);
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

function hueFromHex(hex) {
  const n = hex.replace("#", "");
  const num = parseInt(n.length === 3 ? n.split("").map((c) => c + c).join("") : n, 16);
  const r = (num >> 16) / 255;
  const g = ((num >> 8) & 0xff) / 255;
  const b = (num & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return Math.round(h * 360);
}
