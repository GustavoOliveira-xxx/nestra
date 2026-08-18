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

/* ---------------------------------------------------------------------
   Juntar o que foi dito

   Esta função é a resposta ao ditado que repetia no celular. O
   reconhecimento do Android não entrega pedaços novos a cada evento: ele
   reentrega a frase inteira, um pouco maior a cada vez —

       "pegar"  ·  "pegar ração"  ·  "pegar ração para o Max"

   — e às vezes reentrega a mesma frase de uma sessão anterior quando o
   navegador reabre o microfone sozinho depois de uma pausa. Somar tudo,
   que é o que qualquer concatenação faz, produz exatamente a escada que
   aparecia na tela. No computador isso não acontecia porque ali cada
   trecho vem uma vez só, e por isso o problema era só do celular.

   A regra aqui não tenta adivinhar duplicata por semelhança: ela olha
   para uma relação exata. Se o trecho novo **começa com** tudo o que já
   havia, ele não é uma adição — é a mesma fala, crescida — e substitui o
   anterior. Se o que já havia começa com o trecho novo, é reentrega pura
   e não há nada a somar. Fora esses dois casos, o trecho é novo mesmo e
   entra no fim.

   A comparação ignora maiúsculas, acentos e pontuação (o reconhecedor
   muda os três entre uma entrega e outra) e só aceita o encaixe em
   fronteira de palavra, para "sim" nunca casar dentro de "simples".
   --------------------------------------------------------------------- */
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

  // O trecho novo contém tudo o que já havia: é a fala crescida.
  if (kt === ka || kt.startsWith(ka + ' ')) return t;

  // O que já havia contém o trecho novo: reentrega, nada a somar.
  if (ka.startsWith(kt + ' ')) return a;

  return a + ' ' + t;
}

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

    /* O texto vive em três partes:

       • `committed`   — o que veio de sessões já encerradas. O navegador
                         reinicia o reconhecimento sozinho depois de uma
                         pausa, e sem guardar isto o começo da frase se
                         perderia.
       • `sessionFinal`— o definitivo da sessão atual, SEMPRE reconstruído
                         a partir da lista completa de resultados.
       • `interimText` — o provisório, que muda a cada instante.

       Nenhuma das três é somada às outras por concatenação simples: elas
       passam por `mergeSpoken`, que sabe distinguir "o trecho novo
       continua o anterior" de "o trecho novo é o anterior outra vez,
       maior". É essa distinção que impede a repetição em escada no
       Android — ver a explicação em `mergeSpoken`. */
    this.committed = '';
    this.sessionFinal = '';
    this.interimText = '';
    this._stopping = false;
    this._starting = false;
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
      if (results[i].isFinal) final = mergeSpoken(final, trecho);
      else interim = mergeSpoken(interim, trecho);
    }

    this.sessionFinal = final;
    this.interimText = interim;
  }

  /** Fecha a sessão atual e guarda o que ela produziu. */
  _commitSession() {
    this.committed = mergeSpoken(this.committed, this.sessionFinal);
    this.sessionFinal = '';
    this.interimText = '';
  }

  /**
   * Prepara um reconhecimento novo, com os ouvintes já ligados.
   *
   * Cada volta ganha um objeto novo em vez de reaproveitar o anterior.
   * A lista de resultados pertence ao objeto, e reiniciar o mesmo objeto
   * no Android traz a lista da sessão passada junto — o começo da frase
   * voltava inteiro, somado ao que já estava guardado. Um objeto novo
   * nasce com a lista vazia, sempre, em qualquer navegador.
   */
  _criar() {
    const rec = new Recognition();
    rec.lang = this.lang;
    rec.continuous = this.continuous;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      this.running = true;
      this._starting = false;
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
      /* Este reconhecimento acabou o trabalho dele. Desligar os ouvintes
         evita que um evento atrasado do objeto velho mexa no estado da
         sessão que está começando. */
      rec.onstart = rec.onresult = rec.onerror = rec.onend = null;

      /* O navegador encerra sozinho depois de um silêncio. Se a pessoa
         não pediu para parar, recomeça — senão o ditado de uma frase mais
         pensada morre no meio da primeira pausa.

         Antes de recomeçar, o que a sessão produziu é guardado. */
      const rendeu = Boolean(this.sessionFinal || this.interimText);
      this._vazias = rendeu ? 0 : this._vazias + 1;
      this._commitSession();

      /* Duas sessões seguidas sem nada quer dizer que a pessoa parou de
         falar. Continuar reabrindo o microfone nesse ponto seria deixá-lo
         ligado sem motivo — e um microfone aberto que ninguém pediu é o
         tipo de coisa que não se faz. */
      const desistiu = this._vazias >= 2;

      if (this.running && !this._stopping && !desistiu && this._abrir()) return;

      this.running = false;
      this._starting = false;
      this._emit('end', { text: this.text });
    };

    return rec;
  }

  /** Abre um reconhecimento novo. Devolve se conseguiu. */
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
    /* `running` só fica verdadeiro quando o navegador confirma a abertura,
       e isso é assíncrono. Sem o `_starting`, dois toques seguidos no
       microfone — coisa comum em tela de toque — abriam dois
       reconhecimentos ao mesmo tempo, cada um transcrevendo a mesma fala
       para dentro da mesma caixa. */
    if (!Recognition || this.running || this._starting) return false;

    this._stopping = false;
    this._starting = true;

    if (this._abrir()) return true;

    this._starting = false;
    this._emit('error', { code: 'start', message: 'Não consegui abrir o microfone.' });
    return false;
  }

  stop() {
    if (!this._rec) return;
    this._stopping = true;
    this._starting = false;
    this.running = false;
    try { this._rec.stop(); } catch { /* já estava parando */ }
  }

  abort() {
    if (!this._rec) return;
    this._stopping = true;
    this._starting = false;
    this.running = false;
    try { this._rec.abort(); } catch { /* já estava parando */ }
  }

  /** O definitivo: sessões encerradas mais o que já fechou na atual. */
  get finalText() {
    return mergeSpoken(this.committed, this.sessionFinal);
  }

  /** Tudo o que foi dito até agora, incluindo o trecho ainda provisório. */
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
