/** Neon coin body skins — coin ids map to assets/food/neon/{id}.png */

/** Lobby logo order (tail → head). */
export const MARKET_COINS = [
  "ada",
  "doge",
  "trx",
  "sol",
  "usdc",
  "xrp",
  "bnb",
  "usdt",
  "eth",
  "btc",
];

/** Accent colors for boost glow / trail particles (not body fill). */
export const COIN_ACCENTS = {
  btc: "#f7931a",
  eth: "#627eea",
  usdt: "#26a17b",
  bnb: "#f3ba2f",
  usdc: "#2775ca",
  xrp: "#00aae4",

  sol: "#9945ff",
  trx: "#ff0013",
  doge: "#c2a633",
  ada: "#0033ad",
};

function accentsFor(coins) {
  return coins.map((id) => COIN_ACCENTS[id] || "#b8c4d8");
}

/**
 * @param {{
 *   style?: "coin" | "circuit" | "blockweave" | "pulse" | "prism" | "ember" | "strike",
 *   colors?: string[]
 * }} [opts]
 */
function skin(name, coins, opts = {}) {
  const colors = opts.colors || accentsFor(coins);
  return { name, coins, colors, style: opts.style || "coin" };
}

/** Glossy glass circuit tube mascot — continuous body, no coins. */
export const CIRCUIT_ACCENT = "#5dffc8";

/** Procedural shape skins — no coin sprites; each has its own silhouette. */
export const BLOCKWEAVE_ACCENT = "#e8b84a";
export const PULSE_ACCENT = "#2ef0ff";
export const PRISM_ACCENT = "#c45cff";
export const EMBER_ACCENT = "#ff6a2a";
export const STRIKE_ACCENT = "#ff3d7a";

export const SKINS = [
  skin("market", MARKET_COINS),
  skin("Circuit", [], { style: "circuit", colors: [CIRCUIT_ACCENT] }),
  skin("Blockweave", [], { style: "blockweave", colors: [BLOCKWEAVE_ACCENT] }),
  skin("Pulse", [], { style: "pulse", colors: [PULSE_ACCENT] }),
  skin("Prism", [], { style: "prism", colors: [PRISM_ACCENT] }),
  skin("Ember", [], { style: "ember", colors: [EMBER_ACCENT] }),
  skin("Strike", [], { style: "strike", colors: [STRIKE_ACCENT] }),
  skin("Bitcoin", ["btc"]),
  skin("Ethereum", ["eth"]),
  skin("Tether", ["usdt"]),
  skin("BNB", ["bnb"]),
  skin("USD Coin", ["usdc"]),
  skin("XRP", ["xrp"]),
  skin("Solana", ["sol"]),
  skin("TRON", ["trx"]),
  skin("Dogecoin", ["doge"]),
  skin("Cardano", ["ada"]),
  skin("stables", ["usdt", "usdc"]),
  skin("L1s", ["btc", "eth", "sol", "ada"]),
  skin("majors", ["btc", "eth", "bnb", "sol"]),
];

export const BOT_NAMES = [
  "Viper", "Nova", "Blaze", "Echo", "Pixel", "Surge", "Orbit", "Drift",
  "Nexus", "Flux", "Rune", "Spark", "Ghost", "Comet", "Apex", "Bolt",
  "Shade", "Wave", "Frost", "Ember", "Karma", "Zephyr", "Quill", "Vortex",
  "Scuta", "Ivy", "Moss", "Jade", "Ruby", "Onyx", "Silk", "Arc",
];

export function randomSkin() {
  return SKINS[Math.floor(Math.random() * SKINS.length)];
}

/** Full market mix — matches lobby logo snake */
export function defaultPlayerSkin() {
  return SKINS[0];
}

export function skinByName(name) {
  return SKINS.find((s) => s.name === name) || defaultPlayerSkin();
}

export function foodColor() {
  // Saturated neon hues for pellets
  const hues = [0, 18, 35, 50, 95, 140, 175, 200, 260, 300, 330];
  const h = hues[Math.floor(Math.random() * hues.length)];
  return { h, s: 90 + Math.random() * 10, l: 52 + Math.random() * 12 };
}
