import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SERVERS } from "./servers.js";
import { FOOD_COUNT } from "./utils.js";
import {
  BIRTH_SHARE,
  MAP_SHARE,
  PLATFORM_CUT,
  RING_SHARES,
  computeRoundEconomy,
  splitCents,
  toCents,
} from "./economy.js";

function byId(id) {
  const s = SERVERS.find((x) => x.id === id);
  assert.ok(s, `missing server ${id}`);
  return s;
}

function assertEconomy(server, label) {
  const eco = computeRoundEconomy(server.buyIn, server.maxCapacity);
  const c = eco._cents;

  assert.equal(c.gross, toCents(server.buyIn) * server.maxCapacity, `${label} gross cents`);
  assert.equal(c.platformCut, Math.round(c.gross * PLATFORM_CUT), `${label} platform`);
  assert.equal(c.roundLiquidity, c.gross - c.platformCut, `${label} liquidity`);
  assert.equal(c.birthPool, Math.round(c.roundLiquidity * BIRTH_SHARE), `${label} birth`);
  assert.equal(c.mapBudget, c.roundLiquidity - c.birthPool, `${label} map`);
  assert.equal(
    c.ringBudgets.outer + c.ringBudgets.middle + c.ringBudgets.center,
    c.mapBudget,
    `${label} rings sum to map`
  );

  // Dollar fields match cents to the cent
  assert.equal(toCents(eco.gross), c.gross, `${label} gross $`);
  assert.equal(toCents(eco.platformCut), c.platformCut, `${label} platform $`);
  assert.equal(toCents(eco.roundLiquidity), c.roundLiquidity, `${label} liquidity $`);
  assert.equal(toCents(eco.birthPool), c.birthPool, `${label} birth $`);
  assert.equal(toCents(eco.mapBudget), c.mapBudget, `${label} map $`);
  assert.equal(toCents(eco.ringBudgets.outer), c.ringBudgets.outer, `${label} outer $`);
  assert.equal(toCents(eco.ringBudgets.middle), c.ringBudgets.middle, `${label} middle $`);
  assert.equal(toCents(eco.ringBudgets.center), c.ringBudgets.center, `${label} center $`);

  // perSnakeBirth × n recovers birth pool (allow sub-cent float on the product)
  assert.equal(toCents(eco.perSnakeBirth * eco.playerCount), c.birthPool, `${label} perSnake × n`);

  assert.ok(Math.abs(BIRTH_SHARE + MAP_SHARE - 1) < 1e-12);
  assert.ok(
    Math.abs(RING_SHARES.outer + RING_SHARES.middle + RING_SHARES.center - 1) < 1e-12
  );

  return eco;
}

/** Simulate round-start money: birth on every snake + ring-split map pellets. */
function seedMoneyTotals(eco) {
  const birthTotal = eco.perSnakeBirth * eco.playerCount;
  const base = Math.floor(FOOD_COUNT / 3);
  const rem = FOOD_COUNT - base * 3;
  const counts = { outer: base, middle: base, center: base + rem };
  let mapTotal = 0;
  for (const ring of ["outer", "middle", "center"]) {
    const parts = splitCents(eco._cents.ringBudgets[ring], counts[ring]);
    for (const v of parts) mapTotal += v;
  }
  return { birthTotal, mapTotal, total: birthTotal + mapTotal };
}

describe("computeRoundEconomy across tiers", () => {
  it("lowest tier S1 ($1 × 500)", () => {
    const s = byId("S1");
    assert.equal(s.buyIn, 1);
    assert.equal(s.maxCapacity, 500);
    const eco = assertEconomy(s, "S1");

    // Hand-checked cents
    assert.equal(eco._cents.gross, 50000);
    assert.equal(eco._cents.platformCut, 5000);
    assert.equal(eco._cents.roundLiquidity, 45000);
    assert.equal(eco._cents.birthPool, 13500);
    assert.equal(eco._cents.mapBudget, 31500);
    assert.equal(eco._cents.ringBudgets.outer, 6300);
    assert.equal(eco._cents.ringBudgets.middle, 9450);
    assert.equal(eco._cents.ringBudgets.center, 15750);
    assert.equal(toCents(eco.perSnakeBirth), 27); // $0.27
  });

  it("middle tier S5 ($20 × 300)", () => {
    const s = byId("S5");
    assert.equal(s.buyIn, 20);
    assert.equal(s.maxCapacity, 300);
    const eco = assertEconomy(s, "S5");

    assert.equal(eco._cents.gross, 600000);
    assert.equal(eco._cents.platformCut, 60000);
    assert.equal(eco._cents.roundLiquidity, 540000);
    assert.equal(eco._cents.birthPool, 162000);
    assert.equal(eco._cents.mapBudget, 378000);
    assert.equal(eco._cents.ringBudgets.outer, 75600);
    assert.equal(eco._cents.ringBudgets.middle, 113400);
    assert.equal(eco._cents.ringBudgets.center, 189000);
    assert.equal(toCents(eco.perSnakeBirth), 540); // $5.40
  });

  it("highest tier S10 ($100 × 100)", () => {
    const s = byId("S10");
    assert.equal(s.buyIn, 100);
    assert.equal(s.maxCapacity, 100);
    const eco = assertEconomy(s, "S10");

    assert.equal(eco._cents.gross, 1000000);
    assert.equal(eco._cents.platformCut, 100000);
    assert.equal(eco._cents.roundLiquidity, 900000);
    assert.equal(eco._cents.birthPool, 270000);
    assert.equal(eco._cents.mapBudget, 630000);
    assert.equal(eco._cents.ringBudgets.outer, 126000);
    assert.equal(eco._cents.ringBudgets.middle, 189000);
    assert.equal(eco._cents.ringBudgets.center, 315000);
    assert.equal(toCents(eco.perSnakeBirth), 2700); // $27.00
  });

  it("netLiquidity display matches roundLiquidity for full lobby", () => {
    for (const s of SERVERS) {
      const eco = computeRoundEconomy(s.buyIn, s.maxCapacity);
      assert.equal(toCents(eco.roundLiquidity), toCents(s.netLiquidity), s.id);
    }
  });
});

describe("round-start money invariant", () => {
  it("S1 seed: pellets + birth = roundLiquidity to the cent", () => {
    const eco = computeRoundEconomy(byId("S1").buyIn, byId("S1").maxCapacity);
    const { total } = seedMoneyTotals(eco);
    assert.equal(toCents(total), eco._cents.roundLiquidity);
  });

  it("S10 seed: pellets + birth = roundLiquidity to the cent", () => {
    const eco = computeRoundEconomy(byId("S10").buyIn, byId("S10").maxCapacity);
    const { total } = seedMoneyTotals(eco);
    assert.equal(toCents(total), eco._cents.roundLiquidity);
  });

  it("boost burn + trail split conserves cents", () => {
    const burnedCents = 137; // $1.37
    for (const count of [1, 2]) {
      const parts = splitCents(burnedCents, count);
      assert.equal(toCents(parts.reduce((a, b) => a + b, 0)), burnedCents);
    }
  });
});
