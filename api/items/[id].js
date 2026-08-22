/* =====================================================================
   PUT    /api/items/:id           — edita campos do item
   DELETE /api/items/:id           — envia para a lixeira (§24)
   DELETE /api/items/:id?purge=1   — exclui em definitivo
   ===================================================================== */

import { asUser, oneAsUser, itemToClient } from '../_lib/db.js';
import { handler, json, fail, readBody } from '../_lib/http.js';
import { requireUser } from '../_lib/auth.js';

const TYPES = ['task', 'reminder', 'commitment', 'idea'];
const STATUSES = ['pending', 'done', 'snoozed', 'archived'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const PERIODS = ['any', 'morning', 'afternoon', 'evening', 'night'];

export default handler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = req.query?.id;
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) {
    return fail(res, 400, 'invalid_id', 'Identificador inválido.');
  }

  /* ---------------- exclusão ---------------- */
  if (req.method === 'DELETE') {
    const purge = String(req.query?.purge || '') === '1';

    const [rows] = await asUser(user.id, (sql) => [
      purge
        ? sql`delete from items where id = ${id} and owner_id = ${user.id} returning id`
        : sql`
            update items
               set deleted_at = now(),
                   purge_after = now() + interval '30 days'
             where id = ${id} and owner_id = ${user.id} and deleted_at is null
             returning id
          `,
    ]);

    if (!rows.length) return fail(res, 404, 'not_found', 'Item não encontrado.');
    return json(res, 200, { ok: true, purged: purge });
  }

  if (req.method !== 'PUT') return fail(res, 405, 'method', 'Método não permitido.');

  /* ---------------- edição ---------------- */
  const body = await readBody(req);

  // Só campos conhecidos entram; o resto é ignorado em silêncio.
  const patch = {};
  if ('title' in body) {
    const t = String(body.title || '').trim();
    if (!t || t.length > 280) return fail(res, 400, 'invalid_title', 'Título inválido.');
    patch.title = t;
  }
  if ('description' in body) patch.description = body.description ? String(body.description).slice(0, 4000) : null;
  if ('type' in body && TYPES.includes(body.type)) patch.type = body.type;
  if ('status' in body && STATUSES.includes(body.status)) patch.status = body.status;
  if ('priority' in body && PRIORITIES.includes(body.priority)) patch.priority = body.priority;
  if ('timePeriod' in body && PERIODS.includes(body.timePeriod)) patch.timePeriod = body.timePeriod;
  if ('environmentId' in body) patch.environmentId = body.environmentId || null;
  if ('pinned' in body) patch.pinned = Boolean(body.pinned);
  if ('needsReview' in body) patch.needsReview = Boolean(body.needsReview);
  if ('deletedAt' in body) patch.deletedAt = body.deletedAt || null;

  if ('dueDate' in body) {
    patch.dueDate = /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate || '') ? body.dueDate : null;
  }
  if ('dueTime' in body) {
    patch.dueTime = /^\d{2}:\d{2}$/.test(body.dueTime || '') ? body.dueTime : null;
  }

  if (!Object.keys(patch).length) {
    return fail(res, 400, 'empty_patch', 'Nada para atualizar.');
  }

  if (patch.environmentId) {
    if (!/^[0-9a-f-]{36}$/i.test(String(patch.environmentId))) {
      return fail(res, 400, 'invalid_environment', 'Ambiente inválido.');
    }
    const environments = await oneAsUser(user.id, (sql) =>
      sql`select id from environments
           where id = ${patch.environmentId} and owner_id = ${user.id} and archived_at is null`);
    if (!environments.length) {
      return fail(res, 400, 'invalid_environment', 'Este ambiente não está disponível.');
    }
  }

  // O patch viaja como JSONB: assim um campo ausente permanece e um campo
  // presente com null é realmente apagado (tirar o prazo, por exemplo).
  const p = JSON.stringify(patch);

  const [rows] = await asUser(user.id, (sql) => [
    sql`
      update items i set
        title          = case when x.p ? 'title'         then x.p->>'title'                    else i.title end,
        description    = case when x.p ? 'description'   then x.p->>'description'              else i.description end,
        type           = case when x.p ? 'type'          then (x.p->>'type')::nestra_item_type else i.type end,
        status         = case when x.p ? 'status'        then (x.p->>'status')::nestra_item_status else i.status end,
        priority       = case when x.p ? 'priority'      then (x.p->>'priority')::nestra_priority else i.priority end,
        time_period    = case when x.p ? 'timePeriod'    then (x.p->>'timePeriod')::nestra_day_period else i.time_period end,
        environment_id = case when x.p ? 'environmentId' then (x.p->>'environmentId')::uuid    else i.environment_id end,
        pinned         = case when x.p ? 'pinned'        then (x.p->>'pinned')::boolean        else i.pinned end,
        needs_review   = case when x.p ? 'needsReview'   then (x.p->>'needsReview')::boolean   else i.needs_review end,
        due_date       = case when x.p ? 'dueDate'       then (x.p->>'dueDate')::date          else i.due_date end,
        due_time       = case when x.p ? 'dueTime'       then (x.p->>'dueTime')::time          else i.due_time end,
        deleted_at     = case when x.p ? 'deletedAt'     then (x.p->>'deletedAt')::timestamptz else i.deleted_at end
      from (select ${p}::jsonb as p) x
      where i.id = ${id} and i.owner_id = ${user.id}
      returning i.*
    `,
  ]);

  if (!rows.length) return fail(res, 404, 'not_found', 'Item não encontrado.');
  json(res, 200, { item: itemToClient(rows[0]) });
});
