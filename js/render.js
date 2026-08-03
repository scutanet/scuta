import { WORLD_RADIUS, hsl, shadeColor } from "./utils.js";
import { getFoodSprite, loadFoodSprites } from "./food-sprites.js";

const HEX_SIZE = 22;
const HEX_W = Math.sqrt(3) * HEX_SIZE;
const HEX_H = HEX_SIZE * 1.5;
const ARENA_FILL = "#262a33";
const ARENA_HEX = "#2c313c";
const ARENA_EDGE = "#1a1d24";
const VOID = "#0c0d10";

export class Renderer {
  constructor(canvas, minimapCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.minimap = minimapCanvas;
    this.mctx = minimapCanvas.getContext("2d");
    // Real Slither start FOV (~14 hexes across)
    this.cam = { x: 0, y: 0, zoom: 3.4 };
    this.viewW = 0;
    this.viewH = 0;
    this.dpr = 1;
    this.time = 0;
    this.particles = [];
    this._hexPattern = null;
    this._buildHexPattern();
    this.resize();
    loadFoodSprites();
  }

  _buildHexPattern() {
    const tileW = Math.max(1, Math.round(HEX_W));
    const tileH = Math.max(1, Math.round(HEX_H * 2));
    const c = document.createElement("canvas");
    c.width = tileW;
    c.height = tileH;
    const ctx = c.getContext("2d");
    ctx.fillStyle = ARENA_FILL;
    ctx.fillRect(0, 0, tileW, tileH);
    ctx.fillStyle = ARENA_HEX;
    ctx.strokeStyle = ARENA_EDGE;
    ctx.lineWidth = 1.2;

    const drawAt = (x, y) => {
      this._hexPath(ctx, x, y, HEX_SIZE - 0.35);
      ctx.fill();
      ctx.stroke();
    };

    // Seamless pointy-top honeycomb tile
    drawAt(HEX_W * 0.5, HEX_SIZE);
    drawAt(0, HEX_SIZE + HEX_H);

    this._hexPattern = ctx.createPattern(c, "repeat");
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

    // Real Slither.io FOV: tight when small (~14 hexes across), then ease out
    // with sqrt(mass) so early growth zooms gently and huge snakes pull way back.
    const growth = Math.max(0, snake.mass - 12);
    const fat = Math.max(0, snake.radius - 8);
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
    this._drawFood(ctx, game.food.items, game);
    this._updateParticles(game);
    this._drawParticles(ctx);
    this._drawSnakes(ctx, game.snakes, game);

    ctx.restore();
    this._drawMinimap(game);
  }

  _drawArena(ctx) {
    ctx.beginPath();
    ctx.arc(0, 0, WORLD_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = this._hexPattern || ARENA_FILL;
    ctx.fill();

    // Soft outer rim like Slither
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

  _hexPath(ctx, cx, cy, size) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 180) * (60 * i - 30);
      const x = cx + size * Math.cos(a);
      const y = cy + size * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  _drawFood(ctx, items, game) {
    const viewPad = Math.max(this.viewW, this.viewH) / this.cam.zoom * 0.58;
    const cx = this.cam.x;
    const cy = this.cam.y;
    // Scale coins to ~55% of the viewing snake's head diameter (never near 2×)
    const headR = game?.player?.alive
      ? game.player.radius
      : (game?.snakes?.find((s) => s.alive)?.radius ?? 8);

    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      if (Math.abs(f.x - cx) > viewPad || Math.abs(f.y - cy) > viewPad) continue;

      const pulse = 1 + Math.sin(this.time * 2.4 + f.pulse) * 0.06;
      const mul = f.sizeMul ?? 1;
      // Diameter ≈ 2.2 × head radius ≈ 1.1 × head diameter
      const size = headR * 2.2 * mul * pulse;
      const img = getFoodSprite(f.sprite ?? 0);

      if (img) {
        ctx.drawImage(img, f.x - size * 0.5, f.y - size * 0.5, size, size);
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

    for (const snake of game.snakes) {
      if (!snake.alive || !snake.boosting) continue;
      const h = snake.head;
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
    const sorted = [...snakes].filter((s) => s.alive).sort((a, b) => a.mass - b.mass);
    for (const snake of sorted) this._drawSnake(ctx, snake, game);
  }

  _drawSegment(ctx, x, y, r, color) {
    // Dark rim then body — classic Slither overlapping discs
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

  _drawSnake(ctx, snake, game) {
    const segs = snake.segments;
    if (segs.length < 2) return;

    const colors = snake.skin.colors;
    const r = snake.radius;
    const viewPad = Math.max(this.viewW, this.viewH) / this.cam.zoom * 0.65;
    const cx = this.cam.x;
    const cy = this.cam.y;
    const hq = snake.isPlayer || Math.hypot(snake.head.x - cx, snake.head.y - cy) < 750;

    if (snake.boosting) {
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

    // Never skip segments on the focused snake — stepping by 2 with striped
    // skins flips the whole body between colors whenever length parity changes.
    const step = hq ? 1 : segs.length > 80 ? 2 : 1;

    for (let i = segs.length - 1; i >= 1; i -= step) {
      const s = segs[i];
      if (Math.abs(s.x - cx) > viewPad || Math.abs(s.y - cy) > viewPad) continue;
      // Keep stripe phase stable when distant bots are drawn with step > 1
      const color = colors[Math.floor(i / step) % colors.length];
      const taper = i > segs.length - 8 ? 0.78 + ((segs.length - i) / 8) * 0.22 : 1;
      const sr = r * taper;

      if (hq) {
        this._drawSegment(ctx, s.x, s.y, sr, color);
      } else {
        ctx.beginPath();
        ctx.fillStyle = shadeColor(color, -35);
        ctx.arc(s.x, s.y, sr + 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(s.x, s.y, sr, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const head = segs[0];
    this._drawSegment(ctx, head.x, head.y, r, colors[0]);
    this._drawEyes(ctx, snake, game);
    this._drawNameplate(ctx, snake);
  }

  _drawEyes(ctx, snake, game) {
    const head = snake.head;
    const r = snake.radius;
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

    // Slither-style: large round eyes on the front of the head
    const eyeOffset = r * 0.42;
    const eyeSpread = r * 0.48;
    const perp = faceAng + Math.PI / 2;
    const eyeR = Math.max(3.4, r * 0.42);
    const pupilR = Math.max(1.5, r * 0.2);
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
    const scale = (w / 2 - 6) / WORLD_RADIUS;

    ctx.clearRect(0, 0, w, h);

    ctx.beginPath();
    ctx.fillStyle = "rgba(20, 22, 28, 0.82)";
    ctx.arc(cx, cy, w / 2 - 1, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1.5;
    ctx.arc(cx, cy, w / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();

    // Other snakes as soft grey clusters
    for (const s of game.snakes) {
      if (!s.alive || s.isPlayer) continue;
      const hx = cx + s.head.x * scale;
      const hy = cy + s.head.y * scale;
      ctx.beginPath();
      ctx.fillStyle = "rgba(200, 200, 210, 0.35)";
      ctx.arc(hx, hy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (game.player && game.player.alive) {
      const hx = cx + game.player.head.x * scale;
      const hy = cy + game.player.head.y * scale;
      ctx.beginPath();
      ctx.fillStyle = "#ffffff";
      ctx.arc(hx, hy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
