/* =====================================================================
   POST /api/auth/register — §18 "Cadastro: nome de exibição, e-mail e
   senha, com validação dos campos."
   ===================================================================== */

import crypto from 'node:crypto';
import { sql, environmentToClient, prefsToClient } from '../_lib/db.js';
import { handler, json, fail, readBody, setCookie, clientIpHash } from '../_lib/http.js';
import { hashPassword, createSession, SESSION_COOKIE, logAccountEvent } from '../_lib/auth.js';

const SUGGESTED = [
  { name: 'Trabalho', slug: 'trabalho', color: '#2F6BFF', icon: 'briefcase', description: 'Demandas, respostas e prazos.' },
  { name: 'Estudos', slug: 'estudos', color: '#4FD8FF', icon: 'book', description: 'Provas, leituras e entregas.' },
  { name: 'Pessoal', slug: 'pessoal', color: '#9B7BFF', icon: 'heart', description: 'O que é só seu.' },
];

export default handler(async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'method', 'Método não permitido.');

  const { displayName, email, password, timezone, locale } = await readBody(req);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(displayName || '').trim();

  if (cleanName.length < 2 || cleanName.length > 80) {
    return fail(res, 400, 'invalid_name', 'Escreva um nome entre 2 e 80 caracteres.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return fail(res, 400, 'invalid_email', 'Confira o e-mail digitado.');
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    return fail(res, 400, 'invalid_password', 'A senha precisa de pelo menos 8 caracteres.');
  }

  const existing = await sql`select id from users where email = ${cleanEmail} limit 1`;
  if (existing.length) {
    // §18: mensagem neutra, sem confirmar que o e-mail existe
    return fail(res, 409, 'unavailable',
      'Não foi possível criar a conta com esses dados. Se já tem cadastro, recupere o acesso.');
  }

  const inserted = await sql`
    insert into users (email, display_name, password_hash, timezone, locale)
    values (${cleanEmail}, ${cleanName}, ${hashPassword(password)},
            ${timezone || 'America/Sao_Paulo'}, ${locale || 'pt-BR'})
    returning id, email, display_name, timezone, locale, avatar_color
  `;
  const user = inserted[0];

  await sql`insert into user_preferences (user_id) values (${user.id})`;
  await sql`insert into notification_preferences (user_id) values (${user.id})`;

  // Ambientes de exemplo, todos editáveis (§7.3, §29)
  for (const [i, env] of SUGGESTED.entries()) {
    await sql`
      insert into environments (owner_id, name, slug, description, color, icon, position, is_default)
      values (${user.id}, ${env.name}, ${env.slug}, ${env.description},
              ${env.color}, ${env.icon}, ${i}, false)
    `;
  }

  const ipHash = clientIpHash(req, crypto);
  const { token } = await createSession(user.id, {
    userAgent: req.headers['user-agent'],
    ipHash,
  });
  setCookie(res, SESSION_COOKIE, token);

  await sql`
    insert into user_consents (user_id, kind, version, granted, ip_hash)
    values (${user.id}, 'terms', '1.0', true, ${ipHash}),
           (${user.id}, 'privacy', '1.0', true, ${ipHash})
  `;
  await logAccountEvent(user.id, 'account_created', {}, ipHash);

  const envs = await sql`
    select * from environments where owner_id = ${user.id} order by position
  `;
  const prefs = await sql`select * from user_preferences where user_id = ${user.id}`;

  json(res, 201, {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      timezone: user.timezone,
      locale: user.locale,
    },
    preferences: prefsToClient(prefs[0]),
    environments: envs.map(environmentToClient),
    items: [],
  });
});
