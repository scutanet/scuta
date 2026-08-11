export const WORLD_RADIUS = 5000;
export const FOOD_COUNT = 8800;
export const BOT_COUNT = 28;
export const BASE_SPEED = 2.6;
export const BOOST_SPEED = 4.8;
export const TURN_RATE = 0.085;
/** Bots move/turn slower than the player so they are easier to cut off */
export const BOT_SPEED_MUL = 0.72;
export const BOT_TURN_MUL = 0.65;
/** Dense overlap so thick coin discs blend into a continuous body. */
export const SEGMENT_SPACING = 5;
export const START_LENGTH = 12;
export const FOOD_VALUE = 1;
export const BOOST_COST_INTERVAL = 16; // frames between mass loss / pellet drop while boosting
export const MAX_FOOD = 12800;
/** How far food starts getting sucked toward a snake's head */
export const FOOD_MAGNET_RANGE = 5.5; // × snake radius, plus FOOD_MAGNET_BASE
export const FOOD_MAGNET_BASE = 26;
/** Base pull speed (world units / frame) at point-blank; falls off with distance */
export const FOOD_MAGNET_PULL = 2.8;

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function dist(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.hypot(dx, dy);
}

export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function randRange(min, max) {
  return min + Math.random() * (max - min);
}

export function randInt(min, max) {
  return Math.floor(randRange(min, max + 1));
}

export function randomInCircle(radius, margin = 80) {
  const r = Math.sqrt(Math.random()) * (radius - margin);
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

export function hsl(h, s, l, a = 1) {
  return a < 1 ? `hsla(${h}, ${s}%, ${l}%, ${a})` : `hsl(${h}, ${s}%, ${l}%)`;
}

export function shadeColor(hex, amount) {
  const n = hex.replace("#", "");
  const num = parseInt(n.length === 3 ? n.split("").map((c) => c + c).join("") : n, 16);
  let r = (num >> 16) + amount;
  let g = ((num >> 8) & 0xff) + amount;
  let b = (num & 0xff) + amount;
  r = clamp(r, 0, 255);
  g = clamp(g, 0, 255);
  b = clamp(b, 0, 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
