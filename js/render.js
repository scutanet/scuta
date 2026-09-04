import { WORLD_RADIUS, LOD, hsl, shadeColor } from "./utils.js";
import { getCoinSprite, getFoodSprite, loadFoodSprites } from "./food-sprites.js";
import { CIRCUIT_ACCENT } from "./skins.js";

/** Procedural body styles (no coin sprites). */
const SHAPE_STYLES = new Set(["circuit", "blockweave", "pulse", "prism", "ember", "strike"]);

/**
 * Neon coin PNGs only fill ~65–70% of the canvas (transparent padding).
 * Scale so the visible coin diameter ≈ 2 × segment radius (matches head).
 */
const COIN_DRAW_SCALE = 3.05;
/** Underlay disc keeps a solid silhouette behind transparent sprite padding. */
const COIN_UNDERLAY = 0.98;

/** Front-facing obsidian orb — keep upright; animate eyes in code. */
const OBSIDIAN_HEAD_URL = "assets/snake/obsidian-head.png?v=4";
const OBSIDIAN_HEAD_SCALE = 2.25;

const HEX_SIZE = 22;
const HEX_W = Math.sqrt(3) * HEX_SIZE;
const HEX_H = HEX_SIZE * 1.5;
const ARENA_FILL = "#0a0b0e";
const VOID = "#0c0d10";

let obsidianHead = null;
let obsidianFailed = false;

function loadObsidianHead() {
  if (obsidianHead || obsidianFailed) return;
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    obsidianHead = img;
  };
  img.onerror = () => {
    obsidianFailed = true;
    console.warn("Failed to load obsidian head", OBSIDIAN_HEAD_URL);
  };
  img.src = OBSIDIAN_HEAD_URL;
}

export class Renderer {
  constructor(canvas, minimapCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.minimap = minimapCanvas;
    this.mctx = minimapCanvas.getContext("2d");
    // Start FOV (~14 hexes across)
    this.cam = { x: 0, y: 0, zoom: 3.4 };
    this.viewW = 0;
    this.viewH = 0;
    this.dpr = 1;
    this.time = 0;
    this.particles = [];
    this.resize();
    loadFoodSprites();
    loadObsidianHead();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;
    this.canvas.width = Math.floor(this.viewW * this.dpr);
    this.canvas.height = Math.floor(this.viewH * this.dpr);
    this.canvas.style.width = `${this.viewW}px`;
    this.canvas.style.height = `${this.viewH}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  follow(snake) {
    if (!snake || !snake.alive) return;
    const h = snake.head;
    this.cam.x += (h.x - this.cam.x) * 0.18;
    this.cam.y += (h.y - this.cam.y) * 0.18;

    // FOV: tight when small (~14 hexes across), then ease out
    // with sqrt(mass) so early growth zooms gently and huge snakes pull way back.
    const growth = Math.max(0, snake.mass - 12);
    const fat = Math.max(0, snake.radius - 10);
    const hexAcross = 14 + Math.sqrt(growth) * 0.62 + fat * 0.4;
    const targetZoom = this.viewW / (HEX_W * Math.max(14, hexAcross));
    this.cam.zoom += (targetZoom - this.cam.zoom) * 0.05;
  }

  worldToScreen(x, y) {
    return {
      x: (x - this.cam.x) * this.cam.zoom + this.viewW / 2,
      y: (y - this.cam.y) * this.cam.zoom + this.viewH / 2,
    };
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.viewW / 2) / this.cam.zoom + this.cam.x,
      y: (sy - this.viewH / 2) / this.cam.zoom + this.cam.y,
    };
  }

  /** Camera viewport in world units, plus LOD.VIEW_MARGIN. */
  _viewBounds() {
    const hw = this.viewW / (2 * this.cam.zoom) + LOD.VIEW_MARGIN;
    const hh = this.viewH / (2 * this.cam.zoom) + LOD.VIEW_MARGIN;
    return {
      minX: this.cam.x - hw,
      maxX: this.cam.x + hw,
      minY: this.cam.y - hh,
      maxY: this.cam.y + hh,
    };
  }

  /**
   * LOD tier from camera distance (world units).
   * @returns {{ step: number, detail: boolean, effects: boolean, dist: number }}
   */
  _lodFor(x, y) {
    const dist = Math.hypot(x - this.cam.x, y - this.cam.y);
    if (dist < LOD.NEAR) {
      return { step: LOD.NEAR_STEP, detail: true, effects: true, dist };
    }
    if (dist < LOD.MID) {
      return { step: LOD.MID_STEP, detail: false, effects: true, dist };
    }
    return { step: LOD.FAR_STEP, detail: false, effects: false, dist };
  }

  _boundsVisible(b, view) {
    return !(b.maxX < view.minX || b.minX > view.maxX || b.maxY < view.minY || b.minY > view.maxY);
  }

  render(game) {
    this.time += 0.016;
    const ctx = this.ctx;

    ctx.fillStyle = VOID;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    ctx.save();
    ctx.translate(this.viewW / 2, this.viewH / 2);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);

    this._drawArena(ctx);
    this._drawCashOutZones(ctx, game);
    this._drawFood(ctx, game.food.items, game);
    this._updateParticles(game);
    this._drawParticles(ctx);
    this._drawSnakes(ctx, game.snakes, game);
    this._drawCashOutProgress(ctx, game);

    ctx.restore();
    this._drawMinimap(game);
  }

  /** Filled semi-transparent teal cash-out discs with a brighter outline. */
  _drawCashOutZones(ctx, game) {
    const zones = game.cashOutZones;
    if (!zones?.length) return;

    for (const z of zones) {
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(32, 196, 180, 0.18)";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(80, 255, 230, 0.85)";
      ctx.lineWidth = 10;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(180, 255, 245, 0.55)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  /** Radial dwell ring around the player's head while inside a zone. */
  _drawCashOutProgress(ctx, game) {
    const snake = game.player;
    if (!snake?.alive || !(snake.cashOutProgress > 0)) return;

    const h = snake.head;
    const r = snake.radius + 14;
    const prog = Math.min(1, snake.cashOutProgress);

    ctx.beginPath();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 5;
    ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = "rgba(90, 255, 230, 0.95)";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.arc(h.x, h.y, r, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
    ctx.stroke();
  }

  _drawArena(ctx) {
    ctx.beginPath();
    ctx.arc(0, 0, WORLD_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = ARENA_FILL;
    ctx.fill();

    // Soft outer rim
    ctx.beginPath();
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 28;
    ctx.arc(0, 0, WORLD_RADIUS + 10, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 2;
    ctx.arc(0, 0, WORLD_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
  }

  _drawFood(ctx, items, game) {
    const view = this._viewBounds();
    const headR = game?.player?.alive
      ? game.player.radius
      : (game?.snakes?.find((s) => s.alive)?.radius ?? 10);

    // Prefer spatial query; fall back to full scan if grid missing / cull off
    let list = items;
    if (game?.flags?.cull !== false && game?.foodGrid) {
      list = game.foodGrid.queryRect(view.minX, view.minY, view.maxX, view.maxY, this._foodVis || (this._foodVis = []));
    }

    const seen = new Set();
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (seen.has(f)) continue;
      seen.add(f);
      if (f.x < view.minX || f.x > view.maxX || f.y < view.minY || f.y > view.maxY) continue;

      const kind = f.kind ?? "map";
      const isDeath = kind === "death";
      const isCenter = f.ring === "center";
      const pulse = 1 + Math.sin(this.time * (isDeath ? 3.2 : 2.4) + f.pulse) * (isDeath ? 0.1 : 0.06);
      const mul = f.sizeMul ?? 1;
      const bright = f.brightness ?? (isCenter ? 1.28 : 1);
      // Diameter ≈ 2.2 × head radius ≈ 1.1 × head diameter
      const size = headR * 2.2 * mul * pulse;
      const img = getFoodSprite(f.sprite ?? 0, kind === "death" ? "death" : "map");

      if (img) {
        if (isDeath) {
          // Warm halo around neon circuit kill drops
          const glowR = size * 0.58;
          const g = ctx.createRadialGradient(f.x, f.y, size * 0.15, f.x, f.y, glowR);
          g.addColorStop(0, "rgba(255, 200, 80, 0.28)");
          g.addColorStop(0.55, "rgba(255, 140, 40, 0.12)");
          g.addColorStop(1, "rgba(255, 120, 20, 0)");
          ctx.beginPath();
          ctx.fillStyle = g;
          ctx.arc(f.x, f.y, glowR, 0, Math.PI * 2);
          ctx.fill();
        } else if (isCenter) {
          const glowR = size * 0.62;
          const g = ctx.createRadialGradient(f.x, f.y, size * 0.12, f.x, f.y, glowR);
          g.addColorStop(0, "rgba(200, 255, 255, 0.32)");
          g.addColorStop(0.5, "rgba(120, 230, 255, 0.12)");
          g.addColorStop(1, "rgba(80, 200, 255, 0)");
          ctx.beginPath();
          ctx.fillStyle = g;
          ctx.arc(f.x, f.y, glowR, 0, Math.PI * 2);
          ctx.fill();
        }
        if (bright !== 1) {
          ctx.save();
          ctx.globalAlpha = Math.min(1, 0.75 + bright * 0.2);
          ctx.drawImage(img, f.x - size * 0.5, f.y - size * 0.5, size, size);
          ctx.restore();
        } else {
          ctx.drawImage(img, f.x - size * 0.5, f.y - size * 0.5, size, size);
        }
        continue;
      }

      // Fallback while sprites load
      const r = size * 0.42;
      const color = hsl(f.h, f.s, f.l);
      ctx.beginPath();
      ctx.fillStyle = hsl(f.h, f.s, f.l, 0.28);
      ctx.arc(f.x, f.y, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _updateParticles(game) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= 0.04;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.96;
      p.vy *= 0.96;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    if (this.particles.length > 180) this.particles.length = 180;

    const cx = this.cam.x;
    const cy = this.cam.y;
    for (const snake of game.snakes) {
      if (!snake.alive || !snake.boosting) continue;
      const h = snake.head;
      // Skip particle spawn beyond LOD effects threshold
      if (game?.flags?.lod !== false && Math.hypot(h.x - cx, h.y - cy) >= LOD.MID) continue;
      const ang = snake.angle + Math.PI;
      const c = snake.skin.colors[0];
      for (let n = 0; n < 2; n++) {
        const spread = (Math.random() - 0.5) * 0.9;
        this.particles.push({
          x: h.x - Math.cos(snake.angle) * snake.radius * 0.6,
          y: h.y - Math.sin(snake.angle) * snake.radius * 0.6,
          vx: Math.cos(ang + spread) * (1.2 + Math.random() * 1.8),
          vy: Math.sin(ang + spread) * (1.2 + Math.random() * 1.8),
          life: 0.6 + Math.random() * 0.4,
          r: 1.5 + Math.random() * 2.5,
          color: c,
        });
      }
    }
  }

  _drawParticles(ctx) {
    for (const p of this.particles) {
      ctx.beginPath();
      ctx.globalAlpha = Math.max(0, p.life) * 0.7;
      ctx.fillStyle = p.color;
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawSnakes(ctx, snakes, game) {
    const view = this._viewBounds();
    const useCull = game?.flags?.cull !== false;
    const sorted = [];
    for (let i = 0; i < snakes.length; i++) {
      const s = snakes[i];
      if (!s.alive) continue;
      // Fully outside viewport — skip without iterating segments
      if (useCull && s.bounds && !this._boundsVisible(s.bounds, view)) continue;
      sorted.push(s);
    }
    sorted.sort((a, b) => a.mass - b.mass);
    for (const snake of sorted) this._drawSnake(ctx, snake, game, view);
  }

  _drawSegment(ctx, x, y, r, color) {
    // Fallback disc when neon sprites are not ready
    ctx.beginPath();
    ctx.fillStyle = shadeColor(color, -48);
    ctx.arc(x, y, r + 0.85, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createRadialGradient(
      x - r * 0.28, y - r * 0.32, r * 0.05,
      x, y, r
    );
    grad.addColorStop(0, shadeColor(color, 55));
    grad.addColorStop(0.4, shadeColor(color, 12));
    grad.addColorStop(0.78, color);
    grad.addColorStop(1, shadeColor(color, -28));

    ctx.beginPath();
    ctx.fillStyle = grad;
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawCoinSegment(ctx, x, y, sr, coinId, fallbackColor, hq) {
    const img = coinId ? getCoinSprite(coinId) : null;
    if (img) {
      // Solid underlay = same radius as head, so the body isn't a thin string
      ctx.beginPath();
      ctx.fillStyle = shadeColor(fallbackColor, -55);
      ctx.arc(x, y, sr * COIN_UNDERLAY + 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = shadeColor(fallbackColor, -28);
      ctx.arc(x, y, sr * COIN_UNDERLAY, 0, Math.PI * 2);
      ctx.fill();

      const size = sr * COIN_DRAW_SCALE;
      ctx.drawImage(img, x - size * 0.5, y - size * 0.5, size, size);
      return;
    }
    if (hq) {
      this._drawSegment(ctx, x, y, sr, fallbackColor);
      return;
    }
    ctx.beginPath();
    ctx.fillStyle = shadeColor(fallbackColor, -35);
    ctx.arc(x, y, sr + 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = fallbackColor;
    ctx.arc(x, y, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Platinum circuit head — matches lobby logo (no branded coin). */
  _drawPlatinumHead(ctx, x, y, r, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // Soft platinum halo
    const halo = ctx.createRadialGradient(0, 0, r * 0.35, 0, 0, r * 1.15);
    halo.addColorStop(0, "rgba(184,196,216,0.18)");
    halo.addColorStop(1, "rgba(184,196,216,0)");
    ctx.beginPath();
    ctx.fillStyle = halo;
    ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2);
    ctx.fill();

    // Dark face
    const face = ctx.createRadialGradient(-r * 0.28, -r * 0.32, r * 0.08, 0, 0, r);
    face.addColorStop(0, "#2a2a32");
    face.addColorStop(0.55, "#121218");
    face.addColorStop(1, "#050508");
    ctx.beginPath();
    ctx.fillStyle = face;
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();

    // Circuit ticks
    ctx.strokeStyle = "rgba(197,208,226,0.45)";
    ctx.fillStyle = "rgba(232,238,248,0.75)";
    ctx.lineWidth = Math.max(0.7, r * 0.035);
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.arc(0, 0, r * 0.74, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = "rgba(197,208,226,0.28)";
    ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(197,208,226,0.5)";
    const arm = r * 0.74;
    const tick = r * 0.2;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const cx = Math.cos(a) * arm;
      const cy = Math.sin(a) * arm;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (arm - tick), Math.sin(a) * (arm - tick));
      ctx.lineTo(cx, cy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0.9, r * 0.045), 0, Math.PI * 2);
      ctx.fill();
    }

    // Diagonal ticks
    ctx.strokeStyle = "rgba(197,208,226,0.4)";
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const inner = r * 0.52;
      const outer = r * 0.68;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      ctx.stroke();
    }

    // Platinum rim
    const rim = ctx.createLinearGradient(-r, -r, r, r);
    rim.addColorStop(0, "#ffffff");
    rim.addColorStop(0.4, "#b8c4d8");
    rim.addColorStop(1, "#6a7388");
    ctx.beginPath();
    ctx.strokeStyle = rim;
    ctx.lineWidth = Math.max(1.6, r * 0.085);
    ctx.arc(0, 0, r * 0.96, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = "rgba(220,227,240,0.4)";
    ctx.lineWidth = Math.max(0.8, r * 0.04);
    ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
    ctx.stroke();

    // Left edge shade + highlight
    ctx.beginPath();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = Math.max(1.4, r * 0.08);
    ctx.lineCap = "round";
    ctx.arc(0, 0, r * 0.92, Math.PI * 0.65, Math.PI * 1.35);
    ctx.stroke();

    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.58);
    core.addColorStop(0, "rgba(10,10,14,0.92)");
    core.addColorStop(1, "rgba(10,10,14,0)");
    ctx.beginPath();
    ctx.fillStyle = core;
    ctx.arc(0, 0, r * 0.58, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  _drawSnake(ctx, snake, game, view = null) {
    const segs = snake.segments;
    if (segs.length < 2) return;

    const colors = snake.skin.colors || ["#b8c4d8"];
    const coins = snake.skin.coins || [];
    const style = snake.skin.style || "coin";
    const r = snake.radius;
    const cx = this.cam.x;
    const cy = this.cam.y;
    const viewPad = Math.max(this.viewW, this.viewH) / this.cam.zoom * 0.65;
    const lodEnabled = game?.flags?.lod !== false;
    const lod = snake.isPlayer || !lodEnabled
      ? { step: LOD.NEAR_STEP, detail: true, effects: true, dist: 0 }
      : this._lodFor(snake.head.x, snake.head.y);
    const hq = lod.detail;
    const step = lod.step;

    if (snake.boosting && lod.effects) {
      const head = segs[0];
      const glow = ctx.createRadialGradient(head.x, head.y, r * 0.2, head.x, head.y, r * 2.2);
      glow.addColorStop(0, "rgba(255,255,255,0.16)");
      glow.addColorStop(0.55, `${colors[0]}28`);
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.beginPath();
      ctx.fillStyle = glow;
      ctx.arc(head.x, head.y, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (SHAPE_STYLES.has(style)) {
      const drawer = {
        circuit: this._drawCircuitSnake,
        blockweave: this._drawBlockweaveSnake,
        pulse: this._drawPulseSnake,
        prism: this._drawPrismSnake,
        ember: this._drawEmberSnake,
        strike: this._drawStrikeSnake,
      }[style];
      drawer.call(this, ctx, snake, game, hq, viewPad, cx, cy, lod);
      return;
    }

    const coinLen = coins.length || 1;

    for (let i = segs.length - 1; i >= 1; i -= step) {
      const s = segs[i];
      if (Math.abs(s.x - cx) > viewPad || Math.abs(s.y - cy) > viewPad) continue;
      const phase = Math.floor(i / step);
      const color = colors[phase % colors.length];
      const coinId = coins.length ? coins[phase % coinLen] : null;
      // Gentle tail only — avoid a stringy tip next to a full-size head
      const taper = i > segs.length - 10 ? 0.88 + ((segs.length - i) / 10) * 0.12 : 1;
      const sr = r * taper;
      this._drawCoinSegment(ctx, s.x, s.y, sr, coinId, color, hq);
    }

    const head = segs[0];
    const headR = r * 1.06;
    this._drawPlatinumHead(ctx, head.x, head.y, headR, snake.angle);
    if (lod.detail) this._drawEyes(ctx, snake, game, headR);
    if (lod.detail || snake.isPlayer) this._drawNameplate(ctx, snake);
  }

  /** Continuous glass circuit tube + upright obsidian head. */
  _drawCircuitSnake(ctx, snake, game, hq, viewPad, cx, cy, lod = null) {
    const segs = snake.segments;
    const r = snake.radius;
    const headR = r * 1.08;
    const step = lod?.step ?? (hq ? 1 : segs.length > 100 ? 2 : 1);
    const detail = lod ? lod.detail : hq;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Ribbon path: tail → head (flush under the orb)
    ctx.beginPath();
    let started = false;
    for (let i = segs.length - 1; i >= 0; i -= step) {
      const s = segs[i];
      if (!started) {
        ctx.moveTo(s.x, s.y);
        started = true;
      } else {
        ctx.lineTo(s.x, s.y);
      }
    }
    // Ensure head tip is included when step > 1
    if (step > 1 && segs.length > 1) {
      ctx.lineTo(segs[0].x, segs[0].y);
    }

    if (started) {
      if (detail) {
        ctx.strokeStyle = "rgba(93,255,200,0.12)";
        ctx.lineWidth = r * 2.35;
        ctx.stroke();

        ctx.strokeStyle = "rgba(197,208,226,0.22)";
        ctx.lineWidth = r * 2.12;
        ctx.stroke();
      }

      ctx.strokeStyle = "rgba(106,115,136,0.55)";
      ctx.lineWidth = r * 2.02;
      ctx.stroke();

      ctx.strokeStyle = "#101014";
      ctx.lineWidth = r * 1.92;
      ctx.stroke();

      ctx.strokeStyle = "#16161c";
      ctx.lineWidth = r * 1.45;
      ctx.stroke();
    }
    ctx.restore();

    // Sparse teal circuit ticks along the body (skip near head / distant)
    if (detail) {
      const tickEvery = Math.max(4, Math.round(10 / step));
      ctx.save();
      ctx.lineCap = "round";
      ctx.strokeStyle = CIRCUIT_ACCENT;
      ctx.fillStyle = CIRCUIT_ACCENT;
      for (let i = segs.length - 1; i > 3; i -= tickEvery) {
        const s = segs[i];
        if (Math.abs(s.x - cx) > viewPad || Math.abs(s.y - cy) > viewPad) continue;
        const next = segs[Math.max(0, i - 1)];
        const dx = next.x - s.x;
        const dy = next.y - s.y;
        const len = Math.hypot(dx, dy) || 1;
        const tx = dx / len;
        const ty = dy / len;
        const px = -ty;
        const py = tx;
        const run = r * 0.55;
        const x2 = s.x + tx * run;
        const y2 = s.y + ty * run;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = Math.max(1, r * 0.07);
        ctx.beginPath();
        ctx.moveTo(s.x - tx * run * 0.15, s.y - ty * run * 0.15);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(x2, y2, Math.max(0.9, r * 0.08), 0, Math.PI * 2);
        ctx.fill();
        if ((i / tickEvery) % 2 < 1) {
          const bx = s.x + px * r * 0.28;
          const by = s.y + py * r * 0.28;
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = Math.max(0.8, r * 0.055);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(bx, by);
          ctx.stroke();
          ctx.globalAlpha = 0.8;
          ctx.fillStyle = "#e8fff8";
          ctx.beginPath();
          ctx.arc(bx, by, Math.max(0.7, r * 0.06), 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = CIRCUIT_ACCENT;
        }
      }
      ctx.restore();
    }

    const head = segs[0];
    // Obsidian orb stays upright; pupils track in _drawEyes
    if (obsidianHead) {
      const size = headR * OBSIDIAN_HEAD_SCALE;
      ctx.drawImage(obsidianHead, head.x - size * 0.5, head.y - size * 0.5, size, size);
    } else {
      this._drawPlatinumHead(ctx, head.x, head.y, headR, snake.angle);
    }
    if (detail) this._drawEyes(ctx, snake, game, headR);
    if (detail || snake.isPlayer) this._drawNameplate(ctx, snake);
  }

  /** Hex ledger plates — blockchain block stack silhouette. */
  _drawBlockweaveSnake(ctx, snake, game, hq, viewPad, cx, cy, lod = null) {
    const segs = snake.segments;
    const r = snake.radius;
    const accent = snake.skin.colors?.[0] || "#e8b84a";
    const headR = r * 1.08;
    const step = lod?.step ?? (hq ? 1 : segs.length > 90 ? 2 : 1);
    const detail = lod ? lod.detail : hq;

    for (let i = segs.length - 1; i >= 1; i -= step) {
      const s = segs[i];
      if (Math.abs(s.x - cx) > viewPad || Math.abs(s.y - cy) > viewPad) continue;
      const next = segs[Math.max(0, i - 1)];
      const ang = Math.atan2(next.y - s.y, next.x - s.x);
      const taper = i > segs.length - 10 ? 0.86 + ((segs.length - i) / 10) * 0.14 : 1;
      const sr = r * taper;
      this._drawHexPlate(ctx, s.x, s.y, sr, ang, accent, detail);
    }

    const head = segs[0];
    this._drawHexHead(ctx, head.x, head.y, headR, snake.angle, accent);
    if (detail) this._drawEyes(ctx, snake, game, headR);
    if (detail || snake.isPlayer) this._drawNameplate(ctx, snake);
  }

  _drawHexPlate(ctx, x, y, r, ang, accent, hq) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 6) + (i * Math.PI) / 3;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < 6; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = "#0e0f14";
    ctx.fill();
    if (hq) {
      ctx.strokeStyle = shadeColor(accent, -40);
      ctx.lineWidth = Math.max(1.2, r * 0.1);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 6) + (i * Math.PI) / 3;
        const ir = r * 0.55;
        const ox = Math.cos(a) * ir;
        const oy = Math.sin(a) * ir;
        if (i === 0) ctx.moveTo(ox, oy);
        else ctx.lineTo(ox, oy);
      }
      ctx.closePath();
      ctx.strokeStyle = `${accent}55`;
      ctx.lineWidth = Math.max(0.7, r * 0.045);
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = accent;
      ctx.arc(0, 0, Math.max(1, r * 0.12), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1, r * 0.08);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawHexHead(ctx, x, y, r, angle, accent) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 6) + (i * Math.PI) / 3;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const face = ctx.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.1, 0, 0, r);
    face.addColorStop(0, "#2a2418");
    face.addColorStop(0.55, "#121018");
    face.addColorStop(1, "#050508");
    ctx.fillStyle = face;
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1.8, r * 0.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = `${accent}66`;
    ctx.lineWidth = Math.max(0.8, r * 0.04);
    ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Concentric signal rings — network beacon silhouette. */
  _drawPulseSnake(ctx, snake, game, hq, viewPad, cx, cy, lod = null) {
    const segs = snake.segments;
    const r = snake.radius;
    const accent = snake.skin.colors?.[0] || "#2ef0ff";
    const headR = r * 1.06;
    const step = lod?.step ?? (hq ? 1 : segs.length > 90 ? 2 : 1);
    const detail = lod ? lod.detail : hq;

    // Thin spine under the rings
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    let started = false;
    for (let i = segs.length - 1; i >= 0; i -= step) {
      const s = segs[i];
      if (!started) {
        ctx.moveTo(s.x, s.y);
        started = true;
      } else {
        ctx.lineTo(s.x, s.y);
      }
    }
    if (step > 1) ctx.lineTo(segs[0].x, segs[0].y);
    if (started) {
      ctx.strokeStyle = "rgba(8,18,24,0.9)";
      ctx.lineWidth = r * 0.55;
      ctx.stroke();
      ctx.strokeStyle = `${accent}33`;
      ctx.lineWidth = r * 0.22;
      ctx.stroke();
    }
    ctx.restore();

    const ringEvery = detail ? 2 : Math.max(3, step + 1);
    for (let i = segs.length - 1; i >= 1; i -= ringEvery) {
      const s = segs[i];
      if (Math.abs(s.x - cx) > viewPad || Math.abs(s.y - cy) > viewPad) continue;
      const taper = i > segs.length - 10 ? 0.84 + ((segs.length - i) / 10) * 0.16 : 1;
      const sr = r * taper;
      ctx.beginPath();
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1.1, sr * 0.12);
      ctx.globalAlpha = 0.85;
      ctx.arc(s.x, s.y, sr * 0.92, 0, Math.PI * 2);
      ctx.stroke();
      if (detail) {
        ctx.beginPath();
        ctx.strokeStyle = `${accent}44`;
        ctx.lineWidth = Math.max(0.7, sr * 0.05);
        ctx.arc(s.x, s.y, sr * 0.58, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.9;
        ctx.arc(s.x, s.y, Math.max(1, sr * 0.14), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    const head = segs[0];
    this._drawPulseHead(ctx, head.x, head.y, headR, snake.angle, accent);
    if (detail) this._drawEyes(ctx, snake, game, headR);
    if (detail || snake.isPlayer) this._drawNameplate(ctx, snake);
  }

  _drawPulseHead(ctx, x, y, r, angle, accent) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.fillStyle = "#071016";
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    for (const [rad, alpha, lw] of [
      [0.96, 0.95, 0.1],
      [0.68, 0.55, 0.055],
      [0.4, 0.35, 0.04],
    ]) {
      ctx.beginPath();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = Math.max(1, r * lw);
      ctx.arc(0, 0, r * rad, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.fillStyle = accent;
    ctx.arc(0, 0, Math.max(1.2, r * 0.16), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Faceted crystal diamonds — gem / vault silhouette. */
  _drawPrismSnake(ctx, snake, game, hq, viewPad, cx, cy, lod = null) {
    const segs = snake.segments;
    const r = snake.radius;
    const accent = snake.skin.colors?.[0] || "#c45cff";
    const headR = r * 1.08;
    const step = lod?.step ?? (hq ? 1 : segs.length > 90 ? 2 : 1);
    const detail = lod ? lod.detail : hq;

    for (let i = segs.length - 1; i >= 1; i -= step) {
      const s = segs[i];
      if (Math.abs(s.x - cx) > viewPad || Math.abs(s.y - cy) > viewPad) continue;
      const next = segs[Math.max(0, i - 1)];
      const ang = Math.atan2(next.y - s.y, next.x - s.x);
      const taper = i > segs.length - 10 ? 0.86 + ((segs.length - i) / 10) * 0.14 : 1;
      const sr = r * taper;
      this._drawPrismFacet(ctx, s.x, s.y, sr, ang + (i % 2) * 0.12, accent, detail);
    }

    const head = segs[0];
    this._drawPrismHead(ctx, head.x, head.y, headR, snake.angle, accent);
    if (detail) this._drawEyes(ctx, snake, game, headR);
    if (detail || snake.isPlayer) this._drawNameplate(ctx, snake);
  }

  _drawPrismFacet(ctx, x, y, r, ang, accent, hq) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const hx = r * 1.05;
    const hy = r * 0.72;
    ctx.beginPath();
    ctx.moveTo(hx, 0);
    ctx.lineTo(0, hy);
    ctx.lineTo(-hx, 0);
    ctx.lineTo(0, -hy);
    ctx.closePath();
    ctx.fillStyle = "#140a1c";
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1.1, r * 0.09);
    ctx.stroke();
    if (hq) {
      ctx.beginPath();
      ctx.moveTo(hx * 0.35, 0);
      ctx.lineTo(0, hy * 0.35);
      ctx.lineTo(-hx * 0.35, 0);
      ctx.lineTo(0, -hy * 0.35);
      ctx.closePath();
      ctx.strokeStyle = `${accent}66`;
      ctx.lineWidth = Math.max(0.6, r * 0.04);
      ctx.stroke();
      ctx.beginPath();
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = Math.max(0.7, r * 0.035);
      ctx.moveTo(-hx * 0.15, -hy * 0.55);
      ctx.lineTo(hx * 0.35, -hy * 0.15);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawPrismHead(ctx, x, y, r, angle, accent) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    const hx = r * 1.12;
    const hy = r * 0.88;
    ctx.moveTo(hx, 0);
    ctx.lineTo(0, hy);
    ctx.lineTo(-hx * 0.75, 0);
    ctx.lineTo(0, -hy);
    ctx.closePath();
    const face = ctx.createRadialGradient(-r * 0.15, -r * 0.2, r * 0.08, 0, 0, r);
    face.addColorStop(0, "#2a1638");
    face.addColorStop(0.55, "#120818");
    face.addColorStop(1, "#050508");
    ctx.fillStyle = face;
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1.8, r * 0.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = `${accent}77`;
    ctx.lineWidth = Math.max(0.8, r * 0.04);
    ctx.moveTo(r * 0.35, 0);
    ctx.lineTo(0, r * 0.32);
    ctx.lineTo(-r * 0.28, 0);
    ctx.lineTo(0, -r * 0.32);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  /** Molten core tube — volatility / forge heat. */
  _drawEmberSnake(ctx, snake, game, hq, viewPad, cx, cy, lod = null) {
    const segs = snake.segments;
    const r = snake.radius;
    const accent = snake.skin.colors?.[0] || "#ff6a2a";
    const headR = r * 1.08;
    const step = lod?.step ?? (hq ? 1 : segs.length > 100 ? 2 : 1);
    const detail = lod ? lod.detail : hq;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    let started = false;
    for (let i = segs.length - 1; i >= 0; i -= step) {
      const s = segs[i];
      if (!started) {
        ctx.moveTo(s.x, s.y);
        started = true;
      } else {
        ctx.lineTo(s.x, s.y);
      }
    }
    if (step > 1) ctx.lineTo(segs[0].x, segs[0].y);
    if (started) {
      if (detail) {
        ctx.strokeStyle = `${accent}22`;
        ctx.lineWidth = r * 2.45;
        ctx.stroke();
      }
      ctx.strokeStyle = "#1a0c08";
      ctx.lineWidth = r * 2.05;
      ctx.stroke();
      ctx.strokeStyle = "#2a1410";
      ctx.lineWidth = r * 1.55;
      ctx.stroke();
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = r * 0.72;
      ctx.stroke();
      if (detail) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = "#ffd0a0";
        ctx.lineWidth = r * 0.28;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // Ember sparks along the spine
    if (detail) {
      const sparkEvery = Math.max(5, Math.round(12 / step));
      ctx.save();
      for (let i = segs.length - 1; i > 4; i -= sparkEvery) {
        const s = segs[i];
        if (Math.abs(s.x - cx) > viewPad || Math.abs(s.y - cy) > viewPad) continue;
        const next = segs[Math.max(0, i - 1)];
        const dx = next.x - s.x;
        const dy = next.y - s.y;
        const len = Math.hypot(dx, dy) || 1;
        const px = -dy / len;
        const py = dx / len;
        const side = (i / sparkEvery) % 2 < 1 ? 1 : -1;
        const bx = s.x + px * r * 0.42 * side;
        const by = s.y + py * r * 0.42 * side;
        ctx.beginPath();
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.75;
        ctx.arc(bx, by, Math.max(0.8, r * 0.07), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    const head = segs[0];
    this._drawEmberHead(ctx, head.x, head.y, headR, snake.angle, accent);
    if (detail) this._drawEyes(ctx, snake, game, headR);
    if (detail || snake.isPlayer) this._drawNameplate(ctx, snake);
  }

  _drawEmberHead(ctx, x, y, r, angle, accent) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const halo = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 1.2);
    halo.addColorStop(0, `${accent}33`);
    halo.addColorStop(1, `${accent}00`);
    ctx.beginPath();
    ctx.fillStyle = halo;
    ctx.arc(0, 0, r * 1.2, 0, Math.PI * 2);
    ctx.fill();
    const face = ctx.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.1, 0, 0, r);
    face.addColorStop(0, "#3a1a10");
    face.addColorStop(0.5, "#140808");
    face.addColorStop(1, "#050304");
    ctx.beginPath();
    ctx.fillStyle = face;
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1.8, r * 0.1);
    ctx.arc(0, 0, r * 0.96, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = "#ffd0a0";
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(0.8, r * 0.04);
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.fillStyle = accent;
    ctx.arc(0, 0, Math.max(1.2, r * 0.14), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** Chevron arrow plates — aggressive strike vector. */
  _drawStrikeSnake(ctx, snake, game, hq, viewPad, cx, cy, lod = null) {
    const segs = snake.segments;
    const r = snake.radius;
    const accent = snake.skin.colors?.[0] || "#ff3d7a";
    const headR = r * 1.1;
    const step = lod?.step ?? (hq ? 1 : segs.length > 90 ? 2 : 1);
    const detail = lod ? lod.detail : hq;

    for (let i = segs.length - 1; i >= 1; i -= step) {
      const s = segs[i];
      if (Math.abs(s.x - cx) > viewPad || Math.abs(s.y - cy) > viewPad) continue;
      const next = segs[Math.max(0, i - 1)];
      const ang = Math.atan2(next.y - s.y, next.x - s.x);
      const taper = i > segs.length - 10 ? 0.85 + ((segs.length - i) / 10) * 0.15 : 1;
      const sr = r * taper;
      this._drawChevronPlate(ctx, s.x, s.y, sr, ang, accent, detail);
    }

    const head = segs[0];
    this._drawStrikeHead(ctx, head.x, head.y, headR, snake.angle, accent);
    if (detail) this._drawEyes(ctx, snake, game, headR);
    if (detail || snake.isPlayer) this._drawNameplate(ctx, snake);
  }

  _drawChevronPlate(ctx, x, y, r, ang, accent, hq) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    const tip = r * 1.15;
    const back = r * 0.55;
    const wing = r * 0.95;
    ctx.beginPath();
    ctx.moveTo(tip, 0);
    ctx.lineTo(-back, wing);
    ctx.lineTo(-back * 0.35, 0);
    ctx.lineTo(-back, -wing);
    ctx.closePath();
    ctx.fillStyle = "#160810";
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1.1, r * 0.09);
    ctx.stroke();
    if (hq) {
      ctx.beginPath();
      ctx.moveTo(tip * 0.35, 0);
      ctx.lineTo(-back * 0.15, wing * 0.4);
      ctx.lineTo(-back * 0.05, 0);
      ctx.lineTo(-back * 0.15, -wing * 0.4);
      ctx.closePath();
      ctx.strokeStyle = `${accent}66`;
      ctx.lineWidth = Math.max(0.6, r * 0.04);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawStrikeHead(ctx, x, y, r, angle, accent) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const tip = r * 1.25;
    const back = r * 0.7;
    const wing = r * 1.05;
    ctx.beginPath();
    ctx.moveTo(tip, 0);
    ctx.lineTo(-back, wing);
    ctx.lineTo(-back * 0.2, 0);
    ctx.lineTo(-back, -wing);
    ctx.closePath();
    const face = ctx.createRadialGradient(-r * 0.1, -r * 0.15, r * 0.08, 0, 0, r);
    face.addColorStop(0, "#3a1020");
    face.addColorStop(0.55, "#140810");
    face.addColorStop(1, "#050508");
    ctx.fillStyle = face;
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1.8, r * 0.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.strokeStyle = `${accent}88`;
    ctx.lineWidth = Math.max(0.8, r * 0.04);
    ctx.moveTo(r * 0.35, 0);
    ctx.lineTo(-r * 0.15, r * 0.4);
    ctx.lineTo(-r * 0.05, 0);
    ctx.lineTo(-r * 0.15, -r * 0.4);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  _drawEyes(ctx, snake, game, headR = null) {
    const head = snake.head;
    const r = headR ?? snake.radius;
    const faceAng = snake.angle;

    let lookX;
    let lookY;
    if (snake.isPlayer && game?.mouseWorld) {
      lookX = game.mouseWorld.x;
      lookY = game.mouseWorld.y;
    } else {
      lookX = head.x + Math.cos(snake.targetAngle) * 240;
      lookY = head.y + Math.sin(snake.targetAngle) * 240;
    }

    // Logo-like: large whites on the face, slightly forward
    const eyeOffset = r * 0.28;
    const eyeSpread = r * 0.38;
    const perp = faceAng + Math.PI / 2;
    const eyeR = Math.max(3.2, r * 0.32);
    const pupilR = Math.max(1.4, r * 0.145);
    const maxPupilTravel = eyeR - pupilR - 0.6;

    const eyes = [
      {
        x: head.x + Math.cos(faceAng) * eyeOffset + Math.cos(perp) * eyeSpread,
        y: head.y + Math.sin(faceAng) * eyeOffset + Math.sin(perp) * eyeSpread,
      },
      {
        x: head.x + Math.cos(faceAng) * eyeOffset - Math.cos(perp) * eyeSpread,
        y: head.y + Math.sin(faceAng) * eyeOffset - Math.sin(perp) * eyeSpread,
      },
    ];

    for (const eye of eyes) {
      ctx.beginPath();
      ctx.fillStyle = "#ffffff";
      ctx.arc(eye.x, eye.y, eyeR, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.strokeStyle = "rgba(197,208,226,0.45)";
      ctx.lineWidth = Math.max(0.7, r * 0.03);
      ctx.arc(eye.x, eye.y, eyeR, 0, Math.PI * 2);
      ctx.stroke();

      const ldx = lookX - eye.x;
      const ldy = lookY - eye.y;
      const ld = Math.hypot(ldx, ldy) || 1;
      const strength = Math.min(1, ld / (r * 1.6));
      const px = eye.x + (ldx / ld) * maxPupilTravel * strength;
      const py = eye.y + (ldy / ld) * maxPupilTravel * strength;

      ctx.beginPath();
      ctx.fillStyle = "#111111";
      ctx.arc(px, py, pupilR, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.arc(px + pupilR * 0.3, py - pupilR * 0.32, pupilR * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawNameplate(ctx, snake) {
    if (!snake.name || snake.isPlayer) return;
    const head = snake.head;
    const r = snake.radius;
    const fontSize = Math.max(11, 11 + r * 0.08);
    ctx.font = `600 ${fontSize}px Ubuntu, Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.strokeText(snake.name, head.x, head.y - r - 6);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(snake.name, head.x, head.y - r - 6);
  }

  _drawMinimap(game) {
    const c = this.minimap;
    const ctx = this.mctx;
    const w = c.width;
    const h = c.height;
    const cx = w / 2;
    const cy = h / 2;
    const pad = 5;
    const R = w / 2 - pad;
    const scale = R / WORLD_RADIUS;
    const t = performance.now() * 0.001;

    ctx.clearRect(0, 0, w, h);

    // Outer double-ring bezel
    ctx.beginPath();
    ctx.arc(cx, cy, R + 3.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    // Quiet dark base + soft checkerboard quadrants
    ctx.fillStyle = "#12141a";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    ctx.fillRect(0, 0, cx, cy);
    ctx.fillRect(cx, cy, cx, cy);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(cx, 0, cx, cy);
    ctx.fillRect(0, cy, cx, cy);

    // Crosshair + range rings
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    ctx.stroke();

    // Liquidity / death food (cached)
    this._drawMinimapLiquidity(game);

    // Cash-out zones — filled dots, same world proportion as arena discs
    this._drawMinimapCashOutZones(ctx, game, cx, cy, scale);

    // Rival snakes — thick white worms with clear heads
    this._drawMinimapSnakes(ctx, game, cx, cy, scale);

    ctx.restore();

    // Inner rim
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Player marker drawn last (above rim) so you always find yourself
    if (game.player && game.player.alive) {
      this._drawMinimapPlayer(ctx, game.player, cx, cy, R, scale, t);
    }
  }

  _drawMinimapCashOutZones(ctx, game, cx, cy, scale) {
    const zones = game.cashOutZones;
    if (!zones?.length) return;

    for (const z of zones) {
      const mx = cx + z.x * scale;
      const my = cy + z.y * scale;
      const mr = z.radius * scale;
      ctx.beginPath();
      ctx.fillStyle = "rgba(32, 196, 180, 0.55)";
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = "rgba(120, 255, 235, 0.95)";
      ctx.lineWidth = 1.25;
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _drawMinimapSnakes(ctx, game, cx, cy, scale) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const s of game.snakes) {
      if (!s.alive || s.isPlayer) continue;
      const segs = s.segments;
      if (segs.length < 2) continue;

      // Dense enough samples so curves stay smooth on the radar
      const step = Math.max(1, Math.ceil(segs.length / 90));
      const bodyW = Math.max(2.8, Math.min(8.5, s.radius * scale * 2.1));

      // Dark under-stroke for edge definition
      ctx.beginPath();
      for (let i = 0; i < segs.length; i += step) {
        const sx = cx + segs[i].x * scale;
        const sy = cy + segs[i].y * scale;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      // Always include tip
      const tip = segs[segs.length - 1];
      ctx.lineTo(cx + tip.x * scale, cy + tip.y * scale);
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.lineWidth = bodyW + 2.4;
      ctx.stroke();

      // Bright body
      ctx.beginPath();
      for (let i = 0; i < segs.length; i += step) {
        const sx = cx + segs[i].x * scale;
        const sy = cy + segs[i].y * scale;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.lineTo(cx + tip.x * scale, cy + tip.y * scale);
      ctx.strokeStyle = "rgba(245, 248, 255, 0.95)";
      ctx.lineWidth = bodyW;
      ctx.stroke();

      // Head bulb — makes the snake read as a creature, not a scratch
      const head = segs[0];
      const hx = cx + head.x * scale;
      const hy = cy + head.y * scale;
      const hr = bodyW * 0.72;
      ctx.beginPath();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.arc(hx, hy, hr + 1.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.fillStyle = "#ffffff";
      ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawMinimapPlayer(ctx, player, cx, cy, R, scale, t) {
    let hx = cx + player.head.x * scale;
    let hy = cy + player.head.y * scale;

    // Keep marker fully inside the disc
    const dx = hx - cx;
    const dy = hy - cy;
    const dist = Math.hypot(dx, dy);
    const maxR = R - 7;
    if (dist > maxR) {
      const k = maxR / dist;
      hx = cx + dx * k;
      hy = cy + dy * k;
    }

    const accent = pickMinimapAccent(player.skin);
    const pulse = 0.55 + 0.45 * Math.sin(t * 4.2);

    // Soft outer glow (skin accent)
    const glow = ctx.createRadialGradient(hx, hy, 1, hx, hy, 16);
    glow.addColorStop(0, hexAlpha(accent, 0.55 * pulse));
    glow.addColorStop(0.45, hexAlpha(accent, 0.18 * pulse));
    glow.addColorStop(1, hexAlpha(accent, 0));
    ctx.beginPath();
    ctx.fillStyle = glow;
    ctx.arc(hx, hy, 16, 0, Math.PI * 2);
    ctx.fill();

    // Facing wedge — shows where you're headed
    const ang = player.angle ?? 0;
    const tip = 11;
    ctx.beginPath();
    ctx.moveTo(hx + Math.cos(ang) * tip, hy + Math.sin(ang) * tip);
    ctx.lineTo(
      hx + Math.cos(ang + 2.5) * 5.5,
      hy + Math.sin(ang + 2.5) * 5.5
    );
    ctx.lineTo(
      hx + Math.cos(ang - 2.5) * 5.5,
      hy + Math.sin(ang - 2.5) * 5.5
    );
    ctx.closePath();
    ctx.fillStyle = hexAlpha(accent, 0.85);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Dark halo so the pin stays readable on white liquidity
    ctx.beginPath();
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.arc(hx, hy, 6.4, 0, Math.PI * 2);
    ctx.fill();

    // Accent ring
    ctx.beginPath();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.arc(hx, hy, 5.2, 0, Math.PI * 2);
    ctx.stroke();

    // Bright core
    ctx.beginPath();
    ctx.fillStyle = "#ffffff";
    ctx.arc(hx, hy, 2.6, 0, Math.PI * 2);
    ctx.fill();

    // Tiny accent pupil
    ctx.beginPath();
    ctx.fillStyle = accent;
    ctx.arc(hx, hy, 1.15, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * Ambient food = faint dots. Death spills only = bright pellets + soft glow.
   * Boost trail crumbs are intentionally omitted from the radar.
   */
  _drawMinimapLiquidity(game) {
    const items = game.food?.items;
    if (!items || !items.length) return;

    const w = this.minimap.width;
    const h = this.minimap.height;
    const now = performance.now();
    if (
      !this._liqCanvas ||
      this._liqCanvas.width !== w ||
      this._liqCanvas.height !== h
    ) {
      this._liqCanvas = document.createElement("canvas");
      this._liqCanvas.width = w;
      this._liqCanvas.height = h;
      this._liqCtx = this._liqCanvas.getContext("2d");
      this._liqAt = 0;
    }

    // Death piles change often — refresh fairly quickly
    if (now - (this._liqAt || 0) > 50) {
      this._liqAt = now;
      this._rebuildMinimapLiquidity(items, w, h);
    }

    this.mctx.drawImage(this._liqCanvas, 0, 0);
  }

  _rebuildMinimapLiquidity(items, w, h) {
    const lctx = this._liqCtx;
    lctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const R = w / 2 - 5;
    const scale = R / WORLD_RADIUS;

    // Soft underglow under death clusters (smooth discs, not jagged shapes)
    const G = 40;
    const deathDens = this._minimapDens || (this._minimapDens = new Float32Array(G * G));
    deathDens.fill(0);
    const origin = -WORLD_RADIUS;
    const cell = (WORLD_RADIUS * 2) / G;
    let maxDeath = 0;

    const death = [];
    const ambient = [];
    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      const kind = f.kind ?? "map";
      // Only corpse spills — ignore boost trail crumbs
      if (kind === "death") {
        death.push(f);
        const ix = ((f.x - origin) / cell) | 0;
        const iy = ((f.y - origin) / cell) | 0;
        if (ix >= 0 && iy >= 0 && ix < G && iy < G) {
          const idx = iy * G + ix;
          deathDens[idx] += 1;
          if (deathDens[idx] > maxDeath) maxDeath = deathDens[idx];
        }
      } else if (kind === "map") {
        ambient.push(f);
      }
    }

    if (maxDeath > 0) {
      for (let iy = 0; iy < G; iy++) {
        for (let ix = 0; ix < G; ix++) {
          const d = deathDens[iy * G + ix];
          if (d < 2) continue;
          const tNorm = Math.min(1, d / (maxDeath + 0.001));
          const wx = origin + (ix + 0.5) * cell;
          const wy = origin + (iy + 0.5) * cell;
          const mx = cx + wx * scale;
          const my = cy + wy * scale;
          const rad = (cell * scale) * (0.9 + tNorm * 1.1);
          const g = lctx.createRadialGradient(mx, my, 0, mx, my, rad);
          g.addColorStop(0, `rgba(255,255,255,${0.16 + tNorm * 0.22})`);
          g.addColorStop(0.55, `rgba(255,255,255,${0.05 + tNorm * 0.08})`);
          g.addColorStop(1, "rgba(255,255,255,0)");
          lctx.beginPath();
          lctx.fillStyle = g;
          lctx.arc(mx, my, rad, 0, Math.PI * 2);
          lctx.fill();
        }
      }
    }

    // Ambient map food — sparse faint pins (context only)
    lctx.fillStyle = "rgba(200, 210, 225, 0.22)";
    const ambStride = Math.max(1, (ambient.length / 420) | 0);
    for (let i = 0; i < ambient.length; i += ambStride) {
      const f = ambient[i];
      lctx.fillRect(cx + f.x * scale, cy + f.y * scale, 1.2, 1.2);
    }

    // Death pellets only — clean circular coins (boost trails stay off the radar)
    const maxPellets = 520;
    const stride = death.length > maxPellets ? Math.ceil(death.length / maxPellets) : 1;
    for (let i = 0; i < death.length; i += stride) {
      const f = death[i];
      const mx = cx + f.x * scale;
      const my = cy + f.y * scale;
      const pr = Math.max(1.6, Math.min(3.4, (f.radius || 3) * scale * 2.8));

      lctx.beginPath();
      lctx.fillStyle = "rgba(255,255,255,0.28)";
      lctx.arc(mx, my, pr * 1.85, 0, Math.PI * 2);
      lctx.fill();

      lctx.beginPath();
      lctx.fillStyle = "rgba(255,255,255,0.95)";
      lctx.arc(mx, my, pr, 0, Math.PI * 2);
      lctx.fill();
    }
  }
}

/** Parse #rrggbb → rgba() with alpha. */
function hexAlpha(hex, a) {
  const n = (hex || "#ffffff").replace("#", "");
  const full = n.length === 3 ? n.split("").map((c) => c + c).join("") : n;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return `rgba(255,255,255,${a})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${a})`;
}

/** Brightest skin accent that still reads on the dark radar; falls back to mint. */
function pickMinimapAccent(skin) {
  const colors = skin?.colors || [];
  let best = CIRCUIT_ACCENT;
  let bestL = -1;
  for (const hex of colors) {
    const n = (hex || "").replace("#", "");
    const full = n.length === 3 ? n.split("").map((c) => c + c).join("") : n;
    const num = parseInt(full, 16);
    if (Number.isNaN(num)) continue;
    const r = ((num >> 16) & 255) / 255;
    const g = ((num >> 8) & 255) / 255;
    const b = (num & 255) / 255;
    // Relative luminance
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (L > bestL) {
      bestL = L;
      best = hex;
    }
  }
  // Too dark (e.g. Cardano navy) — use high-visibility mint
  return bestL >= 0.22 ? best : CIRCUIT_ACCENT;
}
