import { WORLD_RADIUS, hsl, shadeColor } from "./utils.js";

export class Renderer {
  constructor(canvas, minimapCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.minimap = minimapCanvas;
    this.mctx = minimapCanvas.getContext("2d");
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.viewW = 0;
    this.viewH = 0;
    this.dpr = 1;
    this.time = 0;
    this.particles = [];
    this.resize();
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
    const targetZoom = Math.max(0.45, Math.min(1.15, 1.05 - (snake.radius - 8) * 0.012));
    this.cam.zoom += (targetZoom - this.cam.zoom) * 0.06;
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

    // Outside-arena void
    ctx.fillStyle = "#040e0d";
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    ctx.save();
    ctx.translate(this.viewW / 2, this.viewH / 2);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);

    this._drawArena(ctx);
    this._drawFood(ctx, game.food.items);
    this._updateParticles(game);
    this._drawParticles(ctx);
    this._drawSnakes(ctx, game.snakes, game);
    this._drawCursor(ctx, game);

    ctx.restore();

    this._drawVignette(ctx);
    this._drawMinimap(game);
  }

  _drawArena(ctx) {
    const g = ctx.createRadialGradient(0, 0, WORLD_RADIUS * 0.05, 0, 0, WORLD_RADIUS);
    g.addColorStop(0, "#1a3f3a");
    g.addColorStop(0.45, "#123330");
    g.addColorStop(0.82, "#0c2422");
    g.addColorStop(1, "#071716");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, WORLD_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // Soft atmospheric haze near center
    const haze = ctx.createRadialGradient(
      this.cam.x, this.cam.y, 40,
      this.cam.x, this.cam.y, 900
    );
    haze.addColorStop(0, "rgba(60, 140, 120, 0.06)");
    haze.addColorStop(1, "rgba(60, 140, 120, 0)");
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.arc(0, 0, WORLD_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // Dot grid
    const spacing = 26;
    const viewPad = Math.max(this.viewW, this.viewH) / this.cam.zoom;
    const minX = Math.floor((this.cam.x - viewPad) / spacing) * spacing;
    const maxX = Math.ceil((this.cam.x + viewPad) / spacing) * spacing;
    const minY = Math.floor((this.cam.y - viewPad) / spacing) * spacing;
    const maxY = Math.ceil((this.cam.y + viewPad) / spacing) * spacing;

    for (let x = minX; x <= maxX; x += spacing) {
      for (let y = minY; y <= maxY; y += spacing) {
        if (x * x + y * y > WORLD_RADIUS * WORLD_RADIUS) continue;
        const flicker = 0.1 + ((x * 12.9898 + y * 78.233) % 1) * 0.08;
        ctx.beginPath();
        ctx.fillStyle = `rgba(110, 190, 165, ${flicker})`;
        ctx.arc(x, y, 1.15, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Boundary — inner glow ring + thick dark rim
    ctx.beginPath();
    ctx.strokeStyle = "rgba(70, 200, 160, 0.55)";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(60, 220, 160, 0.45)";
    ctx.shadowBlur = 18;
    ctx.arc(0, 0, WORLD_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    ctx.strokeStyle = "rgba(20, 55, 48, 0.85)";
    ctx.lineWidth = 36;
    ctx.arc(0, 0, WORLD_RADIUS + 20, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = "rgba(90, 180, 150, 0.15)";
    ctx.lineWidth = 2;
    ctx.arc(0, 0, WORLD_RADIUS + 38, 0, Math.PI * 2);
    ctx.stroke();
  }

  _drawFood(ctx, items) {
    const viewPad = Math.max(this.viewW, this.viewH) / this.cam.zoom * 0.58;
    const cx = this.cam.x;
    const cy = this.cam.y;

    for (let i = 0; i < items.length; i++) {
      const f = items[i];
      if (Math.abs(f.x - cx) > viewPad || Math.abs(f.y - cy) > viewPad) continue;

      const pulse = 1 + Math.sin(this.time * 2.8 + f.pulse) * 0.1;
      const r = f.radius * pulse;
      const color = hsl(f.h, f.s, f.l);

      // Soft bloom
      ctx.beginPath();
      ctx.fillStyle = hsl(f.h, f.s, f.l, 0.22);
      ctx.arc(f.x, f.y, r * 2.1, 0, Math.PI * 2);
      ctx.fill();

      // Core ball
      const grad = ctx.createRadialGradient(
        f.x - r * 0.3, f.y - r * 0.3, r * 0.05,
        f.x, f.y, r
      );
      grad.addColorStop(0, hsl(f.h, Math.max(40, f.s - 10), Math.min(92, f.l + 28)));
      grad.addColorStop(0.55, color);
      grad.addColorStop(1, hsl(f.h, f.s, Math.max(25, f.l - 22)));
      ctx.beginPath();
      ctx.fillStyle = grad;
      ctx.arc(f.x, f.y, r, 0, Math.PI * 2);
      ctx.fill();

      // Specular
      ctx.beginPath();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.arc(f.x - r * 0.32, f.y - r * 0.34, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _updateParticles(game) {
    // Age existing
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

  _drawSegment(ctx, x, y, r, color, outline = true) {
    if (outline) {
      ctx.beginPath();
      ctx.fillStyle = shadeColor(color, -55);
      ctx.arc(x, y, r + 1.1, 0, Math.PI * 2);
      ctx.fill();
    }

    const grad = ctx.createRadialGradient(
      x - r * 0.32, y - r * 0.36, r * 0.08,
      x, y, r
    );
    grad.addColorStop(0, shadeColor(color, 70));
    grad.addColorStop(0.35, shadeColor(color, 18));
    grad.addColorStop(0.75, color);
    grad.addColorStop(1, shadeColor(color, -40));

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
    const hq = snake.isPlayer || Math.hypot(snake.head.x - cx, snake.head.y - cy) < 700;

    // Boost aura
    if (snake.boosting) {
      const head = segs[0];
      const glow = ctx.createRadialGradient(head.x, head.y, r * 0.2, head.x, head.y, r * 2.4);
      glow.addColorStop(0, "rgba(255,255,255,0.18)");
      glow.addColorStop(0.5, `${colors[0]}33`);
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.beginPath();
      ctx.fillStyle = glow;
      ctx.arc(head.x, head.y, r * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }

    const step = !hq && segs.length > 80 ? 2 : segs.length > 220 ? 2 : 1;

    for (let i = segs.length - 1; i >= 1; i -= step) {
      const s = segs[i];
      if (Math.abs(s.x - cx) > viewPad || Math.abs(s.y - cy) > viewPad) continue;
      const color = colors[i % colors.length];
      const taper = i > segs.length - 8 ? 0.72 + ((segs.length - i) / 8) * 0.28 : 1;
      const sr = r * taper * (0.94 + (i % 3 === 0 ? 0.03 : 0));

      if (hq) {
        this._drawSegment(ctx, s.x, s.y, sr, color, true);
      } else {
        ctx.beginPath();
        ctx.fillStyle = shadeColor(color, -40);
        ctx.arc(s.x, s.y, sr + 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.arc(s.x, s.y, sr, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.arc(s.x - sr * 0.28, s.y - sr * 0.3, sr * 0.32, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Head + eyes that track the cursor / aim
    const head = segs[0];
    this._drawSegment(ctx, head.x, head.y, r, colors[0], true);
    this._drawEyes(ctx, snake, game);
    this._drawNameplate(ctx, snake);
  }

  _drawEyes(ctx, snake, game) {
    const head = snake.head;
    const r = snake.radius;
    const faceAng = snake.angle;

    // Player pupils follow the cursor; bots look toward their aim
    let lookX;
    let lookY;
    if (snake.isPlayer && game?.mouseWorld) {
      lookX = game.mouseWorld.x;
      lookY = game.mouseWorld.y;
    } else {
      lookX = head.x + Math.cos(snake.targetAngle) * 240;
      lookY = head.y + Math.sin(snake.targetAngle) * 240;
    }

    const eyeOffset = r * 0.38;
    const eyeSpread = r * 0.42;
    const perp = faceAng + Math.PI / 2;
    const eyeR = Math.max(3.2, r * 0.36);
    const pupilR = Math.max(1.4, r * 0.165);
    const maxPupilTravel = eyeR - pupilR - 0.5;

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
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.arc(eye.x + 0.7, eye.y + 0.9, eyeR * 1.06, 0, Math.PI * 2);
      ctx.fill();

      const eyeGrad = ctx.createRadialGradient(
        eye.x - eyeR * 0.28,
        eye.y - eyeR * 0.32,
        eyeR * 0.1,
        eye.x,
        eye.y,
        eyeR
      );
      eyeGrad.addColorStop(0, "#ffffff");
      eyeGrad.addColorStop(0.7, "#f4f4f4");
      eyeGrad.addColorStop(1, "#c8c8c8");
      ctx.beginPath();
      ctx.fillStyle = eyeGrad;
      ctx.arc(eye.x, eye.y, eyeR, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.strokeStyle = "rgba(0,0,0,0.18)";
      ctx.lineWidth = Math.max(0.8, r * 0.04);
      ctx.arc(eye.x, eye.y, eyeR, 0, Math.PI * 2);
      ctx.stroke();

      const ldx = lookX - eye.x;
      const ldy = lookY - eye.y;
      const ld = Math.hypot(ldx, ldy) || 1;
      // Full look strength once the cursor is a short distance from the eye
      const strength = Math.min(1, ld / (r * 1.8));
      const px = eye.x + (ldx / ld) * maxPupilTravel * strength;
      const py = eye.y + (ldy / ld) * maxPupilTravel * strength;

      ctx.beginPath();
      ctx.fillStyle = "#111111";
      ctx.arc(px, py, pupilR, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.arc(px - pupilR * 0.32, py - pupilR * 0.38, pupilR * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawNameplate(ctx, snake) {
    if (!snake.name) return;
    const head = snake.head;
    const r = snake.radius;
    const labelY = head.y - r - 10;
    const fontSize = Math.max(11, 12 + r * 0.12);
    ctx.font = `700 ${fontSize}px Manrope, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";

    const tw = ctx.measureText(snake.name).width;
    const padX = 8;
    const padY = 4;
    const bw = tw + padX * 2;
    const bh = fontSize + padY * 2;
    const bx = head.x - bw / 2;
    const by = labelY - bh + 2;

    ctx.beginPath();
    roundRect(ctx, bx, by, bw, bh, 6);
    ctx.fillStyle = snake.isPlayer ? "rgba(8, 40, 32, 0.7)" : "rgba(0, 0, 0, 0.45)";
    ctx.fill();

    ctx.fillStyle = snake.isPlayer ? "#b8ffe0" : "rgba(240, 255, 248, 0.95)";
    ctx.fillText(snake.name, head.x, labelY);
  }

  _drawCursor(ctx, game) {
    if (!game.player || !game.player.alive || !game.mouseWorld) return;
    const m = game.mouseWorld;
    const t = this.time;

    ctx.beginPath();
    ctx.strokeStyle = `rgba(180, 255, 220, ${0.35 + Math.sin(t * 4) * 0.1})`;
    ctx.lineWidth = 1.5;
    ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = "rgba(180, 255, 220, 0.25)";
    ctx.lineWidth = 1;
    ctx.arc(m.x, m.y, 14, t, t + Math.PI * 1.2);
    ctx.stroke();

    ctx.beginPath();
    ctx.fillStyle = "rgba(200, 255, 230, 0.55)";
    ctx.arc(m.x, m.y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawVignette(ctx) {
    const g = ctx.createRadialGradient(
      this.viewW / 2, this.viewH / 2, Math.min(this.viewW, this.viewH) * 0.35,
      this.viewW / 2, this.viewH / 2, Math.max(this.viewW, this.viewH) * 0.72
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.38)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
  }

  _drawMinimap(game) {
    const c = this.minimap;
    const ctx = this.mctx;
    const w = c.width;
    const h = c.height;
    const cx = w / 2;
    const cy = h / 2;
    const scale = (w / 2 - 8) / WORLD_RADIUS;

    ctx.clearRect(0, 0, w, h);

    // Arena fill
    const bg = ctx.createRadialGradient(cx, cy, 4, cx, cy, w / 2 - 2);
    bg.addColorStop(0, "rgba(18, 48, 44, 0.95)");
    bg.addColorStop(1, "rgba(6, 18, 16, 0.98)");
    ctx.beginPath();
    ctx.fillStyle = bg;
    ctx.arc(cx, cy, w / 2 - 2, 0, Math.PI * 2);
    ctx.fill();

    // Grid rings
    ctx.strokeStyle = "rgba(80, 160, 140, 0.15)";
    ctx.lineWidth = 1;
    for (const f of [0.33, 0.66, 1]) {
      ctx.beginPath();
      ctx.arc(cx, cy, (w / 2 - 8) * f, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Border
    ctx.beginPath();
    ctx.strokeStyle = "rgba(100, 210, 165, 0.45)";
    ctx.lineWidth = 2;
    ctx.arc(cx, cy, w / 2 - 3, 0, Math.PI * 2);
    ctx.stroke();

    // View frustum (approx)
    if (game.player && game.player.alive) {
      const vw = (this.viewW / this.cam.zoom) * scale;
      const vh = (this.viewH / this.cam.zoom) * scale;
      const vx = cx + this.cam.x * scale - vw / 2;
      const vy = cy + this.cam.y * scale - vh / 2;
      ctx.strokeStyle = "rgba(180, 255, 220, 0.28)";
      ctx.lineWidth = 1;
      ctx.strokeRect(vx, vy, vw, vh);
    }

    for (const s of game.snakes) {
      if (!s.alive) continue;
      const hx = cx + s.head.x * scale;
      const hy = cy + s.head.y * scale;
      if (s.isPlayer) {
        ctx.beginPath();
        ctx.fillStyle = "rgba(125, 255, 184, 0.25)";
        ctx.arc(hx, hy, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.fillStyle = "#7dffb8";
        ctx.arc(hx, hy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.fillStyle = s.skin.colors[0];
        ctx.arc(hx, hy, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
