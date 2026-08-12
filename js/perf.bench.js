/**
 * Headless perf harness — measures sim + render at 100 / 250 / 500 snakes
 * under progressive fix stacks so we can see which change moved the needle.
 *
 * Usage: node js/perf.bench.js
 */
import "./perf-canvas-shim.js";
import { createCanvas } from "./perf-canvas-shim.js";
import { Game } from "./game.js";
import { FoodField } from "./food.js";
import { Snake } from "./snake.js";
import { defaultPlayerSkin, randomSkin } from "./skins.js";
import { AI_STAGGER_FRAMES } from "./utils.js";
import { computeRoundEconomy, computeCashOutZones } from "./economy.js";
import { WORLD_RADIUS } from "./utils.js";

const COUNTS = [100, 250, 500];
const WARMUP = 15;
const SAMPLES = 60;

/** Progressive stacks matching the three fixes (+ stagger / trail cap). */
const STACKS = [
  {
    name: "0_baseline",
    flags: { spatial: false, cull: false, lod: false, staggerAi: false, trailCap: false },
  },
  {
    name: "1_spatial",
    flags: { spatial: true, cull: false, lod: false, staggerAi: true, trailCap: true },
  },
  {
    name: "2_spatial+cull",
    flags: { spatial: true, cull: true, lod: false, staggerAi: true, trailCap: true },
  },
  {
    name: "3_all",
    flags: { spatial: true, cull: true, lod: true, staggerAi: true, trailCap: true },
  },
];

function avg(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / Math.max(1, arr.length);
}

function maxOf(arr) {
  let m = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
}

function makeGame(capacity, flags) {
  const canvas = createCanvas(1280, 720);
  const minimap = createCanvas(180, 180);
  const game = new Game({
    canvas,
    minimap,
    onDeath() {},
    onCashOut() {},
    onHud() {},
  });

  Object.assign(game.flags, flags);
  game.snakes = [];
  game._namesUsed.clear();
  game.mode = "ai";
  game.totalCashedOut = 0;
  game.cashedOutIds = new Set();
  game._frameIndex = 0;
  game.serverSession = { serverId: "S1", buyIn: 1, startingValue: 0, joinedAt: Date.now() };
  game.server = { id: "S1", buyIn: 1, maxCapacity: capacity };
  game.capacity = capacity;
  game.economy = computeRoundEconomy(1, capacity);
  game.cashOutZones = computeCashOutZones(WORLD_RADIUS);
  game.food = new FoodField(game.economy);

  const birth = game.economy.perSnakeBirth;
  game.player = new Snake({
    name: "Bench",
    isPlayer: true,
    skin: defaultPlayerSkin(),
    carriedValue: birth,
    x: 0,
    y: 0,
  });
  game.snakes.push(game.player);

  const botTarget = capacity - 1;
  for (let i = 0; i < botTarget; i++) {
    const bot = game._spawnBot(birth, i, botTarget);
    bot.aiPhase = i % AI_STAGGER_FRAMES;
    bot.skin = randomSkin();
    game.snakes.push(bot);
  }

  game.renderer.cam.x = 0;
  game.renderer.cam.y = 0;
  game.renderer.cam.zoom = 3.4;
  game.running = true;
  if (game.flags.spatial) game._rebuildSpatial();
  else {
    for (const s of game.snakes) s._updateBounds();
  }
  return game;
}

function runCase(capacity, stack) {
  const game = makeGame(capacity, stack.flags);
  const frameMs = [];
  const simMs = [];
  const renderMs = [];
  const checks = [];

  for (let i = 0; i < WARMUP + SAMPLES; i++) {
    const t0 = performance.now();

    const tSim0 = performance.now();
    game._update(1);
    const sim = performance.now() - tSim0;

    const tRen0 = performance.now();
    game.renderer.follow(game.player);
    game.renderer.render(game);
    const ren = performance.now() - tRen0;

    const total = performance.now() - t0;

    if (i >= WARMUP) {
      frameMs.push(total);
      simMs.push(sim);
      renderMs.push(ren);
      checks.push(game.perf.collisionChecks);
    }
  }

  game.running = false;
  const snap = game.moneySnapshot();
  return {
    stack: stack.name,
    snakes: capacity,
    alive: game.snakes.filter((s) => s.alive).length,
    avgFrame: avg(frameMs),
    maxFrame: maxOf(frameMs),
    avgSim: avg(simMs),
    avgRender: avg(renderMs),
    avgChecks: avg(checks),
    driftCents: snap.driftCents,
  };
}

console.log("SCUTA.IO perf bench — fixed 60Hz step, headless canvas shim\n");
const rows = [];
for (const stack of STACKS) {
  for (const n of COUNTS) {
    const row = runCase(n, stack);
    rows.push(row);
    console.log(
      `${row.stack.padEnd(18)} n=${String(row.snakes).padStart(3)} ` +
        `alive=${String(row.alive).padStart(3)} ` +
        `frame=${row.avgFrame.toFixed(1).padStart(6)}ms ` +
        `(max ${row.maxFrame.toFixed(1).padStart(6)}) ` +
        `sim=${row.avgSim.toFixed(1).padStart(6)}ms ` +
        `ren=${row.avgRender.toFixed(1).padStart(6)}ms ` +
        `checks=${row.avgChecks.toFixed(0).padStart(8)} ` +
        `drift¢=${row.driftCents}`
    );
  }
  console.log("");
}

console.log("Summary (avg frame ms → target ≤16.7 for 60fps):\n");
for (const n of COUNTS) {
  const line = rows.filter((r) => r.snakes === n);
  console.log(`  ${n} snakes:`);
  for (const r of line) {
    const ok = r.avgFrame <= 16.7 ? "OK" : "SLOW";
    console.log(
      `    [${ok}] ${r.stack}: ${r.avgFrame.toFixed(1)}ms  checks=${r.avgChecks.toFixed(0)}  sim=${r.avgSim.toFixed(1)} ren=${r.avgRender.toFixed(1)}`
    );
  }
}
