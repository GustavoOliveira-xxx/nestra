/* =====================================================================
   NESTRA — Ajudantes de HTTP: CORS, corpo, cookies e respostas
   §20: mensagens de erro úteis, mas sem detalhes internos do servidor
   ou do banco.
   ===================================================================== */

const ALLOWED = (process.env.NESTRA_ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(String(value || ''));

export const isDateOnly = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
};

export const isTimeOnly = (value) => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
};

export const validTimestamp = (value) => {
  if (!value || String(value).length > 80) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export function applyCors(req, res) {
  const origin = req.headers.origin;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const sameOrigin = host ? `${protocol}://${host}` : null;
  const originAllowed = !origin || origin === sameOrigin || ALLOWED.includes(origin);

  /* CORS sem este bloqueio só esconderia a resposta do site atacante,
     mas ainda deixaria a requisição chegar ao login/cadastro. Rejeitar a
     origem fecha login-CSRF e formulários cross-site. */
  if (!originAllowed) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(403).send(JSON.stringify({
      code: 'origin_not_allowed',
      message: 'Origem não permitida.',
    }));
    return true;
  }

  // Origens externas precisam estar explicitamente configuradas.
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
  const maxBytes = 1024 * 1024;
  if (req.body && typeof req.body === 'object') {
    if (Buffer.byteLength(JSON.stringify(req.body), 'utf8') > maxBytes) {
      const err = new Error('O corpo da requisição é grande demais.');
      err.status = 413;
      err.code = 'body_too_large';
      err.expose = true;
      throw err;
    }
    return req.body;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const err = new Error('O corpo da requisição é grande demais.');
      err.status = 413;
      err.code = 'body_too_large';
      err.expose = true;
      throw err;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('JSON inválido.');
    err.status = 400;
    err.code = 'invalid_json';
    err.expose = true;
    throw err;
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i < 0) return;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // Cookie malformado não derruba a API nem vira detalhe de servidor.
    }
  });
  return out;
}

export function setCookie(res, name, value, { maxAge = 60 * 60 * 24 * 30, clear = false } = {}) {
  /* `SameSite=None` só é necessário quando o site e a API moram em
     origens diferentes — e é justamente o modo que os navegadores de
     celular mais restringem. No iOS, com "prevenir rastreamento entre
     sites" ligado (que vem ligado), um cookie `None` pode simplesmente
     não ser guardado, e a pessoa entra, recarrega e está deslogada.
     Publicado tudo na mesma origem, `Lax` é mais seguro e sobrevive a
     essas proteções. Só quando existe uma lista de origens externas
     configurada é que o cookie precisa afrouxar. */
  const crossSite = ALLOWED.length > 0;

  const bits = [
    `${name}=${clear ? '' : encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    crossSite ? 'SameSite=None' : 'SameSite=Lax',
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
      if (!res.headersSent) fail(
        res,
        err?.status || 500,
        err?.code || 'server_error',
        err?.expose ? err.message : 'Não foi possível concluir a operação agora.',
      );
    }
  };
}

export function serverSalt() {
  const salt = process.env.NESTRA_IP_SALT;
  if (!salt || salt.length < 16) {
    throw new Error('NESTRA_IP_SALT ausente ou curto demais.');
  }
  return salt;
}

/** Hash estável de IP, usado só para limitar tentativas (§19). */
export function clientIpHash(req, crypto) {
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'desconhecido';
  return crypto.createHash('sha256')
    .update(ip + serverSalt())
    .digest('hex')
    .slice(0, 32);
}
