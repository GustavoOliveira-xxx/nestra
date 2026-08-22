/* =====================================================================
   NESTRA — Caixa de captura rápida (§7.1)

   "O sistema registra primeiro e pergunta depois. Uma frase nunca deve
   ser perdida apenas porque a interpretação automática não foi perfeita."

   Enquanto o usuário digita, o que foi entendido aparece em fichas
   abaixo do campo. Cada ficha pode ser descartada com um clique — a
   confirmação é compacta e não bloqueia a captura.
   ===================================================================== */

import { store } from '../store.js';
import { parse, humanDate, TYPE_LABELS, PRIORITY_LABELS, PERIOD_LABELS } from '../nlp.js';
import { el, icon, esc, toast } from '../ui.js';
import { burstAt } from '../../gfx/fx.js';
import { VoiceCapture, voiceSupported, tidySpeech } from '../voice.js';
import { device } from '../../core/device.js';

const CHIP_ICON = {
  date: 'calendar',
  time: 'clock',
  period: 'moon',
  priority: 'flag',
  type: 'sparkle',
  env: 'layers',
  desc: 'list',
  vague: 'clockBack',
};

export function createCapture({ environmentId = null, onCreated = null } = {}) {
  const root = el('div', { class: 'capture border-travel' });

  const input = el('textarea', {
    class: 'capture__input',
    rows: 1,
    /* Em tela estreita o convite é mais curto: com o microfone ao lado,
       a frase inteira quebrava em duas linhas e a segunda ficava cortada
       pela altura de uma linha só. */
    placeholder: device.compact ? 'O que precisa lembrar?' : 'Escreva o que precisa lembrar…',
    'aria-label': 'Captura rápida',
    autocomplete: 'off',
    spellcheck: 'true',
  });

  const send = el('button', {
    class: 'btn btn--primary btn--icon capture__send',
    'aria-label': 'Registrar',
    html: icon('plus', 18),
  });

  const parseRow = el('div', { class: 'capture__parse', 'aria-live': 'polite' });

  /* --- Ditar em vez de digitar ---
     Só existe onde o navegador sabe transcrever. Onde não sabe, o botão
     não aparece — melhor não ter do que ter e não funcionar. */
  const mic = voiceSupported()
    ? el('button', {
        class: 'btn btn--ghost btn--icon capture__mic tip',
        'data-tip': 'Ditar',
        'aria-label': 'Ditar em vez de digitar',
        html: icon('mic', 18),
      })
    : null;

  const hints = el('div', { class: 'capture__hints' }, [
    el('span', { html: '<kbd>Enter</kbd> registra · <kbd>Shift</kbd>+<kbd>Enter</kbd> quebra linha' }),
    el('span', { class: 'grow' }),
    el('span', { html: '<kbd>@</kbd> ambiente · <kbd>#</kbd> etiqueta · <kbd>!!</kbd> prioridade' }),
  ]);

  root.append(
    el('div', { class: 'capture__row' }, [
      el('div', { class: 'capture__glyph', html: icon('bolt', 18) }),
      input,
      mic,
      send,
    ]),
    parseRow,
    hints,
  );

  /** Campos que o usuário descartou manualmente nesta frase. */
  let dismissed = new Set();
  let current = null;

  function context() {
    return {
      environments: store.activeEnvironments,
      timezone: store.state.prefs.timezone,
      defaultEnvironmentId: environmentId ?? store.state.prefs.defaultEnvironmentId,
    };
  }

  function refresh() {
    const text = input.value;

    // altura acompanha o conteúdo
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';

    if (!text.trim() || !store.state.prefs.nlParsingEnabled) {
      parseRow.replaceChildren();
      current = null;
      return;
    }

    current = parse(text, context());
    dismissed.forEach((kind) => {
      if (kind === 'date') { current.dueDate = null; current.dueTime = null; }
      if (kind === 'time') current.dueTime = null;
      if (kind === 'priority') current.priority = 'normal';
      if (kind === 'env') { current.environmentId = null; current.environmentName = null; }
      if (kind === 'period') current.timePeriod = 'any';
      if (kind === 'type') current.type = 'task';
    });

    renderChips();
  }

  function renderChips() {
    parseRow.replaceChildren();
    if (!current) return;

    const chips = [];

    if (current.type !== 'task') {
      chips.push({ kind: 'type', label: TYPE_LABELS[current.type] });
    }
    const dateLabel = humanDate(current.dueDate, store.state.prefs.timezone);
    if (dateLabel) chips.push({ kind: 'date', label: dateLabel });
    if (current.dueTime) chips.push({ kind: 'time', label: current.dueTime });
    if (current.timePeriod !== 'any' && !current.dueTime) {
      chips.push({ kind: 'period', label: PERIOD_LABELS[current.timePeriod] });
    }
    if (current.priority !== 'normal') {
      chips.push({ kind: 'priority', label: 'prioridade ' + PRIORITY_LABELS[current.priority] });
    }
    if (current.environmentName) chips.push({ kind: 'env', label: current.environmentName });
    if (current.description) chips.push({ kind: 'desc', label: 'com descrição' });

    const vague = current.matches.find((m) => m.kind === 'vague');
    if (vague) chips.push({ kind: 'vague', label: 'sem prazo definido', locked: true });

    chips.forEach((chip, i) => {
      const node = el('span', {
        class: 'parse-chip',
        style: { animationDelay: (i * 0.04) + 's' },
        title: chip.locked
          ? 'O Nestra não inventa uma data quando a frase é vaga.'
          : 'Clique no × para descartar',
      }, [
        el('span', { html: icon(CHIP_ICON[chip.kind] || 'sparkle', 13) }),
        el('b', { text: chip.label }),
      ]);

      if (!chip.locked) {
        node.appendChild(el('button', {
          class: 'parse-chip__x',
          'aria-label': `Descartar ${chip.label}`,
          text: '×',
          onClick: (ev) => {
            ev.stopPropagation();
            dismissed.add(chip.kind);
            refresh();
          },
        }));
      }

      parseRow.appendChild(node);
    });

    if (current.needsReview) {
      parseRow.appendChild(el('span', {
        class: 'parse-chip',
        style: { borderColor: 'var(--overdue)', color: 'var(--overdue)' },
        html: icon('alert', 13) + '<b style="color:inherit">confirmar depois</b>',
        title: 'A frase foi salva por inteiro. Você ajusta os detalhes quando quiser.',
      }));
    }
  }

  function submit() {
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }

    const parsed = current && store.state.prefs.nlParsingEnabled
      ? current
      : { title: text, type: 'task', priority: 'normal', dueDate: null, dueTime: null,
          timePeriod: 'any', environmentId: environmentId ?? store.state.prefs.defaultEnvironmentId,
          description: null, tags: [], confidence: 0.5, needsReview: false };

    const item = store.createItem({
      title: parsed.title,
      description: parsed.description,
      type: parsed.type,
      priority: parsed.priority,
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime,
      timePeriod: parsed.timePeriod,
      environmentId: environmentId ?? parsed.environmentId,
      tags: parsed.tags,
      source: 'quick_capture',
      rawInput: text,
      parseConfidence: parsed.confidence,
      needsReview: parsed.needsReview,
    });

    if (!item) return;

    /* Registrar encerra o ditado naquele instante. A fala já está no item
       e não há motivo para o navegador continuar exibindo o indicador de
       microfone na aba enquanto a tela é reconstruída. */
    root.stopVoice?.();

    // A cena de fundo reage à captura
    window.nestraScene?.pulseAt(0.9);
    const r = send.getBoundingClientRect();
    burstAt(r.left + r.width / 2, r.top + r.height / 2, '#2F6BFF', 12);

    input.value = '';
    dismissed = new Set();
    current = null;
    refresh();
    input.focus();

    const where = item.environmentId
      ? store.environmentById(item.environmentId)?.name
      : 'Caixa de entrada';

    toast(`Registrado em ${where}.`, {
      kind: 'success',
      action: 'Desfazer',
      onAction: () => {
        store.trashItem(item.id);
        toast('Captura desfeita.');
      },
    });

    onCreated?.(item);
  }

  /* ---------------------------------------------------------------
     Ditado

     O texto reconhecido entra na caixa como se estivesse sendo digitado:
     o mesmo `refresh()` roda, as mesmas fichas de data e ambiente
     aparecem. O que a pessoa já tinha escrito antes de apertar o
     microfone é preservado — o ditado acrescenta, não substitui.
     --------------------------------------------------------------- */
  if (mic) {
    const voz = new VoiceCapture({ lang: store.state.prefs.locale || 'pt-BR' });
    let textoAntes = '';

    const pintar = (ouvindo) => {
      root.dataset.listening = String(ouvindo);
      mic.dataset.on = String(ouvindo);
      mic.setAttribute('aria-pressed', String(ouvindo));
      mic.dataset.tip = ouvindo ? 'Parar de ditar' : 'Ditar';
      mic.setAttribute('aria-label', ouvindo ? 'Parar de ditar' : 'Ditar em vez de digitar');
    };

    /* Só pinta. O ponto de partida do texto NÃO pode ser fixado aqui:
       o navegador reinicia o reconhecimento sozinho depois de cada pausa
       e este evento dispara de novo a cada reinício. Fixar o texto e
       zerar o acumulado a cada volta era a segunda causa da frase saindo
       repetida. Isso agora acontece uma vez só, no clique. */
    voz.addEventListener('start', () => {
      pintar(true);
      window.nestraScene?.pulseAt(0.4);
    });

    voz.addEventListener('text', () => {
      const dito = tidySpeech(voz.text, { capitalizar: !textoAntes });
      input.value = textoAntes ? `${textoAntes} ${dito}` : dito;
      refresh();
    });

    voz.addEventListener('error', (ev) => {
      pintar(false);
      toast(ev.detail.message, { kind: 'error' });
    });

    voz.addEventListener('end', () => {
      pintar(false);
      // Nada foi entendido: devolve a caixa como estava
      if (!voz.text) input.value = textoAntes;
      refresh();
      input.focus();
    });

    mic.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (voz.running) { voz.stop(); return; }

      // Uma vez por ditado, e não a cada reinício do reconhecimento
      textoAntes = input.value.trim();
      voz.reset();
      voz.start();
    });

    // Sair da tela com o microfone aberto seria péssimo: encerra junto
    root.stopVoice = () => {
      pintar(false);
      voz.abort();
    };
  }

  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      submit();
    }
    if (ev.key === 'Escape') {
      input.value = '';
      refresh();
      input.blur();
    }
  });
  send.addEventListener('click', submit);

  root.focusInput = () => input.focus();
  return root;
}
