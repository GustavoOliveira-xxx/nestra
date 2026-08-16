/* =====================================================================
   NESTRA — Linha de item e tela de detalhes

   §7.2: "O usuário deve conseguir concluir, adiar, editar, mudar a data
   e abrir os detalhes sem navegar por múltiplas telas."
   §7.4: o item principal continua simples; checklist e descrição só
   aparecem quando pedidos.
   ===================================================================== */

import { store } from '../store.js';
import { humanDate, TYPE_LABELS, PRIORITY_LABELS, PERIOD_LABELS, todayIn, toISODate } from '../nlp.js';
import { el, icon, toast, openModal, openMenu, confirmDialog } from '../ui.js';
import { burstAt } from '../../gfx/fx.js';

const TYPE_COLOR = {
  task: 'var(--type-task)',
  reminder: 'var(--type-reminder)',
  commitment: 'var(--type-commitment)',
  idea: 'var(--type-idea)',
};

const TYPE_ICON = {
  task: 'check',
  reminder: 'bell',
  commitment: 'calendar',
  idea: 'bulb',
};

const EVENT_LABELS = {
  created: 'Item criado',
  completed: 'Concluído',
  reopened: 'Reaberto',
  rescheduled: 'Data alterada',
  moved: 'Mudou de ambiente',
  updated: 'Editado',
  trashed: 'Enviado para a lixeira',
  restored: 'Restaurado da lixeira',
  snoozed: 'Adiado',
};

/* ---------------------------------------------------------------------
   Linha de item
   --------------------------------------------------------------------- */
export function renderItem(item, options = {}) {
  const { onChange = null, showEnvironment = true } = options;
  const env = store.environmentById(item.environmentId);
  const overdue = store.isOverdue(item);
  const done = item.status === 'done';

  const row = el('div', {
    class: 'item',
    tabindex: '0',
    role: 'listitem',
    dataset: {
      status: item.status,
      overdue: String(overdue),
      pinned: String(Boolean(item.pinned)),
      id: item.id,
    },
    style: { '--type-color': TYPE_COLOR[item.type] },
  });

  row.appendChild(el('span', { class: 'item__type' }));

  /* Caixa de conclusão */
  const check = el('button', {
    class: 'check item__check',
    role: 'checkbox',
    'aria-checked': String(done),
    'aria-label': done ? 'Reabrir item' : 'Concluir item',
    // concluir precisa ser instantâneo: aqui o carregamento atrapalharia
    'data-noload': true,
  });

  check.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const willComplete = item.status !== 'done';

    if (willComplete) {
      const r = check.getBoundingClientRect();
      burstAt(r.left + r.width / 2, r.top + r.height / 2, TYPE_COLOR[item.type].includes('var') ? '#2F6BFF' : '#2F6BFF', 10);
      window.nestraScene?.pulseAt(0.45);
      if (store.state.prefs.afterComplete !== 'keep') {
        row.classList.add('item--completing');
      }
    }

    store.toggleItem(item.id);
    setTimeout(() => onChange?.(), willComplete && store.state.prefs.afterComplete === 'hide' ? 420 : 0);
  });

  /* Corpo */
  const main = el('div', { class: 'item__main' });
  main.appendChild(el('div', { class: 'item__title', text: item.title }));

  const meta = el('div', { class: 'item__meta' });

  meta.appendChild(el('span', {
    style: { color: TYPE_COLOR[item.type] },
    html: icon(TYPE_ICON[item.type], 12) + `<span>${TYPE_LABELS[item.type]}</span>`,
  }));

  if (item.dueDate) {
    const label = humanDate(item.dueDate, store.state.prefs.timezone);
    const today = toISODate(todayIn(store.state.prefs.timezone));
    const cls = overdue ? ' item__date--overdue' : item.dueDate === today ? ' item__date--today' : '';
    meta.appendChild(el('span', {
      class: 'item__date' + cls,
      html: icon(overdue ? 'alert' : 'calendar', 12) +
        `<span>${label}${item.dueTime ? ' · ' + item.dueTime : ''}</span>`,
      title: item.dueDate,
    }));
  } else if (item.status === 'pending') {
    meta.appendChild(el('span', { class: 'text-dim', text: 'sem prazo' }));
  }

  if (!item.dueTime && item.timePeriod && item.timePeriod !== 'any') {
    meta.appendChild(el('span', { text: PERIOD_LABELS[item.timePeriod] }));
  }

  if (showEnvironment && env) {
    meta.appendChild(el('span', {
      class: 'item__env',
      style: { '--env-color': env.color, color: env.color },
      text: env.name,
    }));
  }

  if (item.priority === 'high' || item.priority === 'urgent') {
    meta.appendChild(el('span', {
      class: 'item__prio item__prio--' + item.priority,
      html: '<i></i><i></i>' + PRIORITY_LABELS[item.priority],
    }));
  }

  if (item.checklist?.length) {
    const doneCount = item.checklist.filter((c) => c.completed).length;
    meta.appendChild(el('span', { class: 'item__checkline' }, [
      el('span', { text: `${doneCount}/${item.checklist.length}` }),
      el('span', { class: 'progress' }, [
        el('span', {
          class: 'progress__bar',
          style: { width: (doneCount / item.checklist.length * 100) + '%' },
        }),
      ]),
    ]));
  }

  if (item.needsReview) {
    meta.appendChild(el('span', {
      class: 'badge badge--overdue',
      text: 'confirmar',
      title: 'A frase foi salva por inteiro; confirme os detalhes quando quiser.',
    }));
  }

  if (item.description) {
    meta.appendChild(el('span', { class: 'text-dim', html: icon('list', 12), title: 'Tem descrição' }));
  }

  main.appendChild(meta);

  /* Ações rápidas */
  const actions = el('div', { class: 'item__actions' });

  const snoozeBtn = el('button', {
    class: 'btn btn--ghost btn--icon btn--sm tip',
    'data-tip': 'Adiar',
    'aria-label': 'Adiar item',
    html: icon('clockBack', 15),
  });
  snoozeBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openMenu(snoozeBtn, [
      { label: 'Para amanhã', icon: 'calendar', onSelect: () => doSnooze(1, 'amanhã') },
      { label: 'Em 3 dias', icon: 'calendar', onSelect: () => doSnooze(3, 'daqui a 3 dias') },
      { label: 'Próxima semana', icon: 'calendar', onSelect: () => doSnooze(7, 'na próxima semana') },
      '-',
      { label: 'Tirar o prazo', icon: 'x', onSelect: () => {
        store.updateItem(item.id, { dueDate: null, dueTime: null });
        toast('Prazo removido. O item continua no ambiente.');
        onChange?.();
      } },
    ]);
  });

  function doSnooze(days, label) {
    store.snoozeItem(item.id, days);
    toast(`Adiado para ${label}.`, {
      action: 'Desfazer',
      onAction: () => { store.updateItem(item.id, { dueDate: item.dueDate }); onChange?.(); },
    });
    onChange?.();
  }

  const moreBtn = el('button', {
    class: 'btn btn--ghost btn--icon btn--sm',
    'aria-label': 'Mais ações',
    html: icon('settings', 15),
  });
  moreBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openMenu(moreBtn, [
      { label: 'Abrir detalhes', icon: 'edit', key: 'Enter', onSelect: () => openItemDetail(item.id, onChange) },
      { label: item.pinned ? 'Desafixar' : 'Fixar no topo', icon: 'star', onSelect: () => {
        store.updateItem(item.id, { pinned: !item.pinned });
        onChange?.();
      } },
      '-',
      ...store.activeEnvironments
        .filter((e) => e.id !== item.environmentId)
        .slice(0, 5)
        .map((e) => ({
          label: 'Mover para ' + e.name,
          icon: 'layers',
          onSelect: () => {
            store.updateItem(item.id, { environmentId: e.id });
            toast(`Movido para ${e.name}.`);
            onChange?.();
          },
        })),
      '-',
      { label: 'Enviar para a lixeira', icon: 'trash', danger: true, onSelect: () => removeItem(item, onChange, row) },
    ]);
  });

  actions.append(snoozeBtn, moreBtn);
  row.append(check, main, actions);

  /* Abrir detalhes */
  row.addEventListener('click', (ev) => {
    if (ev.target.closest('button')) return;
    openItemDetail(item.id, onChange);
  });
  row.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); openItemDetail(item.id, onChange); }
    if (ev.key === ' ') { ev.preventDefault(); check.click(); }
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); removeItem(item, onChange, row); }
  });

  return row;
}

async function removeItem(item, onChange, row) {
  if (store.state.prefs.confirmBeforeDelete) {
    const ok = await confirmDialog({
      title: 'Enviar para a lixeira?',
      message: `"${item.title}" fica na lixeira por 30 dias antes de sumir de vez. Dá para restaurar a qualquer momento.`,
      confirmLabel: 'Enviar para a lixeira',
    });
    if (!ok) return;
  }

  row?.classList.add('item--removing');
  setTimeout(() => {
    store.trashItem(item.id);
    toast('Item na lixeira.', {
      action: 'Restaurar',
      onAction: () => { store.restoreItem(item.id); onChange?.(); },
    });
    onChange?.();
  }, 240);
}

/* ---------------------------------------------------------------------
   Detalhes do item
   --------------------------------------------------------------------- */
export function openItemDetail(itemId, onChange = null) {
  const item = store.state.items.find((i) => i.id === itemId);
  if (!item) return;

  const body = el('div', { class: 'detail' });

  /* Título */
  const titleInput = el('input', {
    class: 'detail__title-input',
    value: item.title,
    'aria-label': 'Título',
    maxlength: '280',
  });
  titleInput.addEventListener('change', () => {
    const v = titleInput.value.trim();
    if (v) store.updateItem(item.id, { title: v });
  });

  /* Frase original, quando veio da captura (§24) */
  if (item.rawInput && item.rawInput !== item.title) {
    body.appendChild(el('div', {
      class: 'chip',
      style: { alignSelf: 'flex-start', fontFamily: 'var(--font-mono)' },
      title: 'A frase exatamente como você escreveu',
      html: icon('bolt', 12) + `<span>“${item.rawInput}”</span>`,
    }));
  }

  body.appendChild(titleInput);

  /* Campos principais */
  const grid = el('div', { class: 'detail__meta-grid' });

  const field = (label, control) =>
    el('label', { class: 'field' }, [
      el('span', { class: 'field__label', text: label }),
      control,
    ]);

  const typeSel = el('select', { class: 'select' },
    Object.entries(TYPE_LABELS).map(([v, l]) =>
      el('option', { value: v, text: l, selected: item.type === v })));
  typeSel.addEventListener('change', () => {
    store.updateItem(item.id, { type: typeSel.value });
    onChange?.();
  });

  const prioSel = el('select', { class: 'select' },
    Object.entries(PRIORITY_LABELS).map(([v, l]) =>
      el('option', { value: v, text: l, selected: item.priority === v })));
  prioSel.addEventListener('change', () => {
    store.updateItem(item.id, { priority: prioSel.value });
    onChange?.();
  });

  const dateInput = el('input', { class: 'input', type: 'date', value: item.dueDate || '' });
  dateInput.addEventListener('change', () => {
    store.updateItem(item.id, { dueDate: dateInput.value || null });
    onChange?.();
  });

  const timeInput = el('input', { class: 'input', type: 'time', value: item.dueTime || '' });
  timeInput.addEventListener('change', () => {
    if (timeInput.value && !dateInput.value) {
      dateInput.value = toISODate(todayIn(store.state.prefs.timezone));
      store.updateItem(item.id, { dueDate: dateInput.value });
    }
    store.updateItem(item.id, { dueTime: timeInput.value || null });
    onChange?.();
  });

  const periodSel = el('select', { class: 'select' },
    Object.entries(PERIOD_LABELS).map(([v, l]) =>
      el('option', { value: v, text: l, selected: (item.timePeriod || 'any') === v })));
  periodSel.addEventListener('change', () => {
    store.updateItem(item.id, { timePeriod: periodSel.value });
    onChange?.();
  });

  const envSel = el('select', { class: 'select' }, [
    el('option', { value: '', text: 'Caixa de entrada', selected: !item.environmentId }),
    ...store.activeEnvironments.map((e) =>
      el('option', { value: e.id, text: e.name, selected: item.environmentId === e.id })),
  ]);
  envSel.addEventListener('change', () => {
    store.updateItem(item.id, { environmentId: envSel.value || null });
    onChange?.();
  });

  grid.append(
    field('Tipo', typeSel),
    field('Prioridade', prioSel),
    field('Ambiente', envSel),
    field('Data', dateInput),
    field('Horário', timeInput),
    field('Período', periodSel),
  );
  body.appendChild(grid);

  /* Descrição */
  const desc = el('textarea', {
    class: 'textarea',
    placeholder: 'Detalhes, contexto, links…',
    value: item.description || '',
  });
  desc.addEventListener('change', () => {
    store.updateItem(item.id, { description: desc.value.trim() || null });
  });
  body.appendChild(el('label', { class: 'field' }, [
    el('span', { class: 'field__label', text: 'Descrição' }),
    desc,
  ]));

  /* Checklist */
  const checkWrap = el('div', { class: 'field' });
  checkWrap.appendChild(el('span', { class: 'field__label', text: 'Checklist' }));
  const checkList = el('div', { class: 'checklist' });
  checkWrap.appendChild(checkList);

  const newCheck = el('input', {
    class: 'input',
    placeholder: 'Adicionar um passo e pressionar Enter',
  });
  newCheck.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const v = newCheck.value.trim();
    if (!v) return;
    store.addChecklistItem(item.id, v);
    newCheck.value = '';
    drawChecklist();
    onChange?.();
  });
  checkWrap.appendChild(newCheck);

  function drawChecklist() {
    const fresh = store.state.items.find((i) => i.id === itemId);
    checkList.replaceChildren();

    (fresh?.checklist || []).forEach((entry) => {
      const row = el('div', {
        class: 'checklist__row',
        dataset: { done: String(entry.completed) },
      });

      const box = el('button', {
        class: 'check',
        role: 'checkbox',
        'aria-checked': String(entry.completed),
        'aria-label': entry.title,
        onClick: () => {
          store.updateChecklistItem(item.id, entry.id, { completed: !entry.completed });
          drawChecklist();
          onChange?.();
        },
      });

      const text = el('input', { class: 'checklist__text', value: entry.title });
      text.addEventListener('change', () => {
        store.updateChecklistItem(item.id, entry.id, { title: text.value.trim() || entry.title });
      });

      const del = el('button', {
        class: 'btn btn--ghost btn--icon btn--sm',
        'aria-label': 'Remover passo',
        html: icon('x', 14),
        onClick: () => {
          store.removeChecklistItem(item.id, entry.id);
          drawChecklist();
          onChange?.();
        },
      });

      row.append(box, text, del);
      checkList.appendChild(row);
    });

    if (!(fresh?.checklist || []).length) {
      checkList.appendChild(el('p', {
        class: 'field__hint',
        text: 'Nenhum passo ainda. Um item pequeno não precisa virar projeto.',
      }));
    }
  }
  drawChecklist();
  body.appendChild(checkWrap);

  /* Histórico */
  const events = store.eventsFor(item.id);
  if (events.length) {
    const hist = el('div', { class: 'field' });
    hist.appendChild(el('span', { class: 'field__label', text: 'Histórico' }));
    const line = el('div', { class: 'timeline' });
    events.slice(0, 8).forEach((ev) => {
      line.appendChild(el('div', { class: 'timeline__row' }, [
        el('span', { text: EVENT_LABELS[ev.action] || ev.action }),
        el('span', {
          class: 'timeline__when',
          text: new Date(ev.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }),
        }),
      ]));
    });
    hist.appendChild(line);
    body.appendChild(hist);
  }

  /* Rodapé */
  const doneBtn = el('button', {
    class: 'btn ' + (item.status === 'done' ? 'btn--outline' : 'btn--primary'),
    html: icon('check', 16) + (item.status === 'done' ? 'Reabrir' : 'Concluir'),
  });

  const trashBtn = el('button', {
    class: 'btn btn--danger',
    html: icon('trash', 16) + 'Lixeira',
  });

  const dialog = openModal({
    title: 'Detalhes do item',
    body,
    footer: [trashBtn, doneBtn],
    wide: true,
    onClose: () => onChange?.(),
  });

  doneBtn.addEventListener('click', () => {
    store.toggleItem(item.id);
    onChange?.();
    dialog.close();
  });

  trashBtn.addEventListener('click', async () => {
    await removeItem(item, onChange, null);
    dialog.close();
  });
}
