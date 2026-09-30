import crypto from 'node:crypto';

export const DOMAIN_ERROR = 'Domain not allowed to use this site.';
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

// Accepts one domain, a comma-separated list ("gmail.com,globant.com") or an array.
export function parseDomains(domains) {
  const list = Array.isArray(domains) ? domains : String(domains ?? '').split(',');
  return list.map((d) => String(d).trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
}

export function isAllowedEmail(email, domains) {
  if (typeof email !== 'string') return false;
  const address = email.toLowerCase();
  return parseDomains(domains).some((d) => address.endsWith('@' + d));
}

// ---------- Google ID token verification (RS256 via Google's JWKS) ----------
let keyCache = { keys: [], expires: 0 };

async function defaultFetchKeys() {
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) throw new Error(`Could not fetch Google certificates (${res.status})`);
  const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
  const body = await res.json();
  return { keys: body.keys || [], expires: Date.now() + maxAge * 1000 };
}

async function getKey(kid, fetchKeys, forceRefresh = false) {
  if (forceRefresh || Date.now() > keyCache.expires || !keyCache.keys.length) keyCache = await fetchKeys();
  return keyCache.keys.find((k) => k.kid === kid) || null;
}

export function resetKeyCache() {
  keyCache = { keys: [], expires: 0 };
}

export async function verifyGoogleIdToken(token, { clientId, fetchKeys = defaultFetchKeys, now = Date.now() } = {}) {
  if (typeof token !== 'string') throw new AuthError('Missing Google credential.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('Malformed Google credential.');
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new AuthError('Malformed Google credential.');
  }
  if (header.alg !== 'RS256') throw new AuthError('Unexpected token algorithm.');
  let jwk = await getKey(header.kid, fetchKeys);
  if (!jwk) jwk = await getKey(header.kid, fetchKeys, true);
  if (!jwk) throw new AuthError('Unknown Google signing key.');
  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    crypto.createPublicKey({ key: jwk, format: 'jwk' }),
    Buffer.from(parts[2], 'base64url'),
  );
  if (!ok) throw new AuthError('Invalid Google credential signature.');
  if (!GOOGLE_ISSUERS.has(payload.iss)) throw new AuthError('Invalid token issuer.');
  if (payload.aud !== clientId) throw new AuthError('Token was issued for a different app.');
  const nowSec = Math.floor(now / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < nowSec - 60) throw new AuthError('Google credential expired. Sign in again.');
  if (payload.email_verified !== true && payload.email_verified !== 'true') throw new AuthError('Your Google email is not verified.');
  return payload;
}

// ---------- Session cookie (stateless, HMAC-signed) ----------
export function createSessionCodec(secret, ttlMs = 12 * 3600_000) {
  const sign = (data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return {
    ttlMs,
    encode(user, now = Date.now()) {
      const data = Buffer.from(JSON.stringify({ ...user, exp: now + ttlMs })).toString('base64url');
      return `${data}.${sign(data)}`;
    },
    decode(token, now = Date.now()) {
      if (typeof token !== 'string' || !token.includes('.')) return null;
      const [data, sig] = token.split('.');
      const expected = sign(data);
      if (!sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
      try {
        const user = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
        if (typeof user.exp !== 'number' || user.exp < now) return null;
        return user;
      } catch {
        return null;
      }
    },
  };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
