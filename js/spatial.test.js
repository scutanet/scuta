import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SpatialHash, SPATIAL_CELL } from "./spatial.js";

describe("SpatialHash", () => {
  it("uses 200-unit cells", () => {
    assert.equal(SPATIAL_CELL, 200);
  });

  it("query returns 3×3 neighbourhood", () => {
    const g = new SpatialHash(200);
    g.insert(100, 100, "a");
    g.insert(250, 100, "b"); // neighbour cell
    g.insert(900, 900, "far");
    const hit = g.query(100, 100);
    assert.ok(hit.includes("a"));
    assert.ok(hit.includes("b"));
    assert.ok(!hit.includes("far"));
  });

  it("queryRect returns items in viewport cells", () => {
    const g = new SpatialHash(200);
    g.insert(10, 10, "in");
    g.insert(5000, 5000, "out");
    const hit = g.queryRect(0, 0, 400, 400);
    assert.ok(hit.includes("in"));
    assert.ok(!hit.includes("out"));
  });

  it("clear empties buckets", () => {
    const g = new SpatialHash();
    g.insert(0, 0, 1);
    g.clear();
    assert.equal(g.query(0, 0).length, 0);
  });
});
