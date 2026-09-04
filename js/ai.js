import { WORLD_RADIUS, angleDiff, dist, randRange, randomInCircle } from "./utils.js";
import { nearestCashOutZone } from "./economy.js";

/**
 * Lightweight arena bot: seek food, avoid larger snakes, chase smaller ones.
 * When carriedValue crosses the cash-out threshold, head for the nearest zone.
 */
export function updateBotAI(bot, snakes, food, opts = {}) {
  if (!bot.alive) return;

  const zones = opts.zones || [];
  const cashThreshold = opts.cashThreshold ?? Infinity;

  bot.aiTimer--;
  const head = bot.head;

  // Cash out when rich enough
  if (zones.length && bot.carriedValue >= cashThreshold) {
    bot.aiState = "cashout";
    const zone = nearestCashOutZone(head.x, head.y, zones);
    if (zone) {
      bot.setTarget(zone.x, zone.y);
      const d = dist(head.x, head.y, zone.x, zone.y);
      // Boost toward the zone when still outside its radius
      bot.boosting = d > zone.radius * 1.15 && bot.mass > 18;
      return;
    }
  }

  // Threats & prey
  let nearestThreat = null;
  let threatDist = Infinity;
  let nearestPrey = null;
  let preyDist = Infinity;

  for (const s of snakes) {
    if (!s.alive || s === bot) continue;
    const d = dist(head.x, head.y, s.head.x, s.head.y);
    // Tight danger zone so bots only react when a kill is already close
    const dangerZone = bot.radius * 4 + s.radius * 3 + 20;
    if (d < dangerZone) {
      const bodyThreat = nearBody(bot, s, bot.radius * 2.5 + 24);
      // Only treat clearly larger snakes as threats (no peer-size panic)
      if (bodyThreat || (d < dangerZone * 0.55 && s.mass > bot.mass * 1.15)) {
        if (d < threatDist) {
          threatDist = d;
          nearestThreat = s;
        }
      }
    }
    if (s.mass < bot.mass * 0.75 && d < 500 && d < preyDist) {
      preyDist = d;
      nearestPrey = s;
    }
  }

  // Boundary avoid
  const fromCenter = Math.hypot(head.x, head.y);
  if (fromCenter > WORLD_RADIUS * 0.82) {
    bot.targetAngle = Math.atan2(-head.y, -head.x) + randRange(-0.4, 0.4);
    bot.boosting = false;
    return;
  }

  if (nearestThreat) {
    bot.aiState = "flee";
    const th = nearestThreat.head;
    // Mild turn away — no boost and little jitter so players can cut them off
    const away = Math.atan2(head.y - th.y, head.x - th.x);
    bot.targetAngle = away + randRange(-0.15, 0.15);
    bot.boosting = false;
    bot.aiTimer = 12;
    return;
  }

  if (nearestPrey && preyDist < 380) {
    bot.aiState = "hunt";
    // Mild lead; no boost so chase stays predictable
    const lead = nearestPrey.boosting ? 24 : 12;
    const tx = nearestPrey.head.x + Math.cos(nearestPrey.angle) * lead;
    const ty = nearestPrey.head.y + Math.sin(nearestPrey.angle) * lead;
    bot.setTarget(tx, ty);
    bot.boosting = false;
    return;
  }

  // Seek food
  if (bot.aiTimer <= 0 || !bot.wantedFood || !foodStillExists(bot.wantedFood, food)) {
    bot.wantedFood = findBestFood(bot, food);
    bot.aiTimer = 25 + Math.floor(Math.random() * 40);
    bot.aiState = "feed";
  }

  if (bot.wantedFood) {
    bot.setTarget(bot.wantedFood.x, bot.wantedFood.y);
    bot.boosting = false;
  } else {
    // Wander
    if (bot.aiTimer <= 0) {
      const p = randomInCircle(WORLD_RADIUS * 0.6);
      bot.setTarget(p.x, p.y);
      bot.aiTimer = 60;
    }
    bot.boosting = false;
  }

  // Random micro-adjust
  if (Math.random() < 0.02) {
    bot.targetAngle += randRange(-0.3, 0.3);
  }
}

function nearBody(bot, other, range) {
  const h = bot.head;
  const step = Math.max(1, Math.floor(other.segments.length / 25));
  for (let i = 0; i < other.segments.length; i += step) {
    if (dist(h.x, h.y, other.segments[i].x, other.segments[i].y) < range) return true;
  }
  return false;
}

function foodStillExists(wanted, food) {
  return food.items.includes(wanted);
}

function findBestFood(bot, food) {
  const h = bot.head;
  let best = null;
  let bestScore = -Infinity;
  // Sample subset for performance
  const items = food.items;
  const n = items.length;
  const samples = Math.min(120, n);
  const stride = Math.max(1, Math.floor(n / samples));
  const start = Math.floor(Math.random() * stride);

  for (let i = start; i < n; i += stride) {
    const f = items[i];
    const d = dist(h.x, h.y, f.x, f.y);
    if (d > 700) continue;
    // Prefer food roughly ahead; weight monetary value
    const ang = Math.atan2(f.y - h.y, f.x - h.x);
    const align = Math.cos(angleDiff(bot.angle, ang));
    const score = (f.value || 0) * 80 + (f.massGain || 1) * 4 + f.radius * 2 - d * 0.04 + align * 30;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}
