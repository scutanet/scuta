/** Round economy — every monetary / cash-out number lives here. */

export const PLATFORM_CUT = 0.10;
export const BIRTH_SHARE = 0.30;
export const MAP_SHARE = 0.70;

export const RING_SHARES = Object.freeze({
  outer: 0.20,
  middle: 0.30,
  center: 0.50,
});

/** Distance from arena center as a fraction of WORLD_RADIUS. */
export const RING_BOUNDS = Object.freeze({
  outer: Object.freeze([0.66, 1.0]),
  middle: Object.freeze([0.33, 0.66]),
  center: Object.freeze([0.0, 0.33]),
});

export const CASHOUT_ZONES = 4;
/** Zone centers sit this fraction of WORLD_RADIUS from the arena origin. */
export const CASHOUT_RADIUS_RATIO = 0.8;
/** Zone radius as a fraction of WORLD_RADIUS. */
export const CASHOUT_ZONE_RADIUS_RATIO = 0.12;
export const CASHOUT_ANGLES = Object.freeze([0, 90, 180, 270]);
export const CASHOUT_DWELL_MS = 5000;

/** Bots seek cash-out when carriedValue ≥ perSnakeBirth × this multiplier. */
export const BOT_CASHOUT_MULT = 3;

/** Allowed invariant drift before logging an error ($). */
export const INVARIANT_TOLERANCE = 0.01;

export function toCents(amount) {
  return Math.round(Number(amount) * 100);
}

export function fromCents(cents) {
  return cents / 100;
}

/**
 * Split `totalCents` across `count` parts with remainder distributed
 * so the parts sum exactly to totalCents.
 * @returns {number[]} dollar amounts
 */
export function splitCents(totalCents, count) {
  if (count <= 0) return [];
  const base = Math.floor(totalCents / count);
  const rem = totalCents - base * count;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = fromCents(base + (i < rem ? 1 : 0));
  }
  return out;
}

/**
 * @param {number} buyIn - tier buy-in (dollars)
 * @param {number} playerCount - tier maxCapacity (snakes in the round)
 */
export function computeRoundEconomy(buyIn, playerCount) {
  const n = Math.max(1, Math.floor(Number(playerCount) || 0));
  const buyInCents = toCents(buyIn);
  const grossCents = buyInCents * n;
  const platformCutCents = Math.round(grossCents * PLATFORM_CUT);
  const roundLiquidityCents = grossCents - platformCutCents;
  const birthPoolCents = Math.round(roundLiquidityCents * BIRTH_SHARE);
  const mapBudgetCents = roundLiquidityCents - birthPoolCents;

  const outerCents = Math.round(mapBudgetCents * RING_SHARES.outer);
  const middleCents = Math.round(mapBudgetCents * RING_SHARES.middle);
  const centerCents = mapBudgetCents - outerCents - middleCents;

  return {
    buyIn: fromCents(buyInCents),
    playerCount: n,
    gross: fromCents(grossCents),
    platformCut: fromCents(platformCutCents),
    roundLiquidity: fromCents(roundLiquidityCents),
    birthPool: fromCents(birthPoolCents),
    perSnakeBirth: fromCents(birthPoolCents) / n,
    mapBudget: fromCents(mapBudgetCents),
    ringBudgets: {
      outer: fromCents(outerCents),
      middle: fromCents(middleCents),
      center: fromCents(centerCents),
    },
    // Integer cents mirrors for exact accounting / tests
    _cents: {
      gross: grossCents,
      platformCut: platformCutCents,
      roundLiquidity: roundLiquidityCents,
      birthPool: birthPoolCents,
      mapBudget: mapBudgetCents,
      ringBudgets: {
        outer: outerCents,
        middle: middleCents,
        center: centerCents,
      },
    },
  };
}

/**
 * Cash-out zone circles derived from WORLD_RADIUS and the ratios above.
 * @param {number} worldRadius
 * @returns {{ x: number, y: number, radius: number }[]}
 */
export function computeCashOutZones(worldRadius) {
  const dist = worldRadius * CASHOUT_RADIUS_RATIO;
  const radius = worldRadius * CASHOUT_ZONE_RADIUS_RATIO;
  const zones = [];
  for (let i = 0; i < CASHOUT_ZONES; i++) {
    const deg = CASHOUT_ANGLES[i] ?? (i * (360 / CASHOUT_ZONES));
    const rad = (deg * Math.PI) / 180;
    zones.push({
      x: Math.cos(rad) * dist,
      y: Math.sin(rad) * dist,
      radius,
    });
  }
  return zones;
}

export function pointInCashOutZone(x, y, zones) {
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    const dx = x - z.x;
    const dy = y - z.y;
    if (dx * dx + dy * dy <= z.radius * z.radius) return z;
  }
  return null;
}

export function nearestCashOutZone(x, y, zones) {
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    const d = Math.hypot(x - z.x, y - z.y);
    if (d < bestD) {
      bestD = d;
      best = z;
    }
  }
  return best;
}
