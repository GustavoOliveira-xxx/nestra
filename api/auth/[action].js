import crypto from 'node:crypto';
import { sql, asUser } from '../_lib/db.js';
import { handler, json, fail, readBody, setCookie, clientIpHash } from '../_lib/http.js';
import {
  hashPassword, verifyPassword, createSession, revokeSession, requireUser,
  SESSION_COOKIE, hashEmail, tooManyAttempts, recordAttempt, logAccountEvent,
} from '../_lib/auth.js';
import { accountState } from '../_lib/account.js';

const GENERIC = 'E-mail ou senha incorretos.';

const SUGGESTED = [
  { name: 'Trabalho', slug: 'trabalho', color: '#2F6BFF', icon: 'briefcase', description: 'Demandas, respostas e prazos.' },
  { name: 'Estudos', slug: 'estudos', color: '#4FD8FF', icon: 'book', description: 'Provas, leituras e entregas.' },
  { name: 'Pessoal', slug: 'pessoal', color: '#9B7BFF', icon: 'heart', description: 'O que é só seu.' },
];

async function register(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'method', 'Método não permitido.');

  const { displayName, email, password, timezone, locale } = await readBody(req);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(displayName || '').trim();

  if (cleanName.length < 2 || cleanName.length > 80) {
    return fail(res, 400, 'invalid_name', 'Escreva um nome entre 2 e 80 caracteres.');
  }
  if (cleanEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return fail(res, 400, 'invalid_email', 'Confira o e-mail digitado.');
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    return fail(res, 400, 'invalid_password', 'A senha precisa de pelo menos 8 caracteres.');
  }
  const cleanTimezone = String(timezone || 'America/Sao_Paulo').trim();
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: cleanTimezone }).format(new Date());
  } catch {
    return fail(res, 400, 'invalid_timezone', 'Fuso horário não reconhecido.');
  }

  const existing = await sql`select id from users where email = ${cleanEmail} limit 1`;
  if (existing.length) {
    return fail(res, 409, 'unavailable',
      'Não foi possível criar a conta com esses dados. Se já tem cadastro, recupere o acesso.');
  }

  const inserted = await sql`
    insert into users (email, display_name, password_hash, timezone, locale)
    values (${cleanEmail}, ${cleanName}, ${hashPassword(password)},
            ${cleanTimezone}, ${locale === 'pt-BR' ? locale : 'pt-BR'})
    returning id, email, display_name, timezone, locale
  `;
  const user = inserted[0];
  const ipHash = clientIpHash(req, crypto);

  await asUser(user.id, (query) => [
    query`insert into user_preferences (user_id) values (${user.id})`,
    query`insert into notification_preferences (user_id) values (${user.id})`,
    ...SUGGESTED.map((env, i) => query`
      insert into environments (owner_id, name, slug, description, color, icon, position, is_default)
      values (${user.id}, ${env.name}, ${env.slug}, ${env.description},
              ${env.color}, ${env.icon}, ${i}, false)
    `),
    query`
      insert into user_consents (user_id, kind, version, granted, ip_hash)
      values (${user.id}, 'terms', '1.0', true, ${ipHash}),
             (${user.id}, 'privacy', '1.0', true, ${ipHash})
    `,
  ]);

  const { token } = await createSession(user.id, {
    userAgent: req.headers['user-agent'],
    ipHash,
  });
  setCookie(res, SESSION_COOKIE, token);
  await logAccountEvent(user.id, 'account_created', {}, ipHash);

  json(res, 201, await accountState(user));
}

async function login(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'method', 'Método não permitido.');

  const { email, password } = await readBody(req);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const ipHash = clientIpHash(req, crypto);
  const emailHash = hashEmail(cleanEmail);

  if (!cleanEmail || !password) return fail(res, 400, 'invalid_credentials', GENERIC);

  if (await tooManyAttempts(emailHash, ipHash)) {
    return fail(res, 429, 'rate_limited',
      'Muitas tentativas seguidas. Aguarde alguns minutos antes de tentar de novo.');
  }

  const rows = await sql`
    select id, email, display_name, password_hash, timezone, locale, locked_until
      from users
     where email = ${cleanEmail} and deleted_at is null and status = 'active'
     limit 1
  `;
  const user = rows[0];
  const ok = user && verifyPassword(password, user.password_hash);

  await recordAttempt(emailHash, ipHash, Boolean(ok));

  if (!ok) {
    if (user) {
      await sql`update users set failed_login_count = failed_login_count + 1 where id = ${user.id}`;
    }
    return fail(res, 401, 'invalid_credentials', GENERIC);
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return fail(res, 423, 'locked', 'Esta conta está temporariamente bloqueada.');
  }

  await sql`update users set last_login_at = now(), failed_login_count = 0 where id = ${user.id}`;

  const { token } = await createSession(user.id, {
    userAgent: req.headers['user-agent'],
    ipHash,
  });
  setCookie(res, SESSION_COOKIE, token);
  await logAccountEvent(user.id, 'login', {}, ipHash);

  json(res, 200, await accountState(user));
}

async function me(req, res) {
  const user = await requireUser(req, res);
  if (!user) return;
  json(res, 200, await accountState(user));
}

async function logout(req, res) {
  await revokeSession(req);
  setCookie(res, SESSION_COOKIE, '', { clear: true });
  json(res, 200, { ok: true });
}

const ROUTES = { register, login, me, logout };

export default handler(async (req, res) => {
  const action = String(req.query?.action || new URL(req.url, 'http://x').pathname.split('/').pop());
  const route = ROUTES[action];
  if (!route) return fail(res, 404, 'not_found', 'Rota não encontrada.');
  await route(req, res);
});
