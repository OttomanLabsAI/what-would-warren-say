// The site is static assets, served by Cloudflare. This Worker exists only to
// relay the page's EODHD requests on the same origin, so the browser never
// makes a cross-site call: a company's fundamentals, its latest quote, and its
// end-of-day or intraday bars for the price chart. The reader's own API token
// travels in a header on each request and is forwarded as EODHD's api_token
// query parameter; nothing is stored here and no token lives on the server.

const RELAY_PREFIX = '/api/eodhd/';
// fundamentals, the latest quote, end-of-day bars and intraday bars, one symbol each
const ALLOWED = /^(?:fundamentals|real-time|eod|intraday)\/[A-Za-z0-9][A-Za-z0-9._^-]{0,40}$/;
// the only query parameters passed on, each checked: a date or unix time, a bar size, an order
const PASS = {
  from: /^(?:\d{4}-\d{2}-\d{2}|\d{1,12})$/,
  to: /^(?:\d{4}-\d{2}-\d{2}|\d{1,12})$/,
  period: /^[dwm]$/,
  interval: /^(?:1m|5m|15m|30m|1h)$/,
  order: /^[ad]$/
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(RELAY_PREFIX)) return relay(request, url, env);
    return env.ASSETS.fetch(request);
  }
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function relay(request, url, env) {
  if (request.method !== 'GET') return json({ error: 'Only GET is supported.' }, 405);
  const token = request.headers.get('x-api-token');
  if (!token) return json({ error: 'Missing API token.' }, 400);
  const path = url.pathname.slice(RELAY_PREFIX.length);
  if (!ALLOWED.test(path)) return json({ error: 'Unsupported path.' }, 404);

  const base = (env && env.EODHD_BASE) || 'https://eodhd.com/api/';
  const upstream = new URL(path, base);
  for (const name of Object.keys(PASS)) {
    const value = url.searchParams.get(name);
    if (value !== null && PASS[name].test(value)) upstream.searchParams.set(name, value);
  }
  upstream.searchParams.set('api_token', token);
  upstream.searchParams.set('fmt', 'json');

  let res;
  try {
    res = await fetch(upstream.toString(), { headers: { accept: 'application/json' } });
  } catch (e) {
    return json({ error: 'Could not reach EODHD: ' + (e && e.message ? e.message : 'network error') }, 502);
  }
  const headers = new Headers({
    'content-type': res.headers.get('content-type') || 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  return new Response(res.body, { status: res.status, headers });
}
