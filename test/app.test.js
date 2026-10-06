import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { RoomManager, computeResults, sanitizeSettings } from '../server/rooms.js';
import {
  verifyGoogleIdToken, verifyMicrosoftIdToken, microsoftVerifiedEmail, MICROSOFT_CONSUMER_TENANT, resetKeyCache, createSessionCodec, isAllowedEmail,
} from '../server/auth.js';
import { createApp } from '../server/index.js';
import { DEFAULT_SETTINGS, buildDeck, cardNumber } from '../shared/constants.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alice = { email: 'alice@globant.com', name: 'Alice', picture: null };
const bob = { email: 'bob@globant.com', name: 'Bob', picture: null };
const carol = { email: 'carol@globant.com', name: 'Carol', picture: null };

// ---------- decks & results ----------
test('decks include SKIP and coffee at the end when enabled', () => {
  const d = buildDeck({ ...DEFAULT_SETTINGS, deckType: 'modfib', coffeeCard: true });
  assert.deepEqual(d.cards.slice(-3), ['100', '☕', 'SKIP']);
  assert.equal(d.numeric, true);
  assert.equal(buildDeck({ ...DEFAULT_SETTINGS, deckType: 'tshirt' }).numeric, false);
  assert.equal(cardNumber('½'), 0.5);
  assert.equal(cardNumber('2.5'), 2.5);
});

test('average and median exclude SKIP; coffee counts as 0', () => {
  const s = { ...DEFAULT_SETTINGS, showMedian: true, coffeeCard: true };
  const r = computeResults(['3', '5', 'SKIP', '☕'], s);
  assert.equal(r.average, 2.67);
  assert.equal(r.median, 3);
  assert.deepEqual(r.counts, [{ value: '3', count: 1 }, { value: '5', count: 1 }, { value: '☕', count: 1 }, { value: 'SKIP', count: 1 }]);
  assert.equal(r.agreement, false);
});

test('T-shirt deck: no average, ordinal median', () => {
  const r = computeResults(['S', 'L', 'M'], { ...DEFAULT_SETTINGS, deckType: 'tshirt', showMedian: true });
  assert.equal(r.average, null);
  assert.equal(r.median, 'M');
});

test('full agreement needs 2+ identical non-SKIP votes', () => {
  assert.equal(computeResults(['5', '5'], DEFAULT_SETTINGS).agreement, true);
  assert.equal(computeResults(['5'], DEFAULT_SETTINGS).agreement, false);
  assert.equal(computeResults(['SKIP', 'SKIP'], DEFAULT_SETTINGS).agreement, false);
});

test('custom deck validation', () => {
  assert.throws(() => sanitizeSettings({ deckType: 'custom', customValues: '1' }), /at least two/);
  const s = sanitizeSettings({ deckType: 'custom', customValues: '1, 2,,3, ?, 3' });
  assert.equal(s.customValues, '1, 2, 3, ?');
  assert.equal(buildDeck(s).numeric, false);
});

// ---------- room manager ----------
function managerWithLog() {
  const events = [];
  const m = new RoomManager({ emit: (roomId, email, event, data) => events.push({ roomId, email, event, data }), graceMs: 50 });
  return { m, events };
}

test('voting flow, hidden votes, auto reveal, early reveal rules', async () => {
  const { m, events } = managerWithLog();
  const room = m.createRoom(alice, { name: 'Sprint', settings: { countdown: false } });
  m.join(room.id, alice);
  m.join(room.id, bob);
  m.setConnected(room.id, alice.email, true);
  m.setConnected(room.id, bob.email, true);

  m.vote(room.id, alice.email, '5');
  assert.equal(m.viewFor(room.id, bob.email).players[0].vote, null, 'votes hidden before reveal');
  assert.equal(m.viewFor(room.id, alice.email).you.vote, '5');
  assert.throws(() => m.reveal(room.id, alice.email), /Wait until everyone/);
  assert.throws(() => m.reveal(room.id, bob.email), /Only the room creator/);

  m.updateSettings(room.id, alice.email, { settings: { allowEarlyReveal: true } });
  m.reveal(room.id, alice.email);
  let v = m.viewFor(room.id, bob.email);
  assert.equal(v.phase, 'revealed');
  assert.equal(v.players[0].vote, '5');
  assert.throws(() => m.vote(room.id, bob.email, '3'), /did not vote/);

  m.resetVoting(room.id, bob.email);
  m.updateSettings(room.id, alice.email, { settings: { autoReveal: true } });
  m.vote(room.id, alice.email, '8');
  m.vote(room.id, bob.email, '8');
  v = m.viewFor(room.id, alice.email);
  assert.equal(v.phase, 'revealed');
  assert.equal(v.results.agreement, true);

  await sleep(5);
  assert.ok(events.some((e) => e.event === 'celebrate'));
  // Change vote after reveal updates results.
  m.vote(room.id, bob.email, '13');
  assert.equal(m.viewFor(room.id, alice.email).results.average, 10.5);
});

test('spectators, kick + ban, creator hand-over, one room per user', async () => {
  const { m, events } = managerWithLog();
  const r1 = m.createRoom(alice, { name: 'One', settings: {} });
  m.join(r1.id, alice);
  m.join(r1.id, bob, { spectator: true });
  m.join(r1.id, carol);
  assert.throws(() => m.vote(r1.id, bob.email, '3'), /Spectators/);
  m.setSpectator(r1.id, bob.email, false);
  m.vote(r1.id, bob.email, '3');

  const bobId = m.viewFor(r1.id, bob.email).you.id;
  assert.throws(() => m.kick(r1.id, carol.email, [bobId]), /Only the room creator/);
  assert.equal(m.kick(r1.id, alice.email, [bobId]), 1);
  assert.ok(events.some((e) => e.event === 'removed' && e.email === bob.email && e.data.reason === 'kicked'));
  assert.throws(() => m.join(r1.id, bob), /removed you|removed from this room/);

  // Carol joins another room -> leaves the first.
  const r2 = m.createRoom(carol, { name: 'Two', settings: {} });
  m.join(r2.id, carol);
  assert.equal(r1.players.has(carol.email), false);
  assert.ok(events.some((e) => e.event === 'removed' && e.data.reason === 'joined-other-room'));

  // Creator leaves -> next player becomes creator.
  m.join(r2.id, bob);
  m.leave(r2.id, carol.email);
  assert.equal(m.viewFor(r2.id, bob.email).you.isCreator, true);

  // Disconnect grace period removes the player.
  m.setConnected(r2.id, bob.email, true);
  m.setConnected(r2.id, bob.email, false);
  await sleep(80);
  assert.equal(r2.players.size, 0);
});

test('countdown then reveal; timer auto-reveals; deck change resets round', async () => {
  const { m } = managerWithLog();
  const room = m.createRoom(alice, { name: 'T', settings: { countdown: true } });
  m.join(room.id, alice);
  m.setConnected(room.id, alice.email, true);
  m.vote(room.id, alice.email, '2');
  m.reveal(room.id, alice.email);
  assert.equal(room.phase, 'countdown');
  assert.throws(() => m.vote(room.id, alice.email, '3'), /being revealed/);
  m.resetVoting(room.id, alice.email);
  assert.equal(room.phase, 'voting');

  m.vote(room.id, alice.email, '2');
  m.updateSettings(room.id, alice.email, { settings: { deckType: 'tshirt' } });
  assert.equal(room.players.get(alice.email).vote, null, 'deck change clears votes');

  m.updateSettings(room.id, alice.email, { settings: { timer: true, timerSeconds: 10 } });
  assert.ok(m.viewFor(room.id, alice.email).timerRemainingMs > 9000);
  assert.throws(() => m.updateSettings(room.id, alice.email, { settings: { timerSeconds: 1 } }), /Timer must be/);
});

test('emoji rate limit and throw validation', () => {
  const { m } = managerWithLog();
  const room = m.createRoom(alice, { name: 'E', settings: {} });
  m.join(room.id, alice);
  m.join(room.id, bob);
  const bobId = m.viewFor(room.id, bob.email).you.id;
  for (let i = 0; i < 6; i++) m.react(room.id, alice.email, '👍');
  assert.throws(() => m.react(room.id, alice.email, '👍'), /Slow down/);
  assert.throws(() => m.throwAt(room.id, bob.email, bobId, '🍅'), /yourself/);
  m.updateSettings(room.id, alice.email, { settings: { throwing: false } });
  assert.throws(() => m.throwAt(room.id, alice.email, bobId, '🍅'), /turned off/);
});

// ---------- auth ----------
test('Google ID token verification', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const fetchKeys = async () => ({ keys: [jwk], expires: Date.now() + 60_000 });
  const sign = (payload) => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url');
    return `${h}.${p}.${sig}`;
  };
  const base = { iss: 'https://accounts.google.com', aud: 'client-1', exp: Math.floor(Date.now() / 1000) + 600, email: 'a@globant.com', email_verified: true };
  resetKeyCache();
  const ok = await verifyGoogleIdToken(sign(base), { clientId: 'client-1', fetchKeys });
  assert.equal(ok.email, 'a@globant.com');
  await assert.rejects(verifyGoogleIdToken(sign({ ...base, aud: 'other' }), { clientId: 'client-1', fetchKeys }), /different app/);
  await assert.rejects(verifyGoogleIdToken(sign({ ...base, exp: 1 }), { clientId: 'client-1', fetchKeys }), /expired/);
  const tampered = sign(base).split('.');
  tampered[1] = Buffer.from(JSON.stringify({ ...base, email: 'evil@globant.com' })).toString('base64url');
  await assert.rejects(verifyGoogleIdToken(tampered.join('.'), { clientId: 'client-1', fetchKeys }), /signature/);
});

test('session codec and domain check', () => {
  const c = createSessionCodec('secret');
  const t = c.encode(alice);
  assert.equal(c.decode(t).email, alice.email);
  assert.equal(c.decode(t + 'x'), null);
  assert.equal(c.decode(t, Date.now() + 13 * 3600_000), null);
  assert.equal(isAllowedEmail('x@globant.com', 'globant.com'), true);
  assert.equal(isAllowedEmail('x@GLOBANT.COM', 'globant.com'), true);
  assert.equal(isAllowedEmail('x@notglobant.com', 'globant.com'), false);
  assert.equal(isAllowedEmail('x@globant.com.evil.io', 'globant.com'), false);
  // several domains, comma-separated or as an array
  assert.equal(isAllowedEmail('x@gmail.com', 'gmail.com, globant.com'), true);
  assert.equal(isAllowedEmail('x@globant.com', 'gmail.com,globant.com'), true);
  assert.equal(isAllowedEmail('x@GMAIL.com', ['gmail.com', 'globant.com']), true);
  assert.equal(isAllowedEmail('x@hotmail.com', 'gmail.com,globant.com'), false);
  assert.equal(isAllowedEmail('x@evilgmail.com', 'gmail.com,globant.com'), false);
  // "*" or an empty setting allows every domain (still needs a real address)
  assert.equal(isAllowedEmail('x@anything.org', '*'), true);
  assert.equal(isAllowedEmail('x@gmail.com', ''), true);
  assert.equal(isAllowedEmail('x@hotmail.com', 'gmail.com, *'), true);
  assert.equal(isAllowedEmail('not-an-email', '*'), false);
});

test('Microsoft ID token verification', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'm1', use: 'sig', x5c: ['ignored'], issuer: 'https://login.microsoftonline.com/{tenantid}/v2.0' };
  const fetchKeys = async () => ({ keys: [jwk], expires: Date.now() + 60_000 });
  const sign = (payload) => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'm1', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`;
  };
  const tid = '72f988bf-86f1-41af-91ab-2d7cd011db47';
  const base = {
    iss: `https://login.microsoftonline.com/${tid}/v2.0`, tid, aud: 'ms-app', nonce: 'n1',
    exp: Math.floor(Date.now() / 1000) + 600, nbf: Math.floor(Date.now() / 1000) - 5,
    name: 'Ann', preferred_username: 'Ann@Contoso.com', email: 'ann@contoso.com',
  };
  const opts = { clientId: 'ms-app', nonce: 'n1', fetchKeys };
  resetKeyCache();
  assert.equal((await verifyMicrosoftIdToken(sign(base), opts)).verifiedEmail, 'ann@contoso.com');
  await assert.rejects(verifyMicrosoftIdToken(sign({ ...base, aud: 'other' }), opts), /different app/);
  await assert.rejects(verifyMicrosoftIdToken(sign({ ...base, nonce: 'n2' }), opts), /could not be confirmed/);
  await assert.rejects(verifyMicrosoftIdToken(sign(base), { ...opts, nonce: undefined }), /could not be confirmed/);
  await assert.rejects(verifyMicrosoftIdToken(sign({ ...base, exp: 1 }), opts), /expired/);
  await assert.rejects(verifyMicrosoftIdToken(sign({ ...base, iss: 'https://login.microsoftonline.com/other/v2.0' }), opts), /issuer/);
  await assert.rejects(verifyMicrosoftIdToken(sign({ ...base, preferred_username: 'bad#EXT#name', email: undefined }), opts), /verified email/);
  const tampered = sign(base).split('.');
  tampered[1] = Buffer.from(JSON.stringify({ ...base, preferred_username: 'boss@contoso.com' })).toString('base64url');
  await assert.rejects(verifyMicrosoftIdToken(tampered.join('.'), opts), /signature/);
});

test('Microsoft: which email address is trusted', () => {
  const work = { tid: '72f988bf-86f1-41af-91ab-2d7cd011db47' };
  // Work account: an admin-typed "email" is ignored unless the domain owner verified it; the UPN is used instead.
  assert.equal(microsoftVerifiedEmail({ ...work, email: 'victim@gmail.com', preferred_username: 'eve@evil.com' }), 'eve@evil.com');
  assert.equal(microsoftVerifiedEmail({ ...work, email: 'Ann@Contoso.com', xms_edov: true, preferred_username: 'a1@contoso.com' }), 'ann@contoso.com');
  assert.equal(microsoftVerifiedEmail({ ...work, email: 'victim@gmail.com' }), null);
  // Personal account: the sign-in address is verified by Microsoft.
  assert.equal(microsoftVerifiedEmail({ tid: MICROSOFT_CONSUMER_TENANT, email: 'jp@hotmail.com' }), 'jp@hotmail.com');
  assert.equal(microsoftVerifiedEmail({ tid: MICROSOFT_CONSUMER_TENANT, preferred_username: 'jp@outlook.com' }), 'jp@outlook.com');
});

// ---------- HTTP end-to-end ----------
async function withServer(fn, opts = {}) {
  const { server } = createApp({
    allowDevLogin: true,
    sessionSecret: 's',
    googleClientId: 'cid',
    allowedDomain: 'globant.com',
    verifyToken: async (credential) => ({ email: credential, name: 'G', email_verified: true }),
    ...opts,
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

function client(base) {
  let cookie = '';
  const call = async (path, body) => {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const stream = async (path) => {
    const ctrl = new AbortController();
    const res = await fetch(base + path, { headers: { cookie }, signal: ctrl.signal });
    const events = [];
    const waiters = [];
    (async () => {
      const decoder = new TextDecoder();
      let buf = '';
      try {
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (ev) {
              events.push({ event: ev, data: JSON.parse(data) });
              waiters.splice(0).forEach((w) => w());
            }
          }
        }
      } catch { /* aborted */ }
    })();
    const next = async (name, pred = () => true, timeout = 2000) => {
      const end = Date.now() + timeout;
      for (;;) {
        const idx = events.findIndex((e) => e.event === name && pred(e.data));
        if (idx >= 0) return events.splice(0, idx + 1).pop().data;
        if (Date.now() > end) throw new Error(`timeout waiting for ${name}`);
        await Promise.race([new Promise((r) => waiters.push(r)), sleep(50)]);
      }
    };
    return { status: res.status, next, close: () => ctrl.abort() };
  };
  return { call, stream };
}

test('HTTP: domain restriction message', async () => {
  await withServer(async (base) => {
    const c = client(base);
    let r = await c.call('/api/auth/google', { credential: 'mallory@gmail.com' });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'Domain not allowed to use this site.');
    r = await c.call('/api/auth/dev', { email: 'x@example.com' });
    assert.equal(r.body.error, 'Domain not allowed to use this site.');
    r = await c.call('/api/me');
    assert.equal(r.status, 401);
    r = await c.call('/api/auth/google', { credential: 'ann@globant.com' });
    assert.equal(r.status, 200);
    assert.equal((await c.call('/api/me')).body.user.email, 'ann@globant.com');
  });
});

test('HTTP: dev login is off unless enabled', async () => {
  await withServer(async (base) => {
    const r = await client(base).call('/api/auth/dev', { email: 'a@globant.com' });
    assert.equal(r.status, 404);
  }, { allowDevLogin: false });
});

test('HTTP + SSE: full round between two players', async () => {
  await withServer(async (base) => {
    const a = client(base);
    const b = client(base);
    await a.call('/api/auth/dev', { email: 'alice@globant.com', name: 'Alice' });
    await b.call('/api/auth/dev', { email: 'bob@globant.com', name: 'Bob' });

    const { body: { roomId } } = await a.call('/api/rooms', { name: 'Sprint 7', settings: { countdown: false, showMedian: true } });
    assert.ok(roomId);
    const sa = await a.stream(`/api/rooms/${roomId}/stream`);
    assert.equal(sa.status, 200);
    await sa.next('state');

    assert.equal((await b.stream(`/api/rooms/${roomId}/stream`)).status, 409, 'must join before streaming');
    assert.equal((await b.call(`/api/rooms/${roomId}`)).body.name, 'Sprint 7');
    await b.call(`/api/rooms/${roomId}/join`, { spectator: false, profile: { name: 'Bobby', avatar: { kind: 'preset', id: 'zorp' } } });
    const sb = await b.stream(`/api/rooms/${roomId}/stream`);
    let st = await sb.next('state', (s) => s.players.length === 2);
    assert.equal(st.players[1].name, 'Bobby');
    assert.deepEqual(st.players[1].avatar, { kind: 'preset', id: 'zorp' });

    await a.call(`/api/rooms/${roomId}/action`, { type: 'vote', value: '5' });
    st = await sb.next('state', (s) => s.votedCount === 1);
    assert.equal(st.players[0].vote, null, 'bob cannot see alice vote yet');
    await b.call(`/api/rooms/${roomId}/action`, { type: 'vote', value: '5' });
    st = await sa.next('state', (s) => s.allVoted);
    assert.equal(st.phase, 'voting');

    const bad = await b.call(`/api/rooms/${roomId}/action`, { type: 'reveal' });
    assert.equal(bad.status, 400);
    await a.call(`/api/rooms/${roomId}/action`, { type: 'reveal' });
    st = await sb.next('state', (s) => s.phase === 'revealed');
    assert.equal(st.results.average, 5);
    assert.equal(st.results.median, 5);
    await sb.next('celebrate');

    // Upload avatar: 1x1 PNG
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const up = await a.call(`/api/rooms/${roomId}/action`, { type: 'profile', profile: { name: 'Al', avatar: { kind: 'upload', dataUrl: png } } });
    assert.equal(up.status, 200);
    st = await sb.next('state', (s) => s.players[0].name === 'Al');
    const img = await fetch(base + st.players[0].avatar.url);
    assert.equal(img.status, 401, 'avatars require a session');
    const fake = await a.call(`/api/rooms/${roomId}/action`, { type: 'profile', profile: { avatar: { kind: 'upload', dataUrl: 'data:image/png;base64,AAAA' } } });
    assert.equal(fake.status, 400);

    await a.call(`/api/rooms/${roomId}/action`, { type: 'emoji', emoji: '🎉' });
    assert.equal((await sb.next('emoji')).emoji, '🎉');

    const bobId = st.you.id;
    await a.call(`/api/rooms/${roomId}/action`, { type: 'kick', ids: [bobId] });
    assert.equal((await sb.next('removed')).reason, 'kicked');
    const rejoin = await b.call(`/api/rooms/${roomId}/join`, {});
    assert.equal(rejoin.status, 400);
    sa.close();
    sb.close();
  });
});

test('HTTP: static files and SPA routes', async () => {
  await withServer(async (base) => {
    for (const p of ['/', '/room/abc123', '/app.js', '/shared/constants.js', '/styles.css']) {
      const r = await fetch(base + p);
      assert.equal(r.status, 200, p);
    }
    assert.equal((await fetch(base + '/../server/auth.js')).status, 404);
    assert.equal((await fetch(base + '/%2e%2e/server/auth.js')).status, 404);
  });
});

test('HTTP: any domain is allowed when ALLOWED_DOMAIN is "*"', async () => {
  await withServer(async (base) => {
    const c = client(base);
    assert.equal((await c.call('/api/auth/google', { credential: 'someone@example.org' })).status, 200);
    assert.equal((await c.call('/api/me')).body.user.provider, 'google');
    const cfg = await c.call('/api/config');
    assert.equal(cfg.body.anyDomain, true);
    assert.deepEqual(cfg.body.allowedDomains, []);
  }, { allowedDomain: '*' });
});

test('HTTP: Microsoft sign-in round trip', async () => {
  let seen = null;
  await withServer(async (base) => {
    // start: redirects to Microsoft with a nonce and state, and remembers them in a short-lived cookie
    let res = await fetch(`${base}/api/auth/microsoft/start?return=${encodeURIComponent('/room/abc123')}`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    const to = new URL(res.headers.get('location'));
    assert.equal(to.origin + to.pathname, 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    assert.equal(to.searchParams.get('client_id'), 'ms-app');
    assert.equal(to.searchParams.get('response_mode'), 'form_post');
    assert.equal(to.searchParams.get('redirect_uri'), 'https://poker.example.com/api/auth/microsoft/callback');
    const loginCookie = res.headers.get('set-cookie');
    assert.match(loginCookie, /SameSite=None; Secure/);
    const cookie = loginCookie.split(';')[0];
    const state = to.searchParams.get('state');
    const nonce = to.searchParams.get('nonce');

    const callback = (fields, cookieHeader = cookie) => fetch(`${base}/api/auth/microsoft/callback`, {
      method: 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader },
      body: new URLSearchParams(fields).toString(),
    });

    // wrong state -> back to the sign-in page with a message, no session
    res = await callback({ id_token: 'tok', state: 'nope' });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /^\/\?login_error=/);

    // cancelled on the Microsoft page -> quietly back home
    res = await callback({ error: 'access_denied', state });
    assert.equal(res.headers.get('location'), '/');

    // success -> session cookie, back to the room the person came from
    res = await callback({ id_token: 'tok', state });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/room/abc123');
    assert.equal(seen.nonce, nonce);
    const session = res.headers.getSetCookie().find((c) => c.startsWith('pp_session='));
    assert.ok(session);
    const me = await fetch(`${base}/api/me`, { headers: { cookie: session.split(';')[0] } }).then((r) => r.json());
    assert.deepEqual([me.user.email, me.user.provider], ['ann@contoso.com', 'microsoft']);

    // no login cookie (e.g. expired or another browser) -> refused
    res = await callback({ id_token: 'tok', state }, '');
    assert.match(res.headers.get('location'), /login_error/);
  }, {
    allowedDomain: '*',
    microsoftClientId: 'ms-app',
    publicUrl: 'https://poker.example.com/',
    verifyMicrosoftToken: async (token, opts) => {
      seen = opts;
      return { verifiedEmail: 'ann@contoso.com', name: 'Ann' };
    },
  });
});

test('HTTP: Microsoft return path cannot leave the site; hidden when not configured', async () => {
  await withServer(async (base) => {
    for (const ret of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
      const res = await fetch(`${base}/api/auth/microsoft/start?return=${encodeURIComponent(ret)}`, { redirect: 'manual' });
      const cookie = res.headers.get('set-cookie').split(';')[0];
      const state = new URL(res.headers.get('location')).searchParams.get('state');
      const cb = await fetch(`${base}/api/auth/microsoft/callback`, {
        method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
        body: new URLSearchParams({ id_token: 't', state }).toString(),
      });
      assert.equal(cb.headers.get('location'), '/');
    }
  }, { allowedDomain: '*', microsoftClientId: 'ms-app', verifyMicrosoftToken: async () => ({ verifiedEmail: 'a@b.com' }) });

  await withServer(async (base) => {
    const res = await fetch(`${base}/api/auth/microsoft/start`, { redirect: 'manual' });
    assert.equal(res.status, 404);
    assert.equal((await client(base).call('/api/config')).body.microsoftEnabled, false);
  });
});
