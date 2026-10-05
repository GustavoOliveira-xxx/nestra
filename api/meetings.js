import { asUser, oneAsUser, meetingToClient, agendaToClient } from './_lib/db.js';
import {
  handler, json, fail, readBody, isUuid, isDateOnly, isTimeOnly, validTimestamp,
} from './_lib/http.js';
import { requireUser } from './_lib/auth.js';

const TEMPLATES = ['free', 'daily', 'one_on_one', 'review'];
const KINDS = ['root', 'topic', 'update', 'plan', 'blocker', 'question', 'decision', 'notice', 'idea'];
const MAX_NODES = 200;

const text = (value, max) => {
  const clean = String(value ?? '').trim();
  return clean ? clean.slice(0, max) : null;
};
const num = (value) => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null);

export function cleanNodes(list) {
  if (!Array.isArray(list)) return null;
  const nodes = [];
  const ids = new Set();
  for (const raw of list.slice(0, MAX_NODES)) {
    if (!raw || typeof raw !== 'object') continue;
    const id = text(raw.id, 40);
    if (!id || ids.has(id)) continue;
    ids.add(id);
    nodes.push({
      id,
      parentId: text(raw.parentId, 40),
      text: text(raw.text, 240) || '',
      detail: text(raw.detail, 600),
      kind: KINDS.includes(raw.kind) ? raw.kind : 'topic',
      done: Boolean(raw.done),
      doneAt: validTimestamp(raw.doneAt),
      note: text(raw.note, 1000),
      task: Boolean(raw.task),
      taskId: isUuid(raw.taskId) ? raw.taskId : null,
      who: text(raw.who, 60),
      source: text(raw.source, 20),
      x: num(raw.x),
      y: num(raw.y),
      order: Number.isInteger(raw.order) ? raw.order : nodes.length,
    });
  }
  return nodes.map((n) => (n.parentId && !ids.has(n.parentId) ? { ...n, parentId: null } : n));
}

async function saveMeeting(user, m) {
  if (!m || !isUuid(m.id)) return [400, 'invalid_id', 'Identificador inválido.'];
  const title = text(m.title, 80);
  if (!title) return [400, 'invalid_title', 'Dê um nome para a reunião.'];

  const weekdays = Array.isArray(m.weekdays)
    ? [...new Set(m.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : [1, 2, 3, 4, 5];
  const duration = Math.min(480, Math.max(5, Number.parseInt(m.durationMinutes, 10) || 15));
  const color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#2F6BFF';
  const template = TEMPLATES.includes(m.template) ? m.template : 'free';
  const startTime = isTimeOnly(m.startTime) ? m.startTime : null;
  const envId = isUuid(m.environmentId) ? m.environmentId : null;
  const archivedAt = m.archivedAt ? validTimestamp(m.archivedAt) : null;

  const rows = await oneAsUser(user.id, (sql) => sql`
    insert into meetings (id, owner_id, environment_id, title, template, color, weekdays,
                          start_time, duration_minutes, archived_at)
    values (${m.id}, ${user.id},
            (select id from environments where id = ${envId} and owner_id = ${user.id}),
            ${title}, ${template}, ${color}, ${weekdays}::smallint[],
            ${startTime}, ${duration}, ${archivedAt})
    on conflict (id) do update set
      environment_id   = excluded.environment_id,
      title            = excluded.title,
      template         = excluded.template,
      color            = excluded.color,
      weekdays         = excluded.weekdays,
      start_time       = excluded.start_time,
      duration_minutes = excluded.duration_minutes,
      archived_at      = excluded.archived_at
    where meetings.owner_id = ${user.id}
    returning *
  `);
  if (!rows.length) return [404, 'not_found', 'Reunião não encontrada.'];
  return [200, { meeting: meetingToClient(rows[0]) }];
}

async function saveAgenda(user, a) {
  if (!a || !isUuid(a.id) || !isUuid(a.meetingId)) return [400, 'invalid_id', 'Identificador inválido.'];
  if (!isDateOnly(a.occursOn)) return [400, 'invalid_date', 'Data inválida.'];
  const nodes = cleanNodes(a.nodes);
  if (!nodes) return [400, 'invalid_nodes', 'Mapa inválido.'];

  const rows = await oneAsUser(user.id, (sql) => sql`
    insert into meeting_agendas (id, owner_id, meeting_id, occurs_on, nodes, notes, summary,
                                 started_at, ended_at)
    select ${a.id}, ${user.id}, m.id, ${a.occursOn}, ${JSON.stringify(nodes)}::jsonb,
           ${text(a.notes, 4000)}, ${text(a.summary, 8000)},
           ${validTimestamp(a.startedAt)}, ${validTimestamp(a.endedAt)}
      from meetings m
     where m.id = ${a.meetingId} and m.owner_id = ${user.id}
    on conflict (meeting_id, occurs_on) do update set
      nodes      = excluded.nodes,
      notes      = excluded.notes,
      summary    = excluded.summary,
      started_at = excluded.started_at,
      ended_at   = excluded.ended_at
    where meeting_agendas.owner_id = ${user.id}
    returning *
  `);
  if (!rows.length) return [404, 'not_found', 'Reunião não encontrada.'];
  return [200, { agenda: agendaToClient(rows[0]) }];
}

async function deleteAgenda(user, id) {
  if (!isUuid(id)) return [400, 'invalid_id', 'Identificador inválido.'];
  await asUser(user.id, (sql) => [
    sql`delete from meeting_agendas where id = ${id} and owner_id = ${user.id}`,
  ]);
  return [200, { ok: true }];
}

export default handler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  if (req.method !== 'POST') return fail(res, 405, 'method', 'Método não permitido.');

  const body = await readBody(req);
  let result;
  if (body.op === 'saveMeeting') result = await saveMeeting(user, body.meeting);
  else if (body.op === 'saveAgenda') result = await saveAgenda(user, body.agenda);
  else if (body.op === 'deleteAgenda') result = await deleteAgenda(user, body.id);
  else return fail(res, 400, 'invalid_op', 'Operação desconhecida.');

  const [status, ...rest] = result;
  if (status >= 400) return fail(res, status, rest[0], rest[1]);
  json(res, status, rest[0]);
});
