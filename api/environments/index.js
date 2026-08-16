/* =====================================================================
   GET  /api/environments — lista os ambientes do usuário
   POST /api/environments — cria um ambiente (§5, Fluxo D)
   ===================================================================== */

import { asUser, environmentToClient } from '../_lib/db.js';
import { handler, json, fail, readBody } from '../_lib/http.js';
import { requireUser } from '../_lib/auth.js';

const slugify = (s) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 40) || 'ambiente';

export default handler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const [rows] = await asUser(user.id, (sql) => [
      sql`select * from environments where owner_id = ${user.id} order by position`,
    ]);
    return json(res, 200, { environments: rows.map(environmentToClient) });
  }

  if (req.method !== 'POST') return fail(res, 405, 'method', 'Método não permitido.');

  const body = await readBody(req);
  const name = String(body.name || '').trim();

  if (!name || name.length > 60) {
    return fail(res, 400, 'invalid_name', 'O nome precisa ter entre 1 e 60 caracteres.');
  }
  if (!/^#[0-9a-f]{6}$/i.test(body.color || '#2F6BFF')) {
    return fail(res, 400, 'invalid_color', 'Cor inválida.');
  }

  const [rows] = await asUser(user.id, (sql) => [
    sql`
      insert into environments (id, owner_id, name, slug, description, color, icon, position, is_default)
      values (
        coalesce(${body.id || null}::uuid, gen_random_uuid()),
        ${user.id}, ${name}, ${body.slug || slugify(name)},
        ${body.description ? String(body.description).slice(0, 400) : null},
        ${body.color || '#2F6BFF'},
        ${String(body.icon || 'layers').slice(0, 30)},
        coalesce(${Number.isInteger(body.position) ? body.position : null},
                 (select count(*) from environments where owner_id = ${user.id})),
        ${Boolean(body.isDefault)}
      )
      on conflict (id) do nothing
      returning *
    `,
  ]);

  if (!rows.length) return json(res, 200, { environment: null, duplicated: true });
  json(res, 201, { environment: environmentToClient(rows[0]) });
});
