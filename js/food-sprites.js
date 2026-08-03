/** Food pellet visual design. */
export const FOOD_DESIGN = /** @type {"neon" | "fruit" | "disc"} */ ("neon");

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

function spriteUrl(id) {
  if (FOOD_DESIGN === "disc") return `assets/food/disc/${id}.png`;
  if (FOOD_DESIGN === "fruit") return `assets/food/fruit/${id}.png`;
  return `assets/food/neon/${id}.png`;
}

export const FOOD_SPRITE_URLS = FOOD_COINS.map((c) => spriteUrl(c.id));

const images = FOOD_SPRITE_URLS.map(() => null);
let ready = false;
let loadPromise = null;

export function loadFoodSprites() {
  if (loadPromise) return loadPromise;
  loadPromise = Promise.all(
    FOOD_SPRITE_URLS.map(
      (url, i) =>
        new Promise((resolve) => {
          const img = new Image();
          img.decoding = "async";
          img.onload = () => {
            images[i] = img;
            resolve();
          };
          img.onerror = () => {
            console.warn("Failed to load food sprite", url);
            resolve();
          };
          img.src = url;
        })
    )
  ).then(() => {
    ready = images.some(Boolean);
    return ready;
  });
  return loadPromise;
}

export function foodSpritesReady() {
  return ready;
}

export function randomFoodSprite() {
  return Math.floor(Math.random() * FOOD_SPRITE_URLS.length);
}

export function getFoodSprite(index) {
  if (!ready) return null;
  const i = ((index % images.length) + images.length) % images.length;
  return images[i];
}

export function getFoodCoin(index) {
  const i = ((index % FOOD_COINS.length) + FOOD_COINS.length) % FOOD_COINS.length;
  return FOOD_COINS[i];
}
