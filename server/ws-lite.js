/**
 * Minimal WebSocket upgrade + text frames for the regional hub.
 * Zero dependencies — enough for connect/count/JSON ping-pong.
 */

import crypto from "node:crypto";
import { EventEmitter } from "node:events";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export class LiteSocket extends EventEmitter {
  /** @param {import("node:stream").Duplex} socket */
  constructor(socket) {
    super();
    this.socket = socket;
    this.readyState = 1; // OPEN
    this._buf = Buffer.alloc(0);

    socket.on("data", (chunk) => this._onData(chunk));
    socket.on("close", () => {
      this.readyState = 3;
      this.emit("close");
    });
    socket.on("error", (err) => {
      this.emit("error", err);
      this.close();
    });
  }

  /** @param {string | Buffer} data */
  send(data) {
    if (this.readyState !== 1) return;
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
    this.socket.write(encodeFrame(0x1, payload));
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    try {
      this.socket.write(encodeFrame(0x8, Buffer.alloc(0)));
    } catch {
      /* ignore */
    }
    try {
      this.socket.end();
    } catch {
      /* ignore */
    }
    this.emit("close");
  }

  /** @param {Buffer} chunk */
  _onData(chunk) {
    this._buf = Buffer.concat([this._buf, chunk]);
    while (true) {
      const frame = decodeFrame(this._buf);
      if (!frame) break;
      this._buf = this._buf.subarray(frame.bytes);

      if (frame.opcode === 0x8) {
        this.close();
        return;
      }
      if (frame.opcode === 0x9) {
        // ping → pong
        this.socket.write(encodeFrame(0xa, frame.payload));
        continue;
      }
      if (frame.opcode === 0xa) continue; // pong
      if (frame.opcode === 0x1 || frame.opcode === 0x2) {
        this.emit("message", frame.payload);
      }
    }
  }
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:stream").Duplex} socket
 * @param {Buffer} head
 * @returns {LiteSocket | null}
 */
export function acceptWebSocket(req, socket, head) {
  const key = req.headers["sec-websocket-key"];
  if (!key || req.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return null;
  }

  const accept = crypto
    .createHash("sha1")
    .update(String(key) + GUID)
    .digest("base64");

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      "\r\n"
  );

  if (head?.length) socket.unshift(head);
  return new LiteSocket(socket);
}

/** @param {number} opcode @param {Buffer} payload */
function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  return Buffer.concat([header, payload]);
}

/** @param {Buffer} buf */
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const second = buf[1];
  const masked = (second & 0x80) !== 0;
  let len = second & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    const hi = buf.readUInt32BE(2);
    const lo = buf.readUInt32BE(6);
    if (hi !== 0 || lo > 0x7fffffff) return null;
    len = lo;
    offset = 10;
  }

  const maskLen = masked ? 4 : 0;
  if (buf.length < offset + maskLen + len) return null;

  let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
  if (masked) {
    const mask = buf.subarray(offset, offset + 4);
    const out = Buffer.alloc(len);
    for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4];
    payload = out;
  }

  return {
    opcode: buf[0] & 0x0f,
    payload,
    bytes: offset + maskLen + len,
  };
}
