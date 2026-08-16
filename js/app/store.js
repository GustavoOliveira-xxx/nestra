/* =====================================================================
   NESTRA — Estado da aplicação

   Funciona offline por padrão e sincroniza com o Neon quando existe uma
   API publicada. Cada conta guarda seus dados numa chave própria: nunca
   há como uma conta enxergar a outra pela interface (§19). A proteção
   real, porém, mora no servidor e no banco — o front só organiza.
   ===================================================================== */

import { api, syncQueue } from './api.js';
import { todayIn, toISODate } from './nlp.js';

const K = {
  accounts: 'nestra:accounts',
  session: 'nestra:session',
  data: (userId) => `nestra:data:${userId}`,
  lastEnv: 'nestra:last-env',
};

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2));

const read = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

/* ---------------------------------------------------------------------
   Senhas — nunca em texto puro, nem no modo local (§20)
   --------------------------------------------------------------------- */
async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const salt = saltHex
    ? Uint8Array.from(saltHex.match(/.{2}/g).map((b) => parseInt(b, 16)))
    : crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    keyMaterial, 256,
  );

  const toHex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return { hash: toHex(bits), salt: toHex(salt) };
}

/* ---------------------------------------------------------------------
   Preferências padrão (§21: valores sensatos, sem questionário)
   --------------------------------------------------------------------- */
export const DEFAULT_PREFS = {
  theme: 'nestra-noturno',
  accent: '#2F6BFF',
  density: 'comfortable',
  motion: 'full',
  highContrast: false,
  glowIntensity: 70,
  cornerStyle: 'square',
  weekStart: 0,
  dateFormat: 'dd/MM/yyyy',
  timeFormat: '24h',
  startView: 'today',
  defaultEnvironmentId: null,
  showUndatedOnToday: false,
  showHighPriorityOutsideToday: true,
  confirmBeforeDelete: true,
  afterComplete: 'fade',
  nlParsingEnabled: true,
  soundEnabled: false,
  notificationsEnabled: false,
  notifyDueItems: true,
  notifyCommitments: true,
  notifyOverdue: true,
  notifyLeadMinutes: 30,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
  locale: 'pt-BR',
};

/* Ambientes sugeridos — apenas exemplos editáveis (§7.3, §29) */
export const SUGGESTED_ENVIRONMENTS = [
  { name: 'Trabalho', color: '#2F6BFF', icon: 'briefcase', description: 'Demandas, respostas e prazos.' },
  { name: 'Estudos',  color: '#4FD8FF', icon: 'book',      description: 'Provas, leituras e entregas.' },
  { name: 'Pessoal',  color: '#9B7BFF', icon: 'heart',     description: 'O que é só seu.' },
];

const slugify = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 40) || 'ambiente';

/* ===================================================================== */

class Store extends EventTarget {
  constructor() {
    super();
    this.state = {
      user: null,
      prefs: { ...DEFAULT_PREFS },
      environments: [],
      items: [],
      tags: [],
      events: [],
      syncState: 'local',
      mode: 'local',
    };
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    if (type !== 'change') this.dispatchEvent(new CustomEvent('change', { detail: { type, detail } }));
  }

  /* ---------------- persistência ---------------- */

  persist() {
    if (!this.state.user) return;
    write(K.data(this.state.user.id), {
      prefs: this.state.prefs,
      environments: this.state.environments,
      items: this.state.items,
      tags: this.state.tags,
      events: this.state.events.slice(-400),
    });
  }

  load(userId) {
    const data = read(K.data(userId), null);
    if (data) {
      this.state.prefs = { ...DEFAULT_PREFS, ...data.prefs };
      this.state.environments = data.environments || [];
      this.state.items = data.items || [];
      this.state.tags = data.tags || [];
      this.state.events = data.events || [];
    } else {
      this.state.prefs = { ...DEFAULT_PREFS };
      this.state.environments = [];
      this.state.items = [];
      this.state.tags = [];
      this.state.events = [];
    }
  }

  /* ---------------- sessão ---------------- */

  async restoreSession() {
    await api.probe();
    this.state.mode = api.online ? 'remote' : 'local';

    if (api.online) {
      try {
        const me = await api.get('/auth/me');
        if (me && me.user) {
          this.state.user = me.user;
          this.state.prefs = { ...DEFAULT_PREFS, ...(me.preferences || {}) };
          this.state.environments = me.environments || [];
          this.state.items = me.items || [];
          this.setSync('synced');
          this.emit('auth', this.state.user);
          return true;
        }
      } catch {
        /* sem sessão remota — segue para a sessão local */
      }
    }

    const session = read(K.session, null);
    if (!session || session.expiresAt < Date.now()) {
      localStorage.removeItem(K.session);
      return false;
    }

    const accounts = read(K.accounts, []);
    const account = accounts.find((a) => a.id === session.userId);
    if (!account) return false;

    this.state.user = { id: account.id, email: account.email, displayName: account.displayName };
    this.load(account.id);
    this.setSync(api.online ? 'syncing' : 'local');
    this.emit('auth', this.state.user);
    return true;
  }

  async register({ displayName, email, password }) {
    email = String(email).trim().toLowerCase();

    if (api.online) {
      const res = await api.post('/auth/register', { displayName, email, password });
      this.state.user = res.user;
      this.state.prefs = { ...DEFAULT_PREFS, ...(res.preferences || {}) };
      this.state.environments = res.environments || [];
      this.state.items = [];
      this.setSync('synced');
      this.emit('auth', this.state.user);
      return this.state.user;
    }

    const accounts = read(K.accounts, []);
    // §18: mensagem neutra, sem revelar se o e-mail já existe
    if (accounts.some((a) => a.email === email)) {
      throw new Error('Não foi possível criar a conta com esses dados. Tente recuperar o acesso.');
    }

    const { hash, salt } = await hashPassword(password);
    const account = {
      id: uid(),
      email,
      displayName: String(displayName).trim(),
      hash,
      salt,
      createdAt: new Date().toISOString(),
    };
    accounts.push(account);
    write(K.accounts, accounts);

    this.state.user = { id: account.id, email, displayName: account.displayName };
    this.state.prefs = { ...DEFAULT_PREFS };
    this.state.environments = [];
    this.state.items = [];
    this.state.events = [];
    this.openSession(account.id);
    this.emit('auth', this.state.user);
    return this.state.user;
  }

  async login({ email, password }) {
    email = String(email).trim().toLowerCase();

    if (api.online) {
      const res = await api.post('/auth/login', { email, password });
      this.state.user = res.user;
      this.state.prefs = { ...DEFAULT_PREFS, ...(res.preferences || {}) };
      this.state.environments = res.environments || [];
      this.state.items = res.items || [];
      this.setSync('synced');
      this.emit('auth', this.state.user);
      return this.state.user;
    }

    const accounts = read(K.accounts, []);
    const account = accounts.find((a) => a.email === email);
    // Mesma mensagem para e-mail inexistente e senha errada (§20)
    const generic = 'E-mail ou senha incorretos.';
    if (!account) throw new Error(generic);

    const { hash } = await hashPassword(password, account.salt);
    if (hash !== account.hash) throw new Error(generic);

    this.state.user = { id: account.id, email: account.email, displayName: account.displayName };
    this.load(account.id);
    this.openSession(account.id);
    this.emit('auth', this.state.user);
    return this.state.user;
  }

  openSession(userId) {
    write(K.session, { userId, expiresAt: Date.now() + 30 * 864e5 });
  }

  async logout() {
    if (api.online) {
      try { await api.post('/auth/logout', {}); } catch { /* segue mesmo assim */ }
    }
    localStorage.removeItem(K.session);
    this.state.user = null;
    this.state.items = [];
    this.state.environments = [];
    this.emit('auth', null);
  }

  /* ---------------- ambientes ---------------- */

  createEnvironment({ name, color, icon, description, isDefault }) {
    const env = {
      id: uid(),
      name: String(name).trim(),
      slug: slugify(name),
      color: color || '#2F6BFF',
      icon: icon || 'layers',
      description: description || null,
      position: this.state.environments.length,
      isDefault: Boolean(isDefault),
      archivedAt: null,
      createdAt: new Date().toISOString(),
    };

    if (env.isDefault) this.state.environments.forEach((e) => (e.isDefault = false));
    this.state.environments.push(env);
    this.persist();
    this.queue('POST', '/environments', env);
    this.emit('environments');
    return env;
  }

  updateEnvironment(id, patch) {
    const env = this.state.environments.find((e) => e.id === id);
    if (!env) return null;
    if (patch.name) patch.slug = slugify(patch.name);
    if (patch.isDefault) this.state.environments.forEach((e) => (e.isDefault = false));
    Object.assign(env, patch, { updatedAt: new Date().toISOString() });
    this.persist();
    this.queue('PUT', `/environments/${id}`, patch);
    this.emit('environments');
    return env;
  }

  archiveEnvironment(id) {
    const env = this.state.environments.find((e) => e.id === id);
    if (!env) return;
    env.archivedAt = new Date().toISOString();
    // os itens não somem junto: voltam para a caixa de entrada
    this.state.items.forEach((i) => {
      if (i.environmentId === id) i.environmentId = null;
    });
    this.persist();
    this.queue('PUT', `/environments/${id}`, { archivedAt: env.archivedAt });
    this.emit('environments');
  }

  seedEnvironments() {
    if (this.state.environments.length) return;
    SUGGESTED_ENVIRONMENTS.forEach((e, i) =>
      this.createEnvironment({ ...e, isDefault: i === 0 }));
  }

  /* ---------------- itens ---------------- */

  createItem(data) {
    const now = new Date().toISOString();
    const item = {
      id: uid(),
      environmentId: data.environmentId ?? this.state.prefs.defaultEnvironmentId ?? null,
      type: data.type || 'task',
      title: String(data.title || '').trim().slice(0, 280),
      description: data.description || null,
      status: 'pending',
      priority: data.priority || 'normal',
      dueDate: data.dueDate || null,
      dueTime: data.dueTime || null,
      timePeriod: data.timePeriod || 'any',
      pinned: false,
      source: data.source || 'manual',
      rawInput: data.rawInput || null,
      parseConfidence: data.parseConfidence ?? null,
      needsReview: Boolean(data.needsReview),
      checklist: [],
      tags: data.tags || [],
      snoozedUntil: null,
      completedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    if (!item.title) return null;

    this.state.items.unshift(item);
    this.logEvent(item.id, 'created');
    this.persist();
    this.queue('POST', '/items', item);
    this.emit('items', { action: 'create', item });
    return item;
  }

  updateItem(id, patch) {
    const item = this.state.items.find((i) => i.id === id);
    if (!item) return null;

    const before = { status: item.status, dueDate: item.dueDate, environmentId: item.environmentId };
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });

    if (patch.status === 'done' && before.status !== 'done') {
      item.completedAt = new Date().toISOString();
      this.logEvent(id, 'completed');
    } else if (patch.status && patch.status !== 'done' && before.status === 'done') {
      item.completedAt = null;
      this.logEvent(id, 'reopened');
    } else if (patch.dueDate !== undefined && patch.dueDate !== before.dueDate) {
      this.logEvent(id, 'rescheduled', { dueDate: patch.dueDate });
    } else if (patch.environmentId !== undefined && patch.environmentId !== before.environmentId) {
      this.logEvent(id, 'moved');
    } else {
      this.logEvent(id, 'updated');
    }

    this.persist();
    this.queue('PUT', `/items/${id}`, patch);
    this.emit('items', { action: 'update', item });
    return item;
  }

  toggleItem(id) {
    const item = this.state.items.find((i) => i.id === id);
    if (!item) return null;
    return this.updateItem(id, { status: item.status === 'done' ? 'pending' : 'done' });
  }

  /** Adia por N dias a partir de hoje, ou para uma data específica. */
  snoozeItem(id, days = 1, isoDate = null) {
    const tz = this.state.prefs.timezone;
    let target = isoDate;
    if (!target) {
      const base = todayIn(tz);
      base.setUTCDate(base.getUTCDate() + days);
      target = toISODate(base);
    }
    return this.updateItem(id, { dueDate: target, status: 'pending' });
  }

  /** Exclusão passa pela lixeira antes de ser definitiva (§24). */
  trashItem(id) {
    const item = this.state.items.find((i) => i.id === id);
    if (!item) return null;
    const now = new Date();
    item.deletedAt = now.toISOString();
    item.purgeAfter = new Date(now.getTime() + 30 * 864e5).toISOString();
    item.updatedAt = now.toISOString();
    this.logEvent(id, 'trashed');
    this.persist();
    this.queue('DELETE', `/items/${id}`);
    this.emit('items', { action: 'trash', item });
    return item;
  }

  restoreItem(id) {
    const item = this.state.items.find((i) => i.id === id);
    if (!item) return null;
    item.deletedAt = null;
    item.purgeAfter = null;
    item.updatedAt = new Date().toISOString();
    this.logEvent(id, 'restored');
    this.persist();
    this.queue('PUT', `/items/${id}`, { deletedAt: null });
    this.emit('items', { action: 'restore', item });
    return item;
  }

  purgeItem(id) {
    this.state.items = this.state.items.filter((i) => i.id !== id);
    this.persist();
    this.queue('DELETE', `/items/${id}?purge=1`);
    this.emit('items', { action: 'purge' });
  }

  emptyTrash() {
    this.state.items = this.state.items.filter((i) => !i.deletedAt);
    this.persist();
    this.emit('items', { action: 'purge' });
  }

  /* ---------------- checklists (§7.4) ---------------- */

  addChecklistItem(itemId, title) {
    const item = this.state.items.find((i) => i.id === itemId);
    if (!item || !String(title).trim()) return null;
    const entry = {
      id: uid(),
      title: String(title).trim().slice(0, 200),
      completed: false,
      position: item.checklist.length,
    };
    item.checklist.push(entry);
    item.updatedAt = new Date().toISOString();
    this.persist();
    this.queue('POST', '/checklist', { op: 'create', itemId, entry });
    this.emit('items', { action: 'checklist', item });
    return entry;
  }

  updateChecklistItem(itemId, entryId, patch) {
    const item = this.state.items.find((i) => i.id === itemId);
    if (!item) return;
    const entry = item.checklist.find((c) => c.id === entryId);
    if (!entry) return;
    Object.assign(entry, patch);
    if (patch.completed !== undefined) {
      entry.completedAt = patch.completed ? new Date().toISOString() : null;
    }
    item.updatedAt = new Date().toISOString();
    this.persist();
    this.queue('POST', '/checklist', { op: 'update', itemId, entryId, patch });
    this.emit('items', { action: 'checklist', item });
  }

  removeChecklistItem(itemId, entryId) {
    const item = this.state.items.find((i) => i.id === itemId);
    if (!item) return;
    item.checklist = item.checklist.filter((c) => c.id !== entryId);
    this.persist();
    this.queue('POST', '/checklist', { op: 'delete', itemId, entryId });
    this.emit('items', { action: 'checklist', item });
  }

  /* ---------------- preferências ---------------- */

  setPrefs(patch) {
    Object.assign(this.state.prefs, patch);
    this.persist();
    this.queue('PUT', '/preferences', patch);
    this.emit('prefs', this.state.prefs);
  }

  /* ---------------- histórico ---------------- */

  logEvent(itemId, action, metadata = {}) {
    this.state.events.push({
      id: uid(),
      itemId,
      action,
      metadata,
      createdAt: new Date().toISOString(),
    });
    if (this.state.events.length > 500) this.state.events = this.state.events.slice(-400);
  }

  eventsFor(itemId) {
    return this.state.events
      .filter((e) => e.itemId === itemId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /* ---------------- sincronização ---------------- */

  queue(method, path, body) {
    if (this.state.mode !== 'remote') return;
    syncQueue.push({ method, path, body });
    this.setSync('syncing');
    clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this.flush(), 900);
  }

  async flush() {
    if (this.state.mode !== 'remote') return;
    if (!navigator.onLine) { this.setSync('offline'); return; }
    try {
      await syncQueue.flush();
      this.setSync(syncQueue.size() ? 'syncing' : 'synced');
    } catch {
      this.setSync('error');
    }
  }

  setSync(state) {
    this.state.syncState = state;
    this.emit('sync', state);
  }

  /* ---------------- seletores ---------------- */

  get live() {
    return this.state.items.filter((i) => !i.deletedAt && i.status !== 'archived');
  }

  get trash() {
    return this.state.items.filter((i) => i.deletedAt);
  }

  environmentById(id) {
    return this.state.environments.find((e) => e.id === id) || null;
  }

  get activeEnvironments() {
    return this.state.environments
      .filter((e) => !e.archivedAt)
      .sort((a, b) => a.position - b.position);
  }

  isOverdue(item) {
    if (item.status !== 'pending' || !item.dueDate) return false;
    return item.dueDate < toISODate(todayIn(this.state.prefs.timezone));
  }

  /**
   * A composição da tela "Hoje" (§7.2), na ordem recomendada:
   * atrasados, para hoje, alta prioridade e capturas recentes.
   */
  todayBuckets() {
    const tz = this.state.prefs.timezone;
    const today = toISODate(todayIn(tz));
    const items = this.live.filter((i) => i.status !== 'archived');

    const overdue = items.filter((i) => i.status === 'pending' && i.dueDate && i.dueDate < today);
    const dueToday = items.filter((i) => i.dueDate === today);

    const inAbove = new Set([...overdue, ...dueToday].map((i) => i.id));

    const highPriority = this.state.prefs.showHighPriorityOutsideToday
      ? items.filter((i) =>
          i.status === 'pending' &&
          !inAbove.has(i.id) &&
          (i.priority === 'high' || i.priority === 'urgent'))
      : [];

    highPriority.forEach((i) => inAbove.add(i.id));

    const cutoff = Date.now() - 24 * 3600 * 1000;
    const recent = items.filter((i) =>
      !inAbove.has(i.id) && new Date(i.createdAt).getTime() > cutoff);

    recent.forEach((i) => inAbove.add(i.id));

    const undated = this.state.prefs.showUndatedOnToday
      ? items.filter((i) => i.status === 'pending' && !i.dueDate && !inAbove.has(i.id))
      : [];

    const byPeriod = { morning: [], afternoon: [], evening: [], night: [], any: [] };
    dueToday.forEach((i) => byPeriod[i.timePeriod || 'any'].push(i));

    const sortRule = (a, b) => {
      if (a.status !== b.status) return a.status === 'done' ? 1 : -1;
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const w = { urgent: 0, high: 1, normal: 2, low: 3 };
      if (w[a.priority] !== w[b.priority]) return w[a.priority] - w[b.priority];
      if (a.dueTime && b.dueTime) return a.dueTime.localeCompare(b.dueTime);
      if (a.dueTime) return -1;
      if (b.dueTime) return 1;
      return b.createdAt.localeCompare(a.createdAt);
    };

    [overdue, highPriority, recent, undated].forEach((l) => l.sort(sortRule));
    Object.values(byPeriod).forEach((l) => l.sort(sortRule));

    return { overdue, dueToday, byPeriod, highPriority, recent, undated, today };
  }

  environmentStats(envId) {
    const tz = this.state.prefs.timezone;
    const today = toISODate(todayIn(tz));
    const items = this.live.filter((i) => i.environmentId === envId);
    return {
      total: items.length,
      pending: items.filter((i) => i.status === 'pending').length,
      overdue: items.filter((i) => i.status === 'pending' && i.dueDate && i.dueDate < today).length,
      today: items.filter((i) => i.dueDate === today && i.status === 'pending').length,
      undated: items.filter((i) => i.status === 'pending' && !i.dueDate).length,
      done: items.filter((i) => i.status === 'done').length,
    };
  }

  search(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.live
      .filter((i) =>
        i.title.toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q))
      .slice(0, 24);
  }

  /* ---------------- exportação (§18) ---------------- */

  exportJSON() {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      format: 'nestra/v1',
      user: this.state.user ? { email: this.state.user.email, displayName: this.state.user.displayName } : null,
      preferences: this.state.prefs,
      environments: this.state.environments,
      items: this.state.items,
    }, null, 2);
  }

  exportCSV() {
    const cols = ['id', 'tipo', 'titulo', 'descricao', 'status', 'prioridade',
      'vencimento', 'horario', 'periodo', 'ambiente', 'criado_em', 'concluido_em'];

    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };

    const rows = this.live.map((i) => [
      i.id, i.type, i.title, i.description, i.status, i.priority,
      i.dueDate, i.dueTime, i.timePeriod,
      this.environmentById(i.environmentId)?.name || '',
      i.createdAt, i.completedAt,
    ].map(esc).join(','));

    return [cols.join(','), ...rows].join('\n');
  }

  /** §18: exclusão da conta com remoção efetiva dos dados locais. */
  deleteAccount() {
    const id = this.state.user?.id;
    if (!id) return;
    localStorage.removeItem(K.data(id));
    localStorage.removeItem(K.session);
    const accounts = read(K.accounts, []).filter((a) => a.id !== id);
    write(K.accounts, accounts);
    this.state.user = null;
    this.state.items = [];
    this.state.environments = [];
    this.emit('auth', null);
  }
}

export const store = new Store();
