interface Env {
  DB: D1Database;
  DODO_BASE_URL: string;
  DODO_BUSINESS_ID: string;
  DODO_API_KEY: string;
  DODO_WEBHOOK_SECRET: string;
  DODO_SOLO_PRODUCT_ID: string;
  DODO_STUDIO_PRODUCT_ID: string;
  PAGES_ORIGIN: string;
}

type Tier = 'solo' | 'studio';

const TIER_CONFIG: Record<Tier, {label: string; maxFiles: number}> = {
  solo: {label: 'Lifetime Solo', maxFiles: 100},
  studio: {label: 'Lifetime Studio', maxFiles: 250},
};

function requestId(request: Request): string {
  return request.headers.get('x-pixelproof-request-id') || crypto.randomUUID();
}

function cors(request: Request, env: Env): Headers {
  const origin = request.headers.get('origin') || '';
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-pixelproof-request-id',
  });
  if (origin === env.PAGES_ORIGIN || origin.startsWith('http://localhost:')) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'Origin');
  }
  return headers;
}

function json(request: Request, env: Env, data: Record<string, unknown>, status = 200): Response {
  const headers = cors(request, env);
  headers.set('x-pixelproof-request-id', requestId(request));
  return new Response(JSON.stringify({...data, request_id: requestId(request)}), {status, headers});
}

function now() {
  return new Date().toISOString();
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function dodo(env: Env, path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${env.DODO_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${env.DODO_API_KEY}`,
      'x-business-id': env.DODO_BUSINESS_ID,
      'user-agent': 'PixelProof/1.0 (browser-local image tools)',
    },
    body: JSON.stringify(payload),
  });
  let data: Record<string, unknown> = {};
  try {
    const parsed = await response.json();
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
  } catch {}
  return {response, data};
}

function tierFromProduct(productId: unknown, env: Env): Tier | null {
  if (productId === env.DODO_SOLO_PRODUCT_ID) return 'solo';
  if (productId === env.DODO_STUDIO_PRODUCT_ID) return 'studio';
  return null;
}

async function checkout(request: Request, env: Env) {
  const payload = await body(request);
  const tier = payload.tier === 'studio' ? 'studio' : payload.tier === 'solo' ? 'solo' : null;
  if (!tier) return json(request, env, {error: 'tier is required'}, 400);
  if (!env.DODO_BASE_URL || !env.DODO_API_KEY || !env.DODO_BUSINESS_ID) {
    return json(request, env, {error: 'checkout is not configured', valid: false}, 503);
  }
  const productId = tier === 'studio' ? env.DODO_STUDIO_PRODUCT_ID : env.DODO_SOLO_PRODUCT_ID;
  const result = await dodo(env, '/checkouts', {
    product_cart: [{product_id: productId, quantity: 1}],
    return_url: `${env.PAGES_ORIGIN}/activate.html`,
  });
  const url = typeof result.data.checkout_url === 'string' ? result.data.checkout_url : '';
  if (!result.response.ok || !url) return json(request, env, {error: 'checkout is temporarily unavailable'}, 502);
  return json(request, env, {checkout_url: url, tier});
}

async function validate(request: Request, env: Env) {
  const payload = await body(request);
  const key = typeof payload.license_key === 'string' ? payload.license_key.trim() : '';
  if (!key) return json(request, env, {error: 'license_key is required', valid: false}, 400);
  if (!env.DODO_BASE_URL || !env.DODO_API_KEY || !env.DODO_BUSINESS_ID) {
    return json(request, env, {error: 'licence validation is temporarily unavailable', valid: false}, 503);
  }
  const result = await dodo(env, '/licenses/validate', {license_key: key});
  const valid = result.response.ok && result.data.valid !== false;
  if (!valid) return json(request, env, {valid: false, error: 'licence key is invalid or inactive'}, 403);
  const tier = tierFromProduct(result.data.product_id || result.data.productId, env)
    || (result.data.tier === 'studio' ? 'studio' : 'solo');
  const config = TIER_CONFIG[tier];
  await env.DB.prepare(
    `INSERT INTO licenses(license_key,tier,email,dodo_payment_id,status,created_at,updated_at)
     VALUES(?1,?2,?3,?4,'active',?5,?5)
     ON CONFLICT(license_key) DO UPDATE SET tier=excluded.tier,email=excluded.email,dodo_payment_id=excluded.dodo_payment_id,status='active',updated_at=excluded.updated_at`,
  ).bind(key, tier, result.data.email || null, result.data.payment_id || result.data.paymentId || null, now()).run();
  return json(request, env, {valid: true, tier, label: config.label, maxFiles: config.maxFiles});
}

async function verifyWebhook(request: Request, env: Env, raw: string) {
  const secret = env.DODO_WEBHOOK_SECRET;
  const id = request.headers.get('webhook-id');
  const timestamp = request.headers.get('webhook-timestamp');
  const signature = request.headers.get('webhook-signature');
  if (!secret || !id || !timestamp || !signature) return false;
  const key = secret.replace(/^whsec_/, '');
  const cryptoKey = await crypto.subtle.importKey('raw', Uint8Array.from(atob(key), char => char.charCodeAt(0)), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(`${id}.${timestamp}.${raw}`));
  const expected = btoa(String.fromCharCode(...new Uint8Array(signed)));
  return signature.split(' ').includes(`v1,${expected}`);
}

async function webhook(request: Request, env: Env) {
  const raw = await request.text();
  if (!(await verifyWebhook(request, env, raw))) return json(request, env, {error: 'invalid webhook signature'}, 401);
  const eventId = request.headers.get('webhook-id') || crypto.randomUUID();
  const inserted = await env.DB.prepare('INSERT OR IGNORE INTO webhook_events(event_id,received_at) VALUES(?1,?2)').bind(eventId, now()).run();
  if (!inserted.meta.changes) return json(request, env, {ok: true, duplicate: true});
  const event = JSON.parse(raw) as Record<string, unknown>;
  const data = event.data && typeof event.data === 'object' ? event.data as Record<string, unknown> : {};
  const key = typeof data.license_key === 'string' ? data.license_key : typeof data.licenseKey === 'string' ? data.licenseKey : '';
  const paymentId = typeof data.payment_id === 'string' ? data.payment_id : typeof data.paymentId === 'string' ? data.paymentId : null;
  const productId = data.product_id || data.productId;
  const tier = tierFromProduct(productId, env);
  if (key && tier && String(event.type || '').includes('succeeded')) {
    await env.DB.prepare(
      `INSERT INTO licenses(license_key,tier,email,dodo_payment_id,status,created_at,updated_at)
       VALUES(?1,?2,?3,?4,'active',?5,?5)
       ON CONFLICT(license_key) DO UPDATE SET tier=excluded.tier,email=excluded.email,dodo_payment_id=excluded.dodo_payment_id,status='active',updated_at=excluded.updated_at`,
    ).bind(key, tier, data.email || null, paymentId, now()).run();
  }
  if (key && (String(event.type || '').includes('refund') || String(event.type || '').includes('cancel'))) {
    await env.DB.prepare('UPDATE licenses SET status=\'disabled\',updated_at=?2 WHERE license_key=?1').bind(key, now()).run();
  }
  return json(request, env, {ok: true});
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = new Headers(request.headers);
    headers.set('x-pixelproof-request-id', requestId(request));
    request = new Request(request, {headers});
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors(request, env)});
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json(request, env, {ok: true});
      if (request.method === 'POST' && url.pathname === '/checkout') return checkout(request, env);
      if (request.method === 'POST' && url.pathname === '/license/validate') return validate(request, env);
      if (request.method === 'POST' && url.pathname === '/webhook/dodo') return webhook(request, env);
      return json(request, env, {error: 'not found'}, 404);
    } catch {
      return json(request, env, {error: 'request failed'}, 500);
    }
  },
};
