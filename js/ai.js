import { WORLD_RADIUS, angleDiff, dist, randRange, randomInCircle } from "./utils.js";

/**
 * Lightweight Slither-like bot: seek food, avoid larger snakes, chase smaller ones.
 */
export function updateBotAI(bot, snakes, food) {
  if (!bot.alive) return;

  bot.aiTimer--;
  const head = bot.head;

  // Threats & prey
  let nearestThreat = null;
  let threatDist = Infinity;
  let nearestPrey = null;
  let preyDist = Infinity;

  for (const s of snakes) {
    if (!s.alive || s === bot) continue;
    const d = dist(head.x, head.y, s.head.x, s.head.y);
    const dangerZone = bot.radius * 8 + s.radius * 6 + 40;
    if (d < dangerZone) {
      // Check if we're near their body
      const bodyThreat = nearBody(bot, s, bot.radius * 5 + 50);
      if (bodyThreat || (d < dangerZone * 0.7 && s.mass > bot.mass * 0.8)) {
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
    bot.boosting = fromCenter > WORLD_RADIUS * 0.9;
    return;
  }

  if (nearestThreat) {
    bot.aiState = "flee";
    const th = nearestThreat.head;
    // Flee away from threat head / closest body
    const away = Math.atan2(head.y - th.y, head.x - th.x);
    bot.targetAngle = away + randRange(-0.5, 0.5);
    bot.boosting = threatDist < bot.radius * 10 + 80 && bot.mass > 20;
    bot.aiTimer = 20;
    return;
  }

  if (nearestPrey && preyDist < 380) {
    bot.aiState = "hunt";
    // Try to cut them off slightly
    const lead = nearestPrey.boosting ? 40 : 20;
    const tx = nearestPrey.head.x + Math.cos(nearestPrey.angle) * lead;
    const ty = nearestPrey.head.y + Math.sin(nearestPrey.angle) * lead;
    bot.setTarget(tx, ty);
    bot.boosting = preyDist < 180 && bot.mass > 25;
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
    // Prefer food roughly ahead
    const ang = Math.atan2(f.y - h.y, f.x - h.x);
    const align = Math.cos(angleDiff(bot.angle, ang));
    const score = f.value * 8 + f.radius * 2 - d * 0.04 + align * 30;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}
