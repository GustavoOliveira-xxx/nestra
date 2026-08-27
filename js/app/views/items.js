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
import { celebrateCompletion, completionEffect, resolveColor } from '../../gfx/complete.js';

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

    // O dado muda na hora; só o redesenho da tela é que espera.
    store.toggleItem(item.id);

    if (!willComplete) {
      onChange?.();
      return;
    }

    /* A própria linha já mostra o novo estado antes de a tela inteira se
       redesenhar: o visto marca, o título ganha o risco e a trilha do
       tipo apaga. Sem isso a resposta ao clique chegaria só depois da
       animação, que é exatamente o que ela não pode custar. */
    row.dataset.status = 'done';
    check.setAttribute('aria-checked', 'true');
    check.setAttribute('aria-label', 'Reabrir item');

    const wait = celebrateCompletion(row, check, {
      color: resolveColor(row),
      mode: store.state.prefs.afterComplete,
    });

    setTimeout(() => onChange?.(), wait);
  });

  /* Corpo */
  const main = el('div', { class: 'item__main' });
  main.appendChild(el('div', { class: 'item__title', text: item.title }));

  const meta = el('div', { class: 'item__meta' });

  meta.appendChild(el('span', {
    style: { color: TYPE_COLOR[item.type] },
    html: icon(TYPE_ICON[item.type], 12) + `<span>${TYPE_LABELS[item.type]}</span>`,
  }));

  /* Uma data que não dá para ler não vira ficha nenhuma — nem a de data,
     nem a de "sem prazo", que seria mentira. Some em silêncio até o dado
     bom chegar. */
  const dateLabel = humanDate(item.dueDate, store.state.prefs.timezone);

  if (dateLabel) {
    const today = toISODate(todayIn(store.state.prefs.timezone));
    const cls = overdue ? ' item__date--overdue' : item.dueDate === today ? ' item__date--today' : '';
    meta.appendChild(el('span', {
      class: 'item__date' + cls,
      html: icon(overdue ? 'alert' : 'calendar', 12) +
        `<span>${dateLabel}${item.dueTime ? ' · ' + item.dueTime : ''}</span>`,
      title: item.dueDate,
    }));
  } else if (!item.dueDate && item.status === 'pending') {
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

  /* Frase original, quando veio da captura (§24) */
  if (item.rawInput && item.rawInput !== item.title) {
    body.appendChild(el('div', {
      class: 'chip detail__raw-input',
      style: { alignSelf: 'flex-start', fontFamily: 'var(--font-mono)' },
      title: 'A frase exatamente como você escreveu',
    }, [
      el('span', { html: icon('bolt', 12) }),
      el('span', { text: `“${item.rawInput}”` }),
    ]));
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

  const prioSel = el('select', { class: 'select' },
    Object.entries(PRIORITY_LABELS).map(([v, l]) =>
      el('option', { value: v, text: l, selected: item.priority === v })));

  const dateInput = el('input', { class: 'input', type: 'date', value: item.dueDate || '' });

  const timeInput = el('input', { class: 'input', type: 'time', value: item.dueTime || '' });

  const periodSel = el('select', { class: 'select' },
    Object.entries(PERIOD_LABELS).map(([v, l]) =>
      el('option', { value: v, text: l, selected: (item.timePeriod || 'any') === v })));

  const envSel = el('select', { class: 'select' }, [
    el('option', { value: '', text: 'Caixa de entrada', selected: !item.environmentId }),
    ...store.activeEnvironments.map((e) =>
      el('option', { value: e.id, text: e.name, selected: item.environmentId === e.id })),
  ]);

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
    maxlength: '4000',
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
  let draftChecklist = (item.checklist || []).map((entry, position) => ({
    ...entry,
    position: Number.isInteger(entry.position) ? entry.position : position,
  }));

  const newCheck = el('input', {
    class: 'input',
    placeholder: 'Adicionar um passo e pressionar Enter',
  });
  newCheck.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const v = newCheck.value.trim();
    if (!v) return;
    draftChecklist.push({
      id: crypto.randomUUID(),
      title: v.slice(0, 200),
      completed: false,
      position: draftChecklist.length,
    });
    newCheck.value = '';
    drawChecklist();
  });
  checkWrap.appendChild(newCheck);

  function drawChecklist() {
    checkList.replaceChildren();

    draftChecklist.forEach((entry) => {
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
          const willComplete = !entry.completed;
          entry.completed = willComplete;
          if (willComplete) {
            box.setAttribute('aria-checked', 'true');
            box.classList.add('check--just-done');
            // Um passo é menor que um item: o selo vem na medida dele.
            completionEffect(box, { color: resolveColor(null), scale: 0.72 });
            setTimeout(drawChecklist, 260);
            return;
          }
          drawChecklist();
        },
      });

      const text = el('input', {
        class: 'checklist__text',
        value: entry.title,
        'aria-label': `Editar passo: ${entry.title}`,
      });
      text.addEventListener('input', () => {
        entry.title = text.value.slice(0, 200);
      });

      const del = el('button', {
        class: 'btn btn--ghost btn--icon btn--sm',
        'aria-label': 'Remover passo',
        html: icon('x', 14),
        onClick: () => {
          draftChecklist = draftChecklist
            .filter((candidate) => candidate.id !== entry.id)
            .map((candidate, position) => ({ ...candidate, position }));
          drawChecklist();
        },
      });

      row.append(box, text, del);
      checkList.appendChild(row);
    });

    if (!draftChecklist.length) {
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

  /* Rodapé. Os campos principais formam um único cadastro: só são
     aplicados juntos pelo botão Salvar. Antes cada `change` gravava uma
     parte em um momento diferente, então fechar o modal podia deixar um
     item pela metade — sobretudo no celular. */
  const cancelBtn = el('button', {
    class: 'btn btn--ghost',
    text: 'Cancelar',
  });

  const saveBtn = el('button', {
    class: 'btn btn--primary',
    html: icon('check', 16) + 'Salvar alterações',
  });

  const doneBtn = el('button', {
    class: 'btn btn--outline',
    html: icon('check', 16) + (item.status === 'done' ? 'Reabrir' : 'Concluir'),
  });

  const trashBtn = el('button', {
    class: 'btn btn--danger',
    style: { marginRight: 'auto' },
    html: icon('trash', 16) + 'Lixeira',
  });

  const dialog = openModal({
    title: 'Detalhes do item',
    body,
    footer: [trashBtn, cancelBtn, doneBtn, saveBtn],
    wide: true,
    onClose: () => onChange?.(),
  });

  function saveChanges({ close = true, announce = true } = {}) {
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.setAttribute('aria-invalid', 'true');
      titleInput.focus();
      toast('O item precisa de um título.', { kind: 'warn' });
      return false;
    }
    titleInput.removeAttribute('aria-invalid');

    let dueDate = dateInput.value || null;
    const dueTime = timeInput.value || null;
    if (dueTime && !dueDate) {
      dueDate = toISODate(todayIn(store.state.prefs.timezone));
      dateInput.value = dueDate;
    }

    const values = {
      title,
      type: typeSel.value,
      priority: prioSel.value,
      environmentId: envSel.value || null,
      dueDate,
      dueTime,
      timePeriod: periodSel.value,
      description: desc.value.trim() || null,
      // Abrir, conferir e salvar é a confirmação explícita do cadastro.
      needsReview: false,
    };

    const patch = {};
    for (const [key, value] of Object.entries(values)) {
      const previous = item[key] ?? null;
      if (!Object.is(previous, value)) patch[key] = value;
    }

    if (Object.keys(patch).length) {
      store.updateItem(item.id, patch);
    }

    /* Checklist participa do mesmo Salvar/Cancelar do restante do modal.
       Isso evita que adicionar ou remover um passo seja gravado mesmo
       quando a pessoa cancela o cadastro. */
    const originalChecklist = item.checklist || [];
    const originalSnapshot = originalChecklist.map(({ id, title, completed, position }) => ({
      id, title, completed: Boolean(completed), position,
    }));
    const normalizedDraft = draftChecklist.map(({ id, title, completed }, index) => ({
      id,
      title: String(title || '').trim(),
      completed: Boolean(completed),
      position: index,
    })).filter((entry) => entry.title);
    const checklistChanged = JSON.stringify(originalSnapshot) !== JSON.stringify(normalizedDraft);
    const originalById = new Map(originalChecklist.map((entry) => [entry.id, entry]));
    const draftIds = new Set(draftChecklist.map((entry) => entry.id));

    originalChecklist
      .filter((entry) => !draftIds.has(entry.id))
      .forEach((entry) => store.removeChecklistItem(item.id, entry.id));

    draftChecklist.forEach((entry, position) => {
      const cleanTitle = String(entry.title || '').trim().slice(0, 200);
      const original = originalById.get(entry.id);
      if (!cleanTitle) {
        if (original) store.removeChecklistItem(item.id, entry.id);
        return;
      }
      if (!original) {
        store.addChecklistItem(item.id, cleanTitle, {
          id: entry.id,
          completed: entry.completed,
          position,
        });
        return;
      }
      const checklistPatch = {};
      if (original.title !== cleanTitle) checklistPatch.title = cleanTitle;
      if (Boolean(original.completed) !== Boolean(entry.completed)) checklistPatch.completed = Boolean(entry.completed);
      if (original.position !== position) checklistPatch.position = position;
      if (Object.keys(checklistPatch).length) {
        store.updateChecklistItem(item.id, entry.id, checklistPatch);
      }
    });

    if (announce) {
      if (Object.keys(patch).length || checklistChanged) {
        toast('Alterações salvas.', { kind: 'success' });
      } else {
        toast('Nenhuma alteração para salvar.');
      }
    }
    if (Object.keys(patch).length || checklistChanged) onChange?.();

    if (close) dialog.close();
    return true;
  }

  cancelBtn.addEventListener('click', () => dialog.close());
  saveBtn.addEventListener('click', () => saveChanges());

  doneBtn.addEventListener('click', () => {
    // Se a pessoa editou e concluiu no mesmo gesto, nenhuma edição fica
    // perdida só porque ela não clicou no botão ao lado primeiro.
    if (!saveChanges({ close: false, announce: false })) return;
    const willComplete = item.status !== 'done';
    store.toggleItem(item.id);
    if (willComplete) {
      // Aqui o alvo é um botão largo: o selo cresce junto com ele.
      completionEffect(doneBtn);
      setTimeout(() => { onChange?.(); dialog.close(); }, 300);
      return;
    }
    onChange?.();
    dialog.close();
  });

  trashBtn.addEventListener('click', async () => {
    await removeItem(item, onChange, null);
    dialog.close();
  });
}
