const VALID_GAMES = ['retro-basket', 'retro-shooter', 'retro-racing', 'retro-paddle', 'retro-pacman', 'obby', 'street-fighter'];
const ASC_GAMES = ['obby'];

export async function onRequestGet(context) {
  const { DB } = context.env;
  const { user } = context.data;

  // Get avatar
  const userRow = await DB.prepare('SELECT avatar FROM users WHERE id = ?')
    .bind(user.sub).first();

  // Compute cumulative from all personal bests
  let cumulative = 0;
  for (const game of VALID_GAMES) {
    const isAsc = ASC_GAMES.includes(game);
    const row = await DB.prepare(
      `SELECT ${isAsc ? 'MIN' : 'MAX'}(score) AS best FROM scores WHERE user_id = ? AND game = ?`
    ).bind(user.sub, game).first();

    if (row && row.best !== null) {
      cumulative += isAsc ? Math.max(0, 1000 - row.best) : row.best;
    }
  }

  return Response.json({
    username: user.username,
    avatar: userRow ? userRow.avatar : 0,
    cumulative,
  });
}
