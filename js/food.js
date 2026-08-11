import {
  FOOD_COUNT,
  MAX_FOOD,
  WORLD_RADIUS,
  randomInCircle,
  randRange,
} from "./utils.js";
import { foodColor } from "./skins.js";
import { randomFoodSprite } from "./food-sprites.js";

export class FoodField {
  constructor() {
    this.items = [];
    this._spawnInitial();
  }

  _spawnInitial() {
    for (let i = 0; i < FOOD_COUNT; i++) {
      this.spawn();
    }
  }

  spawn(x, y, value = 1, color = null, radius = null, opts = null) {
    if (this.items.length >= MAX_FOOD) {
      // Prefer trail / death-spill pellets: free a random ambient pellet if needed
      if ((opts?.immuneId != null || opts?.evictAmbient) && this.items.length > 0) {
        const idx = Math.floor(Math.random() * Math.min(200, this.items.length));
        if (this.items[idx].immuneId == null) this.items.splice(idx, 1);
        else return null;
      } else {
        return null;
      }
    }
    const pos = x != null ? { x, y } : randomInCircle(WORLD_RADIUS, 40);
    const c = color || foodColor();
    const kind = opts?.kind ?? "map";
    const item = {
      x: pos.x,
      y: pos.y,
      value,
      // Collision radius (visual size scales with the viewing snake's head)
      radius: radius ?? (2.6 + Math.random() * 1.8 + value * 0.35),
      h: c.h,
      s: c.s,
      l: c.l,
      sprite: opts?.sprite ?? randomFoodSprite(),
      /** map = neon circuit, death = fruit candy, trail = boost crumbs */
      kind,
      /** 0.85–1.15 variance so coins aren't perfectly uniform */
      sizeMul: opts?.sizeMul ?? (kind === "death" ? 1.15 + Math.random() * 0.35 : 0.85 + Math.random() * 0.3),
      pulse: Math.random() * Math.PI * 2,
      immuneId: opts?.immuneId ?? null,
      immuneUntil: opts?.immuneMs != null ? performance.now() + opts.immuneMs : 0,
    };
    this.items.push(item);
    return item;
  }

  /** Scatter fruit-candy loot equal to the snake's exact mass at death. */
  spillFromSnake(snake) {
    const total = snake.mass;
    const segs = snake.segments;
    if (!(total > 0) || !segs.length) return;

    // Spread mass along the body; cap count for performance / field capacity
    const count = Math.max(1, Math.min(segs.length, 500, Math.round(total / 3)));
    const step = segs.length / count;
    let remaining = total;

    for (let i = 0; i < count; i++) {
      const seg = segs[Math.min(segs.length - 1, Math.floor(i * step))];
      const left = count - i;
      const value = remaining / left;
      const jitter = 14;
      const item = this.spawn(
        seg.x + randRange(-jitter, jitter),
        seg.y + randRange(-jitter, jitter),
        value,
        foodColor(),
        3.5 + Math.random() * 3,
        { kind: "death", evictAmbient: true }
      );
      if (item) remaining -= value;
    }
  }

  /** Drop pellets from the tip of the tail while boosting (Slither-style). */
  dropBoostTrail(snake) {
    const tail = snake.segments[snake.segments.length - 1];
    if (!tail) return;

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
    for (let i = 0; i < count; i++) {
      this.spawn(
        tail.x + tx + randRange(-5, 5),
        tail.y + ty + randRange(-5, 5),
        1,
        { h: hueFromHex(snake.skin.colors[i % snake.skin.colors.length]), s: 75, l: 58 },
        2.8 + Math.random() * 1.4,
        { kind: "trail", immuneId: snake.id, immuneMs: 900, sizeMul: 0.7 + Math.random() * 0.2 }
      );
    }
  }

  maintain() {
    while (this.items.length < FOOD_COUNT * 0.85) {
      this.spawn();
    }
  }
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
