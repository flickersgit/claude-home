export async function onRequestDelete(context) {
  const { DB } = context.env;
  const userId = parseInt(context.params.id);

  if (isNaN(userId)) {
    return Response.json({ error: 'Invalid user ID' }, { status: 400 });
  }

  // Delete user (scores cascade via ON DELETE CASCADE)
  const result = await DB.prepare('DELETE FROM users WHERE id = ?').bind(userId).run();

  if (result.meta.changes === 0) {
    return Response.json({ error: 'User not found' }, { status: 404 });
  }

  return Response.json({ deleted: true });
}
