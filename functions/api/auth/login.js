import { verifyPassword } from '../../../lib/password.js';
import { signJWT } from '../../../lib/jwt.js';
import { checkLoginRateLimit } from '../../../lib/ratelimit.js';

export async function onRequestPost(context) {
  const { DB, JWT_SECRET } = context.env;
  const ip = context.request.headers.get('CF-Connecting-IP') || 'unknown';

  // Rate limit check
  const { allowed, remaining } = await checkLoginRateLimit(DB, ip);
  if (!allowed) {
    return Response.json(
      { error: 'Too many login attempts. Try again in 15 minutes.' },
      { status: 429 }
    );
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { username, password } = body;
  if (!username || !password) {
    return Response.json({ error: 'Username and password required' }, { status: 400 });
  }

  // Look up user
  const user = await DB.prepare('SELECT * FROM users WHERE username = ?')
    .bind(username.toLowerCase()).first();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return Response.json({ error: 'Invalid username or password' }, { status: 401 });
  }

  // Update last login
  const token = await signJWT(
    { sub: user.id, username: user.username, avatar: user.avatar },
    JWT_SECRET
  );

  return Response.json({ token, username: user.username, avatar: user.avatar });
}
