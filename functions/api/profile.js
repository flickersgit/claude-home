const VALID_GAMES = ['retro-basket', 'retro-shooter', 'retro-racing', 'retro-paddle', 'obby', 'street-fighter'];
const ASC_GAMES = ['obby'];

export async function onRequestGet(context) {
  const { DB } = context.env;
  const { user } = context.data;

  // Get user info
  const userRow = await DB.prepare('SELECT username, avatar, created_at FROM users WHERE id = ?')
    .bind(user.sub).first();

  if (!userRow) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  const scores = {};

  for (const game of VALID_GAMES) {
    const isAsc = ASC_GAMES.includes(game);

    // Personal best + play count
    const stats = await DB.prepare(
      `SELECT ${isAsc ? 'MIN' : 'MAX'}(score) AS best, COUNT(*) AS plays FROM scores WHERE user_id = ? AND game = ?`
    ).bind(user.sub, game).first();

    if (!stats.plays || stats.plays === 0) {
      scores[game] = { best: null, rank: null, plays: 0 };
      continue;
    }

    // Global rank
    const rankQuery = isAsc
      ? `SELECT COUNT(DISTINCT user_id) + 1 AS rank FROM (
           SELECT user_id, MIN(score) AS best FROM scores WHERE game = ? GROUP BY user_id
         ) WHERE best < ?`
      : `SELECT COUNT(DISTINCT user_id) + 1 AS rank FROM (
           SELECT user_id, MAX(score) AS best FROM scores WHERE game = ? GROUP BY user_id
         ) WHERE best > ?`;

    const rankRow = await DB.prepare(rankQuery).bind(game, stats.best).first();

    scores[game] = { best: stats.best, rank: rankRow.rank, plays: stats.plays };
  }

  // Cumulative score (sum of bests, Obby inverted)
  let cumulative = 0;
  for (const game of VALID_GAMES) {
    if (scores[game].best !== null) {
      if (ASC_GAMES.includes(game)) {
        cumulative += Math.max(0, 1000 - scores[game].best); // Obby: fewer deaths = more points
      } else {
        cumulative += scores[game].best;
      }
    }
  }

  return Response.json({
    username: userRow.username,
    avatar: userRow.avatar,
    scores,
    cumulative,
    created: userRow.created_at,
  });
}
