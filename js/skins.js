/** Classic Slither.io-style striped skins */
export const SKINS = [
  { name: "zebra", colors: ["#1a1a1a", "#f2f2f2"] },
  { name: "green", colors: ["#3dff7a", "#1db954"] },
  { name: "blue", colors: ["#4aa8ff", "#1e6fd6"] },
  { name: "orange", colors: ["#ffb03a", "#e67e00"] },
  { name: "pink", colors: ["#ff6eb4", "#e91e8c"] },
  { name: "purple", colors: ["#b57bff", "#7c3aed"] },
  { name: "red", colors: ["#ff4d4d", "#c62828"] },
  { name: "cyan", colors: ["#4ef0ff", "#00b8d4"] },
  { name: "yellow", colors: ["#ffe14a", "#f0b400"] },
  { name: "white", colors: ["#ffffff", "#c5c9ce"] },
  { name: "rainbow", colors: ["#ff4d4d", "#ff9f1a", "#ffe14a", "#3dff7a", "#4aa8ff", "#b57bff"] },
  { name: "magma", colors: ["#ff3d00", "#ff9100", "#ff3d00"] },
  { name: "ocean", colors: ["#00bcd4", "#1565c0", "#00bcd4"] },
  { name: "lime", colors: ["#c6ff00", "#76ff03"] },
  { name: "hot", colors: ["#ff1744", "#ff80ab", "#ff1744"] },
  { name: "mint", colors: ["#69f0ae", "#1de9b6"] },
  { name: "gold", colors: ["#ffd54f", "#ff8f00"] },
  { name: "slate", colors: ["#90a4ae", "#455a64"] },
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

/** Classic black/white striped starter like Slither's default */
export function defaultPlayerSkin() {
  return SKINS[0];
}

export function foodColor() {
  // Saturated neon hues like Slither pellets
  const hues = [0, 18, 35, 50, 95, 140, 175, 200, 260, 300, 330];
  const h = hues[Math.floor(Math.random() * hues.length)];
  return { h, s: 90 + Math.random() * 10, l: 52 + Math.random() * 12 };
}
