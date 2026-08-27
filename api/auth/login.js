/* =====================================================================
   POST /api/auth/login — §18/§20
   Mesma mensagem para e-mail inexistente e senha errada, tentativas
   limitadas e nenhum detalhe interno na resposta.
   ===================================================================== */

import crypto from 'node:crypto';
import { sql, asUser, environmentToClient, itemToClient, prefsToClient } from '../_lib/db.js';
import { handler, json, fail, readBody, setCookie, clientIpHash } from '../_lib/http.js';
import {
  verifyPassword, createSession, SESSION_COOKIE,
  hashEmail, tooManyAttempts, recordAttempt, logAccountEvent,
} from '../_lib/auth.js';

const GENERIC = 'E-mail ou senha incorretos.';

export default handler(async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'method', 'Método não permitido.');

  const { email, password } = await readBody(req);
  const cleanEmail = String(email || '').trim().toLowerCase();
  const ipHash = clientIpHash(req, crypto);
  const emailHash = hashEmail(cleanEmail);

  if (!cleanEmail || !password) {
    return fail(res, 400, 'invalid_credentials', GENERIC);
  }

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

  await sql`
    update users set last_login_at = now(), failed_login_count = 0 where id = ${user.id}
  `;

  const { token } = await createSession(user.id, {
    userAgent: req.headers['user-agent'],
    ipHash,
  });
  setCookie(res, SESSION_COOKIE, token);
  await logAccountEvent(user.id, 'login', {}, ipHash);

  const [envs, items, prefs, notifications] = await asUser(user.id, (query) => [
    query`select * from environments where owner_id = ${user.id} order by position`,
    query`
      select i.*, coalesce(
               (select json_agg(json_build_object(
                  'id', c.id, 'title', c.title, 'completed', c.completed, 'position', c.position)
                  order by c.position)
                  from checklist_items c where c.item_id = i.id), '[]'::json) as checklist
        from items i
       where i.owner_id = ${user.id}
       order by i.created_at desc
       limit 1200
    `,
    query`select * from user_preferences where user_id = ${user.id}`,
    query`select * from notification_preferences where user_id = ${user.id}`,
  ]);

  json(res, 200, {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      timezone: user.timezone,
      locale: user.locale,
    },
    preferences: prefsToClient(prefs[0], notifications[0]),
    environments: envs.map(environmentToClient),
    items: items.map(itemToClient),
  });
});
