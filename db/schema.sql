-- =====================================================================
--  NESTRA — Esquema de banco de dados (PostgreSQL / Neon)
--  "seu espaço para o que importa"
--
--  Baseado no Relatório de Produto e Visão do Sistema (seções 13, 18,
--  19, 20, 21, 24, 25 e 26).
--
--  Princípios aplicados aqui:
--   1. Multiusuário desde o início: TODA entidade carrega owner_id/user_id.
--   2. A autorização acontece no servidor E no banco (RLS).
--   3. Índices por proprietário para consultas rápidas.
--   4. Exclusão passa por lixeira antes de virar definitiva.
--   5. Nenhum dado sensível de tarefa em logs — apenas eventos técnicos.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Extensões
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto;   -- gen_random_uuid(), digest()
create extension if not exists citext;     -- e-mail case-insensitive
create extension if not exists pg_trgm;    -- busca por similaridade

-- ---------------------------------------------------------------------
-- Tipos enumerados (seção 6 e 8 do documento)
-- ---------------------------------------------------------------------
do $$ begin
  create type nestra_item_type     as enum ('task','reminder','commitment','idea');
exception when duplicate_object then null; end $$;

do $$ begin
  create type nestra_item_status   as enum ('pending','done','snoozed','archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type nestra_priority      as enum ('low','normal','high','urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type nestra_day_period    as enum ('any','morning','afternoon','evening','night');
exception when duplicate_object then null; end $$;

do $$ begin
  create type nestra_member_role   as enum ('owner','editor','limited','viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type nestra_invite_status as enum ('pending','accepted','revoked','expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type nestra_export_status as enum ('queued','processing','done','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type nestra_export_format as enum ('json','csv');
exception when duplicate_object then null; end $$;

do $$ begin
  create type nestra_recur_freq    as enum ('daily','weekly','monthly','yearly');
exception when duplicate_object then null; end $$;

do $$ begin
  create type nestra_account_status as enum ('active','deactivated','deleted');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Helpers de identidade (usados pelas políticas de RLS)
-- A API define `set local app.user_id = '<uuid>'` dentro da transação.
-- ---------------------------------------------------------------------
create or replace function nestra_current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function nestra_touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- =====================================================================
--  1. CONTAS  (seções 18, 20, 25)
-- =====================================================================

create table if not exists users (
  id                 uuid primary key default gen_random_uuid(),
  email              citext not null unique,
  display_name       text   not null check (length(btrim(display_name)) between 1 and 80),
  password_hash      text,                      -- nulo quando o login é externo
  password_provider  text   not null default 'password'
                       check (password_provider in ('password','google','github')),
  timezone           text   not null default 'America/Sao_Paulo',
  locale             text   not null default 'pt-BR',
  avatar_color       text   not null default '#2F6BFF',
  status             nestra_account_status not null default 'active',
  email_verified_at  timestamptz,
  last_login_at      timestamptz,
  failed_login_count integer not null default 0,
  locked_until       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deactivated_at     timestamptz,               -- §18 desativação temporária
  deleted_at         timestamptz                -- §18 exclusão / anonimização
);
comment on table users is 'Conta de usuário. Senhas nunca em texto puro (§20).';

create index if not exists idx_users_status      on users (status) where deleted_at is null;
create index if not exists idx_users_deleted_at  on users (deleted_at) where deleted_at is not null;

-- Sessões ativas — §18 "visualização e encerramento de sessões"
create table if not exists sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  token_hash   text not null unique,            -- somente o hash do token
  device_label text,
  user_agent   text,
  ip_hash      text,                            -- §19 nunca o IP em claro
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);
create index if not exists idx_sessions_user   on sessions (user_id, revoked_at);
create index if not exists idx_sessions_expiry on sessions (expires_at) where revoked_at is null;

-- Recuperação de senha — §18
create table if not exists password_resets (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  token_hash        text not null unique,
  expires_at        timestamptz not null,
  used_at           timestamptz,
  requested_ip_hash text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_password_resets_user on password_resets (user_id, used_at);

-- Limitação de tentativas de login — §20 "limitar tentativas de login"
create table if not exists login_attempts (
  id         bigserial primary key,
  email_hash text not null,                     -- hash: não revela se o e-mail existe
  ip_hash    text,
  success    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_login_attempts_recent on login_attempts (email_hash, created_at desc);
create index if not exists idx_login_attempts_ip     on login_attempts (ip_hash, created_at desc);

-- Consentimentos — §25 (LGPD, §19)
create table if not exists user_consents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  kind       text not null check (kind in ('terms','privacy','notifications','analytics')),
  version    text not null default '1.0',
  granted    boolean not null default true,
  ip_hash    text,
  created_at timestamptz not null default now()
);
create index if not exists idx_user_consents_user on user_consents (user_id, kind, created_at desc);

-- Eventos de conta — §25 (metadados minimizados, sem conteúdo de tarefa)
create table if not exists account_events (
  id                 bigserial primary key,
  user_id            uuid references users(id) on delete set null,
  type               text not null,
  metadata_minimized jsonb not null default '{}'::jsonb,
  ip_hash            text,
  created_at         timestamptz not null default now()
);
create index if not exists idx_account_events_user on account_events (user_id, created_at desc);

-- =====================================================================
--  2. PREFERÊNCIAS  (seção 21)
-- =====================================================================

create table if not exists user_preferences (
  user_id                          uuid primary key references users(id) on delete cascade,
  theme                            text    not null default 'nestra-noturno',
  accent                           text    not null default '#2F6BFF',
  density                          text    not null default 'comfortable'
                                     check (density in ('compact','comfortable','spacious')),
  motion                           text    not null default 'full'
                                     check (motion in ('full','reduced')),
  high_contrast                    boolean not null default false,
  glow_intensity                   smallint not null default 70 check (glow_intensity between 0 and 100),
  corner_style                     text    not null default 'square'
                                     check (corner_style in ('square','soft')),
  week_start                       smallint not null default 0 check (week_start between 0 and 6),
  date_format                      text    not null default 'dd/MM/yyyy',
  time_format                      text    not null default '24h' check (time_format in ('24h','12h')),
  start_view                       text    not null default 'today'
                                     check (start_view in ('today','last_environment')),
  default_environment_id           uuid,        -- FK adicionada após environments
  show_undated_on_today            boolean not null default false,
  show_high_priority_outside_today boolean not null default true,
  confirm_before_delete            boolean not null default true,
  after_complete                   text    not null default 'fade'
                                     check (after_complete in ('keep','fade','hide')),
  nl_parsing_enabled               boolean not null default true,
  sound_enabled                    boolean not null default false,
  created_at                       timestamptz not null default now(),
  updated_at                       timestamptz not null default now()
);
comment on table user_preferences is 'Valores padrão sensatos: ninguém preenche questionário antes de usar (§21).';

-- =====================================================================
--  3. AMBIENTES  (seção 5)
-- =====================================================================

create table if not exists environments (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  slug        text not null,
  description text,
  color       text not null default '#2F6BFF',
  icon        text not null default 'layers',
  position    integer not null default 0,
  is_default  boolean not null default false,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table environments is 'Unidade principal de organização: Trabalho, Estudos, Pessoal... (§5)';

create unique index if not exists uq_environments_owner_slug on environments (owner_id, slug);
create index        if not exists idx_environments_owner      on environments (owner_id, position)
  where archived_at is null;

alter table user_preferences
  drop constraint if exists fk_prefs_default_environment;
alter table user_preferences
  add constraint fk_prefs_default_environment
  foreign key (default_environment_id) references environments(id) on delete set null;

-- =====================================================================
--  4. ITENS  (seções 6, 7, 8)
-- =====================================================================

create table if not exists items (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references users(id) on delete cascade,
  environment_id   uuid references environments(id) on delete set null,  -- null = caixa de entrada
  type             nestra_item_type   not null default 'task',
  title            text not null check (length(btrim(title)) between 1 and 280),
  description      text,
  status           nestra_item_status not null default 'pending',
  priority         nestra_priority    not null default 'normal',
  due_date         date,
  due_time         time,
  time_period      nestra_day_period  not null default 'any',
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 1440),
  pinned           boolean not null default false,
  position         integer not null default 0,
  -- captura por linguagem natural (§7.1, §24)
  source           text not null default 'manual'
                     check (source in ('manual','quick_capture','recurrence','import')),
  raw_input        text,                    -- a frase original é sempre preservada
  parse_confidence numeric(3,2) check (parse_confidence is null or parse_confidence between 0 and 1),
  needs_review     boolean not null default false,
  -- ciclo de vida (§8, §24)
  snoozed_until    date,
  completed_at     timestamptz,
  deleted_at       timestamptz,             -- lixeira temporária
  purge_after      timestamptz,             -- exclusão definitiva programada
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint chk_items_time_needs_date check (due_time is null or due_date is not null)
);
comment on table items is 'Tarefa, lembrete, compromisso ou ideia. "Atrasado" é calculado, não é estado (§8).';

create index if not exists idx_items_owner_status   on items (owner_id, status)         where deleted_at is null;
create index if not exists idx_items_owner_due      on items (owner_id, due_date)       where deleted_at is null and status = 'pending';
create index if not exists idx_items_owner_env      on items (owner_id, environment_id) where deleted_at is null;
create index if not exists idx_items_owner_priority on items (owner_id, priority)       where deleted_at is null and status = 'pending';
create index if not exists idx_items_undated        on items (owner_id, created_at desc)
  where deleted_at is null and due_date is null and status = 'pending';
create index if not exists idx_items_trash          on items (owner_id, deleted_at)     where deleted_at is not null;
create index if not exists idx_items_needs_review   on items (owner_id)                 where needs_review is true and deleted_at is null;

-- Busca textual em português (§10 "busca avançada" é posterior; o índice já fica pronto)
create index if not exists idx_items_search on items
  using gin (to_tsvector('portuguese', coalesce(title,'') || ' ' || coalesce(description,'')));
create index if not exists idx_items_title_trgm on items using gin (title gin_trgm_ops);

-- Checklists e subtarefas (§7.4)
create table if not exists checklist_items (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references items(id) on delete cascade,
  title        text not null check (length(btrim(title)) between 1 and 200),
  completed    boolean not null default false,
  position     integer not null default 0,
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_checklist_item on checklist_items (item_id, position);

-- Etiquetas — evolução prevista na §5 ("etiquetas ou vínculos secundários")
create table if not exists tags (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references users(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 40),
  color      text not null default '#7AA2FF',
  created_at timestamptz not null default now()
);
create unique index if not exists uq_tags_owner_name on tags (owner_id, lower(name));

create table if not exists item_tags (
  item_id    uuid not null references items(id) on delete cascade,
  tag_id     uuid not null references tags(id)  on delete cascade,
  created_at timestamptz not null default now(),
  primary key (item_id, tag_id)
);
create index if not exists idx_item_tags_tag on item_tags (tag_id);

-- Recorrência — §10 marca como "posterior"; a estrutura já nasce pronta
create table if not exists item_recurrences (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null unique references items(id) on delete cascade,
  freq       nestra_recur_freq not null,
  interval   integer not null default 1 check (interval between 1 and 365),
  byweekday  smallint[],
  bymonthday smallint[],
  until      date,
  max_count  integer,
  next_run   date,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_recurrences_next on item_recurrences (next_run) where active is true;

-- Vínculos entre itens ("próximos passos claros", §30)
create table if not exists item_relations (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references items(id) on delete cascade,
  related_item_id uuid not null references items(id) on delete cascade,
  kind            text not null default 'relates'
                    check (kind in ('relates','blocks','duplicates','follows')),
  created_at      timestamptz not null default now(),
  constraint chk_relation_not_self check (item_id <> related_item_id)
);
create unique index if not exists uq_item_relations on item_relations (item_id, related_item_id, kind);

-- Histórico do item — §13 (ItemEvent)
create table if not exists item_events (
  id         bigserial primary key,
  item_id    uuid references items(id) on delete cascade,
  user_id    uuid references users(id) on delete set null,
  action     text not null,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_item_events_item on item_events (item_id, created_at desc);
create index if not exists idx_item_events_user on item_events (user_id, created_at desc);

-- =====================================================================
--  5. NOTIFICAÇÕES  (seção 9)
-- =====================================================================

create table if not exists notification_preferences (
  user_id           uuid primary key references users(id) on delete cascade,
  enabled           boolean not null default false,
  due_items         boolean not null default true,
  commitments       boolean not null default true,
  overdue_items     boolean not null default true,
  lead_minutes      integer not null default 30 check (lead_minutes between 0 and 1440),
  daily_digest_at   time,
  quiet_hours_start time,
  quiet_hours_end   time,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table notification_preferences is 'Notificar só quando existir razão temporal clara (§9).';

create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index if not exists idx_push_user on push_subscriptions (user_id) where revoked_at is null;

-- =====================================================================
--  6. EXPORTAÇÃO E PORTABILIDADE  (seção 18)
-- =====================================================================

create table if not exists export_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  status       nestra_export_status not null default 'queued',
  format       nestra_export_format not null default 'json',
  file_path    text,
  item_count   integer,
  error_message text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz,
  expires_at   timestamptz
);
create index if not exists idx_exports_user on export_requests (user_id, created_at desc);

-- =====================================================================
--  7. COLABORAÇÃO FUTURA  (seção 23) — estrutura pronta, desligada no MVP
-- =====================================================================

create table if not exists environment_members (
  id             uuid primary key default gen_random_uuid(),
  environment_id uuid not null references environments(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  role           nestra_member_role not null default 'viewer',
  created_at     timestamptz not null default now()
);
create unique index if not exists uq_env_member on environment_members (environment_id, user_id);

create table if not exists share_invites (
  id             uuid primary key default gen_random_uuid(),
  environment_id uuid not null references environments(id) on delete cascade,
  inviter_id     uuid not null references users(id) on delete cascade,
  invitee_email  citext not null,
  role           nestra_member_role not null default 'viewer',
  status         nestra_invite_status not null default 'pending',
  token_hash     text not null unique,
  expires_at     timestamptz not null,
  created_at     timestamptz not null default now(),
  accepted_at    timestamptz,
  accepted_by    uuid references users(id) on delete set null
);
create index if not exists idx_invites_env   on share_invites (environment_id, status);
create index if not exists idx_invites_email on share_invites (invitee_email, status);

-- =====================================================================
--  8. TRIGGERS
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'users','user_preferences','environments','items','checklist_items',
    'item_recurrences','notification_preferences'
  ] loop
    execute format('drop trigger if exists trg_touch_%1$s on %1$I', t);
    execute format(
      'create trigger trg_touch_%1$s before update on %1$I
       for each row execute function nestra_touch_updated_at()', t);
  end loop;
end $$;

-- Histórico automático dos itens, sem gravar o conteúdo privado (§19)
create or replace function nestra_log_item_event() returns trigger
language plpgsql as $$
declare act text;
begin
  if tg_op = 'INSERT' then
    act := 'created';
  elsif old.deleted_at is null and new.deleted_at is not null then
    act := 'trashed';
  elsif old.deleted_at is not null and new.deleted_at is null then
    act := 'restored';
  elsif old.status is distinct from new.status then
    act := case new.status when 'done' then 'completed'
                           when 'snoozed' then 'snoozed'
                           when 'archived' then 'archived'
                           else 'reopened' end;
  elsif old.due_date is distinct from new.due_date then
    act := 'rescheduled';
  elsif old.environment_id is distinct from new.environment_id then
    act := 'moved';
  elsif old.priority is distinct from new.priority then
    act := 'reprioritized';
  else
    act := 'updated';
  end if;

  insert into item_events (item_id, user_id, action, metadata)
  values (
    new.id,
    new.owner_id,
    act,
    jsonb_strip_nulls(jsonb_build_object(
      'status',      nullif(new.status::text, ''),
      'priority',    nullif(new.priority::text, ''),
      'due_date',    new.due_date,
      'type',        new.type::text
    ))
  );
  return new;
end $$;

drop trigger if exists trg_items_event_ins on items;
create trigger trg_items_event_ins after insert on items
  for each row execute function nestra_log_item_event();

drop trigger if exists trg_items_event_upd on items;
create trigger trg_items_event_upd after update on items
  for each row when (old.* is distinct from new.*)
  execute function nestra_log_item_event();

-- completed_at coerente com o status
create or replace function nestra_sync_completed_at() returns trigger
language plpgsql as $$
begin
  if new.status = 'done' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_items_completed on items;
create trigger trg_items_completed before insert or update on items
  for each row execute function nestra_sync_completed_at();

-- Apenas um ambiente padrão por usuário
create or replace function nestra_single_default_env() returns trigger
language plpgsql as $$
begin
  if new.is_default then
    update environments set is_default = false
     where owner_id = new.owner_id and id <> new.id and is_default;
  end if;
  return new;
end $$;

drop trigger if exists trg_env_single_default on environments;
create trigger trg_env_single_default after insert or update of is_default on environments
  for each row when (new.is_default) execute function nestra_single_default_env();

-- =====================================================================
--  9. VISÕES  (seção 7.2 — a tela "Hoje")
-- =====================================================================

create or replace view v_items_enriched as
select
  i.*,
  e.name  as environment_name,
  e.color as environment_color,
  e.icon  as environment_icon,
  (i.status = 'pending' and i.due_date is not null and i.due_date < current_date) as is_overdue,
  (i.due_date = current_date)                                                     as is_today,
  (i.status = 'pending' and i.due_date is not null and i.due_date > current_date)  as is_future,
  (select count(*) from checklist_items c where c.item_id = i.id)                  as checklist_total,
  (select count(*) from checklist_items c where c.item_id = i.id and c.completed)  as checklist_done
from items i
left join environments e on e.id = i.environment_id
where i.deleted_at is null;

comment on view v_items_enriched is 'Itens com atraso calculado a partir da data — não é um estado (§8).';

create or replace view v_environment_stats as
select
  e.id      as environment_id,
  e.owner_id,
  e.name,
  e.color,
  count(i.id) filter (where i.status = 'pending')                                        as pending_count,
  count(i.id) filter (where i.status = 'pending' and i.due_date < current_date)          as overdue_count,
  count(i.id) filter (where i.status = 'pending' and i.due_date = current_date)          as today_count,
  count(i.id) filter (where i.status = 'pending' and i.due_date is null)                 as undated_count,
  count(i.id) filter (where i.status = 'done')                                           as done_count,
  max(i.updated_at)                                                                      as last_activity_at
from environments e
left join items i on i.environment_id = e.id and i.deleted_at is null
where e.archived_at is null
group by e.id, e.owner_id, e.name, e.color;

-- =====================================================================
--  10. RLS — a proteção real vive no banco, não só na interface (§19)
-- =====================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'environments','items','checklist_items','tags','item_tags','item_recurrences',
    'item_relations','item_events','user_preferences','notification_preferences',
    'push_subscriptions','export_requests','user_consents','sessions',
    'environment_members','share_invites'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- Políticas diretas (a tabela carrega a coluna do dono)
do $$
declare r record;
begin
  for r in
    select * from (values
      ('environments','owner_id'), ('items','owner_id'), ('tags','owner_id'),
      ('user_preferences','user_id'), ('notification_preferences','user_id'),
      ('push_subscriptions','user_id'), ('export_requests','user_id'),
      ('user_consents','user_id'), ('sessions','user_id'),
      ('item_events','user_id'), ('environment_members','user_id')
    ) as v(tbl, col)
  loop
    execute format('drop policy if exists p_owner on %I', r.tbl);
    execute format(
      'create policy p_owner on %I using (%I = nestra_current_user_id())
       with check (%I = nestra_current_user_id())', r.tbl, r.col, r.col);
  end loop;
end $$;

-- Políticas indiretas (a posse vem do item pai)
drop policy if exists p_owner on checklist_items;
create policy p_owner on checklist_items
  using (exists (select 1 from items i where i.id = item_id and i.owner_id = nestra_current_user_id()))
  with check (exists (select 1 from items i where i.id = item_id and i.owner_id = nestra_current_user_id()));

drop policy if exists p_owner on item_tags;
create policy p_owner on item_tags
  using (exists (select 1 from items i where i.id = item_id and i.owner_id = nestra_current_user_id()))
  with check (exists (select 1 from items i where i.id = item_id and i.owner_id = nestra_current_user_id()));

drop policy if exists p_owner on item_recurrences;
create policy p_owner on item_recurrences
  using (exists (select 1 from items i where i.id = item_id and i.owner_id = nestra_current_user_id()))
  with check (exists (select 1 from items i where i.id = item_id and i.owner_id = nestra_current_user_id()));

drop policy if exists p_owner on item_relations;
create policy p_owner on item_relations
  using (exists (select 1 from items i where i.id = item_id and i.owner_id = nestra_current_user_id()))
  with check (exists (select 1 from items i where i.id = item_id and i.owner_id = nestra_current_user_id()));

drop policy if exists p_owner on share_invites;
create policy p_owner on share_invites
  using (inviter_id = nestra_current_user_id())
  with check (inviter_id = nestra_current_user_id());

commit;
