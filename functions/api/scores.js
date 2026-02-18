const VALID_GAMES = ['retro-basket', 'retro-shooter', 'retro-racing', 'retro-paddle', 'retro-pacman', 'obby', 'street-fighter'];
const ASC_GAMES = ['obby']; // lower = better

export async function onRequestPost(context) {
  const { DB } = context.env;
  const { user } = context.data;

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { game, score } = body;

  if (!VALID_GAMES.includes(game)) {
    return Response.json({ error: 'Invalid game' }, { status: 400 });
  }

  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 999999) {
    return Response.json({ error: 'Invalid score' }, { status: 400 });
  }

  // Insert score
  await DB.prepare('INSERT INTO scores (user_id, game, score) VALUES (?, ?, ?)')
    .bind(user.sub, game, score).run();

  // Get personal best
  const isAsc = ASC_GAMES.includes(game);
  const bestRow = await DB.prepare(
    `SELECT ${isAsc ? 'MIN' : 'MAX'}(score) AS best FROM scores WHERE user_id = ? AND game = ?`
  ).bind(user.sub, game).first();

  // Get global rank
  const rankQuery = isAsc
    ? `SELECT COUNT(DISTINCT user_id) + 1 AS rank FROM (
         SELECT user_id, MIN(score) AS best FROM scores WHERE game = ? GROUP BY user_id
       ) WHERE best < ?`
    : `SELECT COUNT(DISTINCT user_id) + 1 AS rank FROM (
         SELECT user_id, MAX(score) AS best FROM scores WHERE game = ? GROUP BY user_id
       ) WHERE best > ?`;

  const rankRow = await DB.prepare(rankQuery).bind(game, bestRow.best).first();

  return Response.json({
    personalBest: bestRow.best,
    globalRank: rankRow.rank,
    isNewBest: score === bestRow.best,
  });
}
