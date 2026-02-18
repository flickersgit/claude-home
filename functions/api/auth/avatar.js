export async function onRequestPut(context) {
  const { DB } = context.env;
  const { user } = context.data;

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { avatar } = body;
  if (typeof avatar !== 'number' || avatar < 0 || avatar > 15) {
    return Response.json({ error: 'Avatar must be 0-15' }, { status: 400 });
  }

  await DB.prepare('UPDATE users SET avatar = ? WHERE id = ?')
    .bind(Math.floor(avatar), user.sub).run();

  return Response.json({ avatar: Math.floor(avatar) });
}
