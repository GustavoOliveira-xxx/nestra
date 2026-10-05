const Recognition =
  typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

const chaveFala = (texto) => String(texto)
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[.,;:!?¿¡"'()]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

export function mergeSpoken(acumulado, trecho) {
  const a = String(acumulado || '').replace(/\s+/g, ' ').trim();
  const t = String(trecho || '').replace(/\s+/g, ' ').trim();
  if (!t) return a;
  if (!a) return t;

  const ka = chaveFala(a);
  const kt = chaveFala(t);
  if (!ka) return t;
  if (!kt) return a;

  if (kt === ka || kt.startsWith(ka + ' ')) return t;

  if (ka.startsWith(kt + ' ')) return a;

  return a + ' ' + t;
}

export function voiceSupported() {
  return Boolean(Recognition);
}

export class VoiceCapture extends EventTarget {
  constructor({ lang = 'pt-BR', continuous = true, idleMs = 8000, maxMs = 60000 } = {}) {
    super();
    this.lang = lang;
    this.continuous = continuous;
    this.idleMs = idleMs;
    this.maxMs = maxMs;
    this.running = false;

    this.committed = '';
    this.sessionFinal = '';
    this.interimText = '';
    this._stopping = false;
    this._starting = false;
    this._vazias = 0;
    this._idleTimer = null;
    this._maxTimer = null;
  }

  get available() { return Boolean(Recognition); }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _clearIdleTimer() {
    clearTimeout(this._idleTimer);
    this._idleTimer = null;
  }

  _clearTimers() {
    this._clearIdleTimer();
    clearTimeout(this._maxTimer);
    this._maxTimer = null;
  }

  _touchIdle() {
    this._clearIdleTimer();
    if (!this.idleMs) return;
    this._idleTimer = setTimeout(() => this.stop(), this.idleMs);
    this._idleTimer?.unref?.();
  }

  _armMaximum() {
    clearTimeout(this._maxTimer);
    if (!this.maxMs) return;
    this._maxTimer = setTimeout(() => this.stop(), this.maxMs);
    this._maxTimer?.unref?.();
  }

  applyResults(results) {
    let final = '';
    let interim = '';

    for (let i = 0; i < results.length; i++) {
      const alternativa = results[i][0];
      if (!alternativa) continue;
      const trecho = alternativa.transcript || '';
      if (results[i].isFinal) final = mergeSpoken(final, trecho);
      else interim = mergeSpoken(interim, trecho);
    }

    this.sessionFinal = final;
    this.interimText = interim;
  }

  _commitSession() {
    this.committed = mergeSpoken(this.committed, this.sessionFinal);
    this.sessionFinal = '';
    this.interimText = '';
  }

  _criar() {
    const rec = new Recognition();
    rec.lang = this.lang;
    rec.continuous = this.continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      if (this._stopping || this._rec !== rec) {
        try { rec.abort(); } catch {  }
        return;
      }
      this.running = true;
      this._starting = false;
      this._touchIdle();
      this._emit('start');
    };

    rec.onresult = (ev) => {
      this.applyResults(ev.results);
      this._touchIdle();
      this._emit('text', { final: this.finalText, interim: this.interimText });
    };

    rec.onerror = (ev) => {
      if (ev.error === 'aborted' || ev.error === 'no-speech') return;

      this._stopping = true;
      this.running = false;
      this._clearTimers();

      const motivos = {
        'not-allowed': 'O navegador bloqueou o microfone. Libere o acesso e tente de novo.',
        'service-not-allowed': 'O navegador bloqueou o microfone. Libere o acesso e tente de novo.',
        'audio-capture': 'Nenhum microfone foi encontrado neste aparelho.',
        network: 'O reconhecimento de fala precisa de conexão e ela falhou.',
      };
      this._emit('error', {
        code: ev.error,
        message: motivos[ev.error] || 'Não consegui ouvir agora. Tente de novo.',
      });
    };

    rec.onend = () => {
      rec.onstart = rec.onresult = rec.onerror = rec.onend = null;
      if (this._rec === rec) this._rec = null;
      this._clearIdleTimer();

      const rendeu = Boolean(this.sessionFinal || this.interimText);
      this._vazias = rendeu ? 0 : this._vazias + 1;
      this._commitSession();

      const desistiu = this._vazias >= 2;

      if (this.running && !this._stopping && !desistiu && this._abrir()) return;

      this.running = false;
      this._starting = false;
      this._clearTimers();
      this._emit('end', { text: this.text });
    };

    return rec;
  }

  _abrir() {
    try {
      this._rec = this._criar();
      this._rec.start();
      return true;
    } catch {
      return false;
    }
  }

  start() {
    if (!Recognition || this.running || this._starting) return false;

    this._stopping = false;
    this._starting = true;

    if (this._abrir()) {
      this._armMaximum();
      return true;
    }

    this._starting = false;
    this._clearTimers();
    this._emit('error', { code: 'start', message: 'Não consegui abrir o microfone.' });
    return false;
  }

  stop() {
    this._stopping = true;
    this._starting = false;
    this.running = false;
    this._clearTimers();
    if (!this._rec) return;
    try { this._rec.stop(); } catch {  }
  }

  abort() {
    this._stopping = true;
    this._starting = false;
    this.running = false;
    this._clearTimers();
    if (!this._rec) return;
    try { this._rec.abort(); } catch {  }
  }

  get finalText() {
    return mergeSpoken(this.committed, this.sessionFinal);
  }

  get text() {
    return mergeSpoken(this.finalText, this.interimText);
  }

  reset() {
    this.committed = '';
    this.sessionFinal = '';
    this.interimText = '';
    this._vazias = 0;
  }
}

export function tidySpeech(texto, { capitalizar = true } = {}) {
  const limpo = String(texto)
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?=\S)/g, '$1 ')
    .trim();

  return capitalizar ? limpo.replace(/^(.)/, (_, c) => c.toUpperCase()) : limpo;
}
