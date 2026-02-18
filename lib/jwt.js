// HMAC-SHA256 JWT via Web Crypto API (works in Cloudflare Workers)

const ALGO = { name: 'HMAC', hash: { name: 'SHA-256' } };

function b64url(buf) {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Uint8Array.from(
    atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad),
    c => c.charCodeAt(0)
  );
}

async function getKey(secret) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), ALGO, false, ['sign', 'verify']
  );
}

export async function signJWT(payload, secret, expiresInSeconds = 86400) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const full = { ...payload, iat: now, exp: now + expiresInSeconds };

  const enc = new TextEncoder();
  const h = b64url(enc.encode(JSON.stringify(header)));
  const p = b64url(enc.encode(JSON.stringify(full)));
  const base = `${h}.${p}`;

  const key = await getKey(secret);
  const sig = await crypto.subtle.sign(ALGO, key, enc.encode(base));

  return `${base}.${b64url(sig)}`;
}

export async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed token');

  const [h, p, s] = parts;
  const key = await getKey(secret);
  const enc = new TextEncoder();

  const valid = await crypto.subtle.verify(
    ALGO, key, b64urlDecode(s), enc.encode(`${h}.${p}`)
  );

  if (!valid) throw new Error('Invalid signature');

  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)));
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');

  return payload;
}
