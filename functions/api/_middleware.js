import { verifyJWT } from '../../lib/jwt.js';

const PUBLIC_ROUTES = ['/api/auth/register', '/api/auth/login', '/api/leaderboard'];

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
    'Access-Control-Max-Age': '86400',
  };
}

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const origin = context.request.headers.get('Origin') || '';

  // Handle preflight
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // Admin routes: require X-Admin-Secret header
  if (url.pathname.startsWith('/api/admin')) {
    const secret = context.request.headers.get('X-Admin-Secret');
    if (!secret || secret !== context.env.ADMIN_SECRET) {
      return Response.json({ error: 'Forbidden' }, {
        status: 403, headers: corsHeaders(origin)
      });
    }
    // Admin authenticated, proceed
    const response = await context.next();
    const newHeaders = new Headers(response.headers);
    for (const [k, v] of Object.entries(corsHeaders(origin))) newHeaders.set(k, v);
    return new Response(response.body, { status: response.status, headers: newHeaders });
  }

  // Public routes: no auth needed
  if (PUBLIC_ROUTES.includes(url.pathname) || context.request.method === 'GET' && url.pathname === '/api/leaderboard') {
    const response = await context.next();
    const newHeaders = new Headers(response.headers);
    for (const [k, v] of Object.entries(corsHeaders(origin))) newHeaders.set(k, v);
    return new Response(response.body, { status: response.status, headers: newHeaders });
  }

  // Protected routes: require JWT
  const auth = context.request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');

  try {
    const payload = await verifyJWT(token, context.env.JWT_SECRET);
    context.data.user = payload;
  } catch {
    return Response.json({ error: 'Unauthorized' }, {
      status: 401, headers: corsHeaders(origin)
    });
  }

  const response = await context.next();
  const newHeaders = new Headers(response.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) newHeaders.set(k, v);
  return new Response(response.body, { status: response.status, headers: newHeaders });
}
