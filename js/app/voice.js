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
    this.finalText = '';
    this.interimText = '';
    this._stopping = false;
  }

  get available() { return Boolean(Recognition); }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
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
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const trecho = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) {
          this.finalText = (this.finalText + ' ' + trecho).replace(/\s+/g, ' ').trim();
        } else {
          interim += trecho;
        }
      }
      this.interimText = interim.trim();
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
         pensada morre no meio da primeira pausa. */
      if (this.running && !this._stopping) {
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

  /** Tudo o que foi dito até agora, incluindo o trecho ainda provisório. */
  get text() {
    return (this.finalText + ' ' + this.interimText).replace(/\s+/g, ' ').trim();
  }

  reset() {
    this.finalText = '';
    this.interimText = '';
  }
}

/* ---------------------------------------------------------------------
   Pontuação falada

   Ninguém dita vírgulas em voz alta, mas quase todo mundo fala frases que
   pedem uma. O reconhecimento do navegador já converte "vírgula" e
   "ponto" em pt-BR; o que sobra aqui é a limpeza: espaço antes de sinal,
   inicial minúscula, repetição de espaços.
   --------------------------------------------------------------------- */
export function tidySpeech(texto) {
  return String(texto)
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')       // "palavra ," → "palavra,"
    .replace(/([,;:])(?=\S)/g, '$1 ')      // "palavra,outra" → "palavra, outra"
    .replace(/^\s*(.)/, (_, c) => c.toUpperCase())
    .trim();
}
