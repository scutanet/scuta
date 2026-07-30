/** Classic Slither.io-style multi-color skins */
export const SKINS = [
  { name: "green", colors: ["#4eff8a", "#2ecc71", "#1abc5c"] },
  { name: "blue", colors: ["#4eb8ff", "#3498db", "#2980b9"] },
  { name: "orange", colors: ["#ffb347", "#f39c12", "#e67e22"] },
  { name: "pink", colors: ["#ff7eb3", "#e84393", "#fd79a8"] },
  { name: "purple", colors: ["#c39bff", "#9b59b6", "#8e44ad"] },
  { name: "red", colors: ["#ff6b6b", "#e74c3c", "#c0392b"] },
  { name: "cyan", colors: ["#7ef9ff", "#00cec9", "#00b894"] },
  { name: "yellow", colors: ["#ffe566", "#f1c40f", "#f39c12"] },
  { name: "white", colors: ["#ffffff", "#dfe6e9", "#b2bec3"] },
  { name: "rainbow", colors: ["#ff6b6b", "#ffa502", "#ffe66d", "#4eff8a", "#4eb8ff", "#c39bff"] },
  { name: "magma", colors: ["#ff3d00", "#ff6d00", "#ffab00", "#ff6d00"] },
  { name: "ocean", colors: ["#00b4d8", "#0077b6", "#023e8a", "#0077b6"] },
  { name: "neon", colors: ["#39ff14", "#0affef", "#39ff14"] },
  { name: "sunset", colors: ["#ff9a8b", "#ff6a88", "#ff99ac", "#fad0c4"] },
  { name: "mint", colors: ["#a8ff78", "#78ffd6", "#a8ff78"] },
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

export function foodColor() {
  const hues = [0, 25, 45, 120, 160, 190, 220, 280, 320];
  const h = hues[Math.floor(Math.random() * hues.length)];
  return { h, s: 85 + Math.random() * 10, l: 55 + Math.random() * 15 };
}
