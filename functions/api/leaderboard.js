const VALID_GAMES = ['retro-basket', 'retro-shooter', 'retro-racing', 'retro-paddle', 'obby', 'street-fighter'];
const ASC_GAMES = ['obby'];

export async function onRequestGet(context) {
  const { DB } = context.env;
  const url = new URL(context.request.url);
  const gameFilter = url.searchParams.get('game');

  const games = gameFilter && VALID_GAMES.includes(gameFilter) ? [gameFilter] : VALID_GAMES;
  const result = {};

  for (const game of games) {
    const isAsc = ASC_GAMES.includes(game);
    const query = isAsc
      ? `SELECT u.username, u.avatar, MIN(s.score) AS best_score
         FROM scores s JOIN users u ON s.user_id = u.id
         WHERE s.game = ? GROUP BY s.user_id
         ORDER BY best_score ASC LIMIT 10`
      : `SELECT u.username, u.avatar, MAX(s.score) AS best_score
         FROM scores s JOIN users u ON s.user_id = u.id
         WHERE s.game = ? GROUP BY s.user_id
         ORDER BY best_score DESC LIMIT 10`;

    const { results } = await DB.prepare(query).bind(game).all();

    result[game] = results.map((row, i) => ({
      rank: i + 1,
      username: row.username,
      avatar: row.avatar,
      score: row.best_score,
    }));
  }

  return Response.json(result);
}
