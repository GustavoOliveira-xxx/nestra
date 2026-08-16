/* =====================================================================
   NESTRA — Ajudantes de HTTP: CORS, corpo, cookies e respostas
   §20: mensagens de erro úteis, mas sem detalhes internos do servidor
   ou do banco.
   ===================================================================== */

const ALLOWED = (process.env.NESTRA_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function applyCors(req, res) {
  const origin = req.headers.origin;

  // Sem lista configurada, só a mesma origem é aceita (o mais restrito)
  if (origin && ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function json(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(payload));
}

export function fail(res, status, code, message) {
  json(res, status, { code, message });
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

export function setCookie(res, name, value, { maxAge = 60 * 60 * 24 * 30, clear = false } = {}) {
  const bits = [
    `${name}=${clear ? '' : encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=None',
    `Max-Age=${clear ? 0 : maxAge}`,
  ];
  const prev = res.getHeader('Set-Cookie');
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  list.push(bits.join('; '));
  res.setHeader('Set-Cookie', list);
}

/** Envolve um handler com CORS e captura de erro sem vazar detalhes. */
export function handler(fn) {
  return async (req, res) => {
    if (applyCors(req, res)) return;
    try {
      await fn(req, res);
    } catch (err) {
      // O detalhe fica no log do servidor; o cliente recebe algo genérico
      console.error('[nestra api]', err?.message || err);
      if (!res.headersSent) {
        fail(res, 500, 'server_error', 'Não foi possível concluir a operação agora.');
      }
    }
  };
}

/** Hash estável de IP, usado só para limitar tentativas (§19). */
export function clientIpHash(req, crypto) {
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'desconhecido';
  return crypto.createHash('sha256')
    .update(ip + (process.env.NESTRA_IP_SALT || 'nestra'))
    .digest('hex')
    .slice(0, 32);
}
