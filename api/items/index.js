/* =====================================================================
   GET  /api/items   — lista os itens do usuário autenticado
   POST /api/items   — cria um item

   §19: "Cada consulta e alteração deve ser filtrada pelo usuário
   autenticado." O owner_id entra em toda cláusula E a RLS do banco
   confere de novo.
   ===================================================================== */

import { asUser, oneAsUser, itemToClient } from '../_lib/db.js';
import {
  handler, json, fail, readBody, isUuid, isDateOnly, isTimeOnly, validTimestamp,
} from '../_lib/http.js';
import { requireUser } from '../_lib/auth.js';

const TYPES = ['task', 'reminder', 'commitment', 'idea'];
const STATUSES = ['pending', 'done', 'snoozed', 'archived'];
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
  if (body.id && !isUuid(body.id)) {
    return fail(res, 400, 'invalid_id', 'Identificador inválido.');
  }
  const type = TYPES.includes(body.type) ? body.type : 'task';
  const status = STATUSES.includes(body.status) ? body.status : 'pending';
  const priority = PRIORITIES.includes(body.priority) ? body.priority : 'normal';
  const timePeriod = PERIODS.includes(body.timePeriod) ? body.timePeriod : 'any';
  const source = ['manual', 'quick_capture', 'recurrence', 'import'].includes(body.source)
    ? body.source
    : 'manual';

  const deletedAt = source === 'import' ? validTimestamp(body.deletedAt) : null;
  const createdAt = source === 'import' ? validTimestamp(body.createdAt) : null;

  if (body.dueDate && !isDateOnly(body.dueDate)) {
    return fail(res, 400, 'invalid_date', 'Data inválida.');
  }
  if (body.dueTime && !isTimeOnly(body.dueTime)) {
    return fail(res, 400, 'invalid_time', 'Horário inválido.');
  }
  if (body.dueTime && !body.dueDate) {
    return fail(res, 400, 'time_requires_date', 'Informe uma data junto do horário.');
  }
  if ('pinned' in body && typeof body.pinned !== 'boolean') {
    return fail(res, 400, 'invalid_pinned', 'Valor de fixação inválido.');
  }
  if ('needsReview' in body && typeof body.needsReview !== 'boolean') {
    return fail(res, 400, 'invalid_review', 'Valor de revisão inválido.');
  }
  if ('parseConfidence' in body &&
      (typeof body.parseConfidence !== 'number' || body.parseConfidence < 0 || body.parseConfidence > 1)) {
    return fail(res, 400, 'invalid_confidence', 'Confiança de interpretação inválida.');
  }
  const dueDate = body.dueDate || null;
  const dueTime = dueDate ? body.dueTime || null : null;

  /* A FK garante que o ambiente exista, mas não que ele pertença à mesma
     conta nem que ainda esteja ativo. Valida os dois antes de gravar para
     uma captura nunca aparecer no contexto errado ou sumir num arquivado. */
  let environmentId = body.environmentId || null;
  if (environmentId) {
    if (!isUuid(environmentId)) {
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
        id, owner_id, environment_id, type, title, description, status, priority,
        due_date, due_time, time_period, pinned, source, raw_input,
        parse_confidence, needs_review, deleted_at, purge_after, created_at
      ) values (
        coalesce(${body.id || null}::uuid, gen_random_uuid()),
        ${user.id},
        ${environmentId},
        ${type}, ${title},
        ${body.description ? String(body.description).slice(0, 4000) : null},
        ${status}, ${priority}, ${dueDate}, ${dueTime}, ${timePeriod},
        ${Boolean(body.pinned)}, ${source},
        ${body.rawInput ? String(body.rawInput).slice(0, 1000) : null},
        ${typeof body.parseConfidence === 'number' ? body.parseConfidence : null},
        ${Boolean(body.needsReview)},
        ${deletedAt},
        ${deletedAt ? new Date(new Date(deletedAt).getTime() + 30 * 864e5).toISOString() : null},
        coalesce(${createdAt}, now())
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
