export async function onRequestDelete(context) {
  const { DB } = context.env;
  const userId = parseInt(context.params.id);

  if (isNaN(userId)) {
    return Response.json({ error: 'Invalid user ID' }, { status: 400 });
  }

  const result = await DB.prepare('DELETE FROM scores WHERE user_id = ?').bind(userId).run();

  return Response.json({ reset: true, deleted: result.meta.changes });
}
