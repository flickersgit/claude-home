import { hashPassword } from '../../../lib/password.js';
import { signJWT } from '../../../lib/jwt.js';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/;

export async function onRequestPost(context) {
  const { DB, JWT_SECRET } = context.env;

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { username, password, avatar } = body;

  // Validate username
  if (!username || !USERNAME_RE.test(username)) {
    return Response.json({ error: 'Username must be 3-16 characters (letters, numbers, underscore)' }, { status: 400 });
  }

  // Validate password
  if (!password || password.length < 6) {
    return Response.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
  }

  // Validate avatar
  const avatarId = typeof avatar === 'number' ? Math.max(0, Math.min(15, Math.floor(avatar))) : Math.floor(Math.random() * 16);

  // Hash password
  const passwordHash = await hashPassword(password);

  // Insert user
  try {
    const result = await DB.prepare(
      'INSERT INTO users (username, password_hash, avatar) VALUES (?, ?, ?)'
    ).bind(username.toLowerCase(), passwordHash, avatarId).run();

    const userId = result.meta.last_row_id;

    // Issue JWT
    const token = await signJWT({ sub: userId, username: username.toLowerCase(), avatar: avatarId }, JWT_SECRET);

    return Response.json({ token, username: username.toLowerCase(), avatar: avatarId });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE')) {
      return Response.json({ error: 'Username already taken' }, { status: 409 });
    }
    return Response.json({ error: 'Registration failed' }, { status: 500 });
  }
}
