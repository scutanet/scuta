/**
 * SCUTA.IO authoritative regional arena.
 *
 *   node server/index.js --region NA
 *
 * Protocol (JSON over WebSocket):
 *   C→S  { type:"join", name, skin }
 *   C→S  { type:"input", angle, boost }
 *   C→S  { type:"ping", t }
 *   S→C  { type:"welcome", playerId, region, ... }
 *   S→C  { type:"state", t, snakes, food, ... }   // 20 Hz
 *   S→C  { type:"died" | "cashed", ... }
 */

import http from "node:http";
import crypto from "node:crypto";
import { getRegionById, REGIONS, regionDisplayName } from "../js/regions.js";
import { acceptWebSocket } from "./ws-lite.js";
import { AuthoritativeWorld, SNAPSHOT_HZ } from "./world.js";

const startedAt = Date.now();

function parseArgs(argv) {
  const out = { region: "NA", port: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--region" || a === "-r") out.region = argv[++i] || out.region;
    else if (a.startsWith("--region=")) out.region = a.slice("--region=".length);
    else if (a === "--port" || a === "-p") out.port = Number(argv[++i]);
    else if (a.startsWith("--port=")) out.port = Number(a.slice("--port=".length));
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const region = getRegionById(args.region);
if (!region) {
  console.error(`[scuta] Unknown region "${args.region}". Use: ${REGIONS.map((r) => r.id).join(", ")}`);
  process.exit(1);
}

const PORT = Number.isFinite(args.port) && args.port > 0 ? args.port : region.port;
const LABEL = regionDisplayName(region);

const world = new AuthoritativeWorld({ regionId: region.id });
world.start();

/** @type {Map<string, { socket: import("./ws-lite.js").LiteSocket, id: string, joined: boolean }>} */
const peers = new Map();

world.onEvent = (evt) => {
  if (!evt.clientId) return;
  const peer = peers.get(evt.clientId);
  if (!peer) return;
  if (evt.type === "died") {
    send(peer.socket, { type: "died", length: evt.length || 0 });
  } else if (evt.type === "cashed") {
    send(peer.socket, { type: "cashed", amount: evt.amount || 0, length: evt.length || 0 });
  }
};

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

function sendJson(res, status, body) {
  cors(res);
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function send(socket, obj) {
  try {
    if (socket.readyState === 1) socket.send(JSON.stringify(obj));
  } catch {
    /* ignore */
  }
}

function healthPayload() {
  return {
    region: region.id,
    players: world.humanCount(),
    bots: world.botCount(),
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    tick: world.tick,
    ping: 0,
    authoritative: true,
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/health/")) {
    sendJson(res, 200, healthPayload());
    return;
  }
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/info")) {
    sendJson(res, 200, {
      name: "SCUTA.IO",
      region: region.id,
      label: LABEL,
      city: region.city,
      host: region.host,
      port: PORT,
      players: world.humanCount(),
      bots: world.botCount(),
      uptime: Math.floor((Date.now() - startedAt) / 1000),
      authoritative: true,
    });
    return;
  }
  sendJson(res, 404, { error: "not_found" });
});

server.on("upgrade", (req, socket, head) => {
  const ws = acceptWebSocket(req, socket, head);
  if (!ws) return;

  const id = crypto.randomBytes(8).toString("hex");
  const peer = { socket: ws, id, joined: false };
  peers.set(id, peer);

  send(ws, {
    type: "hello",
    region: region.id,
    label: LABEL,
    clientId: id,
    players: world.humanCount(),
    bots: world.botCount(),
    authoritative: true,
  });

  const drop = () => {
    if (!peers.has(id)) return;
    peers.delete(id);
    world.removePlayer(id);
    console.info(`[scuta:${region.id}] leave ${id} (humans=${world.humanCount()})`);
  };

  ws.on("close", drop);
  ws.on("error", drop);

  ws.on("message", (raw) => {
    let msg = null;
    try {
      msg = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "ping") {
      send(ws, { type: "pong", t: msg.t ?? Date.now() });
      return;
    }

    if (msg.type === "join") {
      if (peer.joined) return;
      try {
        const snake = world.addPlayer(id, {
          name: msg.name,
          skin: msg.skin,
        });
        peer.joined = true;
        send(ws, {
          type: "welcome",
          playerId: snake.id,
          clientId: id,
          region: region.id,
          label: LABEL,
          name: snake.name,
          players: world.humanCount(),
          bots: world.botCount(),
        });
        send(ws, world.buildSnapshot(id));
        console.info(`[scuta:${region.id}] join ${snake.name} (${id}) humans=${world.humanCount()}`);
      } catch (err) {
        send(ws, {
          type: "error",
          code: err?.code || "join_failed",
          message: err?.message || "join failed",
        });
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      return;
    }

    if (msg.type === "input") {
      if (!peer.joined) return;
      world.setInput(id, {
        angle: Number(msg.angle),
        boost: Boolean(msg.boost),
      });
    }
  });
});

/** Broadcast AOI snapshots at SNAPSHOT_HZ */
const snapMs = Math.round(1000 / SNAPSHOT_HZ);
setInterval(() => {
  for (const [id, peer] of peers) {
    if (!peer.joined) continue;
    send(peer.socket, world.buildSnapshot(id));
  }
}, snapMs);

server.listen(PORT, () => {
  console.info(`[scuta] Authoritative arena ready`);
  console.info(`[scuta] Region : ${LABEL}`);
  console.info(`[scuta] Listen : 0.0.0.0:${PORT}`);
  console.info(`[scuta] Health : http://0.0.0.0:${PORT}/health`);
  console.info(`[scuta] Sim ${60}Hz · snapshots ${SNAPSHOT_HZ}Hz · bots ${world.botCount()}`);
});

function shutdown(signal) {
  console.info(`[scuta:${region.id}] ${signal} — shutting down`);
  world.stop();
  for (const [, peer] of peers) {
    try {
      peer.socket.close();
    } catch {
      /* ignore */
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
