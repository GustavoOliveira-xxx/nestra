/* =====================================================================
   NESTRA — Camada de acesso à API

   §14: "O banco Neon não deve ser acessado diretamente pelo navegador
   com credenciais sensíveis. Será necessário um backend ou uma camada
   de funções serverless."

   O front nunca vê a string de conexão. Ele fala com /api/*, que valida
   a sessão e só então conversa com o Postgres. Quando não existe API
   publicada (por exemplo, no GitHub Pages puro), o app cai para o modo
   local e avisa o usuário na barra lateral.
   ===================================================================== */

const CONFIG_KEY = 'nestra:api-base';

export const api = {
  base: null,
  online: false,

  /**
   * Descobre o endereço da API, nesta ordem:
   *   1. o que a pessoa digitou nas configurações;
   *   2. a `<meta name="nestra-api">` do index.html;
   *   3. `/api` na mesma origem.
   *
   * O terceiro caso é o que faz a conta funcionar em dois aparelhos sem
   * ninguém configurar nada: publicado na Vercel, o front e as funções
   * moram na mesma origem, então `/api` simplesmente existe. Onde não
   * existir — GitHub Pages puro, arquivo local — o `probe()` recebe um
   * 404 e o app volta ao modo local, exatamente como antes.
   */
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

    // `file://` não tem origem para conversar; aí é modo local mesmo.
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

  /**
   * Testa se existe uma API viva antes de tentar sincronizar.
   *
   * Não basta o 200: hospedagem estática costuma devolver o index.html
   * para qualquer caminho desconhecido, e aí o app acharia que tem banco
   * quando só tem HTML. Por isso a resposta precisa se identificar.
   */
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

      /* API publicada mas com o banco fora do ar é diferente de não haver
         API nenhuma. Nos dois casos o app funciona local, mas só no
         primeiro dá para dizer à pessoa o que exatamente falta. */
      this.degraded = isNestra && payload.ok === false
        ? { reason: payload.reason || 'desconhecido', message: payload.message || '' }
        : null;

      this.online = isNestra && payload.ok !== false;
    } catch {
      this.online = false;
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

/* ---------------------------------------------------------------------
   Fila de sincronização — §24 "se houver conexão interrompida, o item
   deve permanecer em estado de envio pendente e informar claramente o
   que aconteceu."
   --------------------------------------------------------------------- */
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
    list.push({ ...op, id: crypto.randomUUID(), at: Date.now(), tries: 0 });
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

  /**
   * Envia tudo o que está pendente; devolve quantas operações passaram.
   *
   * A fila pode receber outra captura enquanto uma requisição está no ar.
   * Por isso cada conclusão relê o armazenamento e remove somente a
   * operação que acabou de subir. Reescrever a fotografia antiga da fila
   * apagava exatamente o cadastro feito nesse intervalo — comportamento
   * que aparecia mais no celular, onde a rede demora um pouco mais.
   *
   * Uma falha temporária também interrompe a rodada. A ordem é parte da
   * integridade: se criar um ambiente falhou, o item seguinte não pode ser
   * enviado antes dele e perder a referência ao ambiente.
   */
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

          // Preserva tudo o que chegou à fila enquanto a rede respondia.
          this.write(this.read().filter((entry) => entry.id !== op.id));
          sent++;
        } catch (err) {
          const current = this.read();
          const index = current.findIndex((entry) => entry.id === op.id);
          if (index < 0) continue;

          // 4xx que não seja 408/429 significa operação inválida: descarta.
          const permanent = err.status >= 400 && err.status < 500 &&
            err.status !== 408 && err.status !== 429;

          if (permanent || (current[index].tries || 0) >= 6) {
            /* Nunca finge que uma alteração rejeitada foi sincronizada.
               Ela sai da fila ativa para não bloquear o restante, mas
               permanece visível e pode ser tentada após a correção. */
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
