/* =====================================================================
   PUT    /api/account — atualiza perfil/fuso da conta autenticada
   DELETE /api/account — exclui a conta e todos os dados associados

   A interface já oferecia as duas ações, mas elas só alteravam a cópia
   do navegador. Este endpoint torna a promessa verdadeira no modo
   sincronizado e mantém a operação filtrada pela sessão atual.
   ===================================================================== */

import { sql } from './_lib/db.js';
import { handler, json, fail, readBody, setCookie } from './_lib/http.js';
import { requireUser, SESSION_COOKIE, logAccountEvent } from './_lib/auth.js';

export default handler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'PUT') {
    const body = await readBody(req);
    const patch = {};

    if ('displayName' in body) {
      const displayName = String(body.displayName || '').trim();
      if (displayName.length < 2 || displayName.length > 80) {
        return fail(res, 400, 'invalid_name', 'Escreva um nome entre 2 e 80 caracteres.');
      }
      patch.displayName = displayName;
    }

    if ('timezone' in body) {
      const timezone = String(body.timezone || '').trim();
      try {
        new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }).format(new Date());
      } catch {
        return fail(res, 400, 'invalid_timezone', 'Fuso horário não reconhecido.');
      }
      patch.timezone = timezone;
    }

    if (!Object.keys(patch).length) {
      return fail(res, 400, 'empty_patch', 'Nada para atualizar.');
    }

    const p = JSON.stringify(patch);
    const rows = await sql`
      update users u set
        display_name = case when x.p ? 'displayName' then x.p->>'displayName' else u.display_name end,
        timezone     = case when x.p ? 'timezone'    then x.p->>'timezone'    else u.timezone end
      from (select ${p}::jsonb as p) x
      where u.id = ${user.id} and u.deleted_at is null and u.status = 'active'
      returning u.id, u.email, u.display_name, u.timezone, u.locale, u.avatar_color
    `;

    if (!rows.length) return fail(res, 404, 'not_found', 'Conta não encontrada.');
    const row = rows[0];
    return json(res, 200, {
      user: {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        timezone: row.timezone,
        locale: row.locale,
        avatarColor: row.avatar_color,
      },
    });
  }

  if (req.method === 'DELETE') {
    await logAccountEvent(user.id, 'account_deleted');
    const rows = await sql`
      delete from users
       where id = ${user.id} and deleted_at is null
       returning id
    `;
    if (!rows.length) return fail(res, 404, 'not_found', 'Conta não encontrada.');

    setCookie(res, SESSION_COOKIE, '', { clear: true });
    return json(res, 200, { ok: true });
  }

  fail(res, 405, 'method', 'Método não permitido.');
});
