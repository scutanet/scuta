/**
 * SCUTA.IO regional arena entry point.
 *
 *   node server/index.js --region NA
 *   node server/index.js --region EU
 *   node server/index.js --region ASIA
 *
 * Exposes:
 *   GET  /health  → { region, players, uptime, ping }
 *   WS   /        → multiplayer socket (player count for health)
 *
 * Game simulation stays in the existing client modules; this process is the
 * regional network layer (health + WebSocket hub). Zero npm deps.
 */

import http from "node:http";
import { getRegionById, REGIONS, regionDisplayName } from "../js/regions.js";
import { acceptWebSocket } from "./ws-lite.js";

const startedAt = Date.now();

/** @type {Set<import("./ws-lite.js").LiteSocket>} */
const clients = new Set();

function parseArgs(argv) {
  const out = { region: "NA", port: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--region" || a === "-r") {
      out.region = argv[++i] || out.region;
    } else if (a.startsWith("--region=")) {
      out.region = a.slice("--region=".length);
    } else if (a === "--port" || a === "-p") {
      out.port = Number(argv[++i]);
    } else if (a.startsWith("--port=")) {
      out.port = Number(a.slice("--port=".length));
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const region = getRegionById(args.region);

if (!region) {
  const ids = REGIONS.map((r) => r.id).join(", ");
  console.error(`[scuta] Unknown region "${args.region}". Use one of: ${ids}`);
  process.exit(1);
}

const PORT = Number.isFinite(args.port) && args.port > 0 ? args.port : region.port;
const LABEL = regionDisplayName(region);

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

function healthPayload() {
  return {
    region: region.id,
    players: clients.size,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    /** Client measures RTT from the request; field kept for the public contract. */
    ping: 0,
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
      players: clients.size,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    });
    return;
  }

  sendJson(res, 404, { error: "not_found" });
});

server.on("upgrade", (req, socket, head) => {
  const client = acceptWebSocket(req, socket, head);
  if (!client) return;

  clients.add(client);
  console.info(`[scuta:${region.id}] client connected (${clients.size} online)`);

  client.send(
    JSON.stringify({
      type: "welcome",
      region: region.id,
      label: LABEL,
      players: clients.size,
    })
  );

  const drop = () => {
    if (clients.delete(client)) {
      console.info(`[scuta:${region.id}] client left (${clients.size} online)`);
    }
  };

  client.on("close", drop);
  client.on("error", drop);

  client.on("message", (raw) => {
    let msg = null;
    try {
      msg = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
    } catch {
      return;
    }
    if (msg?.type === "ping") {
      client.send(JSON.stringify({ type: "pong", t: msg.t ?? Date.now() }));
    }
  });
});

server.listen(PORT, () => {
  console.info(`[scuta] Regional server ready`);
  console.info(`[scuta] Region : ${LABEL}`);
  console.info(`[scuta] Host   : ${region.host}`);
  console.info(`[scuta] Listen : 0.0.0.0:${PORT}`);
  console.info(`[scuta] Health : http://0.0.0.0:${PORT}/health`);
});

function shutdown(signal) {
  console.info(`[scuta:${region.id}] ${signal} — shutting down`);
  for (const c of clients) {
    try {
      c.close();
    } catch {
      /* ignore */
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
