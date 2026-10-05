const CONFIG_KEY = 'nestra:api-base';

export const api = {
  base: null,
  online: false,
  ai: false,

  resolveBase() {
    const meta = document.querySelector('meta[name="nestra-api"]');
    const stored = localStorage.getItem(CONFIG_KEY);
    const fromMeta = meta && meta.content && meta.content !== '__API_BASE__' ? meta.content : null;

    const explicit = (stored || fromMeta || '').replace(/\/$/, '');
    if (explicit) {
      this.base = explicit;
      this.autoDetected = false;
      return this.base;
    }

    if (location.protocol === 'http:' || location.protocol === 'https:') {
      const path = location.pathname.replace(/\/[^/]*$/, '');
      this.base = (location.origin + path).replace(/\/$/, '') + '/api';
      this.autoDetected = true;
      return this.base;
    }

    this.base = null;
    this.autoDetected = false;
    return null;
  },

  setBase(url) {
    if (url) localStorage.setItem(CONFIG_KEY, url.replace(/\/$/, ''));
    else localStorage.removeItem(CONFIG_KEY);
    this.resolveBase();
  },

  async probe() {
    if (!this.resolveBase()) {
      this.online = false;
      return false;
    }
    try {
      const res = await fetch(this.base + '/health', {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4500),
      });
      if (!res.ok) {
        this.online = false;
        return false;
      }
      const payload = await res.json().catch(() => null);
      const isNestra = payload?.service === 'nestra-api';

      this.degraded = isNestra && payload.ok === false
        ? { reason: payload.reason || 'desconhecido', message: payload.message || '' }
        : null;

      this.online = isNestra && payload.ok !== false;
      this.ai = this.online && payload.ai === true;
    } catch {
      this.online = false;
      this.ai = false;
      this.degraded = null;
    }
    return this.online;
  },

  async request(path, { method = 'GET', body, signal } = {}) {
    if (!this.base) throw new ApiError('offline', 'API não configurada');

    const res = await fetch(this.base + path, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });

    let payload = null;
    const text = await res.text();
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { message: text }; }
    }

    if (!res.ok) {
      throw new ApiError(
        payload?.code || String(res.status),
        payload?.message || 'Não foi possível concluir a operação.',
        res.status,
      );
    }
    return payload;
  },

  get:  (p)    => api.request(p),
  post: (p, b) => api.request(p, { method: 'POST', body: b }),
  put:  (p, b) => api.request(p, { method: 'PUT', body: b }),
  del:  (p)    => api.request(p, { method: 'DELETE' }),
};

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const QUEUE_KEY = 'nestra:sync-queue';
const FAILED_KEY = 'nestra:sync-failed';

export const syncQueue = {
  _flushing: null,
  _ownerId: null,

  setOwner(ownerId) {
    this._ownerId = ownerId ? String(ownerId) : null;
  },

  key(prefix) {
    return this._ownerId ? `${prefix}:${this._ownerId}` : null;
  },

  read() {
    const key = this.key(QUEUE_KEY);
    if (!key) return [];
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch { return []; }
  },

  write(list) {
    const key = this.key(QUEUE_KEY);
    if (key) localStorage.setItem(key, JSON.stringify(list.slice(-500)));
  },

  push(op) {
    const list = this.read();
    const entry = { ...op, id: crypto.randomUUID(), at: Date.now(), tries: 0 };
    const index = op.coalesce ? list.findIndex((e) => e.coalesce === op.coalesce) : -1;
    if (index >= 0) list[index] = entry;
    else list.push(entry);
    this.write(list);
  },

  size() { return this.read().length; },

  failed() {
    const key = this.key(FAILED_KEY);
    if (!key) return [];
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch { return []; }
  },

  failedSize() { return this.failed().length; },

  rememberFailure(op, err) {
    const key = this.key(FAILED_KEY);
    if (!key) return;
    const list = this.failed();
    list.push({
      ...op,
      failedAt: Date.now(),
      error: {
        code: err?.code || 'sync_error',
        status: err?.status || null,
        message: err?.message || 'Não foi possível sincronizar esta alteração.',
      },
    });
    localStorage.setItem(key, JSON.stringify(list.slice(-500)));
  },

  retryFailed() {
    const failedKey = this.key(FAILED_KEY);
    if (!failedKey) return 0;
    const list = this.failed();
    if (!list.length) return 0;
    const retry = list.map(({ failedAt, error, ...op }) => ({ ...op, tries: 0 }));
    this.write([...retry, ...this.read()]);
    localStorage.removeItem(failedKey);
    return retry.length;
  },

  clear() {
    const queueKey = this.key(QUEUE_KEY);
    const failedKey = this.key(FAILED_KEY);
    if (queueKey) localStorage.removeItem(queueKey);
    if (failedKey) localStorage.removeItem(failedKey);
  },

  async flush() {
    if (!api.online) return 0;
    if (this._flushing) return this._flushing;

    this._flushing = (async () => {
      const attempted = new Set();
      let sent = 0;

      while (true) {
        const op = this.read().find((entry) => !attempted.has(entry.id));
        if (!op) break;
        attempted.add(op.id);

        try {
          await api.request(op.path, { method: op.method, body: op.body });

          this.write(this.read().filter((entry) => entry.id !== op.id));
          sent++;
        } catch (err) {
          const current = this.read();
          const index = current.findIndex((entry) => entry.id === op.id);
          if (index < 0) continue;

          const permanent = err.status >= 400 && err.status < 500 &&
            err.status !== 408 && err.status !== 429;

          if (permanent || (current[index].tries || 0) >= 6) {
            this.rememberFailure(current[index], err);
            current.splice(index, 1);
            this.write(current);
            continue;
          }

          current[index] = { ...current[index], tries: (current[index].tries || 0) + 1 };
          this.write(current);
          break;
        }
      }

      return sent;
    })();

    try {
      return await this._flushing;
    } finally {
      this._flushing = null;
    }
  },
};
