import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RoomManager, ActionError } from './rooms.js';
import {
  AuthError, DOMAIN_ERROR, createSessionCodec, isAllowedEmail, parseCookies, verifyGoogleIdToken,
} from './auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_DIRS = { '/shared/': path.join(ROOT, 'shared'), '/': path.join(ROOT, 'public') };
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
};
const COOKIE = 'pp_session';
const MAX_BODY = 400 * 1024;
const MAX_AVATAR_BYTES = 150 * 1024;

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com/gsi/client",
  "frame-src https://accounts.google.com/gsi/",
  "connect-src 'self' https://accounts.google.com/gsi/",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: https://*.googleusercontent.com",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createApp(options = {}) {
  const config = {
    googleClientId: options.googleClientId ?? process.env.GOOGLE_CLIENT_ID ?? '',
    allowedDomain: (options.allowedDomain ?? process.env.ALLOWED_DOMAIN ?? 'globant.com').toLowerCase(),
    allowDevLogin: options.allowDevLogin ?? process.env.ALLOW_DEV_LOGIN === 'true',
    sessionSecret: options.sessionSecret ?? process.env.SESSION_SECRET ?? crypto.randomBytes(32).toString('hex'),
    verifyToken: options.verifyToken ?? verifyGoogleIdToken,
    graceMs: options.graceMs,
  };
  const sessions = createSessionCodec(config.sessionSecret);
  const conns = new Map(); // roomId -> Map<email, res>
  const pendingState = new Set();

  const manager = new RoomManager({ emit, graceMs: config.graceMs });

  // ---------- SSE plumbing ----------
  function send(res, event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function emit(roomId, email, event, data) {
    const roomConns = conns.get(roomId);
    if (event === 'state') {
      if (pendingState.has(roomId)) return;
      pendingState.add(roomId);
      queueMicrotask(() => {
        pendingState.delete(roomId);
        for (const [e, res] of conns.get(roomId) || []) {
          const view = manager.viewFor(roomId, e);
          if (view) send(res, 'state', view);
        }
      });
      return;
    }
    if (!roomConns) return;
    if (email) {
      const res = roomConns.get(email);
      if (!res) return;
      send(res, event, data);
      if (event === 'removed') {
        roomConns.delete(email);
        res.end();
      }
      return;
    }
    for (const res of roomConns.values()) send(res, event, data);
  }

  const heartbeat = setInterval(() => {
    for (const roomConns of conns.values()) for (const res of roomConns.values()) res.write(': ping\n\n');
  }, 20_000);
  heartbeat.unref();

  function openStream(req, res, user, roomId) {
    if (!manager.getRoom(roomId)?.players.has(user.email)) throw new HttpError(409, 'Join the room first.');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    if (!conns.has(roomId)) conns.set(roomId, new Map());
    const roomConns = conns.get(roomId);
    const old = roomConns.get(user.email);
    if (old) {
      send(old, 'replaced', {});
      old.end();
    }
    roomConns.set(user.email, res);
    manager.setConnected(roomId, user.email, true);
    req.on('close', () => {
      if (roomConns.get(user.email) !== res) return;
      roomConns.delete(user.email);
      if (!roomConns.size) conns.delete(roomId);
      manager.setConnected(roomId, user.email, false);
    });
  }

  // ---------- helpers ----------
  function currentUser(req) {
    return sessions.decode(parseCookies(req.headers.cookie)[COOKIE]);
  }

  function requireUser(req) {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Sign in to continue.');
    if (!isAllowedEmail(user.email, config.allowedDomain)) throw new HttpError(403, DOMAIN_ERROR);
    return user;
  }

  function setSession(req, res, user) {
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : '';
    const maxAge = Math.floor(sessions.ttlMs / 1000);
    res.setHeader('Set-Cookie', `${COOKIE}=${sessions.encode(user)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
  }

  function parseProfile(profile) {
    if (!profile || typeof profile !== 'object') return {};
    const out = { name: typeof profile.name === 'string' ? profile.name : undefined };
    const a = profile.avatar;
    if (a?.kind === 'preset') out.avatar = { kind: 'preset', id: String(a.id || '') };
    else if (a?.kind === 'upload') out.avatar = { kind: 'upload', image: parseDataUrl(a.dataUrl) };
    else out.avatar = { kind: 'google' };
    return out;
  }

  function parseDataUrl(dataUrl) {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) throw new ActionError('Upload a PNG, JPEG or WebP image.');
    const data = Buffer.from(m[2], 'base64');
    if (data.length > MAX_AVATAR_BYTES) throw new ActionError('That image is too large. Use one under 150 KB.');
    const sig = data.subarray(0, 12).toString('hex');
    const valid = (m[1] === 'image/png' && sig.startsWith('89504e47'))
      || (m[1] === 'image/jpeg' && sig.startsWith('ffd8ff'))
      || (m[1] === 'image/webp' && sig.startsWith('52494646') && sig.slice(16, 24) === '57454250');
    if (!valid) throw new ActionError('That file is not a valid image.');
    return { type: m[1], data, hash: crypto.createHash('sha1').update(data).digest('hex').slice(0, 10) };
  }

  async function readJson(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      throw new HttpError(415, 'Expected JSON.');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new HttpError(413, 'Request is too large.');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      throw new HttpError(400, 'Invalid JSON.');
    }
  }

  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  async function serveStatic(req, res, pathname) {
    let file;
    if (pathname === '/' || pathname.startsWith('/room/')) {
      file = path.join(STATIC_DIRS['/'], 'index.html');
    } else {
      const prefix = pathname.startsWith('/shared/') ? '/shared/' : '/';
      const base = STATIC_DIRS[prefix];
      file = path.normalize(path.join(base, decodeURIComponent(pathname.slice(prefix.length))));
      if (!file.startsWith(base + path.sep)) throw new HttpError(404, 'Not found.');
    }
    let body;
    try {
      body = await fs.readFile(file);
    } catch {
      throw new HttpError(404, 'Not found.');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  // ---------- routes ----------
  async function handleApi(req, res, pathname) {
    const method = req.method;

    if (pathname === '/api/health') return json(res, 200, { ok: true, rooms: manager.rooms.size });

    if (pathname === '/api/config' && method === 'GET') {
      return json(res, 200, {
        googleClientId: config.googleClientId,
        allowedDomain: config.allowedDomain,
        devLogin: config.allowDevLogin,
      });
    }

    if (pathname === '/api/auth/google' && method === 'POST') {
      if (!config.googleClientId) throw new HttpError(500, 'Google sign-in is not configured on the server.');
      const { credential } = await readJson(req);
      const payload = await config.verifyToken(credential, { clientId: config.googleClientId });
      if (!isAllowedEmail(payload.email, config.allowedDomain)) throw new HttpError(403, DOMAIN_ERROR);
      const user = { email: payload.email.toLowerCase(), name: payload.name || payload.email.split('@')[0], picture: payload.picture || null };
      setSession(req, res, user);
      return json(res, 200, { user });
    }

    if (pathname === '/api/auth/dev' && method === 'POST') {
      if (!config.allowDevLogin) throw new HttpError(404, 'Not found.');
      const body = await readJson(req);
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter an email address.');
      if (!isAllowedEmail(email, config.allowedDomain)) throw new HttpError(403, DOMAIN_ERROR);
      const user = { email, name: String(body.name || email.split('@')[0]).slice(0, 32), picture: null };
      setSession(req, res, user);
      return json(res, 200, { user });
    }

    if (pathname === '/api/logout' && method === 'POST') {
      const user = currentUser(req);
      const roomId = user && manager.userRoom.get(user.email);
      if (roomId) manager.leave(roomId, user.email, 'signed-out');
      res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      return json(res, 200, { ok: true });
    }

    const user = requireUser(req);

    if (pathname === '/api/me' && method === 'GET') {
      return json(res, 200, { user, roomId: manager.userRoom.get(user.email) || null });
    }

    if (pathname === '/api/rooms' && method === 'POST') {
      const body = await readJson(req);
      const profile = parseProfile(body.profile);
      const room = manager.createRoom(user, { name: body.name, settings: body.settings });
      manager.join(room.id, user, { spectator: body.spectator, profile });
      return json(res, 200, { roomId: room.id });
    }

    const m = /^\/api\/rooms\/([A-Za-z0-9]{1,16})(\/[a-z]+)?(?:\/([a-f0-9]{12}))?$/.exec(pathname);
    if (!m) throw new HttpError(404, 'Not found.');
    const [, roomId, sub = '', playerId] = m;

    if (!sub && method === 'GET') {
      const room = manager.getRoom(roomId);
      if (!room) throw new HttpError(404, 'This room does not exist. Check the invite link or create a new room.');
      return json(res, 200, {
        id: room.id,
        name: room.name,
        players: room.players.size,
        member: room.players.has(user.email),
        banned: room.banned.has(user.email),
      });
    }

    if (sub === '/join' && method === 'POST') {
      const body = await readJson(req);
      manager.join(roomId, user, { spectator: body.spectator, profile: parseProfile(body.profile) });
      return json(res, 200, { roomId });
    }

    if (sub === '/stream' && method === 'GET') return openStream(req, res, user, roomId);

    if (sub === '/avatars' && playerId && method === 'GET') {
      const image = manager.avatarImage(roomId, playerId);
      if (!image) throw new HttpError(404, 'Not found.');
      res.writeHead(200, { 'Content-Type': image.type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      return res.end(image.data);
    }

    if (sub === '/action' && method === 'POST') {
      const body = await readJson(req);
      const result = runAction(roomId, user, body) ?? {};
      return json(res, 200, { ok: true, ...result });
    }

    throw new HttpError(404, 'Not found.');
  }

  function runAction(roomId, user, body) {
    const e = user.email;
    switch (body.type) {
      case 'vote': return manager.vote(roomId, e, body.value === null ? null : String(body.value));
      case 'reveal': return manager.reveal(roomId, e);
      case 'reset': return manager.resetVoting(roomId, e);
      case 'spectator': return manager.setSpectator(roomId, e, body.spectator);
      case 'settings': return manager.updateSettings(roomId, e, { name: body.name, settings: body.settings });
      case 'kick': return { kicked: manager.kick(roomId, e, Array.isArray(body.ids) ? body.ids.map(String) : []) };
      case 'emoji': return manager.react(roomId, e, body.emoji);
      case 'throw': return manager.throwAt(roomId, e, String(body.to), body.emoji);
      case 'profile': return manager.updateProfile(roomId, user, parseProfile(body.profile));
      case 'leave': return manager.leave(roomId, e, 'left');
      default: throw new ActionError('Unknown action.');
    }
  }

  const server = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname.startsWith('/api/')) await handleApi(req, res, pathname);
      else if (req.method === 'GET' || req.method === 'HEAD') await serveStatic(req, res, pathname);
      else throw new HttpError(405, 'Method not allowed.');
    } catch (err) {
      const status = err instanceof HttpError || err instanceof AuthError ? err.status
        : err instanceof ActionError ? 400 : 500;
      if (status === 500) console.error(err);
      if (res.headersSent) return res.end();
      json(res, status, { error: status === 500 ? 'Something went wrong on the server. Try again.' : err.message });
    }
  });
  server.on('close', () => clearInterval(heartbeat));
  return { server, manager, config };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const port = Number(process.env.PORT || 3000);
  const { server, config } = createApp();
  if (!config.googleClientId) console.warn('⚠ GOOGLE_CLIENT_ID is not set: Google sign-in will not work.');
  if (config.allowDevLogin) console.warn('⚠ ALLOW_DEV_LOGIN=true: email-only sign-in is enabled. Never use this in production.');
  if (!process.env.SESSION_SECRET) console.warn('⚠ SESSION_SECRET is not set: sessions reset on every restart.');
  server.listen(port, () => console.log(`Planning Poker listening on http://localhost:${port}`));
}
