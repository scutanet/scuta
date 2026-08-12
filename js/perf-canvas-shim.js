/**
 * Minimal canvas / 2d-context shim for headless Node perf benches.
 * Enough for Renderer to call without throwing; draw ops are no-ops.
 */
function createCtx() {
  const noop = () => {};
  const ctx = {
    canvas: null,
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    globalAlpha: 1,
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    setTransform: noop,
    translate: noop,
    scale: noop,
    rotate: noop,
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    clearRect: noop,
    drawImage: noop,
    fillText: noop,
    strokeText: noop,
    clip: noop,
    createRadialGradient: () => ({ addColorStop: noop }),
    createLinearGradient: () => ({ addColorStop: noop }),
  };
  return ctx;
}

export function createCanvas(width = 800, height = 600) {
  const ctx = createCtx();
  const canvas = {
    width,
    height,
    style: {},
    getContext() {
      ctx.canvas = canvas;
      return ctx;
    },
  };
  return canvas;
}

import { performance as nodePerf } from "node:perf_hooks";

if (typeof globalThis.window === "undefined") {
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
  };
}
if (typeof globalThis.performance === "undefined" || !globalThis.performance.now) {
  globalThis.performance = nodePerf;
}
if (typeof globalThis.Image === "undefined") {
  globalThis.Image = class {
    set src(_) {}
  };
}
if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    createElement(tag) {
      if (tag === "canvas") return createCanvas(64, 64);
      return {};
    },
  };
}
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
}
if (typeof globalThis.cancelAnimationFrame === "undefined") {
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
