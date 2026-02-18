// D1-backed login rate limiting

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

export async function checkLoginRateLimit(db, ip) {
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count } = await db
    .prepare('SELECT COUNT(*) AS count FROM login_attempts WHERE ip = ? AND attempted_at > ?')
    .bind(ip, windowStart)
    .first();

  if (count >= MAX_ATTEMPTS) {
    return { allowed: false, remaining: 0 };
  }

  await db.prepare('INSERT INTO login_attempts (ip) VALUES (?)').bind(ip).run();

  // Periodic cleanup (1% of requests)
  if (Math.random() < 0.01) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await db.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(cutoff).run();
  }

  return { allowed: true, remaining: MAX_ATTEMPTS - count - 1 };
}
