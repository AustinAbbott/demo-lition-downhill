// Local dev server with zero dependencies: `node dev/server.mjs`
// Serves ./public and runs rooms in-process using the same RoomLogic the
// Durable Object uses. (`npx wrangler dev` also works if you have wrangler.)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RoomLogic } from '../public/js/room.js';

const PORT = +(process.env.PORT || 8787);
const ROOT = path.resolve(fileURLToPath(new URL('../public', import.meta.url)));
const ROOM_RE = /^\/api\/room\/([A-Za-z0-9]{3,8})\/ws$/;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const rooms = new Map();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
});

server.on('upgrade', (req, socket) => {
  const m = new URL(req.url, 'http://x').pathname.match(ROOM_RE);
  const key = req.headers['sec-websocket-key'];
  if (!m || !key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const code = m[1].toUpperCase();
  let room = rooms.get(code);
  if (!room) { room = new RoomLogic(code, { onEmpty: () => rooms.delete(code) }); rooms.set(code, room); }
  const ws = new MiniWS(socket);
  room.attach(ws);
  ws.onmessage = (d) => room.message(ws, d);
  ws.onclose = () => room.detach(ws);
});

// Just enough of RFC 6455 for unfragmented text frames.
class MiniWS {
  constructor(sock) {
    this.sock = sock; this.buf = Buffer.alloc(0); this.closed = false; this.ended = false;
    sock.setNoDelay(true);
    sock.on('data', (d) => this.data(d));
    sock.on('close', () => this.end());
    sock.on('error', () => this.end());
  }
  data(d) {
    this.buf = Buffer.concat([this.buf, d]);
    for (;;) {
      if (this.buf.length < 2) return;
      const op = this.buf[0] & 0x0f, masked = this.buf[1] & 0x80;
      let len = this.buf[1] & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      const mo = masked ? 4 : 0;
      if (this.buf.length < off + mo + len) return;
      let payload = Buffer.from(this.buf.subarray(off + mo, off + mo + len));
      if (masked) { const mask = this.buf.subarray(off, off + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]; }
      this.buf = this.buf.subarray(off + mo + len);
      if (op === 1) this.onmessage?.(payload.toString('utf8'));
      else if (op === 8) this.close();
      else if (op === 9) this.frame(10, payload);
    }
  }
  frame(op, payload) {
    if (this.closed) return;
    const len = payload.length;
    let hdr;
    if (len < 126) hdr = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { hdr = Buffer.alloc(4); hdr[0] = 0x80 | op; hdr[1] = 126; hdr.writeUInt16BE(len, 2); }
    else { hdr = Buffer.alloc(10); hdr[0] = 0x80 | op; hdr[1] = 127; hdr.writeBigUInt64BE(BigInt(len), 2); }
    this.sock.write(Buffer.concat([hdr, payload]));
  }
  send(s) { this.frame(1, Buffer.from(s, 'utf8')); }
  close() { if (this.closed) return; this.frame(8, Buffer.alloc(0)); this.closed = true; this.sock.end(); this.end(); }
  end() { if (this.ended) return; this.ended = true; this.closed = true; this.onclose?.(); }
}

server.listen(PORT, () => console.log(`Demolition Downhill dev server → http://localhost:${PORT}`));
