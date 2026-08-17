/* =====================================================================
   NESTRA — Ditar em vez de digitar

   A captura por voz não é um recurso à parte: ela entrega texto na mesma
   caixa de sempre, que continua sendo interpretada pelo mesmo leitor de
   frases. Falar "reunião com o professor quinta às 19h" produz
   exatamente o mesmo item que digitar isso — inclusive as fichas de
   data, horário e ambiente aparecendo enquanto a frase é reconhecida.

   Usa o reconhecimento de fala do próprio navegador. Não há gravação,
   nem arquivo de áudio, nem envio para um serviço do Nestra: o áudio é
   processado pelo navegador e só o texto chega até aqui. Em navegadores
   sem esse recurso, o botão simplesmente não aparece — a caixa de texto
   nunca deixa de funcionar.
   ===================================================================== */

const Recognition =
  typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

/** O navegador sabe transcrever fala? */
export function voiceSupported() {
  return Boolean(Recognition);
}

/**
 * Uma sessão de ditado.
 *
 * O reconhecimento devolve dois tipos de resultado: os provisórios, que
 * mudam enquanto a pessoa fala, e os definitivos, que já não mudam mais.
 * Os dois são entregues separadamente para a interface poder mostrar o
 * texto se formando — sem isso, ditar parece travado até a frase acabar.
 */
export class VoiceCapture extends EventTarget {
  constructor({ lang = 'pt-BR', continuous = true } = {}) {
    super();
    this.lang = lang;
    this.continuous = continuous;
    this.running = false;

    /* O texto vive em três partes, e a separação é o que impede a
       repetição em escada:

       • `committed`   — o que veio de sessões já encerradas. O navegador
                         reinicia o reconhecimento sozinho depois de uma
                         pausa, e a cada reinício a lista de resultados
                         volta do zero; sem guardar isto, o começo da
                         frase se perderia.
       • `sessionFinal`— o definitivo da sessão atual, SEMPRE reconstruído
                         a partir da lista completa de resultados.
       • `interimText` — o provisório, que muda a cada instante.

       O erro anterior era acumular o definitivo (`final += trecho`) em
       vez de reconstruí-lo. No Android, cada evento reentrega resultados
       que já haviam sido entregues, então "pegar ração para o Max" ia
       sendo somado a si mesmo pedaço a pedaço: "pegar", "pegar ração",
       "pegar ração para"… Reconstruir a partir da lista elimina a
       classe inteira de problema, em vez de remendar o sintoma. */
    this.committed = '';
    this.sessionFinal = '';
    this.interimText = '';
    this._stopping = false;
    this._vazias = 0;   // sessões seguidas que não produziram nada
  }

  get available() { return Boolean(Recognition); }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  /**
   * Lê o evento de resultado e reescreve o estado da sessão.
   *
   * Separado do `start()` para poder ser exercitado sem microfone: as
   * sequências que quebraram no aparelho real são reproduzíveis aqui.
   */
  applyResults(results) {
    let final = '';
    let interim = '';

    for (let i = 0; i < results.length; i++) {
      const alternativa = results[i][0];
      if (!alternativa) continue;
      const trecho = alternativa.transcript || '';
      if (results[i].isFinal) final += trecho + ' ';
      else interim += trecho + ' ';
    }

    this.sessionFinal = final.replace(/\s+/g, ' ').trim();
    this.interimText = interim.replace(/\s+/g, ' ').trim();
  }

  /** Fecha a sessão atual e guarda o que ela produziu. */
  _commitSession() {
    if (this.sessionFinal) {
      this.committed = (this.committed + ' ' + this.sessionFinal).replace(/\s+/g, ' ').trim();
    }
    this.sessionFinal = '';
    this.interimText = '';
  }

  start() {
    if (!Recognition || this.running) return false;

    const rec = new Recognition();
    rec.lang = this.lang;
    rec.continuous = this.continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      this.running = true;
      this._stopping = false;
      this._emit('start');
    };

    rec.onresult = (ev) => {
      this.applyResults(ev.results);
      this._emit('text', { final: this.finalText, interim: this.interimText });
    };

    rec.onerror = (ev) => {
      /* `aborted` e `no-speech` são rotina: acontecem quando a pessoa
         para de falar ou encerra o ditado. Não são falhas para relatar. */
      if (ev.error === 'aborted' || ev.error === 'no-speech') return;

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
      /* O navegador encerra sozinho depois de um silêncio. Se a pessoa
         não pediu para parar, recomeça — senão o ditado de uma frase mais
         pensada morre no meio da primeira pausa.

         Antes de recomeçar, o que a sessão produziu é guardado: a lista
         de resultados nasce vazia na sessão seguinte, e sem guardar o
         começo da frase iria embora. */
      const rendeu = Boolean(this.sessionFinal || this.interimText);
      this._vazias = rendeu ? 0 : this._vazias + 1;
      this._commitSession();

      /* Duas sessões seguidas sem nada quer dizer que a pessoa parou de
         falar. Continuar reabrindo o microfone nesse ponto seria deixá-lo
         ligado sem motivo — e um microfone aberto que ninguém pediu é o
         tipo de coisa que não se faz. */
      const desistiu = this._vazias >= 2;

      if (this.running && !this._stopping && !desistiu) {
        try { rec.start(); return; } catch { /* segue para o encerramento */ }
      }
      this.running = false;
      this._emit('end', { text: this.text });
    };

    this._rec = rec;
    try {
      rec.start();
    } catch {
      this._emit('error', { code: 'start', message: 'Não consegui abrir o microfone.' });
      return false;
    }
    return true;
  }

  stop() {
    if (!this._rec) return;
    this._stopping = true;
    this.running = false;
    try { this._rec.stop(); } catch { /* já estava parando */ }
  }

  abort() {
    if (!this._rec) return;
    this._stopping = true;
    this.running = false;
    try { this._rec.abort(); } catch { /* já estava parando */ }
  }

  /** O definitivo: sessões encerradas mais o que já fechou na atual. */
  get finalText() {
    return (this.committed + ' ' + this.sessionFinal).replace(/\s+/g, ' ').trim();
  }

  /** Tudo o que foi dito até agora, incluindo o trecho ainda provisório. */
  get text() {
    return (this.finalText + ' ' + this.interimText).replace(/\s+/g, ' ').trim();
  }

  reset() {
    this.committed = '';
    this.sessionFinal = '';
    this.interimText = '';
    this._vazias = 0;
  }
}

/* ---------------------------------------------------------------------
   Pontuação falada

   Ninguém dita vírgulas em voz alta, mas quase todo mundo fala frases que
   pedem uma. O reconhecimento do navegador já converte "vírgula" e
   "ponto" em pt-BR; o que sobra aqui é a limpeza: espaço antes de sinal,
   inicial minúscula, repetição de espaços.
   --------------------------------------------------------------------- */
export function tidySpeech(texto, { capitalizar = true } = {}) {
  const limpo = String(texto)
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')       // "palavra ," → "palavra,"
    .replace(/([,;:])(?=\S)/g, '$1 ')      // "palavra,outra" → "palavra, outra"
    .trim();

  /* A maiúscula inicial só faz sentido quando o ditado começa a frase.
     Emendado no que já estava escrito, ela produz coisas como "comprar
     pão Amanhã de manhã". */
  return capitalizar ? limpo.replace(/^(.)/, (_, c) => c.toUpperCase()) : limpo;
}
