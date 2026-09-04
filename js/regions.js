/**
 * Regional multiplayer endpoints — shared by client and Node server.
 * NA (New York) · EU (Amsterdam) · ASIA (Singapore)
 */

export const REGION_PREF_KEY = "scuta_region";

/** @typedef {"NA" | "EU" | "ASIA"} RegionId */

/**
 * @typedef {{
 *   id: RegionId,
 *   code: RegionId,
 *   name: string,
 *   city: string,
 *   host: string,
 *   port: number,
 *   accent: string,
 * }} Region
 */

/** @type {readonly Region[]} */
export const REGIONS = Object.freeze([
  Object.freeze({
    id: "NA",
    code: "NA",
    name: "North America",
    city: "New York",
    host: "na.scuta.io",
    port: 3001,
    accent: "#3d7cff",
  }),
  Object.freeze({
    id: "EU",
    code: "EU",
    name: "Europe",
    city: "Amsterdam",
    host: "eu.scuta.io",
    port: 3002,
    accent: "#26a17b",
  }),
  Object.freeze({
    id: "ASIA",
    code: "ASIA",
    name: "Asia",
    city: "Singapore",
    host: "asia.scuta.io",
    port: 3003,
    accent: "#f7931a",
  }),
]);

/** @type {ReadonlyMap<string, Region>} */
const BY_ID = new Map(REGIONS.map((r) => [r.id, r]));

/**
 * @param {string | null | undefined} id
 * @returns {Region | null}
 */
export function getRegionById(id) {
  if (!id) return null;
  return BY_ID.get(String(id).toUpperCase()) || null;
}

/**
 * @param {string | null | undefined} raw
 * @returns {Region}
 */
export function resolveRegion(raw) {
  return getRegionById(raw) || REGIONS[0];
}

/**
 * Public health URL for a region.
 * Production: https://{host}/health (reverse-proxy → regional port).
 * Overrides (first match wins):
 *   1. window.__SCUTA_REGION_ORIGIN__ = "http://127.0.0.1"
 *   2. Page served from localhost / 127.0.0.1 → http://127.0.0.1:{port}/health
 * @param {Region} region
 */
export function regionHealthUrl(region) {
  const origin = resolveDevOrigin();
  if (origin) return `${origin}:${region.port}/health`;
  return `https://${region.host}/health`;
}

/**
 * WebSocket URL for a region.
 * @param {Region} region
 */
export function regionWsUrl(region) {
  const origin = resolveDevOrigin();
  if (origin) {
    const u = new URL(origin.includes("://") ? origin : `http://${origin}`);
    const proto = u.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${u.hostname}:${region.port}`;
  }
  return `wss://${region.host}`;
}

/** @returns {string | null} */
function resolveDevOrigin() {
  try {
    if (
      typeof globalThis !== "undefined" &&
      globalThis.__SCUTA_REGION_ORIGIN__ != null
    ) {
      return String(globalThis.__SCUTA_REGION_ORIGIN__).replace(/\/$/, "");
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof location !== "undefined") {
      const host = location.hostname;
      if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
        return "http://127.0.0.1";
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Human label for lobby / logs.
 * @param {Region} region
 */
export function regionDisplayName(region) {
  return `${region.code} — ${region.city}`;
}

/**
 * @param {string | null | undefined} fallbackId
 * @returns {RegionId}
 */
export function getPreferredRegionId(fallbackId = "NA") {
  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(REGION_PREF_KEY);
      if (saved && getRegionById(saved)) return /** @type {RegionId} */ (saved);
    }
  } catch {
    /* private mode */
  }
  const fb = getRegionById(fallbackId);
  return fb ? fb.id : REGIONS[0].id;
}

/**
 * @param {RegionId | string} id
 */
export function setPreferredRegionId(id) {
  const region = getRegionById(id);
  if (!region) return;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(REGION_PREF_KEY, region.id);
    }
  } catch {
    /* private mode */
  }
}

/**
 * Ping a region's /health endpoint. Returns measured RTT (ms) or null on failure.
 * @param {Region} region
 * @param {number} [timeoutMs]
 * @returns {Promise<{ ok: boolean, latencyMs: number | null, players: number, uptime: number, region: string | null }>}
 */
export async function pingRegion(region, timeoutMs = 4000) {
  const url = regionHealthUrl(region);
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl
    ? setTimeout(() => ctrl.abort(), timeoutMs)
    : null;
  const t0 =
    typeof performance !== "undefined" ? performance.now() : Date.now();

  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      mode: "cors",
      signal: ctrl?.signal,
    });
    const t1 =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    const latencyMs = Math.max(0, Math.round(t1 - t0));

    if (!res.ok) {
      return { ok: false, latencyMs: null, players: 0, uptime: 0, region: null };
    }

    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    return {
      ok: true,
      latencyMs,
      players: Number(body?.players) || 0,
      uptime: Number(body?.uptime) || 0,
      region: body?.region != null ? String(body.region) : region.id,
    };
  } catch {
    return { ok: false, latencyMs: null, players: 0, uptime: 0, region: null };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Ping every region in parallel.
 * @returns {Promise<Map<RegionId, Awaited<ReturnType<typeof pingRegion>>>>}
 */
export async function pingAllRegions() {
  /** @type {Map<RegionId, Awaited<ReturnType<typeof pingRegion>>>} */
  const out = new Map();
  const results = await Promise.all(
    REGIONS.map(async (r) => {
      const result = await pingRegion(r);
      return /** @type {const} */ ([r.id, result]);
    })
  );
  for (const [id, result] of results) out.set(id, result);
  return out;
}

/**
 * Pick the reachable region with the lowest measured latency.
 * Falls back to preferred / NA when none respond.
 * @param {Map<string, { ok: boolean, latencyMs: number | null }>} pingMap
 * @param {RegionId} [fallbackId]
 * @returns {Region}
 */
export function pickLowestLatencyRegion(pingMap, fallbackId = "NA") {
  let best = null;
  let bestMs = Infinity;
  for (const region of REGIONS) {
    const p = pingMap.get(region.id);
    if (!p?.ok || p.latencyMs == null) continue;
    if (p.latencyMs < bestMs) {
      bestMs = p.latencyMs;
      best = region;
    }
  }
  return best || resolveRegion(getPreferredRegionId(fallbackId));
}
