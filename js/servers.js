/** Server Selection & Demo Economy Engine */

export const DEMO_BALANCE_KEY = "scuta_demo_balance";
export const SERVER_PREF_KEY = "scuta_server";
export const DEFAULT_DEMO_BALANCE = 500;
export const PLATFORM_FEE_RATE = 0.1;
export const DEMO_TOP_UP_AMOUNT = 100;

/**
 * Approved server tier specs + presentation metadata for Liquidity Pools UI.
 * Net liquidity = buyIn × maxCapacity × 0.90 (platform fee reserved).
 * coin: neon food-sprite id (S1=ADA … S10=BTC).
 */
export const SERVERS = Object.freeze([
  Object.freeze({
    id: "S1", code: "S1", tier: "Micro", arena: "MICRO ARENA", poolClass: "LOW-CAP POOL",
    buyIn: 1, maxCapacity: 500, netLiquidity: 450, accent: "#3d7cff", coin: "ada", winsGoal: 10,
  }),
  Object.freeze({
    id: "S2", code: "S2", tier: "Starter", arena: "STARTER ARENA", poolClass: "ENTRY POOL",
    buyIn: 2.5, maxCapacity: 450, netLiquidity: 1012.5, accent: "#f5c518", coin: "doge", winsGoal: 12,
  }),
  Object.freeze({
    id: "S3", code: "S3", tier: "Bronze", arena: "BRONZE ARENA", poolClass: "LOW-CAP POOL",
    buyIn: 5, maxCapacity: 400, netLiquidity: 1800, accent: "#ff3b4a", coin: "trx", winsGoal: 15,
  }),
  Object.freeze({
    id: "S4", code: "S4", tier: "Silver", arena: "SILVER ARENA", poolClass: "MID-CAP POOL",
    buyIn: 10, maxCapacity: 350, netLiquidity: 3150, accent: "#14f195", coin: "sol", winsGoal: 18,
  }),
  Object.freeze({
    id: "S5", code: "S5", tier: "Gold", arena: "GOLD ARENA", poolClass: "MID-CAP POOL",
    buyIn: 20, maxCapacity: 300, netLiquidity: 5400, accent: "#2775ca", coin: "usdc", winsGoal: 20,
  }),
  Object.freeze({
    id: "S6", code: "S6", tier: "Platinum", arena: "PLATINUM ARENA", poolClass: "HIGH-CAP POOL",
    buyIn: 35, maxCapacity: 250, netLiquidity: 7875, accent: "#9ad7ff", coin: "xrp", winsGoal: 22,
  }),
  Object.freeze({
    id: "S7", code: "S7", tier: "Diamond", arena: "DIAMOND ARENA", poolClass: "HIGH-CAP POOL",
    buyIn: 50, maxCapacity: 200, netLiquidity: 9000, accent: "#f3ba2f", coin: "bnb", winsGoal: 25,
  }),
  Object.freeze({
    id: "S8", code: "S8", tier: "Master", arena: "MASTER ARENA", poolClass: "ELITE POOL",
    buyIn: 65, maxCapacity: 150, netLiquidity: 8775, accent: "#26a17b", coin: "usdt", winsGoal: 28,
  }),
  Object.freeze({
    id: "S9", code: "S9", tier: "Grandmaster", arena: "GRANDMASTER ARENA", poolClass: "ELITE POOL",
    buyIn: 80, maxCapacity: 120, netLiquidity: 8640, accent: "#a78bfa", coin: "eth", winsGoal: 30,
  }),
  Object.freeze({
    id: "S10", code: "S10", tier: "Apex VIP", arena: "APEX VIP", poolClass: "VIP POOL",
    buyIn: 100, maxCapacity: 100, netLiquidity: 9000, accent: "#f7931a", coin: "btc", winsGoal: 35,
  }),
]);

/** @type {{ serverId: string, buyIn: number, startingValue: number, joinedAt: number } | null} */
let activeSession = null;

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function formatMoney(amount) {
  const n = roundMoney(amount);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function getDemoBalance() {
  const raw = localStorage.getItem(DEMO_BALANCE_KEY);
  if (raw == null || raw === "") {
    updateDemoBalance(DEFAULT_DEMO_BALANCE);
    return DEFAULT_DEMO_BALANCE;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    updateDemoBalance(DEFAULT_DEMO_BALANCE);
    return DEFAULT_DEMO_BALANCE;
  }
  return roundMoney(parsed);
}

export function updateDemoBalance(newAmount) {
  const next = roundMoney(Math.max(0, Number(newAmount) || 0));
  localStorage.setItem(DEMO_BALANCE_KEY, String(next));
  return next;
}

export function resetDemoBalance() {
  return updateDemoBalance(DEFAULT_DEMO_BALANCE);
}

export function topUpDemoBalance(amount = DEMO_TOP_UP_AMOUNT) {
  return updateDemoBalance(getDemoBalance() + amount);
}

export function getServerById(id) {
  return SERVERS.find((s) => s.id === id) || null;
}

export function getServerIndex(id) {
  const i = SERVERS.findIndex((s) => s.id === id);
  return i >= 0 ? i : 0;
}

export function getPreferredServerId() {
  const saved = localStorage.getItem(SERVER_PREF_KEY);
  if (saved && getServerById(saved)) return saved;
  return SERVERS[0].id;
}

export function setPreferredServerId(id) {
  if (getServerById(id)) localStorage.setItem(SERVER_PREF_KEY, id);
}

export function getServerSession() {
  return activeSession;
}

export function clearServerSession() {
  activeSession = null;
}

export function getSessionServer() {
  if (!activeSession) return null;
  return getServerById(activeSession.serverId);
}

/** Stable-enough simulated online count (updates ~each minute). */
export function getSimulatedOnline(server) {
  const minute = Math.floor(Date.now() / 60000);
  let h = 2166136261;
  const key = `${server.id}:${minute}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = (h >>> 0) / 0xffffffff;
  const fill = 0.42 + u * 0.52;
  return Math.max(1, Math.min(server.maxCapacity, Math.floor(server.maxCapacity * fill)));
}

/** Demo wins progress toward a tier goal (stable per day). */
export function getWinsProgress(server) {
  const day = Math.floor(Date.now() / 86400000);
  let h = 2166136261;
  const key = `wins:${server.id}:${day}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const goal = server.winsGoal || 20;
  const wins = Math.floor(((h >>> 0) / 0xffffffff) * goal * 0.85);
  return { wins, goal };
}

export function calcStartingValue(buyIn) {
  return roundMoney(buyIn * (1 - PLATFORM_FEE_RATE));
}

export function canAffordServer(serverId) {
  const server = getServerById(serverId);
  if (!server) return false;
  if (activeSession?.serverId === server.id) return true;
  const balance = getDemoBalance();
  const refund = activeSession ? activeSession.buyIn : 0;
  return roundMoney(balance + refund) >= server.buyIn;
}

/**
 * Attempt to join / switch to a server.
 * Deducts buy-in (refunds prior session buy-in when switching tiers).
 */
export function selectServer(serverId) {
  const server = getServerById(serverId);
  if (!server) return { ok: false, reason: "not_found" };

  if (activeSession?.serverId === server.id) {
    setPreferredServerId(server.id);
    return { ok: true, server, session: activeSession, alreadyJoined: true };
  }

  const balance = getDemoBalance();
  const refund = activeSession ? activeSession.buyIn : 0;
  const available = roundMoney(balance + refund);

  if (available < server.buyIn) {
    return {
      ok: false,
      reason: "insufficient_funds",
      server,
      balance,
      shortfall: roundMoney(server.buyIn - available),
    };
  }

  const nextBalance = updateDemoBalance(available - server.buyIn);
  const startingValue = calcStartingValue(server.buyIn);
  activeSession = {
    serverId: server.id,
    buyIn: server.buyIn,
    startingValue,
    joinedAt: Date.now(),
  };
  setPreferredServerId(server.id);

  return { ok: true, server, session: activeSession, balance: nextBalance };
}

export function serverDisplayName(server) {
  return `${server.code} — ${server.tier}`;
}

export function serverShortLabel(server) {
  return `${server.tier.toUpperCase()} ${server.code}`;
}

export function tierBadge(server) {
  return `TIER ${server.code} • ${server.poolClass}`;
}

/** Neon food-coin sprite for a server tier (S1=ADA … S10=BTC). */
export function poolCoinUrl(server) {
  const id = server?.coin || "ada";
  return `assets/food/neon/${id}.png`;
}

export function poolIconSvg(server, size = 64) {
  const id = server?.coin || "ada";
  const label = id.toUpperCase();
  return `<img class="pool-coin-icon" src="${poolCoinUrl(server)}" width="${size}" height="${size}" alt="${label}" draggable="false" />`;
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
