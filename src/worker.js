// Cloudflare Worker entry point.
//   /api/room/:CODE/ws  -> WebSocket into that room's Durable Object
//   everything else      -> static files from ./public (Workers Static Assets)

import { RoomLogic } from '../public/js/room.js';

const ROOM_RE = /^\/api\/room\/([A-Za-z0-9]{3,8})\/ws$/;
const INFO_RE = /^\/api\/room\/([A-Za-z0-9]{3,8})\/info$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(ROOM_RE);
    if (m) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected a WebSocket upgrade', { status: 426 });
      }
      const code = m[1].toUpperCase();
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      return stub.fetch(request);
    }
    const info = url.pathname.match(INFO_RE);
    if (info) {
      // is there a room with this code? (used by the start screen before joining)
      const stub = env.ROOMS.get(env.ROOMS.idFromName(info[1].toUpperCase()));
      return stub.fetch(request);
    }
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};

// One Durable Object instance per room code. It holds the room in memory and
// keeps itself alive while anyone is connected (the game loop is a 20 Hz timer).
export class Room {
  constructor(state, env) {
    this.state = state;
    this.logic = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const code = (url.pathname.match(ROOM_RE) || url.pathname.match(INFO_RE))?.[1]?.toUpperCase() || 'ROOM';
    if (!this.logic) {
      // Remember when the room was last in use so it still counts as
      // "existing" (joinable) even if this object was evicted from memory.
      const openedAt = (await this.state.storage.get('lastSeen')) || 0;
      if (!this.logic) {
        this.logic = new RoomLogic(code, {
          openedAt,
          onActivity: (ts) => { this.state.storage.put('lastSeen', ts); },
        });
      }
    }

    if (INFO_RE.test(url.pathname)) {
      return new Response(JSON.stringify(this.logic.info()), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.logic.attach(server);
    server.addEventListener('message', (e) => this.logic.message(server, typeof e.data === 'string' ? e.data : ''));
    const bye = () => {
      this.logic.detach(server);
      try { server.close(1000, 'bye'); } catch {} // complete the closing handshake
    };
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);
    return new Response(null, { status: 101, webSocket: client });
  }
}
