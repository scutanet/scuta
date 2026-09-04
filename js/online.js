/**
 * Client-side helpers for the authoritative online arena.
 * The browser never simulates physics online — only sends input and paints state.
 */

import { skinByName, defaultPlayerSkin } from "./skins.js";

/**
 * @param {import("./skins.js").SKINS[number] | string | null} skin
 */
export function serializeSkin(skin) {
  const s =
    typeof skin === "string"
      ? skinByName(skin)
      : skin && skin.name
        ? skinByName(skin.name)
        : defaultPlayerSkin();
  return {
    name: s.name,
    style: s.style || "coin",
    colors: s.colors,
    coins: s.coins,
  };
}

/**
 * Rebuild local snake/food mirrors from a server snapshot (render-only).
 * @param {import("./game.js").Game} game
 * @param {any} state
 * @param {typeof import("./snake.js").Snake} Snake
 */
export function applyServerState(game, state, Snake) {
  if (!state || state.type !== "state") return;

  if (Array.isArray(state.zones) && state.zones.length) {
    game.cashOutZones = state.zones.map((z) => ({
      x: z[0],
      y: z[1],
      radius: z[2],
    }));
  }

  const byId = new Map();
  for (const s of game.snakes) byId.set(s.id, s);

  const next = [];
  let player = null;

  for (const net of state.snakes || []) {
    let snake = byId.get(net.id);
    if (!snake) {
      snake = new Snake({
        name: net.name,
        isPlayer: Boolean(net.you),
        skin: net.skin?.name ? skinByName(net.skin.name) : defaultPlayerSkin(),
        x: net.segs?.[0]?.[0] ?? 0,
        y: net.segs?.[0]?.[1] ?? 0,
        carriedValue: net.cv || 0,
      });
      snake.id = net.id;
    }

    snake.name = net.name;
    snake.alive = true;
    snake.isPlayer = Boolean(net.you);
    snake.angle = net.angle;
    snake.targetAngle = net.angle;
    snake.boosting = Boolean(net.boost);
    snake.mass = net.mass;
    snake.radius = net.r;
    snake.carriedValue = net.cv || 0;
    snake.cashOutProgress = net.cop || 0;
    if (net.skin?.name) snake.skin = skinByName(net.skin.name);

    const segs = net.segs || [];
    if (segs.length) {
      snake.segments.length = 0;
      for (let i = 0; i < segs.length; i++) {
        snake.segments.push({ x: segs[i][0], y: segs[i][1] });
      }
      // Fill density for rendering continuity
      while (snake.segments.length < Math.max(8, Math.floor(net.mass || 12))) {
        const tip = snake.segments[snake.segments.length - 1];
        snake.segments.push({ x: tip.x, y: tip.y });
      }
    }
    snake._updateBounds?.();
    next.push(snake);
    if (net.you) player = snake;
  }

  game.snakes = next;
  game.player = player && player.alive ? player : null;

  // Food
  const kinds = ["map", "trail", "death"];
  const items = [];
  for (const f of state.food || []) {
    items.push({
      x: f[0],
      y: f[1],
      radius: f[2],
      value: f[3],
      kind: kinds[f[4]] || "map",
      sprite: f[5] | 0,
      massGain: 1,
      h: 40,
      s: 90,
      l: 55,
      brightness: 1,
      sizeMul: 1,
      pulse: 0,
      immuneId: null,
      immuneUntil: 0,
    });
  }
  game.food.items = items;
}
