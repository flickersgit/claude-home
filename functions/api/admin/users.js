export async function onRequestGet(context) {
  const { DB } = context.env;

  const { results } = await DB.prepare(
    `SELECT u.id, u.username, u.avatar, u.created_at,
            COUNT(s.id) AS score_count
     FROM users u LEFT JOIN scores s ON u.id = s.user_id
     GROUP BY u.id ORDER BY u.created_at DESC`
  ).all();

  return Response.json(results);
}
