/* =====================================================================
   POST /api/checklist — subtarefas e checklists (§7.4)

   Um endpoint só, com `op`, porque a fila de sincronização do cliente
   reenvia operações fora de ordem e um caminho único simplifica muito o
   tratamento de conflito. A posse vem sempre do item pai.
   ===================================================================== */

import { asUser } from './_lib/db.js';
import { handler, json, fail, readBody } from './_lib/http.js';
import { requireUser } from './_lib/auth.js';

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));

export default handler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method !== 'POST') return fail(res, 405, 'method', 'Método não permitido.');

  const { op, itemId, entryId, entry, patch } = await readBody(req);
  if (!isUuid(itemId)) return fail(res, 400, 'invalid_id', 'Item inválido.');

  // O item precisa ser do usuário autenticado (§19)
  const [owned] = await asUser(user.id, (sql) => [
    sql`select id from items where id = ${itemId} and owner_id = ${user.id} limit 1`,
  ]);
  if (!owned.length) return fail(res, 404, 'not_found', 'Item não encontrado.');

  if (op === 'create') {
    const title = String(entry?.title || '').trim();
    if (!title || title.length > 200) {
      return fail(res, 400, 'invalid_title', 'O passo precisa ter entre 1 e 200 caracteres.');
    }
    const [rows] = await asUser(user.id, (sql) => [
      sql`
        insert into checklist_items (id, item_id, title, completed, position)
        values (
          coalesce(${entry?.id || null}::uuid, gen_random_uuid()),
          ${itemId}, ${title}, ${Boolean(entry?.completed)},
          coalesce(${Number.isInteger(entry?.position) ? entry.position : null},
                   (select count(*) from checklist_items where item_id = ${itemId}))
        )
        on conflict (id) do nothing
        returning *
      `,
    ]);
    return json(res, 201, { entry: rows[0] || null });
  }

  if (op === 'update') {
    if (!isUuid(entryId)) return fail(res, 400, 'invalid_id', 'Passo inválido.');

    const clean = {};
    if (patch && 'title' in patch) {
      const t = String(patch.title || '').trim();
      if (!t || t.length > 200) return fail(res, 400, 'invalid_title', 'Passo inválido.');
      clean.title = t;
    }
    if (patch && 'completed' in patch) clean.completed = Boolean(patch.completed);
    if (patch && 'position' in patch && Number.isInteger(patch.position)) clean.position = patch.position;
    if (!Object.keys(clean).length) return fail(res, 400, 'empty_patch', 'Nada para atualizar.');

    const p = JSON.stringify(clean);
    const [rows] = await asUser(user.id, (sql) => [
      sql`
        update checklist_items c set
          title        = case when x.p ? 'title'     then x.p->>'title'                else c.title end,
          completed    = case when x.p ? 'completed' then (x.p->>'completed')::boolean else c.completed end,
          position     = case when x.p ? 'position'  then (x.p->>'position')::int      else c.position end,
          completed_at = case when x.p ? 'completed'
                              then (case when (x.p->>'completed')::boolean then now() else null end)
                              else c.completed_at end
        from (select ${p}::jsonb as p) x
        where c.id = ${entryId} and c.item_id = ${itemId}
        returning c.*
      `,
    ]);
    if (!rows.length) return fail(res, 404, 'not_found', 'Passo não encontrado.');
    return json(res, 200, { entry: rows[0] });
  }

  if (op === 'delete') {
    if (!isUuid(entryId)) return fail(res, 400, 'invalid_id', 'Passo inválido.');
    await asUser(user.id, (sql) => [
      sql`delete from checklist_items where id = ${entryId} and item_id = ${itemId}`,
    ]);
    return json(res, 200, { ok: true });
  }

  fail(res, 400, 'invalid_op', 'Operação desconhecida.');
});
