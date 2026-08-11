/**
 * Map food = logo-free neon arcade orbs.
 * Death loot = neon circuit coins (with logos) so kill drops stay distinct.
 */
export const FOOD_DESIGN = /** @type {"orb" | "neon" | "disc"} */ ("orb");

/** Top-10 crypto coins used as arena food pellets. */
export const FOOD_COINS = [
  { id: "btc", label: "Bitcoin" },
  { id: "eth", label: "Ethereum" },
  { id: "usdt", label: "Tether" },
  { id: "bnb", label: "BNB" },
  { id: "usdc", label: "USD Coin" },
  { id: "xrp", label: "XRP" },
  { id: "sol", label: "Solana" },
  { id: "trx", label: "TRON" },
  { id: "doge", label: "Dogecoin" },
  { id: "ada", label: "Cardano" },
];

/** @typedef {"map" | "death" | "trail"} FoodKind */

function mapSpriteUrl(id) {
  if (FOOD_DESIGN === "disc") return `assets/food/disc/${id}.png`;
  if (FOOD_DESIGN === "neon") return `assets/food/neon/${id}.png`;
  return `assets/food/orb/${id}.png`;
}

/** Kill drops use branded neon circuit coins. */
function deathSpriteUrl(id) {
  return `assets/food/neon/${id}.png`;
}

export const MAP_SPRITE_URLS = FOOD_COINS.map((c) => mapSpriteUrl(c.id));
export const DEATH_SPRITE_URLS = FOOD_COINS.map((c) => deathSpriteUrl(c.id));

/** @deprecated use MAP_SPRITE_URLS */
export const FOOD_SPRITE_URLS = MAP_SPRITE_URLS;

const mapImages = MAP_SPRITE_URLS.map(() => null);
const deathImages = DEATH_SPRITE_URLS.map(() => null);
let ready = false;
let loadPromise = null;

function loadSet(urls, bucket) {
  return Promise.all(
    urls.map(
      (url, i) =>
        new Promise((resolve) => {
          const img = new Image();
          img.decoding = "async";
          img.onload = () => {
            bucket[i] = img;
            resolve();
          };
          img.onerror = () => {
            console.warn("Failed to load food sprite", url);
            resolve();
          };
          img.src = url;
        })
    )
  );
}

export function loadFoodSprites() {
  if (loadPromise) return loadPromise;
  loadPromise = Promise.all([
    loadSet(MAP_SPRITE_URLS, mapImages),
    loadSet(DEATH_SPRITE_URLS, deathImages),
  ]).then(() => {
    ready = mapImages.some(Boolean) || deathImages.some(Boolean);
    return ready;
  });
  return loadPromise;
}

export function foodSpritesReady() {
  return ready;
}

export function randomFoodSprite() {
  return Math.floor(Math.random() * FOOD_COINS.length);
}

/**
 * @param {number} index
 * @param {FoodKind} [kind="map"]
 */
export function getFoodSprite(index, kind = "map") {
  if (!ready) return null;
  const bucket = kind === "death" ? deathImages : mapImages;
  if (!bucket.length) return null;
  const i = ((index % bucket.length) + bucket.length) % bucket.length;
  return bucket[i] || mapImages[i] || deathImages[i] || null;
}

export function getFoodCoin(index) {
  const i = ((index % FOOD_COINS.length) + FOOD_COINS.length) % FOOD_COINS.length;
  return FOOD_COINS[i];
}

const COIN_INDEX = Object.fromEntries(FOOD_COINS.map((c, i) => [c.id, i]));

/** Neon branded coin sprite by id (btc, eth, …) — used for snake body skins. */
export function getCoinSprite(id) {
  const index = COIN_INDEX[id];
  if (index == null) return null;
  return getFoodSprite(index, "death");
}

export function neonCoinUrl(id) {
  return deathSpriteUrl(id);
}
