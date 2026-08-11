import {
  BASE_SPEED,
  BOOST_COST_INTERVAL,
  BOOST_SPEED,
  BOT_SPEED_MUL,
  BOT_TURN_MUL,
  FOOD_MAGNET_BASE,
  FOOD_MAGNET_PULL,
  FOOD_MAGNET_RANGE,
  SEGMENT_SPACING,
  START_LENGTH,
  TURN_RATE,
  WORLD_RADIUS,
  angleDiff,
  clamp,
  dist,
  randomInCircle,
} from "./utils.js";
import { randomSkin } from "./skins.js";

let nextId = 1;

export class Snake {
  constructor({ name, x, y, isPlayer = false, skin = null }) {
    this.id = nextId++;
    this.name = name || "snake";
    this.isPlayer = isPlayer;
    this.skin = skin || randomSkin();
    this.alive = true;
    this.angle = Math.random() * Math.PI * 2;
    this.targetAngle = this.angle;
    this.boosting = false;
    this.boostTimer = 0;
    this.mass = START_LENGTH;
    this.radius = 10;
    this.wantedFood = null;
    this.aiState = "wander";
    this.aiTimer = 0;
    this.prevHeadX = null;
    this.prevHeadY = null;

    const start = x != null ? { x, y } : randomInCircle(WORLD_RADIUS * 0.7);
    this.segments = [];
    for (let i = 0; i < START_LENGTH; i++) {
      this.segments.push({
        x: start.x - Math.cos(this.angle) * i * SEGMENT_SPACING,
        y: start.y - Math.sin(this.angle) * i * SEGMENT_SPACING,
      });
    }
    this._updateRadius();
  }

  get length() {
    return Math.floor(this.mass);
  }

  get head() {
    return this.segments[0];
  }

  _updateRadius() {
    // Slightly plumper than classic Slither so neon coins read as a solid body
    this.radius = clamp(10 + Math.sqrt(Math.max(0, this.mass - START_LENGTH)) * 0.62, 10, 46);
  }

  setTarget(wx, wy) {
    const h = this.head;
    this.targetAngle = Math.atan2(wy - h.y, wx - h.x);
  }

  grow(amount) {
    this.mass += amount;
    const needed = Math.floor(this.mass);
    while (this.segments.length < needed) {
      const tail = this.segments[this.segments.length - 1];
      this.segments.push({ x: tail.x, y: tail.y });
    }
    this._updateRadius();
  }

  shrink(amount) {
    this.mass = Math.max(START_LENGTH * 0.6, this.mass - amount);
    const needed = Math.max(START_LENGTH, Math.floor(this.mass));
    if (this.segments.length > needed) this.segments.length = needed;
    this._updateRadius();
  }

  update(dtFrames = 1) {
    if (!this.alive) return { droppedFood: false };

    const head = this.segments[0];
    this.prevHeadX = head.x;
    this.prevHeadY = head.y;

    const speedMul = this.isPlayer ? 1 : BOT_SPEED_MUL;
    const turnMul = this.isPlayer ? 1 : BOT_TURN_MUL;

    const diff = angleDiff(this.angle, this.targetAngle);
    const maxTurn = TURN_RATE * turnMul * (this.boosting ? 0.88 : 1) * dtFrames;
    this.angle += clamp(diff, -maxTurn, maxTurn);

    const speed = (this.boosting ? BOOST_SPEED : BASE_SPEED) * speedMul * dtFrames;
    let nx = head.x + Math.cos(this.angle) * speed;
    let ny = head.y + Math.sin(this.angle) * speed;

    // Bots steer inward near the rim; players die on contact (checked in Game)
    if (!this.isPlayer) {
      const d = Math.hypot(nx, ny);
      const limit = WORLD_RADIUS - this.radius;
      if (d > limit * 0.82) {
        this.targetAngle = Math.atan2(-ny, -nx) + (Math.random() - 0.5) * 0.25;
      }
    }

    this._moveBody(nx, ny);

    let droppedFood = false;
    if (this.boosting && this.mass > START_LENGTH + 2) {
      this.boostTimer += dtFrames;
      if (this.boostTimer >= BOOST_COST_INTERVAL) {
        this.boostTimer = 0;
        this.shrink(0.9);
        droppedFood = true;
      }
    } else {
      this.boostTimer = 0;
      if (this.mass <= START_LENGTH + 2) this.boosting = false;
    }

    return { droppedFood };
  }

  _moveBody(nx, ny) {
    const segs = this.segments;
    segs[0].x = nx;
    segs[0].y = ny;

    for (let i = 1; i < segs.length; i++) {
      const prev = segs[i - 1];
      const cur = segs[i];
      const dx = prev.x - cur.x;
      const dy = prev.y - cur.y;
      const d = Math.hypot(dx, dy) || 0.0001;
      if (d > SEGMENT_SPACING) {
        const t = SEGMENT_SPACING / d;
        cur.x = prev.x - dx * t;
        cur.y = prev.y - dy * t;
      }
    }
  }

  /** Pull nearby pellets toward the head (Slither-style food vacuum). */
  attractFood(foodItems) {
    const h = this.head;
    const magnetR = this.radius * FOOD_MAGNET_RANGE + FOOD_MAGNET_BASE;
    const magnetR2 = magnetR * magnetR;
    const now = performance.now();
    const pullBase = FOOD_MAGNET_PULL + this.radius * 0.12;

    for (let i = 0; i < foodItems.length; i++) {
      const f = foodItems[i];
      if (f.immuneId === this.id && now < f.immuneUntil) continue;

      const dx = h.x - f.x;
      const dy = h.y - f.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= magnetR2 || d2 < 0.25) continue;

      const d = Math.sqrt(d2);
      // Stronger as it gets closer — vacuum / magnet feel
      const t = 1 - d / magnetR;
      const pull = pullBase * t * t * (1.15 + t);
      f.x += (dx / d) * pull;
      f.y += (dy / d) * pull;
    }
  }

  collectFood(foodItems) {
    const eaten = [];
    const h = this.head;
    const eatR = this.radius + 6;
    const now = performance.now();
    for (let i = 0; i < foodItems.length; i++) {
      const f = foodItems[i];
      // Don't instantly re-absorb your own boost trail
      if (f.immuneId === this.id && now < f.immuneUntil) continue;
      if (dist(h.x, h.y, f.x, f.y) < eatR + f.radius) {
        eaten.push(i);
        this.grow(f.value * 0.55);
      }
    }
    return eaten;
  }

  hitsSnake(other) {
    if (!other.alive || other === this) return false;

    const h = this.head;
    // Match visible body size (segments are drawn at full radius)
    const hitR = this.radius * 0.88 + other.radius * 0.88;
    const hitR2 = hitR * hitR;
    const segs = other.segments;

    // Skip only their head tip so two heads brushing doesn't always double-kill
    const start = 2;
    // Never leave sample gaps larger than ~hit radius
    const step = Math.max(1, Math.floor((hitR * 0.85) / SEGMENT_SPACING));

    for (let i = start; i < segs.length; i += step) {
      const s = segs[i];
      const dx = h.x - s.x;
      const dy = h.y - s.y;
      if (dx * dx + dy * dy < hitR2) return true;
    }
    // Ensure tip of their tail is tested when step > 1
    if (segs.length > start) {
      const tip = segs[segs.length - 1];
      const dx = h.x - tip.x;
      const dy = h.y - tip.y;
      if (dx * dx + dy * dy < hitR2) return true;
    }

    // Swept test: catch tunneling when boosting through a body
    const px = this.prevHeadX;
    const py = this.prevHeadY;
    if (px != null) {
      const moved = (h.x - px) * (h.x - px) + (h.y - py) * (h.y - py);
      if (moved > 0.25) {
        for (let i = start; i < segs.length; i += step) {
          if (distToSegment2(segs[i].x, segs[i].y, px, py, h.x, h.y) < hitR2) {
            return true;
          }
        }
      }
    }

    return false;
  }

  die() {
    this.alive = false;
  }
}

/** Squared distance from point (px,py) to segment (ax,ay)-(bx,by). */
function distToSegment2(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  let t = ab2 > 0 ? (apx * abx + apy * aby) / ab2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + abx * t - px;
  const cy = ay + aby * t - py;
  return cx * cx + cy * cy;
}
