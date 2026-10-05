import { api, syncQueue } from './api.js';
import { todayIn, toISODate } from './nlp.js';

const K = {
  accounts: 'nestra:accounts',
  session: 'nestra:session',
  data: (userId) => `nestra:data:${userId}`,
  lastEnv: 'nestra:last-env',
  remoteUser: 'nestra:remote-user',
};

const PULL_EVERY = 15000;

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

export const SUGGESTED_ENVIRONMENTS = [
  { name: 'Trabalho', color: '#2F6BFF', icon: 'briefcase', description: 'Demandas, respostas e prazos.' },
  { name: 'Estudos',  color: '#4FD8FF', icon: 'book',      description: 'Provas, leituras e entregas.' },
  { name: 'Pessoal',  color: '#9B7BFF', icon: 'heart',     description: 'O que é só seu.' },
];

const slugify = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '').slice(0, 40) || 'ambiente';

export const weekdayOf = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();

export function shiftDay(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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
      meetings: [],
      agendas: [],
      syncState: 'local',
      mode: 'local',
    };
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    if (type !== 'change') this.dispatchEvent(new CustomEvent('change', { detail: { type, detail } }));
  }

  persist() {
    if (!this.state.user) return;
    write(K.data(this.state.user.id), {
      prefs: this.state.prefs,
      environments: this.state.environments,
      items: this.state.items,
      tags: this.state.tags,
      events: this.state.events.slice(-400),
      meetings: this.state.meetings,
      agendas: this.state.agendas,
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
      this.state.meetings = data.meetings || [];
      this.state.agendas = data.agendas || [];
    } else {
      this.state.prefs = { ...DEFAULT_PREFS };
      this.state.environments = [];
      this.state.items = [];
      this.state.tags = [];
      this.state.events = [];
      this.state.meetings = [];
      this.state.agendas = [];
    }
  }

  async restoreSession() {
    await api.probe();
    this.state.mode = api.online ? 'remote' : 'local';

    if (api.online) {
      try {
        const me = await api.get('/auth/me');
        if (me && me.user) {
          this.adoptRemote(me);
          this.flush();
          return true;
        }
      } catch (err) {
        if (!err.status && this.restoreCachedRemote()) return true;
      }
    }

    if (!api.online && this.restoreCachedRemote()) return true;

    const session = read(K.session, null);
    if (!session || session.expiresAt < Date.now()) {
      localStorage.removeItem(K.session);
      return false;
    }

    const accounts = read(K.accounts, []);
    const account = accounts.find((a) => a.id === session.userId);
    if (!account) return false;

    this.state.mode = 'local';
    this.state.user = { id: account.id, email: account.email, displayName: account.displayName };
    this.load(account.id);
    this.setSync('local');
    this.emit('auth', this.state.user);
    return true;
  }

  adoptRemote(payload) {
    this.state.mode = 'remote';
    this.state.user = payload.user;
    syncQueue.setOwner(payload.user?.id);
    this.state.prefs = {
      ...DEFAULT_PREFS,
      ...(payload.preferences || {}),
      timezone: payload.user?.timezone || payload.preferences?.timezone || DEFAULT_PREFS.timezone,
    };
    this.state.environments = payload.environments || [];
    this.state.items = payload.items || [];
    this.state.meetings = payload.meetings || [];
    this.state.agendas = this.mergeAgendas(payload.agendas || []);

    write(K.remoteUser, payload.user);
    this.persist();

    this.setSync(syncQueue.failedSize() ? 'error' : 'synced');
    this.emit('auth', this.state.user);
    return this.state.user;
  }

  restoreCachedRemote() {
    const cached = read(K.remoteUser, null);
    if (!cached || !cached.id) return false;

    this.state.mode = 'remote';
    this.state.user = cached;
    syncQueue.setOwner(cached.id);
    this.load(cached.id);
    this.setSync(navigator.onLine ? 'error' : 'offline');
    this.emit('auth', this.state.user);
    return true;
  }

  async pull({ reason = 'auto' } = {}) {
    if (this.state.mode !== 'remote' || !this.state.user) return false;
    if (this._pulling) return this._pulling;
    if (!navigator.onLine) { this.setSync('offline'); return false; }

    this._pulling = (async () => {
      try {
        if (!api.online && !(await api.probe())) {
          this.setSync(navigator.onLine ? 'error' : 'offline');
          return false;
        }
        if (syncQueue.size()) {
          await this.flush();
          if (syncQueue.size()) return false;
        }

        const me = await api.get('/auth/me');
        if (!me || !me.user) return false;

        const before = this.signature();

        this.state.user = me.user;
        this.state.prefs = {
          ...DEFAULT_PREFS,
          ...(me.preferences || {}),
          timezone: me.user?.timezone || me.preferences?.timezone || DEFAULT_PREFS.timezone,
        };
        this.state.environments = me.environments || [];
        this.state.items = me.items || [];
        this.state.meetings = me.meetings || [];
        this.state.agendas = this.mergeAgendas(me.agendas || []);

        write(K.remoteUser, me.user);
        this.persist();
        this.setSync(syncQueue.failedSize() ? 'error' : 'synced');

        const changed = before !== this.signature();
        if (changed) this.emit('pulled', { reason });
        return changed;
      } catch (err) {
        if (err.status === 401) {
          this.state.user = null;
          this.state.items = [];
          this.state.environments = [];
          this.state.meetings = [];
          this.state.agendas = [];
          localStorage.removeItem(K.remoteUser);
          this.emit('auth', null);
        } else {
          this.setSync(navigator.onLine ? 'error' : 'offline');
        }
        return false;
      } finally {
        this._pulling = null;
      }
    })();

    return this._pulling;
  }

  signature() {
    return JSON.stringify({
      user: this.state.user && {
        id: this.state.user.id,
        displayName: this.state.user.displayName,
        timezone: this.state.user.timezone,
      },
      prefs: this.state.prefs,
      environments: this.state.environments.map((e) => ({
        id: e.id, updatedAt: e.updatedAt, archivedAt: e.archivedAt,
        name: e.name, color: e.color, icon: e.icon, position: e.position,
      })),
      items: this.state.items.map((i) => ({
        id: i.id, updatedAt: i.updatedAt, status: i.status, title: i.title,
        description: i.description, priority: i.priority, type: i.type,
        environmentId: i.environmentId, dueDate: i.dueDate, dueTime: i.dueTime,
        timePeriod: i.timePeriod, checklist: i.checklist,
      })),
      meetings: this.state.meetings.map((m) => ({
        id: m.id, title: m.title, template: m.template, color: m.color, weekdays: m.weekdays,
        startTime: m.startTime, durationMinutes: m.durationMinutes,
        environmentId: m.environmentId, archivedAt: m.archivedAt,
      })),
      agendas: this.state.agendas.map((a) => ({
        id: a.id, meetingId: a.meetingId, occursOn: a.occursOn, nodes: a.nodes,
        notes: a.notes, summary: a.summary, startedAt: a.startedAt, endedAt: a.endedAt,
      })),
    });
  }

  startAutoSync() {
    if (this._autoSync) return;
    this._autoSync = true;

    const refresh = (reason) => {
      if (this.state.mode !== 'remote' || !this.state.user) return;
      if (document.hidden) return;
      this.pull({ reason });
    };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      refresh('foreground');
    });

    window.addEventListener('focus', () => refresh('focus'));
    window.addEventListener('online', () => refresh('online'));
    window.addEventListener('pageshow', (ev) => { if (ev.persisted) refresh('restore'); });

    setInterval(() => refresh('interval'), PULL_EVERY);

    navigator.serviceWorker?.addEventListener?.('message', (ev) => {
      if (ev.data?.type === 'flush-queue') this.flush();
    });
  }

  async register({ displayName, email, password }) {
    email = String(email).trim().toLowerCase();

    if (api.online) {
      const res = await api.post('/auth/register', {
        displayName, email, password,
        timezone: DEFAULT_PREFS.timezone,
        locale: DEFAULT_PREFS.locale,
      });
      return this.adoptRemote({ ...res, items: res.items || [] });
    }

    const accounts = read(K.accounts, []);
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
    this.state.meetings = [];
    this.state.agendas = [];
    this.openSession(account.id);
    this.emit('auth', this.state.user);
    return this.state.user;
  }

  async login({ email, password }) {
    email = String(email).trim().toLowerCase();

    if (api.online) {
      const res = await api.post('/auth/login', { email, password });
      return this.adoptRemote(res);
    }

    const accounts = read(K.accounts, []);
    const account = accounts.find((a) => a.email === email);
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
      try { await this.flush(); } catch {  }
      try { await api.post('/auth/logout', {}); } catch {  }
    }
    localStorage.removeItem(K.session);
    localStorage.removeItem(K.remoteUser);
    this.state.user = null;
    this.state.items = [];
    this.state.environments = [];
    this.state.meetings = [];
    this.state.agendas = [];
    this.emit('auth', null);
  }

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
    env.isDefault = false;

    const wasDefault = this.state.prefs.defaultEnvironmentId === id;
    if (wasDefault) this.state.prefs.defaultEnvironmentId = null;

    this.state.items.forEach((i) => {
      if (i.environmentId === id) i.environmentId = null;
    });
    this.persist();
    this.queue('PUT', `/environments/${id}`, { archivedAt: env.archivedAt, isDefault: false });
    if (wasDefault) this.queue('PUT', '/preferences', { defaultEnvironmentId: null });
    this.emit('environments');
    if (wasDefault) this.emit('prefs', this.state.prefs);
  }

  seedEnvironments() {
    if (this.state.environments.length) return;
    SUGGESTED_ENVIRONMENTS.forEach((e) =>
      this.createEnvironment({ ...e, isDefault: false }));
  }

  createItem(data) {
    const now = new Date().toISOString();
    const requestedEnvironmentId = data.environmentId ?? this.state.prefs.defaultEnvironmentId ?? null;
    const targetEnvironment = requestedEnvironmentId
      ? this.state.environments.find((env) => env.id === requestedEnvironmentId && !env.archivedAt)
      : null;
    const item = {
      id: uid(),
      environmentId: targetEnvironment?.id || null,
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
    const removed = this.state.items.filter((i) => i.deletedAt).map((i) => i.id);
    this.state.items = this.state.items.filter((i) => !i.deletedAt);
    this.persist();
    removed.forEach((id) => this.queue('DELETE', `/items/${id}?purge=1`));
    this.emit('items', { action: 'purge' });
  }

  addChecklistItem(itemId, title, options = {}) {
    const item = this.state.items.find((i) => i.id === itemId);
    if (!item || !String(title).trim()) return null;
    const entry = {
      id: options.id || uid(),
      title: String(title).trim().slice(0, 200),
      completed: Boolean(options.completed),
      position: Number.isInteger(options.position) ? options.position : item.checklist.length,
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

  get activeMeetings() {
    return this.state.meetings
      .filter((m) => !m.archivedAt)
      .sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99') ||
        a.title.localeCompare(b.title));
  }

  meetingById(id) {
    return this.state.meetings.find((m) => m.id === id) || null;
  }

  saveMeeting(data) {
    const now = new Date().toISOString();
    const existing = data.id ? this.meetingById(data.id) : null;
    const meeting = existing || { id: uid(), createdAt: now, archivedAt: null };
    Object.assign(meeting, {
      title: String(data.title ?? meeting.title ?? '').trim().slice(0, 80),
      template: data.template ?? meeting.template ?? 'free',
      color: data.color ?? meeting.color ?? '#2F6BFF',
      weekdays: [...new Set((data.weekdays ?? meeting.weekdays ?? [1, 2, 3, 4, 5]).map(Number))].sort(),
      startTime: data.startTime === undefined ? (meeting.startTime ?? null) : (data.startTime || null),
      durationMinutes: Number(data.durationMinutes ?? meeting.durationMinutes ?? 15),
      environmentId: data.environmentId === undefined ? (meeting.environmentId ?? null) : (data.environmentId || null),
      archivedAt: data.archivedAt === undefined ? meeting.archivedAt : data.archivedAt,
      updatedAt: now,
    });
    if (!meeting.title) return null;
    if (!existing) this.state.meetings.push(meeting);
    this.persist();
    this.queue('POST', '/meetings', { op: 'saveMeeting', meeting }, 'meeting:' + meeting.id);
    this.emit('meetings', { action: existing ? 'update' : 'create', meeting });
    return meeting;
  }

  archiveMeeting(id) {
    return this.saveMeeting({ id, archivedAt: new Date().toISOString() });
  }

  meetingsOn(iso) {
    const weekday = weekdayOf(iso);
    return this.activeMeetings.filter((m) => m.weekdays.includes(weekday));
  }

  nextOccurrence(meeting, fromIso) {
    if (!meeting?.weekdays?.length) return fromIso;
    let iso = fromIso;
    for (let i = 0; i < 8; i++) {
      if (meeting.weekdays.includes(weekdayOf(iso))) return iso;
      iso = shiftDay(iso, 1);
    }
    return fromIso;
  }

  previousOccurrence(meeting, beforeIso) {
    if (!meeting?.weekdays?.length) return shiftDay(beforeIso, -1);
    let iso = shiftDay(beforeIso, -1);
    for (let i = 0; i < 8; i++) {
      if (meeting.weekdays.includes(weekdayOf(iso))) return iso;
      iso = shiftDay(iso, -1);
    }
    return shiftDay(beforeIso, -1);
  }

  agendaFor(meetingId, iso) {
    return this.state.agendas.find((a) => a.meetingId === meetingId && a.occursOn === iso) || null;
  }

  lastAgendaBefore(meetingId, iso) {
    return this.state.agendas
      .filter((a) => a.meetingId === meetingId && a.occursOn < iso && a.nodes.some((n) => n.kind !== 'root'))
      .sort((a, b) => b.occursOn.localeCompare(a.occursOn))[0] || null;
  }

  agendasOf(meetingId) {
    return this.state.agendas
      .filter((a) => a.meetingId === meetingId)
      .sort((a, b) => b.occursOn.localeCompare(a.occursOn));
  }

  openAgenda(meetingId, iso) {
    const found = this.agendaFor(meetingId, iso);
    if (found) return found;
    const meeting = this.meetingById(meetingId);
    return {
      id: uid(),
      meetingId,
      occursOn: iso,
      nodes: [{ id: uid(), parentId: null, kind: 'root', text: meeting?.title || 'Reunião', done: false, order: 0 }],
      notes: null,
      summary: null,
      startedAt: null,
      endedAt: null,
      draft: true,
    };
  }

  saveAgenda(agenda) {
    const now = new Date().toISOString();
    delete agenda.draft;
    agenda.updatedAt = now;
    if (!this.state.agendas.includes(agenda)) {
      const index = this.state.agendas.findIndex((a) => a.meetingId === agenda.meetingId && a.occursOn === agenda.occursOn);
      if (index >= 0) this.state.agendas[index] = agenda;
      else this.state.agendas.push(agenda);
    }
    this.persist();
    const { draft, ...body } = agenda;
    this.queue('POST', '/meetings', { op: 'saveAgenda', agenda: body }, 'agenda:' + agenda.id);
    this.emit('meetings', { action: 'agenda', agenda });
    return agenda;
  }

  deleteAgenda(id) {
    this.state.agendas = this.state.agendas.filter((a) => a.id !== id);
    this.persist();
    this.queue('POST', '/meetings', { op: 'deleteAgenda', id }, 'agenda:' + id);
    this.emit('meetings', { action: 'agenda-delete' });
  }

  mergeAgendas(remote) {
    const pending = new Set(syncQueue.read()
      .filter((op) => op.body?.op === 'saveAgenda')
      .map((op) => op.body.agenda.id));
    const local = this.state.agendas.filter((a) => pending.has(a.id));
    const keep = remote.filter((r) => !local.some((l) => l.meetingId === r.meetingId && l.occursOn === r.occursOn));
    return [...keep, ...local];
  }

  setPrefs(patch) {
    Object.assign(this.state.prefs, patch);
    if ('timezone' in patch && this.state.user) this.state.user.timezone = patch.timezone;
    this.persist();
    const preferencePatch = { ...patch };
    delete preferencePatch.timezone;
    if (Object.keys(preferencePatch).length) this.queue('PUT', '/preferences', preferencePatch);
    if ('timezone' in patch) this.queue('PUT', '/account', { timezone: patch.timezone });
    this.emit('prefs', this.state.prefs);
  }

  updateProfile({ displayName }) {
    const name = String(displayName || '').trim();
    if (!this.state.user || name.length < 2 || name.length > 80) return null;
    this.state.user.displayName = name;
    this.persist();
    this.queue('PUT', '/account', { displayName: name });
    this.emit('auth', this.state.user);
    return this.state.user;
  }

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

  queue(method, path, body, coalesce = null) {
    if (this.state.mode !== 'remote') return;
    syncQueue.setOwner(this.state.user?.id);
    syncQueue.push({ method, path, body, coalesce });
    this.setSync('syncing');
    clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this.flush(), 900);
  }

  async flush() {
    if (this.state.mode !== 'remote') return;
    if (!navigator.onLine) { this.setSync('offline'); return; }
    try {
      if (!api.online && !(await api.probe())) {
        this.setSync('error');
        return;
      }
      await syncQueue.flush();
      this.setSync(syncQueue.failedSize() ? 'error' : syncQueue.size() ? 'syncing' : 'synced');
    } catch {
      this.setSync('error');
    }
  }

  setSync(state) {
    this.state.syncState = state;
    this.emit('sync', state);
  }

  get live() {
    return this.state.items.filter((i) => !i.deletedAt && i.status !== 'archived');
  }

  get trash() {
    return this.state.items.filter((i) => i.deletedAt);
  }

  environmentById(id) {
    return this.state.environments.find((e) => e.id === id) || null;
  }

  rememberEnvironment(id) {
    if (this.environmentById(id) && !this.environmentById(id).archivedAt) {
      localStorage.setItem(K.lastEnv, id);
    }
  }

  lastEnvironmentId() {
    const id = localStorage.getItem(K.lastEnv);
    return id && this.environmentById(id) && !this.environmentById(id).archivedAt ? id : null;
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

  importData(raw) {
    let data;
    try {
      data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      throw new Error('Não consegui ler o arquivo. Ele precisa ser o JSON exportado pelo Nestra.');
    }

    if (!data || typeof data !== 'object') {
      throw new Error('Arquivo não reconhecido.');
    }

    const envsIn = Array.isArray(data.environments) ? data.environments : [];
    const itemsIn = Array.isArray(data.items) ? data.items : [];

    if (!envsIn.length && !itemsIn.length) {
      throw new Error('O arquivo não tem ambientes nem itens para importar.');
    }

    const envsAqui = new Set(this.state.environments.map((e) => e.id));
    const itensAqui = new Set(this.state.items.map((i) => i.id));
    const agora = new Date().toISOString();

    const porNome = new Map(
      this.state.environments.map((e) => [String(e.name).trim().toLowerCase(), e.id]),
    );
    const religar = new Map();

    let ambientes = 0;
    let itens = 0;

    envsIn.forEach((e, i) => {
      if (!e || !e.id || envsAqui.has(e.id)) return;

      const chave = String(e.name || '').trim().toLowerCase();
      const jaExiste = porNome.get(chave);
      if (jaExiste) {
        religar.set(e.id, jaExiste);
        return;
      }

      const env = {
        id: e.id,
        name: String(e.name || 'Ambiente').slice(0, 60),
        slug: e.slug || slugify(e.name || 'ambiente'),
        color: /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : '#2F6BFF',
        icon: String(e.icon || 'layers').slice(0, 30),
        description: e.description || null,
        position: Number.isInteger(e.position) ? e.position : this.state.environments.length + i,
        isDefault: false,
        archivedAt: e.archivedAt || null,
        createdAt: e.createdAt || agora,
      };

      this.state.environments.push(env);
      envsAqui.add(env.id);
      porNome.set(chave, env.id);
      this.queue('POST', '/environments', env);
      ambientes++;
    });

    itemsIn.forEach((i) => {
      if (!i || !i.id || itensAqui.has(i.id)) return;
      const titulo = String(i.title || '').trim();
      if (!titulo) return;

      const alvo = religar.get(i.environmentId) || i.environmentId;
      const ambienteValido = alvo && envsAqui.has(alvo);

      const item = {
        id: i.id,
        environmentId: ambienteValido ? alvo : null,
        type: ['task', 'reminder', 'commitment', 'idea'].includes(i.type) ? i.type : 'task',
        title: titulo.slice(0, 280),
        description: i.description || null,
        status: ['pending', 'done', 'archived'].includes(i.status) ? i.status : 'pending',
        priority: ['low', 'normal', 'high', 'urgent'].includes(i.priority) ? i.priority : 'normal',
        dueDate: i.dueDate || null,
        dueTime: i.dueTime || null,
        timePeriod: i.timePeriod || 'any',
        pinned: Boolean(i.pinned),
        source: i.source || 'import',
        rawInput: i.rawInput || null,
        parseConfidence: i.parseConfidence ?? null,
        needsReview: Boolean(i.needsReview),
        checklist: (Array.isArray(i.checklist) ? i.checklist : [])
          .map((entry, position) => ({
            id: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(entry?.id || ''))
              ? entry.id
              : uid(),
            title: String(entry?.title || '').trim().slice(0, 200),
            completed: Boolean(entry?.completed),
            position: Number.isInteger(entry?.position) ? entry.position : position,
          }))
          .filter((entry) => entry.title),
        tags: Array.isArray(i.tags) ? i.tags : [],
        snoozedUntil: i.snoozedUntil || null,
        completedAt: i.completedAt || null,
        deletedAt: i.deletedAt || null,
        createdAt: i.createdAt || agora,
        updatedAt: agora,
      };

      this.state.items.push(item);
      itensAqui.add(item.id);
      this.queue('POST', '/items', item);
      item.checklist.forEach((entry) => {
        this.queue('POST', '/checklist', { op: 'create', itemId: item.id, entry });
      });
      itens++;
    });

    this.state.items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    this.persist();
    this.emit('environments');
    this.emit('items', { action: 'import' });

    const ignorados = (envsIn.length - ambientes) + (itemsIn.length - itens);
    return { ambientes, itens, ignorados };
  }

  exportJSON() {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      format: 'nestra/v1',
      user: this.state.user ? { email: this.state.user.email, displayName: this.state.user.displayName } : null,
      preferences: this.state.prefs,
      environments: this.state.environments,
      items: this.state.items,
      meetings: this.state.meetings,
      agendas: this.state.agendas,
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

  async deleteAccount() {
    const id = this.state.user?.id;
    if (!id) return;

    if (this.state.mode === 'remote') {
      await this.flush();
      if (syncQueue.size() || syncQueue.failedSize()) {
        throw new Error('Ainda há alterações que não foram sincronizadas. Resolva a sincronização antes de excluir a conta.');
      }
      await api.del('/account');
      syncQueue.clear();
      localStorage.removeItem(K.remoteUser);
    }

    localStorage.removeItem(K.data(id));
    localStorage.removeItem(K.session);
    const accounts = read(K.accounts, []).filter((a) => a.id !== id);
    write(K.accounts, accounts);
    this.state.user = null;
    this.state.items = [];
    this.state.environments = [];
    this.state.meetings = [];
    this.state.agendas = [];
    this.emit('auth', null);
  }
}

export const store = new Store();
