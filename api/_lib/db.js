/* =====================================================================
   NESTRA — Acesso ao Neon
   §14 e §26: o navegador nunca recebe a credencial do banco. Toda
   requisição passa por aqui, que verifica a sessão e aplica as regras.
   ===================================================================== */

import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  console.error('[nestra] DATABASE_URL não definida — configure a variável de ambiente.');
}

export const sql = neon(process.env.DATABASE_URL);

/**
 * Executa consultas dentro de uma transação com o dono definido.
 *
 * O `set_config('app.user_id', …, true)` é lido pelas políticas de RLS
 * criadas em db/schema.sql. Mesmo que uma consulta esqueça o WHERE, o
 * banco não devolve linhas de outra conta (§19: "a proteção real precisa
 * existir na API e no banco").
 *
 * @param {string} userId
 * @param {(sql: typeof import('@neondatabase/serverless').neon) => Array} build
 */
export async function asUser(userId, build) {
  const queries = build(sql);
  const list = Array.isArray(queries) ? queries : [queries];
  const results = await sql.transaction([
    sql`select set_config('app.user_id', ${userId}, true)`,
    ...list,
  ]);
  return results.slice(1);
}

/** Uma única consulta como o usuário autenticado. */
export async function oneAsUser(userId, build) {
  const [rows] = await asUser(userId, (s) => [build(s)]);
  return rows;
}

/* --------------------------------------------------------------------
   Conversão entre o formato do banco (snake_case) e o do front (camelCase)
   -------------------------------------------------------------------- */

export function itemToClient(row) {
  return {
    id: row.id,
    environmentId: row.environment_id,
    type: row.type,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
    dueTime: row.due_time ? String(row.due_time).slice(0, 5) : null,
    timePeriod: row.time_period,
    pinned: row.pinned,
    source: row.source,
    rawInput: row.raw_input,
    parseConfidence: row.parse_confidence == null ? null : Number(row.parse_confidence),
    needsReview: row.needs_review,
    snoozedUntil: row.snoozed_until ? String(row.snoozed_until).slice(0, 10) : null,
    completedAt: row.completed_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    checklist: row.checklist || [],
    tags: row.tags || [],
  };
}

export function environmentToClient(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    color: row.color,
    icon: row.icon,
    position: row.position,
    isDefault: row.is_default,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
  };
}

export function prefsToClient(row) {
  if (!row) return {};
  return {
    theme: row.theme,
    accent: row.accent,
    density: row.density,
    motion: row.motion,
    highContrast: row.high_contrast,
    glowIntensity: row.glow_intensity,
    cornerStyle: row.corner_style,
    weekStart: row.week_start,
    dateFormat: row.date_format,
    timeFormat: row.time_format,
    startView: row.start_view,
    defaultEnvironmentId: row.default_environment_id,
    showUndatedOnToday: row.show_undated_on_today,
    showHighPriorityOutsideToday: row.show_high_priority_outside_today,
    confirmBeforeDelete: row.confirm_before_delete,
    afterComplete: row.after_complete,
    nlParsingEnabled: row.nl_parsing_enabled,
    soundEnabled: row.sound_enabled,
  };
}

/** Mapeia campos camelCase do cliente para as colunas reais. */
export const ITEM_COLUMNS = {
  environmentId: 'environment_id',
  type: 'type',
  title: 'title',
  description: 'description',
  status: 'status',
  priority: 'priority',
  dueDate: 'due_date',
  dueTime: 'due_time',
  timePeriod: 'time_period',
  pinned: 'pinned',
  snoozedUntil: 'snoozed_until',
  deletedAt: 'deleted_at',
  needsReview: 'needs_review',
};

export const ENV_COLUMNS = {
  name: 'name',
  slug: 'slug',
  description: 'description',
  color: 'color',
  icon: 'icon',
  position: 'position',
  isDefault: 'is_default',
  archivedAt: 'archived_at',
};

export const PREF_COLUMNS = {
  theme: 'theme',
  accent: 'accent',
  density: 'density',
  motion: 'motion',
  highContrast: 'high_contrast',
  glowIntensity: 'glow_intensity',
  cornerStyle: 'corner_style',
  weekStart: 'week_start',
  dateFormat: 'date_format',
  timeFormat: 'time_format',
  startView: 'start_view',
  defaultEnvironmentId: 'default_environment_id',
  showUndatedOnToday: 'show_undated_on_today',
  showHighPriorityOutsideToday: 'show_high_priority_outside_today',
  confirmBeforeDelete: 'confirm_before_delete',
  afterComplete: 'after_complete',
  nlParsingEnabled: 'nl_parsing_enabled',
  soundEnabled: 'sound_enabled',
};
