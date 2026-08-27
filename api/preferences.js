/* PUT /api/preferences — §21 preferências individuais */

import { asUser, oneAsUser, prefsToClient } from './_lib/db.js';
import { handler, json, fail, readBody, isUuid } from './_lib/http.js';
import { requireUser } from './_lib/auth.js';

const ENUMS = {
  density: ['compact', 'comfortable', 'spacious'],
  motion: ['full', 'reduced'],
  cornerStyle: ['square', 'soft'],
  timeFormat: ['24h', '12h'],
  startView: ['today', 'last_environment'],
  afterComplete: ['keep', 'fade', 'hide'],
};

export default handler(async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'GET') {
    const [rows, notifications] = await asUser(user.id, (sql) => [
      sql`select * from user_preferences where user_id = ${user.id}`,
      sql`select * from notification_preferences where user_id = ${user.id}`,
    ]);
    return json(res, 200, { preferences: prefsToClient(rows[0], notifications[0]) });
  }

  if (req.method !== 'PUT') return fail(res, 405, 'method', 'Método não permitido.');

  const body = await readBody(req);
  const patch = {};
  const notificationPatch = {};

  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (key in body && allowed.includes(body[key])) patch[key] = body[key];
  }
  if ('accent' in body && /^#[0-9a-f]{6}$/i.test(body.accent)) patch.accent = body.accent;
  if ('theme' in body) patch.theme = String(body.theme).slice(0, 40);
  if ('dateFormat' in body) patch.dateFormat = String(body.dateFormat).slice(0, 20);
  for (const key of [
    'highContrast', 'showUndatedOnToday', 'showHighPriorityOutsideToday',
    'confirmBeforeDelete', 'nlParsingEnabled', 'soundEnabled',
  ]) {
    if (!(key in body)) continue;
    if (typeof body[key] !== 'boolean') {
      return fail(res, 400, 'invalid_boolean', 'Preferência booleana inválida.');
    }
    patch[key] = body[key];
  }
  if ('glowIntensity' in body && Number.isInteger(body.glowIntensity) &&
      body.glowIntensity >= 0 && body.glowIntensity <= 100) {
    patch.glowIntensity = body.glowIntensity;
  }
  if ('weekStart' in body && [0, 1, 2, 3, 4, 5, 6].includes(body.weekStart)) {
    patch.weekStart = body.weekStart;
  }
  if ('defaultEnvironmentId' in body) {
    const environmentId = body.defaultEnvironmentId || null;
    if (environmentId) {
      if (!isUuid(environmentId)) {
        return fail(res, 400, 'invalid_environment', 'Ambiente padrão inválido.');
      }
      const environments = await oneAsUser(user.id, (sql) =>
        sql`select id from environments
             where id = ${environmentId} and owner_id = ${user.id} and archived_at is null`);
      if (!environments.length) {
        return fail(res, 400, 'invalid_environment', 'Este ambiente não está disponível.');
      }
    }
    patch.defaultEnvironmentId = environmentId;
  }

  for (const key of ['notificationsEnabled', 'notifyDueItems', 'notifyCommitments', 'notifyOverdue']) {
    if (!(key in body)) continue;
    if (typeof body[key] !== 'boolean') {
      return fail(res, 400, 'invalid_boolean', 'Preferência booleana inválida.');
    }
    notificationPatch[key] = body[key];
  }
  if ('notifyLeadMinutes' in body) {
    if (!Number.isInteger(body.notifyLeadMinutes) || body.notifyLeadMinutes < 0 || body.notifyLeadMinutes > 1440) {
      return fail(res, 400, 'invalid_lead', 'Antecedência inválida.');
    }
    notificationPatch.notifyLeadMinutes = body.notifyLeadMinutes;
  }

  if (!Object.keys(patch).length && !Object.keys(notificationPatch).length) {
    return fail(res, 400, 'empty_patch', 'Nada para atualizar.');
  }

  const p = JSON.stringify(patch);

  const [rows] = await asUser(user.id, (sql) => [
    sql`
      update user_preferences u set
        theme                            = case when x.p ? 'theme'        then x.p->>'theme'        else u.theme end,
        accent                           = case when x.p ? 'accent'       then x.p->>'accent'       else u.accent end,
        density                          = case when x.p ? 'density'      then x.p->>'density'      else u.density end,
        motion                           = case when x.p ? 'motion'       then x.p->>'motion'       else u.motion end,
        corner_style                     = case when x.p ? 'cornerStyle'  then x.p->>'cornerStyle'  else u.corner_style end,
        date_format                      = case when x.p ? 'dateFormat'   then x.p->>'dateFormat'   else u.date_format end,
        time_format                      = case when x.p ? 'timeFormat'   then x.p->>'timeFormat'   else u.time_format end,
        start_view                       = case when x.p ? 'startView'    then x.p->>'startView'    else u.start_view end,
        after_complete                   = case when x.p ? 'afterComplete' then x.p->>'afterComplete' else u.after_complete end,
        high_contrast                    = case when x.p ? 'highContrast' then (x.p->>'highContrast')::boolean else u.high_contrast end,
        glow_intensity                   = case when x.p ? 'glowIntensity' then (x.p->>'glowIntensity')::smallint else u.glow_intensity end,
        week_start                       = case when x.p ? 'weekStart'    then (x.p->>'weekStart')::smallint else u.week_start end,
        show_undated_on_today            = case when x.p ? 'showUndatedOnToday' then (x.p->>'showUndatedOnToday')::boolean else u.show_undated_on_today end,
        show_high_priority_outside_today = case when x.p ? 'showHighPriorityOutsideToday' then (x.p->>'showHighPriorityOutsideToday')::boolean else u.show_high_priority_outside_today end,
        confirm_before_delete            = case when x.p ? 'confirmBeforeDelete' then (x.p->>'confirmBeforeDelete')::boolean else u.confirm_before_delete end,
        nl_parsing_enabled               = case when x.p ? 'nlParsingEnabled' then (x.p->>'nlParsingEnabled')::boolean else u.nl_parsing_enabled end,
        sound_enabled                    = case when x.p ? 'soundEnabled' then (x.p->>'soundEnabled')::boolean else u.sound_enabled end,
        default_environment_id           = case when x.p ? 'defaultEnvironmentId' then (x.p->>'defaultEnvironmentId')::uuid else u.default_environment_id end
      from (select ${p}::jsonb as p) x
      where u.user_id = ${user.id}
      returning u.*
    `,
  ]);

  /* Mantém o indicador legado do ambiente alinhado à preferência usada
     de fato pelas capturas. Assim nenhum aparelho mostra um padrão e
     envia os itens para outro lugar. */
  if ('defaultEnvironmentId' in patch) {
    await asUser(user.id, (sql) => [
      sql`update environments
             set is_default = coalesce(id = ${patch.defaultEnvironmentId}, false)
           where owner_id = ${user.id} and archived_at is null`,
    ]);
  }

  let notificationRows;
  if (Object.keys(notificationPatch).length) {
    const np = JSON.stringify(notificationPatch);
    [notificationRows] = await asUser(user.id, (sql) => [
      sql`
        update notification_preferences n set
          enabled       = case when x.p ? 'notificationsEnabled' then (x.p->>'notificationsEnabled')::boolean else n.enabled end,
          due_items     = case when x.p ? 'notifyDueItems'       then (x.p->>'notifyDueItems')::boolean       else n.due_items end,
          commitments   = case when x.p ? 'notifyCommitments'    then (x.p->>'notifyCommitments')::boolean    else n.commitments end,
          overdue_items = case when x.p ? 'notifyOverdue'        then (x.p->>'notifyOverdue')::boolean        else n.overdue_items end,
          lead_minutes  = case when x.p ? 'notifyLeadMinutes'    then (x.p->>'notifyLeadMinutes')::int         else n.lead_minutes end
        from (select ${np}::jsonb as p) x
        where n.user_id = ${user.id}
        returning n.*
      `,
    ]);
  } else {
    [notificationRows] = await asUser(user.id, (sql) => [
      sql`select * from notification_preferences where user_id = ${user.id}`,
    ]);
  }

  json(res, 200, { preferences: prefsToClient(rows[0], notificationRows[0]) });
});
