import crypto from 'node:crypto';

export const DOMAIN_ERROR = 'Domain not allowed to use this site.';
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const MICROSOFT_KEYS_URL = 'https://login.microsoftonline.com/common/discovery/v2.0/keys';
export const MICROSOFT_AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
// Tenant that every personal Microsoft account (outlook.com, hotmail.com, live.com...) belongs to.
export const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

// Accepts one domain, a comma-separated list ("gmail.com,globant.com") or an array.
// "*" (or an empty value) means every domain is allowed.
export function parseDomains(domains) {
  const list = Array.isArray(domains) ? domains : String(domains ?? '').split(',');
  const out = list.map((d) => String(d).trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  return out.length && !out.includes('*') ? out : ['*'];
}

export function allowsAnyDomain(domains) {
  return parseDomains(domains).includes('*');
}

export function isAllowedEmail(email, domains) {
  if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return false;
  const list = parseDomains(domains);
  if (list.includes('*')) return true;
  const address = email.toLowerCase();
  return list.some((d) => address.endsWith('@' + d));
}

// ---------- ID token verification (RS256 via the provider's JWKS) ----------
const keyCaches = new Map(); // url -> { keys, expires }

function makeKeyFetcher(url, label) {
  return async function fetchKeys() {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Could not fetch ${label} signing keys (${res.status})`);
    const maxAge = Number((res.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1] || 3600);
    const body = await res.json();
    return { keys: body.keys || [], expires: Date.now() + Math.max(maxAge, 300) * 1000 };
  };
}

async function getKey(cacheId, kid, fetchKeys, forceRefresh = false) {
  let cache = keyCaches.get(cacheId);
  if (forceRefresh || !cache || Date.now() > cache.expires || !cache.keys.length) {
    cache = await fetchKeys();
    keyCaches.set(cacheId, cache);
  }
  return cache.keys.find((k) => k.kid === kid) || null;
}

export function resetKeyCache() {
  keyCaches.clear();
}

// Checks the signature and returns the decoded payload. Claims are checked by the caller.
async function verifyJwt(token, { cacheId, fetchKeys, label }) {
  if (typeof token !== 'string') throw new AuthError(`Missing ${label} credential.`);
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError(`Malformed ${label} credential.`);
  let header;
  let payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new AuthError(`Malformed ${label} credential.`);
  }
  if (header.alg !== 'RS256') throw new AuthError('Unexpected token algorithm.');
  let jwk = await getKey(cacheId, header.kid, fetchKeys);
  if (!jwk) jwk = await getKey(cacheId, header.kid, fetchKeys, true);
  if (!jwk) throw new AuthError(`Unknown ${label} signing key.`);
  const { kty, n, e } = jwk;
  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    crypto.createPublicKey({ key: { kty, n, e }, format: 'jwk' }),
    Buffer.from(parts[2], 'base64url'),
  );
  if (!ok) throw new AuthError(`Invalid ${label} credential signature.`);
  return payload;
}

function checkTimes(payload, now, label) {
  const nowSec = Math.floor(now / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < nowSec - 60) throw new AuthError(`${label} sign-in expired. Sign in again.`);
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 60) throw new AuthError(`${label} credential is not valid yet.`);
}

const fetchGoogleKeys = makeKeyFetcher(GOOGLE_CERTS_URL, 'Google');
const fetchMicrosoftKeys = makeKeyFetcher(MICROSOFT_KEYS_URL, 'Microsoft');

export async function verifyGoogleIdToken(token, { clientId, fetchKeys = fetchGoogleKeys, now = Date.now() } = {}) {
  const payload = await verifyJwt(token, { cacheId: 'google', fetchKeys, label: 'Google' });
  if (!GOOGLE_ISSUERS.has(payload.iss)) throw new AuthError('Invalid token issuer.');
  if (payload.aud !== clientId) throw new AuthError('Token was issued for a different app.');
  checkTimes(payload, now, 'Google');
  if (payload.email_verified !== true && payload.email_verified !== 'true') throw new AuthError('Your Google email is not verified.');
  return payload;
}

// Microsoft identity platform v2.0 ID token, any work/school tenant or a personal account.
// Returns the payload plus `verifiedEmail`: an address we can trust as the user's identity.
export async function verifyMicrosoftIdToken(token, { clientId, nonce, fetchKeys = fetchMicrosoftKeys, now = Date.now() } = {}) {
  const payload = await verifyJwt(token, { cacheId: 'microsoft', fetchKeys, label: 'Microsoft' });
  if (!GUID.test(String(payload.tid || '')) || payload.iss !== `https://login.microsoftonline.com/${payload.tid}/v2.0`) {
    throw new AuthError('Invalid token issuer.');
  }
  if (payload.aud !== clientId) throw new AuthError('Token was issued for a different app.');
  checkTimes(payload, now, 'Microsoft');
  if (!nonce || payload.nonce !== nonce) throw new AuthError('Microsoft sign-in could not be confirmed. Try again.');
  const verifiedEmail = microsoftVerifiedEmail(payload);
  if (!verifiedEmail) {
    throw new AuthError('Your Microsoft account did not share a verified email address, so it can’t be used here.');
  }
  return { ...payload, verifiedEmail };
}

// Work/school accounts can carry an "email" that their admin typed in without proof of ownership,
// so it is only trusted when Microsoft says the domain owner verified it (xms_edov). Otherwise the
// sign-in name (UPN) is used: its domain must be one the tenant has verified.
export function microsoftVerifiedEmail(payload) {
  const looksLikeEmail = (v) => typeof v === 'string' && /^[^@\s#]+@[^@\s]+\.[^@\s]+$/.test(v);
  const email = payload.email;
  const upn = payload.preferred_username;
  if (payload.tid === MICROSOFT_CONSUMER_TENANT) {
    // Personal accounts: Microsoft confirmed ownership of the sign-in address.
    if (looksLikeEmail(email)) return email.toLowerCase();
    if (looksLikeEmail(upn)) return upn.toLowerCase();
    return null;
  }
  const edov = payload.xms_edov === true || payload.xms_edov === 1 || payload.xms_edov === '1' || payload.xms_edov === 'true';
  if (edov && looksLikeEmail(email)) return email.toLowerCase();
  if (looksLikeEmail(upn)) return upn.toLowerCase();
  return null;
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
