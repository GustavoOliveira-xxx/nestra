/* PUT /api/environments/:id — edita ou arquiva um ambiente (§5, §7.3) */

import { asUser, environmentToClient } from '../_lib/db.js';
import { handler, json, fail, readBody } from '../_lib/http.js';
import { requireUser } from '../_lib/auth.js';

export default handler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = req.query?.id;
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) {
    return fail(res, 400, 'invalid_id', 'Identificador inválido.');
  }

  if (req.method !== 'PUT') return fail(res, 405, 'method', 'Método não permitido.');

  const body = await readBody(req);
  const patch = {};

  if ('name' in body) {
    const n = String(body.name || '').trim();
    if (!n || n.length > 60) return fail(res, 400, 'invalid_name', 'Nome inválido.');
    patch.name = n;
  }
  if ('slug' in body) patch.slug = String(body.slug).slice(0, 40);
  if ('description' in body) patch.description = body.description ? String(body.description).slice(0, 400) : null;
  if ('color' in body) {
    if (!/^#[0-9a-f]{6}$/i.test(body.color)) return fail(res, 400, 'invalid_color', 'Cor inválida.');
    patch.color = body.color;
  }
  if ('icon' in body) patch.icon = String(body.icon).slice(0, 30);
  if ('position' in body && Number.isInteger(body.position)) patch.position = body.position;
  if ('isDefault' in body) patch.isDefault = Boolean(body.isDefault);
  if ('archivedAt' in body) patch.archivedAt = body.archivedAt || null;

  if (!Object.keys(patch).length) return fail(res, 400, 'empty_patch', 'Nada para atualizar.');

  const p = JSON.stringify(patch);

  const [rows] = await asUser(user.id, (sql) => [
    sql`
      update environments e set
        name        = case when x.p ? 'name'        then x.p->>'name'                     else e.name end,
        slug        = case when x.p ? 'slug'        then x.p->>'slug'                     else e.slug end,
        description = case when x.p ? 'description' then x.p->>'description'              else e.description end,
        color       = case when x.p ? 'color'       then x.p->>'color'                    else e.color end,
        icon        = case when x.p ? 'icon'        then x.p->>'icon'                     else e.icon end,
        position    = case when x.p ? 'position'    then (x.p->>'position')::int          else e.position end,
        is_default  = case when x.p ? 'isDefault'   then (x.p->>'isDefault')::boolean     else e.is_default end,
        archived_at = case when x.p ? 'archivedAt'  then (x.p->>'archivedAt')::timestamptz else e.archived_at end
      from (select ${p}::jsonb as p) x
      where e.id = ${id} and e.owner_id = ${user.id}
      returning e.*
    `,
  ]);

  if (!rows.length) return fail(res, 404, 'not_found', 'Ambiente não encontrado.');

  // Arquivar não apaga itens: eles voltam para a caixa de entrada
  if (patch.archivedAt) {
    await asUser(user.id, (sql) => [
      sql`update items set environment_id = null
           where environment_id = ${id} and owner_id = ${user.id} and deleted_at is null`,
    ]);
  }

  json(res, 200, { environment: environmentToClient(rows[0]) });
});
