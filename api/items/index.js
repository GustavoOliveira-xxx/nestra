/* =====================================================================
   GET  /api/items   — lista os itens do usuário autenticado
   POST /api/items   — cria um item

   §19: "Cada consulta e alteração deve ser filtrada pelo usuário
   autenticado." O owner_id entra em toda cláusula E a RLS do banco
   confere de novo.
   ===================================================================== */

import { asUser, oneAsUser, itemToClient } from '../_lib/db.js';
import { handler, json, fail, readBody } from '../_lib/http.js';
import { requireUser } from '../_lib/auth.js';

const TYPES = ['task', 'reminder', 'commitment', 'idea'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const PERIODS = ['any', 'morning', 'afternoon', 'evening', 'night'];

export default handler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const includeTrash = String(req.query?.trash || '') === '1';
    const [rows] = await asUser(user.id, (sql) => [
      includeTrash
        ? sql`select * from items where owner_id = ${user.id} and deleted_at is not null order by deleted_at desc limit 400`
        : sql`
            select i.*, coalesce(
                     (select json_agg(json_build_object(
                        'id', c.id, 'title', c.title, 'completed', c.completed, 'position', c.position)
                        order by c.position)
                        from checklist_items c where c.item_id = i.id), '[]'::json) as checklist
              from items i
             where i.owner_id = ${user.id} and i.deleted_at is null
             order by i.created_at desc
             limit 800
          `,
    ]);
    return json(res, 200, { items: rows.map(itemToClient) });
  }

  if (req.method !== 'POST') return fail(res, 405, 'method', 'Método não permitido.');

  const body = await readBody(req);

  // §20: validar tipos, tamanhos e formatos de entrada
  const title = String(body.title || '').trim();
  if (!title || title.length > 280) {
    return fail(res, 400, 'invalid_title', 'O título precisa ter entre 1 e 280 caracteres.');
  }
  const type = TYPES.includes(body.type) ? body.type : 'task';
  const priority = PRIORITIES.includes(body.priority) ? body.priority : 'normal';
  const timePeriod = PERIODS.includes(body.timePeriod) ? body.timePeriod : 'any';

  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate || '') ? body.dueDate : null;
  const dueTime = dueDate && /^\d{2}:\d{2}$/.test(body.dueTime || '') ? body.dueTime : null;

  /* A FK garante que o ambiente exista, mas não que ele pertença à mesma
     conta nem que ainda esteja ativo. Valida os dois antes de gravar para
     uma captura nunca aparecer no contexto errado ou sumir num arquivado. */
  let environmentId = body.environmentId || null;
  if (environmentId) {
    if (!/^[0-9a-f-]{36}$/i.test(String(environmentId))) {
      return fail(res, 400, 'invalid_environment', 'Ambiente inválido.');
    }
    const environments = await oneAsUser(user.id, (sql) =>
      sql`select id from environments
           where id = ${environmentId} and owner_id = ${user.id} and archived_at is null`);
    if (!environments.length) {
      return fail(res, 400, 'invalid_environment', 'Este ambiente não está disponível.');
    }
  }

  const [rows] = await asUser(user.id, (sql) => [
    sql`
      insert into items (
        id, owner_id, environment_id, type, title, description, priority,
        due_date, due_time, time_period, source, raw_input, parse_confidence, needs_review
      ) values (
        coalesce(${body.id || null}::uuid, gen_random_uuid()),
        ${user.id},
        ${environmentId},
        ${type}, ${title},
        ${body.description ? String(body.description).slice(0, 4000) : null},
        ${priority}, ${dueDate}, ${dueTime}, ${timePeriod},
        ${['manual', 'quick_capture', 'recurrence', 'import'].includes(body.source) ? body.source : 'manual'},
        ${body.rawInput ? String(body.rawInput).slice(0, 1000) : null},
        ${typeof body.parseConfidence === 'number' ? body.parseConfidence : null},
        ${Boolean(body.needsReview)}
      )
      on conflict (id) do nothing
      returning *
    `,
  ]);

  if (!rows.length) {
    // O id já existia: a fila de sincronização reenviou a mesma operação
    return json(res, 200, { item: null, duplicated: true });
  }

  json(res, 201, { item: itemToClient(rows[0]) });
});
