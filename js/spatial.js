/** Spatial hash grid — cell size in world units. */
export const SPATIAL_CELL = 200;

/**
 * Uniform grid hash for point/segment queries.
 * Rebuild each frame: clear() then insert; query reads the 3×3 neighbourhood.
 */
export class SpatialHash {
  constructor(cellSize = SPATIAL_CELL) {
    this.cellSize = cellSize;
    /** @type {Map<number, any[]>} */
    this.buckets = new Map();
    this._inv = 1 / cellSize;
  }

  clear() {
    this.buckets.clear();
  }

  _key(cx, cy) {
    // Pack signed cell coords into one number (cells span ~±WORLD_RADIUS/cell)
    return ((cx + 32768) << 16) | ((cy + 32768) & 0xffff);
  }

  cellOf(x, y) {
    return {
      cx: Math.floor(x * this._inv),
      cy: Math.floor(y * this._inv),
    };
  }

  insert(x, y, item) {
    const cx = Math.floor(x * this._inv);
    const cy = Math.floor(y * this._inv);
    const key = this._key(cx, cy);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    bucket.push(item);
  }

  /**
   * Candidates in the 3×3 neighbourhood around (x, y).
   * @param {number} x
   * @param {number} y
   * @param {any[]} [out] reusable output array
   * @returns {any[]}
   */
  query(x, y, out = []) {
    out.length = 0;
    const cx = Math.floor(x * this._inv);
    const cy = Math.floor(y * this._inv);
    const buckets = this.buckets;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = buckets.get(this._key(cx + dx, cy + dy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  }

  /**
   * Candidates whose cells intersect the axis-aligned rectangle
   * [minX,minY]–[maxX,maxY] (inclusive of boundary cells).
   * @param {number} minX
   * @param {number} minY
   * @param {number} maxX
   * @param {number} maxY
   * @param {any[]} [out]
   * @returns {any[]}
   */
  queryRect(minX, minY, maxX, maxY, out = []) {
    out.length = 0;
    const inv = this._inv;
    const cx0 = Math.floor(minX * inv);
    const cy0 = Math.floor(minY * inv);
    const cx1 = Math.floor(maxX * inv);
    const cy1 = Math.floor(maxY * inv);
    const buckets = this.buckets;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const bucket = buckets.get(this._key(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) out.push(bucket[i]);
      }
    }
    return out;
  }
}
